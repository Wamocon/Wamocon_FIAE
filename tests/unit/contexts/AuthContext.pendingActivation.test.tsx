import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { isSignInBlockedError } from '@/lib/auth/access-state';

// AuthProvider.signIn for an account that is not released (trainer_activated
// is false): the sign in succeeds and the person lands on the dashboard of the
// role, where the layout shows the notice. No error that is lost on the way,
// no sign out, no jump to /login. Accounts that are deactivated or whose
// profile cannot be read are still stopped, with a coded error the login form
// translates.

let profileRow: Record<string, unknown> | null = null;

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
const push = jest.fn();
let mockPathname = '/login';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  // a public page (the login): the sign in redirects from here
  usePathname: () => mockPathname,
}));

import { AuthProvider, useAuth } from '@/contexts/AuthContext';

type Outcome = { message: string; code: string | null };

function Probe({ resolve }: { resolve?: () => Promise<string | null> }) {
  const { signIn, signOut, profile, user, sessionEnd } = useAuth();
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  return (
    <>
      <button
        onClick={() =>
          (resolve
            ? signIn('u2@example.com', 'secret', resolve)
            : signIn('u2@example.com', 'secret')
          )
            .then(() => setOutcome({ message: 'signed in', code: null }))
            .catch((e: Error & { code?: string }) =>
              setOutcome({
                message: e.message,
                code: isSignInBlockedError(e) ? e.code : null,
              })
            )
        }
      >
        login
      </button>
      <button onClick={() => void signOut(false, 'deactivated')}>
        out-reason
      </button>
      <button onClick={() => void signOut()}>out-plain</button>
      <button onClick={() => void signOut(true, 'deactivated')}>
        out-silent
      </button>
      <div data-testid="outcome">{outcome?.message ?? ''}</div>
      <div data-testid="code">{outcome?.code ?? ''}</div>
      <div data-testid="user">{user?.id ?? ''}</div>
      <div data-testid="end">{sessionEnd ?? 'none'}</div>
      <div data-testid="activated">
        {profile ? String(profile.trainerActivated) : 'no profile'}
      </div>
    </>
  );
}

async function signInAs(
  row: Record<string, unknown> | null,
  resolve?: () => Promise<string | null>
) {
  profileRow = row;
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <Probe resolve={resolve} />
    </AuthProvider>
  );
  await user.click(screen.getByText('login'));
  await waitFor(
    () => expect(screen.getByTestId('outcome').textContent).not.toBe(''),
    { timeout: 8000 }
  );
}

const baseRow = {
  id: 'u2',
  full_name: 'Neue Azubi',
  role: 'TRAINEE',
  avatar_url: null,
  assigned_trainer_id: null,
  start_of_training_date: null,
  ausbildung_duration_years: 3,
  birth_date: null,
  is_active: true,
  trainer_activated: true,
  organization_id: null,
  organizations: null,
};

describe('AuthProvider.signIn gates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = '/login';
    window.localStorage.clear();
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
            Promise.resolve(
              profileRow
                ? { data: profileRow, error: null }
                : { data: null, error: { code: 'PGRST116', message: 'none' } }
            ),
          maybeSingle: () =>
            Promise.resolve({ data: profileRow ? { id: 'u2' } : null }),
        }),
      }),
    }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('a trainee who is not released signs in and goes to the dashboard (the notice is there)', async () => {
    await signInAs({ ...baseRow, trainer_activated: false });
    expect(screen.getByTestId('outcome')).toHaveTextContent('signed in');
    expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/trainee/dashboard');
    expect(screen.getByTestId('user')).toHaveTextContent('u2');
    expect(screen.getByTestId('activated')).toHaveTextContent('false');
  });

  it('does not ask for the occupation choice first, the notice comes first', async () => {
    const resolve = jest.fn().mockResolvedValue('/berufswahl');
    await signInAs({ ...baseRow, trainer_activated: false }, resolve);
    expect(resolve).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/trainee/dashboard');
  });

  it('a released trainee still gets the hint of the caller', async () => {
    const resolve = jest.fn().mockResolvedValue('/berufswahl');
    await signInAs(baseRow, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/berufswahl');
  });

  it('navigates after the sign in although the provider was mounted on a protected page', async () => {
    // The person opened /trainee/dashboard first (the provider was made there)
    // and was sent to the login: the sign in must still take them on.
    profileRow = baseRow;
    mockPathname = '/trainee/dashboard';
    const user = userEvent.setup();
    const view = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    mockPathname = '/login';
    view.rerender(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await user.click(screen.getByText('login'));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/trainee/dashboard')
    );
  });

  it('a deactivated account is signed out with a coded error', async () => {
    await signInAs({ ...baseRow, is_active: false });
    expect(screen.getByTestId('code')).toHaveTextContent('deactivated');
    expect(screen.getByTestId('outcome')).toHaveTextContent(
      'Ihr Konto wurde deaktiviert'
    );
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('user')).toHaveTextContent('');
    expect(screen.getByTestId('activated')).toHaveTextContent('no profile');
  });

  it('a deactivated account that is also not released is told it is deactivated', async () => {
    await signInAs({
      ...baseRow,
      is_active: false,
      trainer_activated: false,
    });
    expect(screen.getByTestId('code')).toHaveTextContent('deactivated');
  });

  it('a deactivated organization is signed out with a coded error', async () => {
    await signInAs({
      ...baseRow,
      organizations: {
        id: 'o1',
        name: 'Org',
        slug: 'org',
        subscription_plan: 'LIGHT',
        is_platform_owner: false,
        is_active: false,
      },
    });
    expect(screen.getByTestId('code')).toHaveTextContent(
      'organizationDeactivated'
    );
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('a profile that cannot be read is signed out with a coded error', async () => {
    await signInAs(null);
    expect(screen.getByTestId('code')).toHaveTextContent('profileUnavailable');
    expect(screen.getByTestId('outcome')).toHaveTextContent(
      'Ihr Profil konnte nicht geladen werden'
    );
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  }, 15000);
});

describe('AuthProvider.signOut destination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
    });
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
    mockSupabase.auth.signOut.mockResolvedValue({});
  });

  async function renderProbe() {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    return user;
  }

  it('goes to the start page by default', async () => {
    const user = await renderProbe();
    await user.click(screen.getByText('out-plain'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(screen.getByTestId('end')).toHaveTextContent('manual');
  });

  it('goes to the login with the reason when one is given', async () => {
    const user = await renderProbe();
    await user.click(screen.getByText('out-reason'));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/login?reason=deactivated')
    );
    expect(screen.getByTestId('end')).toHaveTextContent('deactivated');
  });

  it('stays where it is when it is silent, even with a reason', async () => {
    const user = await renderProbe();
    await user.click(screen.getByText('out-silent'));
    await waitFor(() => expect(mockSupabase.auth.signOut).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('end')).toHaveTextContent('none');
  });
});
