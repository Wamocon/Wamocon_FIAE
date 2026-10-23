import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

// Preview shares the auth of Production: the browser sign-up must not create
// an account from Preview.

const mockSupabase: any = {
  auth: {
    getSession: (jest.fn() as any).mockResolvedValue({
      data: { session: null },
    }),
    getUser: (jest.fn() as any).mockResolvedValue({ data: { user: null } }),
    onAuthStateChange: (jest.fn() as any).mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    }),
    signOut: (jest.fn() as any).mockResolvedValue({}),
    signInWithPassword: jest.fn(),
    signUp: jest.fn(),
  },
  from: jest.fn(),
};

jest.mock('@/lib/supabase', () => ({
  __esModule: true,
  supabase: mockSupabase,
}));

jest.mock('@/lib/db-schema', () => ({
  ...(jest.requireActual('@/lib/db-schema') as object),
  IS_PREVIEW_SCHEMA: true,
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/login',
}));

import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { PREVIEW_ADMIN_BLOCKED_MESSAGE } from '@/lib/db-schema';

let captured: ReturnType<typeof useAuth> | null = null;
function Capture() {
  captured = useAuth();
  return <div data-testid="ready">ready</div>;
}

describe('AuthContext sign-up in Preview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    captured = null;
  });

  it('refuses to sign up and never calls supabase.auth.signUp', async () => {
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('ready')).toBeTruthy());
    let error: unknown;
    await act(async () => {
      try {
        await captured!.signUp('A B', 'a@example.com', 'secret1', 'trainee');
      } catch (e) {
        error = e;
      }
    });
    expect((error as Error).message).toBe(PREVIEW_ADMIN_BLOCKED_MESSAGE);
    expect(mockSupabase.auth.signUp).not.toHaveBeenCalled();
  });
});
