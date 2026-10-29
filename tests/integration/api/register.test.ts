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
import { createTableDb } from '../../helpers/mockDb';

// Module under test: POST /api/register (src/app/api/register/route.ts).
// Self-registration always yields a TRAINEE, never takes a role from the
// request, from ADMIN_EMAIL or from an existing profile, and is rate limited.
// It is a normal sign up (auth.signUp with the public key): with "Confirm
// email" on in Supabase the answer has no session and the person has to
// confirm the address, with it off the account is confirmed at once. Both
// answers end the same way: a profile that waits for the release by a trainer.

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

type SignUpAnswer = { data: any; error: any };

/** Supabase with "Confirm email" on: a user, but no session yet. */
const confirmPending = (args: any): SignUpAnswer => ({
  data: {
    user: {
      id: 'new-user',
      email: args.email,
      identities: [{ id: 'identity-1' }],
      email_confirmed_at: null,
    },
    session: null,
  },
  error: null,
});

/** Supabase with mailer_autoconfirm: the user is confirmed and has a session. */
const autoConfirmed = (args: any): SignUpAnswer => ({
  data: {
    user: {
      id: 'new-user',
      email: args.email,
      identities: [{ id: 'identity-1' }],
      email_confirmed_at: '2026-10-29T10:00:00Z',
    },
    session: { access_token: 'a', refresh_token: 'r' },
  },
  error: null,
});

type RegisterOptions = {
  tables?: Parameters<typeof createTableDb>[0];
  signUp?: jest.Mock;
};

async function setup(options: RegisterOptions = {}) {
  jest.resetModules();
  const table = createTableDb(
    options.tables ?? {
      // 1) e-mail lookup, 2) trainer assignment, 3) org + trainer list
      profiles: {
        sequence: [
          [],
          [{ id: 'tr1' }],
          [{ id: 'tr1', organizationId: 'org1' }],
        ],
      },
    }
  );
  jest.doMock('@/db', () => ({ __esModule: true, default: table.db }));
  const signUp =
    options.signUp ??
    (jest.fn() as jest.Mock).mockImplementation(async (args: any) =>
      confirmPending(args)
    );
  const createUser = jest.fn();
  const supa = await import('@supabase/supabase-js');
  (supa.createClient as jest.Mock).mockReturnValue({
    auth: { signUp, admin: { createUser } },
  });
  const mod = await import('@/app/api/register/route');
  return {
    POST: mod.POST as (req: any) => Promise<Response>,
    signUp,
    createUser,
    createClient: supa.createClient as jest.Mock,
    ...table,
  };
}

function makeRequest(
  body: unknown,
  ip = '203.0.113.7',
  extraHeaders: Record<string, string> = {}
) {
  const headers: Record<string, string> = {
    'x-forwarded-for': ip,
    ...extraHeaders,
  };
  return {
    headers: {
      get: (k: string) => headers[k.toLowerCase()] ?? null,
    },
    json: async () => body,
  } as any;
}

const valid = { email: 'azubi@example.com', password: 'secret12' };

describe('API: POST /api/register', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'http://test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.ADMIN_EMAIL;
    delete process.env.DEFAULT_TRAINER_ID;
    delete process.env.DEFAULT_TRAINER_EMAIL;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('creates a TRAINEE that waits for trainer activation and notifies trainers', async () => {
    const { POST, signUp, writes } = await setup();
    const res = await POST(makeRequest(valid));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, role: 'TRAINEE' });
    expect(signUp).toHaveBeenCalledTimes(1);
    expect((signUp.mock.calls[0][0] as any).options.data).toEqual({
      full_name: 'Azubi',
    });
    expect(writes('insert', 'profiles')[0]).toMatchObject({
      id: 'new-user',
      role: 'TRAINEE',
      trainerActivated: false,
      assignedTrainerId: 'tr1',
    });
    expect((writes('insert', 'notifications')[0] as any).type).toBe(
      'TRAINEE_REGISTERED'
    );
  });

  describe('with and without the confirmation of the e-mail address', () => {
    it('Confirm email on: answers with confirmationRequired and still makes the profile wait for the release', async () => {
      const { POST, writes } = await setup();
      const res = await POST(makeRequest(valid));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.confirmationRequired).toBe(true);
      expect(body.role).toBe('TRAINEE');
      expect(writes('insert', 'profiles')[0]).toMatchObject({
        id: 'new-user',
        trainerActivated: false,
        isActive: true,
      });
      // the trainers hear of it, and that the address is not confirmed yet
      const note = writes('insert', 'notifications')[0] as any;
      expect(note.type).toBe('TRAINEE_REGISTERED');
      expect(note.message).toMatch(/noch nicht bestätigt/);
    });

    it('mailer_autoconfirm (session in the answer): unchanged behavior, no confirmation needed', async () => {
      const signUp = (jest.fn() as jest.Mock).mockImplementation(
        async (args: any) => autoConfirmed(args)
      );
      const { POST, writes } = await setup({ signUp });
      const res = await POST(makeRequest(valid));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({
        success: true,
        role: 'TRAINEE',
        confirmationRequired: false,
        user: { id: 'new-user', email: 'azubi@example.com' },
      });
      expect(writes('insert', 'profiles')[0]).toMatchObject({
        id: 'new-user',
        role: 'TRAINEE',
        trainerActivated: false,
      });
      const note = writes('insert', 'notifications')[0] as any;
      expect(note.message).not.toMatch(/noch nicht bestätigt/);
    });

    it('a confirmed user without a session needs no confirmation either', async () => {
      const signUp = (jest.fn() as jest.Mock).mockImplementation(
        async (args: any) => {
          const answer = autoConfirmed(args);
          answer.data.session = null;
          return answer;
        }
      );
      const { POST } = await setup({ signUp });
      const res = await POST(makeRequest(valid));
      expect((await res.json()).confirmationRequired).toBe(false);
    });

    it('is a plain sign up with the public key: no auth.admin, no service key', async () => {
      const { POST, createClient, createUser } = await setup();
      await POST(makeRequest(valid));
      expect(createUser).not.toHaveBeenCalled();
      expect(createClient).toHaveBeenCalledTimes(1);
      expect(createClient.mock.calls[0][1]).toBe('anon');
    });

    it('sends the link to /auth/callback of the configured public URL', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://fiae-learn.com/';
      const { POST, signUp } = await setup();
      await POST(
        makeRequest(valid, '203.0.113.7', {
          'x-forwarded-host': 'evil.example',
          'x-forwarded-proto': 'https',
        })
      );
      expect((signUp.mock.calls[0][0] as any).options.emailRedirectTo).toBe(
        'https://fiae-learn.com/auth/callback'
      );
    });

    it('without a configured URL it falls back to the host of the request', async () => {
      const { POST, signUp } = await setup();
      await POST(
        makeRequest(valid, '203.0.113.7', {
          'x-forwarded-host': 'preview.fiae-learn.com',
          'x-forwarded-proto': 'https',
        })
      );
      expect((signUp.mock.calls[0][0] as any).options.emailRedirectTo).toBe(
        'https://preview.fiae-learn.com/auth/callback'
      );
    });

    it('Confirm email on and the address already confirmed: Supabase answers with a user without identities, that is 409 and no profile', async () => {
      const signUp = (jest.fn() as jest.Mock).mockImplementation(
        async (args: any) => {
          const answer = confirmPending(args);
          answer.data.user.identities = [];
          return answer;
        }
      );
      const { POST, writes } = await setup({
        tables: { profiles: [] },
        signUp,
      });
      const res = await POST(makeRequest(valid));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/bereits registriert/);
      expect(writes('insert', 'profiles')).toHaveLength(0);
      expect(writes('insert', 'notifications')).toHaveLength(0);
    });

    it('500 if Supabase answers without a user', async () => {
      const signUp = (jest.fn() as jest.Mock).mockImplementation(async () => ({
        data: { user: null, session: null },
        error: null,
      }));
      const { POST, writes } = await setup({
        tables: { profiles: [] },
        signUp,
      });
      const res = await POST(makeRequest(valid));
      expect(res.status).toBe(500);
      expect(writes('insert', 'profiles')).toHaveLength(0);
    });
  });

  it('ignores a role sent in the request body', async () => {
    const { POST, writes } = await setup();
    const res = await POST(
      makeRequest({ ...valid, role: 'ADMIN', user_metadata: { role: 'ADMIN' } })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe('TRAINEE');
    expect((writes('insert', 'profiles')[0] as any).role).toBe('TRAINEE');
  });

  it('does not grant ADMIN to the ADMIN_EMAIL address', async () => {
    process.env.ADMIN_EMAIL = 'boss@example.com';
    const { POST, writes } = await setup();
    const res = await POST(
      makeRequest({ email: 'Boss@Example.com', password: 'secret12' })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe('TRAINEE');
    expect((writes('insert', 'profiles')[0] as any).role).toBe('TRAINEE');
  });

  it('409 and no auth user if a profile with this e-mail already exists', async () => {
    const { POST, signUp } = await setup({
      tables: { profiles: [{ id: 'existing', role: 'ADMIN' }] },
    });
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/bereits registriert/);
    expect(signUp).not.toHaveBeenCalled();
  });

  describe('errors of the sign up', () => {
    const failing = (error: any) =>
      (jest.fn() as jest.Mock).mockImplementation(async () => ({
        data: { user: null, session: null },
        error,
      }));

    it.each([
      [
        'code user_already_exists',
        { status: 422, code: 'user_already_exists', message: 'x' },
        409,
        /bereits registriert/,
      ],
      [
        'code email_exists',
        { status: 422, code: 'email_exists', message: 'x' },
        409,
        /bereits registriert/,
      ],
      [
        'the old message of an address that is registered',
        {
          status: 422,
          message: 'A user with this email address has already been registered',
        },
        409,
        /bereits registriert/,
      ],
      [
        'a weak password is no "already registered"',
        { status: 422, code: 'weak_password', message: 'Password is weak' },
        400,
        /Passwort wird nicht akzeptiert/,
      ],
      [
        'the limit of the mail sending',
        { status: 429, code: 'over_email_send_rate_limit', message: 'x' },
        429,
        /keine weiteren E-Mails/,
      ],
      [
        'sign ups switched off in Supabase',
        { status: 422, code: 'signup_disabled', message: 'x' },
        503,
        /Selbstregistrierung/,
      ],
      [
        'an address Supabase does not accept',
        { status: 400, code: 'email_address_invalid', message: 'x' },
        400,
        /gültige E-Mail/,
      ],
      [
        'anything else, without the raw message',
        { status: 500, message: 'secret internal detail' },
        400,
        /Registrierung ist fehlgeschlagen/,
      ],
    ])('%s', async (_name, error, status, message) => {
      const { POST, writes } = await setup({
        tables: { profiles: [] },
        signUp: failing(error),
      });
      const res = await POST(makeRequest(valid));
      const body = await res.json();
      expect(res.status).toBe(status);
      expect(body.error).toMatch(message);
      expect(JSON.stringify(body)).not.toMatch(/secret internal detail/);
      expect(writes('insert', 'profiles')).toHaveLength(0);
    });
  });

  describe('the password rule (at least 8 characters)', () => {
    it.each([
      [{ email: '', password: 'secret12' }, /erforderlich/],
      [{ email: 'not-an-email', password: 'secret12' }, /gültige E-Mail/],
      [{ email: 'azubi@example.com', password: '123' }, /mindestens 8 Zeichen/],
      [
        { email: 'azubi@example.com', password: 'sixsix' },
        /mindestens 8 Zeichen/,
      ],
      [
        { email: 'azubi@example.com', password: '1234567' },
        /mindestens 8 Zeichen/,
      ],
    ])(
      '400 with a clear message for invalid input %#',
      async (payload, message) => {
        const { POST, signUp } = await setup();
        const res = await POST(makeRequest(payload));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(message);
        expect(signUp).not.toHaveBeenCalled();
      }
    );

    it('exactly 8 characters are accepted, without further demands', async () => {
      const { POST, signUp } = await setup();
      const res = await POST(
        makeRequest({ email: 'azubi@example.com', password: 'aaaaaaaa' })
      );
      expect(res.status).toBe(200);
      expect(signUp).toHaveBeenCalledTimes(1);
    });
  });

  it('400 for an unreadable body', async () => {
    const { POST } = await setup();
    const res = await POST({
      headers: { get: () => null },
      json: async () => {
        throw new Error('bad json');
      },
    } as any);
    expect(res.status).toBe(400);
  });

  it('429 with Retry-After after five registrations from the same address', async () => {
    const { POST } = await setup({ tables: { profiles: [] } });
    for (let i = 0; i < 5; i++) {
      const ok = await POST(
        makeRequest({ email: `azubi${i}@example.com`, password: 'secret12' })
      );
      expect(ok.status).toBe(200);
    }
    const blocked = await POST(makeRequest(valid));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await blocked.json()).error).toMatch(
      /Zu viele Registrierungsversuche/
    );

    // A different client address is not affected
    const other = await POST(makeRequest(valid, '198.51.100.9'));
    expect(other.status).toBe(200);
  });
});
