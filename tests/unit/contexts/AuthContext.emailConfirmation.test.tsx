import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { isEmailNotConfirmedError } from '@/lib/auth/email-confirmation';

// AuthProvider and the two rules of this change: a sign in of an address that
// is not confirmed yet fails with its own kind of error (the login form offers
// the e-mail again), and the own password is changed only with 8 characters
// and only through the server, which checks the CURRENT password first
// (WMCNL-2965): the browser no longer calls auth.updateUser itself.

const mockSupabase: any = {
  auth: {
    getSession: jest.fn(),
    onAuthStateChange: jest.fn(),
    signOut: jest.fn(),
    signInWithPassword: jest.fn(),
    updateUser: jest.fn(),
  },
  from: jest.fn(),
};

jest.mock('@/lib/supabase', () => ({
  __esModule: true,
  supabase: mockSupabase,
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/login',
}));

import { AuthProvider, useAuth } from '@/contexts/AuthContext';

function Probe({ password, current }: { password: string; current: string }) {
  const { signIn, changePassword } = useAuth();
  const [result, setResult] = React.useState('');
  const [kind, setKind] = React.useState('');
  return (
    <>
      <button
        onClick={() =>
          signIn('azubi@example.com', 'secret12')
            .then(() => setResult('signed in'))
            .catch((e: unknown) => {
              setKind(isEmailNotConfirmedError(e) ? 'not-confirmed' : 'other');
              setResult((e as Error).message);
            })
        }
      >
        login
      </button>
      <button
        onClick={() =>
          changePassword(current, password)
            .then(() => setResult('changed'))
            .catch((e: Error & { code?: string }) =>
              setResult(e.code ?? e.message)
            )
        }
      >
        change
      </button>
      <div data-testid="result">{result}</div>
      <div data-testid="kind">{kind}</div>
    </>
  );
}

async function run(
  buttonText: string,
  password = 'irrelevant',
  current = 'current-pass'
) {
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <Probe password={password} current={current} />
    </AuthProvider>
  );
  await user.click(screen.getByText(buttonText));
  await waitFor(() =>
    expect(screen.getByTestId('result').textContent).not.toBe('')
  );
}

describe('AuthProvider and the confirmation of the e-mail address', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
    mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
    mockSupabase.auth.signOut.mockResolvedValue({});
    mockSupabase.auth.updateUser.mockResolvedValue({ data: {}, error: null });
    // the SDK refuses, the direct request after it tells why
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Email not confirmed' },
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const directAnswer = (status: number, text: string) =>
    jest.fn().mockResolvedValue({
      ok: false,
      status,
      text: () => Promise.resolve(text),
    });

  describe('signIn', () => {
    it('an address that is not confirmed fails with EmailNotConfirmedError and the German text', async () => {
      global.fetch = directAnswer(
        400,
        '{"code":400,"error_code":"email_not_confirmed","msg":"Email not confirmed"}'
      ) as any;
      await run('login');
      expect(screen.getByTestId('kind')).toHaveTextContent('not-confirmed');
      expect(screen.getByTestId('result')).toHaveTextContent(
        'E-Mail ist noch nicht bestätigt.'
      );
    });

    it('a wrong password stays a plain error with its own text', async () => {
      global.fetch = directAnswer(
        400,
        '{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}'
      ) as any;
      await run('login');
      expect(screen.getByTestId('kind')).toHaveTextContent('other');
      expect(screen.getByTestId('result')).toHaveTextContent(
        'E-Mail oder Passwort ist falsch.'
      );
    });
  });

  describe('changePassword', () => {
    const serverAnswer = (status: number, body: unknown) =>
      jest.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      });

    it.each(['', 'short', '1234567'])(
      'refuses %j as the new password with its code and sends nothing',
      async password => {
        global.fetch = jest.fn() as any;
        await run('change', password);
        expect(screen.getByTestId('result')).toHaveTextContent(
          'PASSWORD_INVALID'
        );
        expect(global.fetch).not.toHaveBeenCalled();
        expect(mockSupabase.auth.updateUser).not.toHaveBeenCalled();
      }
    );

    it('refuses an empty current password and sends nothing', async () => {
      global.fetch = jest.fn() as any;
      await run('change', '12345678', '');
      expect(screen.getByTestId('result')).toHaveTextContent(
        'CURRENT_PASSWORD_REQUIRED'
      );
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockSupabase.auth.updateUser).not.toHaveBeenCalled();
    });

    it('changes the password through the server, with the current and the new one, and never through auth.updateUser', async () => {
      global.fetch = serverAnswer(200, { success: true }) as any;
      await run('change', '12345678', 'old-password');
      expect(screen.getByTestId('result')).toHaveTextContent('changed');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('/api/auth/change-password');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        currentPassword: 'old-password',
        newPassword: '12345678',
      });
      expect(mockSupabase.auth.updateUser).not.toHaveBeenCalled();
    });

    it('a wrong current password stays a failure with the code of the server', async () => {
      global.fetch = serverAnswer(400, {
        code: 'CURRENT_PASSWORD_WRONG',
      }) as any;
      await run('change', '12345678', 'wrong');
      expect(screen.getByTestId('result')).toHaveTextContent(
        'CURRENT_PASSWORD_WRONG'
      );
    });

    it('an answer without a known code is a plain FAILED, no text of the server is passed on', async () => {
      global.fetch = serverAnswer(500, {
        error: 'Invalid login credentials from supabase',
      }) as any;
      await run('change', '12345678', 'old-password');
      expect(screen.getByTestId('result').textContent).toBe('FAILED');
    });

    it('a request that cannot be sent is UNAVAILABLE', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as any;
      await run('change', '12345678', 'old-password');
      expect(screen.getByTestId('result').textContent).toBe('UNAVAILABLE');
    });
  });
});
