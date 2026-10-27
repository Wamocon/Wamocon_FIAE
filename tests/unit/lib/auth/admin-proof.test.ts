/**
 * @jest-environment node
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  ADMIN_PROOF_HEADER,
  ADMIN_PROOF_TTL_SEC,
  isAdminProofConfigured,
  signAdminProof,
  verifyAdminProof,
} from '@/lib/auth/admin-proof';

// The admin PIN was a gate of the dialog only. Now a right PIN gives a proof:
// a signed token bound to the person (profile id), a purpose and an expiry.
// The routes that start expensive or dangerous work ask for it in the header.
// The key is derived from the server side Supabase secret key, so there is no
// new variable. Without that key nothing is signed and nothing is accepted.

const USER = '99999999-9999-4999-8999-999999999999';
const OTHER = '11111111-1111-4111-8111-111111111111';
const PURPOSE = 'hai-index-admin';
const NOW = 1_800_000_000_000;
const KEY_A = 'test-only-secret-key-aaaaaaaaaaaaaaaaaaaa';
const KEY_B = 'test-only-secret-key-bbbbbbbbbbbbbbbbbbbb';

const saved = { ...process.env };
function setKey(value: string | undefined) {
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (value !== undefined) process.env.SUPABASE_SECRET_KEY = value;
}

beforeEach(() => setKey(KEY_A));
afterEach(() => {
  process.env = { ...saved };
});

const sign = (id = USER, purpose: any = PURPOSE, now = NOW) =>
  signAdminProof(id, purpose, now)!;

describe('admin proof', () => {
  it('names the header and lives ten minutes', () => {
    expect(ADMIN_PROOF_HEADER).toBe('x-admin-pin-proof');
    expect(ADMIN_PROOF_TTL_SEC).toBe(600);
  });

  it('signs a proof that the same person verifies for the same purpose', () => {
    const { proof, expiresAt } = sign();
    expect(expiresAt).toBe(NOW + 600_000);
    expect(verifyAdminProof(proof, USER, PURPOSE, NOW + 1000)).toBe('valid');
  });

  it('does not put the person or the key into the token', () => {
    const { proof } = sign();
    expect(proof).not.toContain(USER);
    expect(proof).not.toContain(KEY_A);
    expect(proof).toMatch(/^v1\.\d+\.[0-9a-f]{64}$/);
  });

  it('is valid up to the expiry and not at or after it', () => {
    const { proof } = sign();
    expect(verifyAdminProof(proof, USER, PURPOSE, NOW + 599_999)).toBe('valid');
    expect(verifyAdminProof(proof, USER, PURPOSE, NOW + 600_000)).toBe(
      'invalid'
    );
    expect(verifyAdminProof(proof, USER, PURPOSE, NOW + 3_600_000)).toBe(
      'invalid'
    );
  });

  it('is bound to the person: the proof of one person is no proof of another', () => {
    const { proof } = sign(USER);
    expect(verifyAdminProof(proof, OTHER, PURPOSE, NOW)).toBe('invalid');
  });

  it('is bound to the purpose', () => {
    const { proof } = sign(USER, PURPOSE);
    expect(verifyAdminProof(proof, USER, 'other-purpose' as any, NOW)).toBe(
      'invalid'
    );
  });

  it('is bound to the key: a proof of another key is refused', () => {
    const { proof } = sign();
    setKey(KEY_B);
    expect(verifyAdminProof(proof, USER, PURPOSE, NOW)).toBe('invalid');
  });

  it('refuses a token with a prolonged expiry', () => {
    const { proof } = sign();
    const [v, , mac] = proof.split('.');
    const prolonged = `${v}.${NOW + 86_400_000}.${mac}`;
    expect(verifyAdminProof(prolonged, USER, PURPOSE, NOW)).toBe('invalid');
  });

  it('refuses a flipped signature', () => {
    const { proof } = sign();
    const last = proof.slice(-1) === '0' ? '1' : '0';
    expect(
      verifyAdminProof(proof.slice(0, -1) + last, USER, PURPOSE, NOW)
    ).toBe('invalid');
  });

  it.each([
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 5],
    ['an object', {}],
    ['an array', ['x']],
    ['another version', `v2.${NOW + 1000}.${'a'.repeat(64)}`],
    ['a short signature', `v1.${NOW + 1000}.abcd`],
    ['a signature with upper case', `v1.${NOW + 1000}.${'A'.repeat(64)}`],
    ['no expiry', `v1..${'a'.repeat(64)}`],
    ['a negative expiry', `v1.-5.${'a'.repeat(64)}`],
    ['a huge value', 'v1.' + '9'.repeat(10000)],
    ['an injection', `v1.${NOW + 1000}.${'a'.repeat(64)}\n`],
  ])('refuses %s', (_name, value) => {
    expect(verifyAdminProof(value, USER, PURPOSE, NOW)).toBe('invalid');
  });

  it('is not valid for an empty person', () => {
    expect(signAdminProof('', PURPOSE, NOW)).toBeNull();
    const { proof } = sign();
    expect(verifyAdminProof(proof, '', PURPOSE, NOW)).toBe('invalid');
  });

  describe('without a key', () => {
    it.each([
      ['no variable', undefined],
      ['an empty variable', ''],
      ['a short placeholder', 'changeme'],
    ])('signs nothing and verifies nothing (%s)', (_name, value) => {
      const { proof } = sign();
      setKey(value);
      expect(isAdminProofConfigured()).toBe(false);
      expect(signAdminProof(USER, PURPOSE, NOW)).toBeNull();
      expect(verifyAdminProof(proof, USER, PURPOSE, NOW)).toBe('unconfigured');
      expect(verifyAdminProof('x', USER, PURPOSE, NOW)).toBe('unconfigured');
    });

    it('also accepts the older name of the same key', () => {
      delete process.env.SUPABASE_SECRET_KEY;
      process.env.SUPABASE_SERVICE_ROLE_KEY = KEY_A;
      expect(isAdminProofConfigured()).toBe(true);
      const { proof } = sign();
      expect(verifyAdminProof(proof, USER, PURPOSE, NOW)).toBe('valid');
    });
  });

  it('is bound to the database schema: a Preview proof is no Production proof', () => {
    // Preview and Production share one Supabase project and so the key
    const before = process.env.NEXT_PUBLIC_DB_SCHEMA;
    const beforeServer = process.env.SUPABASE_DB_SCHEMA;
    delete process.env.SUPABASE_DB_SCHEMA;
    const make = (schema: string | undefined) => {
      if (schema === undefined) delete process.env.NEXT_PUBLIC_DB_SCHEMA;
      else process.env.NEXT_PUBLIC_DB_SCHEMA = schema;
      let mod: typeof import('@/lib/auth/admin-proof') | undefined;
      jest.isolateModules(() => {
        mod = require('@/lib/auth/admin-proof');
      });
      return mod!;
    };
    try {
      const production = make(undefined);
      const preview = make('public_preview');
      const { proof } = production.signAdminProof(USER, PURPOSE, NOW)!;
      expect(production.verifyAdminProof(proof, USER, PURPOSE, NOW)).toBe(
        'valid'
      );
      expect(preview.verifyAdminProof(proof, USER, PURPOSE, NOW)).toBe(
        'invalid'
      );
      const previewProof = preview.signAdminProof(USER, PURPOSE, NOW)!.proof;
      expect(
        production.verifyAdminProof(previewProof, USER, PURPOSE, NOW)
      ).toBe('invalid');
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_DB_SCHEMA;
      else process.env.NEXT_PUBLIC_DB_SCHEMA = before;
      if (beforeServer !== undefined) {
        process.env.SUPABASE_DB_SCHEMA = beforeServer;
      }
    }
  });

  it('uses the current time when none is given', () => {
    const signed = signAdminProof(USER, PURPOSE)!;
    expect(verifyAdminProof(signed.proof, USER, PURPOSE)).toBe('valid');
    expect(Math.abs(signed.expiresAt - (Date.now() + 600_000))).toBeLessThan(
      5000
    );
  });
});
