import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

// AuthProvider.signIn must never hang without a message. The Supabase client
// can wait forever for its auth lock: signInWithPassword then neither answers
// nor fails. The sign in gives the client 12 seconds, then tries the direct
// request to /auth/v1/token (and setSession) for 10 seconds, then fails with
// a clear message. The tests use a signInWithPassword whose promise never
// settles and fake timers.

const TIMEOUT_TEXT =
  'Die Anmeldung dauert zu lange. Bitte laden Sie die Seite neu und versuchen Sie es erneut.';

const mockSupabase: any = {
  auth: {
    getSession: jest.fn(),
    onAuthStateChange: jest.fn(),
    signOut: jest.fn(),
    signInWithPassword: jest.fn(),
    setSession: jest.fn(),
  },
  from: jest.fn(),
  channel: jest.fn(),
};

jest.mock('@/lib/supabase', () => ({
  __esModule: true,
  supabase: mockSupabase,
}));

const replace = jest.fn();
let mockPathname = '/login';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace }),
  usePathname: () => mockPathname,
}));

import { AuthProvider, useAuth } from '@/contexts/AuthContext';

function Harness() {
  const { signIn, loading } = useAuth();
  const [message, setMessage] = React.useState('');
  return (
    <>
      <button
        onClick={() =>
          signIn('diag-niemand@example.invalid', 'secret')
            .then(() => setMessage('signed in'))
            .catch((e: Error) => setMessage(e.message))
        }
      >
        login
      </button>
      <div data-testid="message">{message}</div>
      <div data-testid="loading">{String(loading)}</div>
    </>
  );
}

const never = () => new Promise<never>(() => undefined);

/** The direct requests to the token endpoint (not the profile sync). */
const tokenCalls = () =>
  (global.fetch as jest.Mock).mock.calls.filter(([url]) =>
    /auth\/v1\/token/.test(String(url))
  );

const message = () => screen.getByTestId('message').textContent;
const loading = () => screen.getByTestId('loading').textContent;

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function profileQuery(role = 'TRAINEE') {
  return () => ({
    select: () => ({
      eq: () => ({
        single: () =>
          Promise.resolve({
            data: {
              id: 'u2',
              full_name: 'User Two',
              role,
              avatar_url: null,
              assigned_trainer_id: null,
              start_of_training_date: null,
              ausbildung_duration_years: 3,
              birth_date: null,
              is_active: true,
              trainer_activated: true,
              organization_id: null,
              organizations: null,
            },
            error: null,
          }),
        maybeSingle: () => Promise.resolve({ data: { id: 'u2' } }),
      }),
    }),
  });
}

function renderHarness() {
  render(
    <AuthProvider>
      <Harness />
    </AuthProvider>
  );
  return async () => {
    // let the start up of the provider (getSession) finish before the click
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      fireEvent.click(screen.getByText('login'));
    });
  };
}

describe('AuthProvider.signIn with a signInWithPassword that never answers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockPathname = '/login';
    window.localStorage.clear();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
    });
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
    mockSupabase.auth.signOut.mockResolvedValue({});
    mockSupabase.auth.signInWithPassword.mockImplementation(never);
    mockSupabase.from.mockImplementation(profileQuery());
    global.fetch = jest.fn(never) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('waits 12 seconds for the client, then 10 seconds for the direct request, then shows the message', async () => {
    const clickLogin = renderHarness();
    await clickLogin();
    expect(loading()).toBe('true');

    // within the limit of the client nothing happens and no direct request is sent
    await advance(11_999);
    expect(message()).toBe('');
    expect(tokenCalls()).toHaveLength(0);

    // the limit of the client is hit: the direct request starts
    await advance(1);
    expect(tokenCalls()).toHaveLength(1);
    const [url, init] = tokenCalls()[0];
    expect(String(url)).toMatch(/\/auth\/v1\/token\?grant_type=password$/);
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(message()).toBe('');

    // within the limit of the direct request nothing happens
    await advance(9_999);
    expect(message()).toBe('');
    expect(loading()).toBe('true');

    // the limit of the direct request is hit: a clear message, loading is reset
    await advance(1);
    expect(message()).toBe(TIMEOUT_TEXT);
    expect(loading()).toBe('false');
    // the request is aborted, nothing is signed in or redirected
    expect(init.signal.aborted).toBe(true);
    expect(mockSupabase.auth.setSession).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    // no timer is left behind
    expect(jest.getTimerCount()).toBe(0);
  });

  it('signs in with the direct request when only the client hangs', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ access_token: 'a', refresh_token: 'r' }),
    });
    mockSupabase.auth.setSession.mockResolvedValue({
      data: {
        session: { user: { id: 'u2', email: 'diag-niemand@example.invalid' } },
      },
      error: null,
    });
    const clickLogin = renderHarness();
    await clickLogin();
    await advance(12_000);

    expect(tokenCalls()).toHaveLength(1);
    expect(mockSupabase.auth.setSession).toHaveBeenCalledWith({
      access_token: 'a',
      refresh_token: 'r',
    });
    expect(message()).toBe('signed in');
    expect(replace).toHaveBeenCalledWith('/trainee/dashboard');
    expect(loading()).toBe('false');
  });

  it('keeps the message for a wrong password when the client hangs and the direct request answers 400', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('invalid login credentials'),
    });
    const clickLogin = renderHarness();
    await clickLogin();
    await advance(12_000);
    expect(message()).toBe('E-Mail oder Passwort ist falsch.');
    expect(loading()).toBe('false');
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the message when the direct request answers but setSession hangs too', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ access_token: 'a', refresh_token: 'r' }),
    });
    mockSupabase.auth.setSession.mockImplementation(never);
    const clickLogin = renderHarness();
    await clickLogin();
    await advance(12_000);
    expect(message()).toBe('');
    await advance(10_000);
    expect(message()).toBe(TIMEOUT_TEXT);
    expect(loading()).toBe('false');
    expect(replace).not.toHaveBeenCalled();
  });

  it('ignores an answer of the client that comes after its limit', async () => {
    let answerLate: (value: unknown) => void = () => undefined;
    mockSupabase.auth.signInWithPassword.mockImplementation(
      () =>
        new Promise(resolve => {
          answerLate = resolve;
        })
    );
    const clickLogin = renderHarness();
    await clickLogin();
    await advance(12_000);
    await act(async () => {
      answerLate({
        data: { user: { id: 'u2', email: 'diag-niemand@example.invalid' } },
        error: null,
      });
      await Promise.resolve();
    });
    await advance(10_000);
    expect(message()).toBe(TIMEOUT_TEXT);
    expect(replace).not.toHaveBeenCalled();
  });

  it('resets loading and passes on an error that the client throws', async () => {
    mockSupabase.auth.signInWithPassword.mockRejectedValue(
      new Error('network down')
    );
    const clickLogin = renderHarness();
    await clickLogin();
    expect(message()).toBe('network down');
    expect(loading()).toBe('false');
  });

  it('does not start the direct request when the client answers in time', async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'u2', email: 'diag-niemand@example.invalid' } },
      error: null,
    });
    const clickLogin = renderHarness();
    await clickLogin();
    await advance(1);
    expect(message()).toBe('signed in');
    expect(replace).toHaveBeenCalledWith('/trainee/dashboard');
    // never the token request
    expect(tokenCalls()).toHaveLength(0);
    // the limit of the client left no timer that could fire later
    await advance(60_000);
    expect(message()).toBe('signed in');
  });
});

describe('AuthProvider.signIn when the steps after the sign in hang', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockPathname = '/login';
    window.localStorage.clear();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
    });
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
    mockSupabase.auth.signOut.mockResolvedValue({});
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'u2', email: 'diag-niemand@example.invalid' } },
      error: null,
    });
    mockSupabase.from.mockImplementation(profileQuery());
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('skips the background sync and goes on when reading the session hangs', async () => {
    const clickLogin = renderHarness();
    // the start up of the provider has read the session already (it answered)
    mockSupabase.auth.getSession.mockImplementation(never);
    await clickLogin();
    await advance(4_999);
    expect(message()).toBe('');
    await advance(1);
    expect(message()).toBe('signed in');
    expect(replace).toHaveBeenCalledWith('/trainee/dashboard');
    expect(loading()).toBe('false');
  });

  it('ends with the message and no session when the profile never loads', async () => {
    const clickLogin = renderHarness();
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ single: never, maybeSingle: never }),
      }),
    }));
    await clickLogin();
    await advance(14_999);
    expect(message()).toBe('');
    expect(loading()).toBe('true');
    await advance(1);
    expect(message()).toBe(TIMEOUT_TEXT);
    expect(loading()).toBe('false');
    expect(mockSupabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(replace).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('auth_user_cache')).toBeNull();
  });

  it('still ends with the message when the local sign out hangs as well', async () => {
    const clickLogin = renderHarness();
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ single: never, maybeSingle: never }),
      }),
    }));
    mockSupabase.auth.signOut.mockImplementation(never);
    await clickLogin();
    await advance(15_000);
    expect(message()).toBe(TIMEOUT_TEXT);
    await advance(10_000);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('the onAuthStateChange handler of AuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = '/trainer/dashboard';
    window.localStorage.clear();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
    });
    mockSupabase.auth.signOut.mockResolvedValue({});
  });

  afterEach(() => {
    mockPathname = '/login';
    jest.restoreAllMocks();
  });

  it('does not wait for another supabase call (a callback that waits can deadlock the client)', async () => {
    let handler: (event: string, session: unknown) => Promise<void> = async () =>
      undefined;
    mockSupabase.auth.onAuthStateChange.mockImplementation(
      (callback: typeof handler) => {
        handler = callback;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }
    );
    // every supabase query hangs, as it does while the client holds its lock
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ single: never, maybeSingle: never }),
      }),
    }));
    mockSupabase.channel.mockImplementation(() => {
      const channel: any = { on: () => channel, subscribe: () => channel };
      return channel;
    });

    render(
      <AuthProvider>
        <div />
      </AuthProvider>
    );
    expect(mockSupabase.auth.onAuthStateChange).toHaveBeenCalledTimes(1);

    const settled = jest.fn();
    await act(async () => {
      void handler('SIGNED_IN', {
        user: { id: 'u2', email: 'diag-niemand@example.invalid' },
        access_token: 'a',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }).then(settled);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(settled).toHaveBeenCalledTimes(1);
  });
});
