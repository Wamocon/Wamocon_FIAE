import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// AuthProvider.signIn on a public page (the login page): where the person goes
// after the sign in. Without a caller hint it is the dashboard of the role,
// exactly as before. A caller (the login form) may name another target, for
// example the occupation choice page, and a failing hint never undoes the
// sign in.

let profileRole = 'TRAINEE';

const mockSupabase: any = {
  auth: {
    getSession: jest.fn(),
    onAuthStateChange: jest.fn(),
    signOut: jest.fn(),
    signInWithPassword: jest.fn(),
  },
  from: jest.fn(),
};

jest.mock('@/lib/supabase', () => ({
  __esModule: true,
  supabase: mockSupabase,
}));

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace }),
  // a public page: the sign in redirects from here
  usePathname: () => '/login',
}));

import { AuthProvider, useAuth } from '@/contexts/AuthContext';

type ResolveRedirect = () => Promise<string | null | undefined>;

function SignInButton({ resolve }: { resolve?: ResolveRedirect }) {
  const { signIn } = useAuth();
  const [message, setMessage] = React.useState('');
  return (
    <>
      <button
        onClick={() =>
          (resolve
            ? signIn('u2@example.com', 'secret', resolve)
            : signIn('u2@example.com', 'secret')
          )
            .then(() => setMessage('signed in'))
            .catch((e: Error) => setMessage(e.message))
        }
      >
        login
      </button>
      <div data-testid="message">{message}</div>
    </>
  );
}

async function signInWith(resolve?: ResolveRedirect) {
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <SignInButton resolve={resolve} />
    </AuthProvider>
  );
  await user.click(screen.getByText('login'));
  await waitFor(() =>
    expect(screen.getByTestId('message').textContent).not.toBe('')
  );
}

describe('AuthProvider.signIn redirect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    profileRole = 'TRAINEE';
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
    });
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
    mockSupabase.auth.signOut.mockResolvedValue({});
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'u2', email: 'u2@example.com' } },
      error: null,
    });
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: {
                id: 'u2',
                full_name: 'User Two',
                role: profileRole,
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
    }));
    mockSupabase.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
    });
  });

  it('goes to the trainee dashboard without a hint, as before', async () => {
    await signInWith();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/trainee/dashboard');
  });

  it('goes to the trainer dashboard for a trainer level role, as before', async () => {
    profileRole = 'ADMIN';
    await signInWith();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/trainer/dashboard');
  });

  it('goes where the hint says', async () => {
    const resolve = jest.fn().mockResolvedValue('/berufswahl');
    await signInWith(resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/berufswahl');
    expect(screen.getByTestId('message')).toHaveTextContent('signed in');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty text', ''],
  ])('uses the dashboard when the hint gives %s', async (_name, value) => {
    await signInWith(jest.fn().mockResolvedValue(value));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/trainee/dashboard');
  });

  it('does not let a failing hint undo the sign in', async () => {
    await signInWith(jest.fn().mockRejectedValue(new Error('hint failed')));
    expect(replace).toHaveBeenCalledWith('/trainee/dashboard');
    expect(screen.getByTestId('message')).toHaveTextContent('signed in');
  });

  it('does not ask the hint when the sign in fails', async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login' },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('invalid'),
    }) as any;
    const resolve = jest.fn().mockResolvedValue('/berufswahl');
    await signInWith(resolve);
    expect(resolve).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('message')).toHaveTextContent(
      'E-Mail oder Passwort ist falsch.'
    );
  });
});
