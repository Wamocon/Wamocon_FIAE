import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// We'll mock supabase client used in AuthContext
const mockSupabase: any = {
  auth: {
    getSession: (jest.fn() as any).mockResolvedValue({
      data: { session: { user: { id: 'u1', email: 'u1@example.com' } } },
    }),
    getUser: (jest.fn() as any).mockResolvedValue({
      data: { user: { id: 'u1', email: 'u1@example.com' } },
    }),
    onAuthStateChange: (jest.fn() as any).mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    }),
    signOut: (jest.fn() as any).mockResolvedValue({}),
    signInWithPassword: jest.fn(),
    signUp: jest.fn(),
  },
  from: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: (jest.fn() as any).mockResolvedValue({
          data: {
            id: 'u1',
            full_name: 'User One',
            role: 'TRAINEE',
            avatar_url: null,
            start_of_training_date: null,
            assigned_trainer_id: null,
          },
          error: null,
        }),
        maybeSingle: (jest.fn() as any).mockResolvedValue({
          data: { id: 'u1' },
        }),
      }),
    }),
    update: jest.fn(),
  }),
};

jest.mock('@/lib/supabase', () => ({
  __esModule: true,
  supabase: mockSupabase,
}));

// A non-public path makes AuthProvider load the profile (public paths skip it)
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/trainee/dashboard',
}));

import { AuthProvider, useAuth } from '@/contexts/AuthContext';

function Consumer() {
  const { profile, user, signOut } = useAuth();
  return (
    <div>
      <div data-testid="uid">{user?.id ?? ''}</div>
      <div data-testid="role">{profile?.role ?? ''}</div>
      <button onClick={() => signOut()}>logout</button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('provides profile and role on mount', async () => {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('uid').textContent).toBe('u1')
    );
    // The profile is loaded asynchronously after the session user is set
    await waitFor(() =>
      expect(screen.getByTestId('role').textContent).toBe('trainee')
    );
  });

  it('signOut clears profile and user state', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('uid').textContent).toBe('u1')
    );
    await user.click(screen.getByText('logout'));
    // After signOut, AuthContext sets user/profile to null
    await waitFor(() => expect(screen.getByTestId('uid').textContent).toBe(''));
    expect(screen.getByTestId('role').textContent).toBe('');
  });

  it('signOut clears local state even if the remote signOut fails', async () => {
    mockSupabase.auth.signOut = ((..._args: any[]) =>
      Promise.reject(new Error('fail'))) as any;
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('uid').textContent).toBe('u1')
    );
    await expect(
      user.click(screen.getByText('logout'))
    ).resolves.toBeUndefined();
    // The remote failure is logged, the local session is cleared regardless
    await waitFor(() => expect(screen.getByTestId('uid').textContent).toBe(''));
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('signIn signs out and reports an error when the profile is not readable', async () => {
    const originalFrom = mockSupabase.from;
    const originalSignOut = mockSupabase.auth.signOut;
    const signOut = (jest.fn() as any).mockResolvedValue({});
    mockSupabase.auth.signOut = signOut;
    // The account exists, but its profile row is hidden (row level security) or missing
    mockSupabase.from = (jest.fn() as any).mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: (jest.fn() as any).mockResolvedValue({
            data: null,
            error: { code: 'PGRST116', message: 'no rows' },
          }),
          maybeSingle: (jest.fn() as any).mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      }),
    });
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'u2', email: 'u2@example.com' } },
      error: null,
    });
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    function SignInConsumer() {
      const { user, signIn } = useAuth();
      const [message, setMessage] = React.useState('');
      return (
        <div>
          <div data-testid="signed-in-uid">{user?.id ?? ''}</div>
          <div data-testid="message">{message}</div>
          <button
            onClick={() =>
              signIn('u2@example.com', 'secret').catch((e: Error) =>
                setMessage(e.message)
              )
            }
          >
            login
          </button>
        </div>
      );
    }

    const user = userEvent.setup();
    render(
      <AuthProvider>
        <SignInConsumer />
      </AuthProvider>
    );
    await user.click(screen.getByText('login'));

    // No silent success: the person sees why nothing happens, and no session is left behind
    await waitFor(
      () =>
        expect(screen.getByTestId('message').textContent).toContain(
          'Ihr Profil konnte nicht geladen werden'
        ),
      { timeout: 8000 }
    );
    expect(signOut).toHaveBeenCalled();
    expect(screen.getByTestId('signed-in-uid').textContent).toBe('');

    consoleError.mockRestore();
    mockSupabase.from = originalFrom;
    mockSupabase.auth.signOut = originalSignOut;
  }, 15000);
});
