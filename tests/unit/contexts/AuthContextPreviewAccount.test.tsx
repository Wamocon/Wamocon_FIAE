import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

// An account created in Preview carries app_metadata.preview_only. Production
// rejects it at the sign-in: German message, sign-out, no profile sync.
// Normal accounts take the same path as before, and Preview lets the flagged
// account in.

const flaggedUser = {
  id: 'pv1',
  email: 'preview.user@example.com',
  app_metadata: { preview_only: true },
};
const normalUser = {
  id: 'n1',
  email: 'normal@example.com',
  app_metadata: { provider: 'email', providers: ['email'] },
};

const profileChain: any = {
  select: () => profileChain,
  eq: () => profileChain,
  single: async () => ({ data: null, error: { message: 'not readable' } }),
  maybeSingle: async () => ({ data: null }),
};

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
    setSession: jest.fn(),
    signUp: jest.fn(),
  },
  from: jest.fn(() => profileChain),
  channel: jest.fn(() => ({ on: () => ({ subscribe: () => ({}) }) })),
};

jest.mock('@/lib/supabase', () => ({
  __esModule: true,
  supabase: mockSupabase,
}));

let mockPreview = false;
let mockPath = '/login';
jest.mock('@/lib/db-schema', () => {
  // a live getter: the tests switch between Production and Preview
  const mocked = { ...(jest.requireActual('@/lib/db-schema') as object) };
  Object.defineProperty(mocked, 'IS_PREVIEW_SCHEMA', {
    enumerable: true,
    get: () => mockPreview,
  });
  return mocked;
});

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => mockPath,
}));

import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { PREVIEW_ACCOUNT_REJECTED_MESSAGE } from '@/lib/preview-account';

let captured: ReturnType<typeof useAuth> | null = null;
function Capture() {
  captured = useAuth();
  return <div data-testid="ready">{captured.user?.id ?? 'none'}</div>;
}

async function signIn(): Promise<Error | undefined> {
  render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId('ready')).toBeTruthy());
  let error: Error | undefined;
  await act(async () => {
    try {
      await captured!.signIn('a@example.com', 'secret');
    } catch (e) {
      error = e as Error;
    }
  });
  return error;
}

const syncCalls = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.filter(c => String(c[0]) === '/api/auth/sync-profile');

describe('AuthContext sign-in and accounts created in Preview', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    captured = null;
    mockPreview = false;
    mockPath = '/login';
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'tok', expires_at: 4_000_000_000 } },
    });
    fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    }));
    (global as any).fetch = fetchMock;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('Production rejects the flagged account, signs out and syncs no profile', async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: flaggedUser },
      error: null,
    });
    const error = await signIn();
    expect(error?.message).toBe(PREVIEW_ACCOUNT_REJECTED_MESSAGE);
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
    expect(syncCalls(fetchMock)).toHaveLength(0);
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(screen.getByTestId('ready').textContent).toBe('none');
  });

  it('Production rejects the flagged account on the fallback path too', async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'sdk failed' },
    });
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'a', refresh_token: 'r' }),
      text: async () => '',
    }));
    mockSupabase.auth.setSession.mockResolvedValue({
      data: { session: { user: flaggedUser } },
      error: null,
    });
    const error = await signIn();
    expect(error?.message).toBe(PREVIEW_ACCOUNT_REJECTED_MESSAGE);
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
    expect(syncCalls(fetchMock)).toHaveLength(0);
  });

  it('Production keeps the normal path for a normal account (profile sync is started)', async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: normalUser },
      error: null,
    });
    const error = await signIn();
    expect(error?.message).not.toBe(PREVIEW_ACCOUNT_REJECTED_MESSAGE);
    expect(syncCalls(fetchMock)).toHaveLength(1);
  });

  it('Production keeps the normal path for an account without app_metadata', async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'n2', email: 'old@example.com' } },
      error: null,
    });
    const error = await signIn();
    expect(error?.message).not.toBe(PREVIEW_ACCOUNT_REJECTED_MESSAGE);
    expect(syncCalls(fetchMock)).toHaveLength(1);
  });

  it('a restored session of a flagged account is ended when the profile sync is rejected', async () => {
    mockPath = '/trainee/dashboard';
    mockSupabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'tok',
          expires_at: 4_000_000_000,
          user: flaggedUser,
        },
      },
    });
    mockSupabase.auth.onAuthStateChange.mockImplementation(
      (cb: (event: string, session: unknown) => void) => {
        setTimeout(
          () =>
            cb('SIGNED_IN', {
              access_token: 'tok',
              expires_at: 4_000_000_000,
              user: flaggedUser,
            }),
          0
        );
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }
    );
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ code: 'PREVIEW_ACCOUNT_REJECTED' }),
      text: async () => '',
    }));
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>
    );
    await waitFor(() => expect(syncCalls(fetchMock).length).toBeGreaterThan(0));
    await waitFor(() => expect(mockSupabase.auth.signOut).toHaveBeenCalled());
  });

  it('Preview lets the flagged account in (profile sync is started)', async () => {
    mockPreview = true;
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: flaggedUser },
      error: null,
    });
    const error = await signIn();
    expect(error?.message).not.toBe(PREVIEW_ACCOUNT_REJECTED_MESSAGE);
    expect(syncCalls(fetchMock)).toHaveLength(1);
  });
});
