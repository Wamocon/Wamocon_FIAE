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
  fakeSession,
  makeRequest,
  mockSession,
  type FakeSession,
} from '../../../helpers/mockNext';

// WMCNL-2965 and WMCNL-3030 (and 2936): the password is changed only if the
// CURRENT password is right. The server checks it with a sign in against
// Supabase Auth on a client of its own, then sets the new one. A wrong or a
// missing current password changes nothing, attempts are counted and limited,
// and neither a password nor a text of Supabase ends up in an answer or a log.

const URL_BASE = 'http://localhost/api/auth/change-password';
const OLD = 'old-secret-1';
const NEW = 'new-secret-2';
const SESSION: FakeSession = fakeSession({
  id: 'u1',
  email: 'azubi@example.com',
  role: 'TRAINEE',
  isTrainerLevel: false,
});

type AuthDouble = {
  getUser: jest.Mock<(token?: string) => Promise<any>>;
  signInWithPassword: jest.Mock<(args: any) => Promise<any>>;
  updateUser: jest.Mock<(args: any) => Promise<any>>;
  signOut: jest.Mock<(args?: any) => Promise<any>>;
};

let auth: AuthDouble;
let limiter: {
  reserveAttempt: jest.Mock<(...args: any[]) => Promise<any>>;
  clearAttempts: jest.Mock<(...args: any[]) => Promise<void>>;
};
let created: Array<{ url: string; options: any }>;
let logged: string[];

function setup(who: FakeSession | null = SESSION) {
  jest.resetModules();
  mockSession(who);
  created = [];
  auth = {
    getUser: jest.fn(async () => ({
      data: { user: { id: SESSION.id, email: 'login@example.com' } },
      error: null,
    })),
    signInWithPassword: jest.fn(async (args: any) =>
      args.password === OLD
        ? { data: { session: { access_token: 'check-token' } }, error: null }
        : {
            data: { session: null },
            error: { status: 400, code: 'invalid_credentials' },
          }
    ),
    updateUser: jest.fn(async () => ({ data: {}, error: null })),
    signOut: jest.fn(async () => ({ error: null })),
  };
  jest.doMock('@supabase/supabase-js', () => ({
    __esModule: true,
    createClient: (url: string, _key: string, options: any) => {
      created.push({ url, options });
      return { auth };
    },
  }));
  limiter = {
    reserveAttempt: jest.fn(async () => ({
      allowed: true,
      retryAfterSec: 0,
      failures: 1,
    })),
    clearAttempts: jest.fn(async () => undefined),
  };
  jest.doMock('@/lib/auth/attempt-limiter', () => ({
    __esModule: true,
    ...(jest.requireActual('@/lib/auth/attempt-limiter') as object),
    ...limiter,
  }));
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  const mod = await import('@/app/api/auth/change-password/route');
  const res = await mod.POST(
    makeRequest('POST', URL_BASE, { token: 'browser-token', body, headers })
  );
  return { status: res.status, body: await res.json(), res };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supa.example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-for-test';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'anon-key-for-test';
  logged = [];
  const record = (...args: unknown[]) => {
    logged.push(args.map(a => String(a)).join(' '));
  };
  jest.spyOn(console, 'log').mockImplementation(record);
  jest.spyOn(console, 'warn').mockImplementation(record);
  jest.spyOn(console, 'error').mockImplementation(record);
  setup();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /api/auth/change-password: who may call it', () => {
  it('401 without a session, nothing is asked of Supabase', async () => {
    setup(null);
    const { status } = await post({ currentPassword: OLD, newPassword: NEW });
    expect(status).toBe(401);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/change-password: the current password is required', () => {
  it.each([
    ['missing', { newPassword: NEW }],
    ['empty', { currentPassword: '', newPassword: NEW }],
    ['not a string', { currentPassword: 12345678, newPassword: NEW }],
  ])('400 when the current password is %s, nothing changes', async (_n, b) => {
    const { status, body } = await post(b);
    expect(status).toBe(400);
    expect(body.code).toBe('CURRENT_PASSWORD_REQUIRED');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('400 for a wrong current password and the password is NOT changed', async () => {
    const { status, body } = await post({
      currentPassword: 'not-the-password',
      newPassword: NEW,
    });
    expect(status).toBe(400); // not 401: the browser would repeat a 401
    expect(body.code).toBe('CURRENT_PASSWORD_WRONG');
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('a current password of absurd length is wrong without asking Supabase', async () => {
    const { status, body } = await post({
      currentPassword: 'x'.repeat(5000),
      newPassword: NEW,
    });
    expect(status).toBe(400);
    expect(body.code).toBe('CURRENT_PASSWORD_WRONG');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('checks the current password against the e-mail of the Auth account, not a value of the request', async () => {
    await post({
      currentPassword: OLD,
      newPassword: NEW,
      email: 'someone-else@example.com',
      userId: 'u2',
    });
    expect(auth.getUser).toHaveBeenCalledWith('browser-token');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'login@example.com',
      password: OLD,
    });
  });

  it('refuses when the Auth account is not the one of the session', async () => {
    auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'other', email: 'x@example.com' } },
      error: null,
    });
    const { status } = await post({ currentPassword: OLD, newPassword: NEW });
    expect(status).toBe(400);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/change-password: the new password', () => {
  it.each([
    ['missing', { currentPassword: OLD }],
    ['empty', { currentPassword: OLD, newPassword: '' }],
    ['too short', { currentPassword: OLD, newPassword: 'short' }],
    ['7 characters', { currentPassword: OLD, newPassword: '1234567' }],
  ])('400 when it is %s (the rule of the registration)', async (_n, b) => {
    const { status, body } = await post(b);
    expect(status).toBe(400);
    expect(body.code).toBe('PASSWORD_INVALID');
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('400 when it equals the current password', async () => {
    const { status, body } = await post({
      currentPassword: OLD,
      newPassword: OLD,
    });
    expect(status).toBe(400);
    expect(body.code).toBe('PASSWORD_UNCHANGED');
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('maps a refusal of Supabase Auth to a code without its text', async () => {
    auth.updateUser.mockResolvedValueOnce({
      data: null,
      error: {
        status: 422,
        code: 'weak_password',
        message: 'Password is known to be weak and easy to guess',
      },
    });
    const { status, body } = await post({
      currentPassword: OLD,
      newPassword: NEW,
    });
    expect(status).toBe(400);
    expect(body.code).toBe('PASSWORD_INVALID');
    expect(JSON.stringify(body)).not.toMatch(/weak|guess|supabase/i);
  });
});

describe('POST /api/auth/change-password: the right current password', () => {
  it('changes the password, with the session of the check and on a client that persists nothing', async () => {
    const { status, body } = await post({
      currentPassword: OLD,
      newPassword: NEW,
    });
    expect(status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: NEW });
    // The sign in of the check runs before the change
    expect(auth.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(
      auth.updateUser.mock.invocationCallOrder[0]
    );
    // A client of its own: the session of the browser is neither replaced nor refreshed
    expect(created).toHaveLength(1);
    expect(created[0].options.auth).toMatchObject({
      persistSession: false,
      autoRefreshToken: false,
    });
  });

  it('ends the session of the check afterwards (this one only, scope local)', async () => {
    await post({ currentPassword: OLD, newPassword: NEW });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('resets the attempt counter of the person after a success', async () => {
    await post({ currentPassword: OLD, newPassword: NEW });
    expect(limiter.clearAttempts).toHaveBeenCalledTimes(1);
    const [scope, subjects] = limiter.clearAttempts.mock.calls[0] as [
      string,
      string[],
    ];
    expect(scope).toBe('password-change');
    expect(subjects).toContain('user:u1');
  });

  it('a user of any role may change the own password (trainer and admin too)', async () => {
    setup(
      fakeSession({
        id: SESSION.id,
        role: 'ADMIN',
        isAdmin: true,
        isTrainerLevel: true,
      })
    );
    const { status } = await post({ currentPassword: OLD, newPassword: NEW });
    expect(status).toBe(200);
  });
});

describe('POST /api/auth/change-password: rate limit against guessing', () => {
  it('counts the attempt BEFORE the password is compared, per person and per address', async () => {
    await post(
      { currentPassword: 'wrong-one', newPassword: NEW },
      { 'x-forwarded-for': '203.0.113.9' }
    );
    const reserves = limiter.reserveAttempt.mock.calls as any[][];
    expect(reserves.map(c => c[0])).toEqual([
      'password-change',
      'password-change',
    ]);
    expect(reserves[0][1]).toBe('user:u1');
    expect(String(reserves[1][1])).toMatch(/^ip:/);
    expect(limiter.reserveAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      auth.signInWithPassword.mock.invocationCallOrder[0]
    );
  });

  it('a locked person gets 429 with Retry-After and is not even checked', async () => {
    limiter.reserveAttempt.mockResolvedValueOnce({
      allowed: false,
      retryAfterSec: 60,
      failures: 5,
    });
    const { status, body, res } = await post({
      currentPassword: OLD,
      newPassword: NEW,
    });
    expect(status).toBe(429);
    expect(body.code).toBe('TOO_MANY_ATTEMPTS');
    expect(body.retryAfterSec).toBe(60);
    expect(res.headers.get('Retry-After')).toBe('60');
    // Even the RIGHT password does not get through while the lock holds
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('a locked address gets 429 as well', async () => {
    limiter.reserveAttempt
      .mockResolvedValueOnce({ allowed: true, retryAfterSec: 0, failures: 1 })
      .mockResolvedValueOnce({
        allowed: false,
        retryAfterSec: 300,
        failures: 15,
      });
    const { status } = await post(
      { currentPassword: OLD, newPassword: NEW },
      { 'x-forwarded-for': '203.0.113.10' }
    );
    expect(status).toBe(429);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('the memory limit holds when the counter of the database cannot answer', async () => {
    limiter.reserveAttempt.mockRejectedValue(new Error('relation missing'));
    // The first ten attempts are checked (and answered as wrong), the eleventh is refused
    for (let i = 0; i < 10; i++) {
      const { status, body } = await post({
        currentPassword: 'guess-' + i,
        newPassword: NEW,
      });
      expect(status).toBe(400);
      expect(body.code).toBe('CURRENT_PASSWORD_WRONG');
    }
    const last = await post({ currentPassword: OLD, newPassword: NEW });
    expect(last.status).toBe(429);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/change-password: failures of Supabase and the logs', () => {
  it('503 when Supabase Auth cannot be reached, nothing is changed', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: { status: 503, name: 'AuthRetryableFetchError', code: undefined },
    });
    const { status, body } = await post({
      currentPassword: OLD,
      newPassword: NEW,
    });
    expect(status).toBe(503);
    expect(body.code).toBe('UNAVAILABLE');
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('answers carry a code, never a text of the authentication', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: {
        status: 400,
        code: 'invalid_credentials',
        message: 'Invalid login credentials',
      },
    });
    const { body } = await post({ currentPassword: OLD, newPassword: NEW });
    expect(JSON.stringify(body)).not.toMatch(
      /invalid login|credentials|supabase/i
    );
    expect(Object.keys(body).sort()).toEqual(['code', 'error']);
  });

  it('no password and no token ends up in a log line', async () => {
    // success, wrong password, failed change: every path writes logs
    await post({ currentPassword: OLD, newPassword: NEW });
    await post({ currentPassword: 'wrong-guess-9', newPassword: NEW });
    auth.updateUser.mockResolvedValueOnce({
      data: null,
      error: { status: 500, code: 'unexpected_failure', message: NEW + OLD },
    });
    await post({ currentPassword: OLD, newPassword: NEW });
    auth.getUser.mockRejectedValueOnce(
      new Error('boom ' + OLD + ' ' + NEW + ' browser-token')
    );
    await post({ currentPassword: OLD, newPassword: NEW });

    const text = logged.join('\n');
    for (const secret of [
      OLD,
      NEW,
      'wrong-guess-9',
      'browser-token',
      'check-token',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
