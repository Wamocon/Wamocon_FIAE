import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// We'll mock supabase client used in AuthContext
const mockSupabase: any = {
  auth: {
    getSession: (jest.fn() as any).mockResolvedValue({ data: { session: { user: { id: 'u1', email: 'u1@example.com' } } } }),
    getUser: (jest.fn() as any).mockResolvedValue({ data: { user: { id: 'u1', email: 'u1@example.com' } } }),
    onAuthStateChange: (jest.fn() as any).mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
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
        maybeSingle: (jest.fn() as any).mockResolvedValue({ data: { id: 'u1' } }),
      }),
    }),
    update: jest.fn(),
  }),
};

jest.mock('@/lib/supabase', () => ({ __esModule: true, supabase: mockSupabase }));

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
    await waitFor(() => expect(screen.getByTestId('uid').textContent).toBe('u1'));
    expect(screen.getByTestId('role').textContent).toBe('trainee');
  });

  it('signOut clears profile and user state', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('uid').textContent).toBe('u1'));
    await user.click(screen.getByText('logout'));
    // After signOut, AuthContext sets user/profile to null
    await waitFor(() => expect(screen.getByTestId('uid').textContent).toBe(''));
    expect(screen.getByTestId('role').textContent).toBe('');
  });

  it('signOut error propagates and state may remain unchanged', async () => {
  mockSupabase.auth.signOut = ((..._args: any[]) => Promise.reject(new Error('fail'))) as any;
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('uid').textContent).toBe('u1'));
    await expect(user.click(screen.getByText('logout'))).resolves.toBeUndefined();
    // Since signOut threw, the context method rejects before clearing state; assert user still present
    expect(screen.getByTestId('uid').textContent).toBe('u1');
  });
});
