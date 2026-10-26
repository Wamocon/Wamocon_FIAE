/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';

// Behavior under test: src/lib/auth/attempt-limiter.ts, the database backed
// counter behind the lock after too many wrong PINs. The decision is made by ONE
// upsert (see supabase/migrations/20261029000200_auth_attempts.sql), so these
// tests check the statement that is sent, how the answer of the database is
// turned into a decision, and that a database error is never a green light.
// The semantics of the SQL itself were run against a throwaway database.

const dialect = new PgDialect();

type Row = {
  failures: number;
  last_allowed: boolean;
  retry_after: number;
};

async function load(rows: Row[] | Error = []) {
  jest.resetModules();
  const execute = jest.fn(async (..._args: unknown[]) => {
    if (rows instanceof Error) throw rows;
    return rows;
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: { execute } }));
  const mod = await import('@/lib/auth/attempt-limiter');
  const sent = () =>
    execute.mock.calls.map(call => dialect.sqlToQuery(call[0] as any));
  return { mod, execute, sent };
}

describe('policies', () => {
  it('lock a person after 5 attempts for 1, 5 and then 15 minutes', async () => {
    const { mod } = await load();
    expect(mod.PIN_USER_POLICY.threshold).toBe(5);
    expect(mod.PIN_USER_POLICY.lockSeconds).toEqual([60, 300, 900]);
  });

  it('give an address more room than a person, so a shared office address is not locked by one colleague', async () => {
    const { mod } = await load();
    expect(mod.PIN_IP_POLICY.threshold).toBeGreaterThan(
      mod.PIN_USER_POLICY.threshold
    );
    expect(mod.PIN_IP_POLICY.lockSeconds).toEqual(
      mod.PIN_USER_POLICY.lockSeconds
    );
  });

  it('name the check once', async () => {
    const { mod } = await load();
    expect(mod.HAI_PIN_SCOPE).toBe('hai-admin-pin');
    expect(mod.HAI_PIN_SCOPE.length).toBeLessThanOrEqual(64);
  });
});

describe('subjects', () => {
  it('names a person by the profile id', async () => {
    const { mod } = await load();
    expect(mod.userSubject('1f0c')).toBe('user:1f0c');
  });

  it('hashes an address, so no address is stored and the length is bounded', async () => {
    const { mod } = await load();
    const a = mod.ipSubject('203.0.113.7');
    expect(a).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(a).not.toContain('203.0.113.7');
    expect(mod.ipSubject('203.0.113.7')).toBe(a);
    expect(mod.ipSubject('203.0.113.8')).not.toBe(a);
    // a header value of any length ends in the same short key
    expect(mod.ipSubject('x'.repeat(10_000))).toMatch(/^ip:[0-9a-f]{32}$/);
  });

  it('has no key for an unknown address, so unknown callers do not share one counter', async () => {
    const { mod } = await load();
    expect(mod.ipSubject('unknown')).toBeNull();
    expect(mod.ipSubject('')).toBeNull();
  });

  it('stays below the column limit of the table (128)', async () => {
    const { mod } = await load();
    const uuid = '00000000-0000-0000-0000-000000000001';
    expect(mod.userSubject(uuid).length).toBeLessThanOrEqual(128);
    expect(mod.ipSubject('1.2.3.4')!.length).toBeLessThanOrEqual(128);
  });
});

describe('reserveAttempt', () => {
  it('lets an attempt through when the database says so', async () => {
    const { mod } = await load([
      { failures: 1, last_allowed: true, retry_after: 0 },
    ]);
    const decision = await mod.reserveAttempt(
      mod.HAI_PIN_SCOPE,
      'user:a',
      mod.PIN_USER_POLICY
    );
    expect(decision).toEqual({ allowed: true, retryAfterSec: 0, failures: 1 });
  });

  it('refuses while a lock is active and tells how long', async () => {
    const { mod } = await load([
      { failures: 5, last_allowed: false, retry_after: 42 },
    ]);
    const decision = await mod.reserveAttempt(
      mod.HAI_PIN_SCOPE,
      'user:a',
      mod.PIN_USER_POLICY
    );
    expect(decision).toEqual({
      allowed: false,
      retryAfterSec: 42,
      failures: 5,
    });
  });

  it('lets the attempt that reaches the threshold through, with the lock that now starts', async () => {
    const { mod } = await load([
      { failures: 5, last_allowed: true, retry_after: 60 },
    ]);
    const decision = await mod.reserveAttempt(
      mod.HAI_PIN_SCOPE,
      'user:a',
      mod.PIN_USER_POLICY
    );
    expect(decision.allowed).toBe(true);
    expect(decision.retryAfterSec).toBe(60);
  });

  it('treats a refused attempt as at least one second, never as zero', async () => {
    const { mod } = await load([
      { failures: 5, last_allowed: false, retry_after: 0 },
    ]);
    const decision = await mod.reserveAttempt(
      mod.HAI_PIN_SCOPE,
      'user:a',
      mod.PIN_USER_POLICY
    );
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('reads numeric strings of the driver as numbers', async () => {
    const { mod } = await load([
      { failures: '3', last_allowed: true, retry_after: '0' } as any,
    ]);
    const decision = await mod.reserveAttempt(
      mod.HAI_PIN_SCOPE,
      'user:a',
      mod.PIN_USER_POLICY
    );
    expect(decision).toEqual({ allowed: true, retryAfterSec: 0, failures: 3 });
  });

  it('sends ONE statement: an upsert that counts and decides in the database', async () => {
    const { mod, execute, sent } = await load([
      { failures: 1, last_allowed: true, retry_after: 0 },
    ]);
    await mod.reserveAttempt(mod.HAI_PIN_SCOPE, 'user:a', mod.PIN_USER_POLICY);
    expect(execute).toHaveBeenCalledTimes(1);
    const { sql, params } = sent()[0];
    expect(sql).toMatch(/insert into "?auth_attempts"? as a/i);
    expect(sql).toMatch(/on conflict \(scope, subject\) do update set/i);
    // the time and the window come from the database, not from the instance
    expect(sql).toMatch(/now\(\)/);
    expect(sql).toMatch(/last_allowed =/);
    expect(sql).toMatch(/returning/i);
    // the check is not a read followed by a write
    expect(sql).not.toMatch(/^\s*select/i);
    // scope and subject are bound parameters, nothing is spliced into the text
    expect(params).toEqual(expect.arrayContaining(['hai-admin-pin', 'user:a']));
    expect(sql).not.toContain('user:a');
  });

  it('does not extend a lock and does not count a refused attempt', async () => {
    const { mod, sent } = await load([
      { failures: 5, last_allowed: false, retry_after: 10 },
    ]);
    await mod.reserveAttempt(mod.HAI_PIN_SCOPE, 'user:a', mod.PIN_USER_POLICY);
    const { sql } = sent()[0];
    // while locked the counter, the lock and the time of the last attempt stay
    expect(sql).toMatch(/failures = case\s+when .*locked_until > now\(\)/is);
    expect(sql).toMatch(/last_attempt_at = case\s+when/is);
  });

  it('puts the threshold and the lock steps of the policy into the statement', async () => {
    const { mod, sent } = await load([
      { failures: 1, last_allowed: true, retry_after: 0 },
    ]);
    await mod.reserveAttempt('some-scope', 'user:a', {
      threshold: 7,
      lockSeconds: [11, 22],
      quietHours: 3,
    });
    const { sql, params } = sent()[0];
    expect(sql).toMatch(/array\[11,\s*22\]/);
    expect(sql).toMatch(/>= 7/);
    expect(params).toContain('some-scope');
    // the quiet window is a number of hours
    expect(sql).toMatch(/hours => 3/);
  });

  it.each([
    ['a threshold below 2', { threshold: 1, lockSeconds: [60], quietHours: 1 }],
    ['no lock step', { threshold: 5, lockSeconds: [], quietHours: 1 }],
    [
      'a fractional lock step',
      { threshold: 5, lockSeconds: [1.5], quietHours: 1 },
    ],
    [
      'a negative lock step',
      { threshold: 5, lockSeconds: [-60], quietHours: 1 },
    ],
    [
      'a fractional threshold',
      { threshold: 2.5, lockSeconds: [60], quietHours: 1 },
    ],
    ['no quiet window', { threshold: 5, lockSeconds: [60], quietHours: 0 }],
  ])('rejects a policy with %s', async (_name, policy) => {
    const { mod, execute } = await load();
    await expect(
      mod.reserveAttempt(mod.HAI_PIN_SCOPE, 'user:a', policy)
    ).rejects.toThrow(/policy/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('never ends in a green light when the database fails', async () => {
    const { mod } = await load(new Error('connection refused'));
    await expect(
      mod.reserveAttempt(mod.HAI_PIN_SCOPE, 'user:a', mod.PIN_USER_POLICY)
    ).rejects.toThrow('connection refused');
  });

  it('never ends in a green light when the database answers nothing', async () => {
    const { mod } = await load([]);
    await expect(
      mod.reserveAttempt(mod.HAI_PIN_SCOPE, 'user:a', mod.PIN_USER_POLICY)
    ).rejects.toThrow(/no answer/i);
  });
});

describe('clearAttempts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes the rows of the given subjects and removes old rows on the way', async () => {
    const { mod, execute, sent } = await load([]);
    await mod.clearAttempts(mod.HAI_PIN_SCOPE, ['user:a', 'ip:abc']);
    expect(execute).toHaveBeenCalledTimes(1);
    const { sql, params } = sent()[0];
    expect(sql).toMatch(/delete from "?auth_attempts"?/i);
    expect(sql).toMatch(/scope = \$1/);
    expect(sql).toMatch(/last_attempt_at < now\(\)/);
    expect(params).toEqual(
      expect.arrayContaining(['hai-admin-pin', 'user:a', 'ip:abc'])
    );
  });

  it('only touches the given scope', async () => {
    const { mod, sent } = await load([]);
    await mod.clearAttempts('other-scope', ['user:a']);
    expect(sent()[0].params).toContain('other-scope');
    expect(sent()[0].sql).toMatch(/where scope = \$1/i);
  });

  it('does nothing without a subject', async () => {
    const { mod, execute } = await load([]);
    await mod.clearAttempts(mod.HAI_PIN_SCOPE, []);
    expect(execute).not.toHaveBeenCalled();
  });
});
