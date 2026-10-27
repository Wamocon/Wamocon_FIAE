import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';

// The login form with the real AuthProvider and a Supabase client whose
// signInWithPassword never answers (it waits for an auth lock that nobody
// releases). The person must not look at a spinner without end: after the
// limits of the sign in the form shows the message and the button works again.

const mockSupabase: any = {
  auth: {
    getSession: jest.fn(),
    onAuthStateChange: jest.fn(),
    signOut: jest.fn(),
    signInWithPassword: jest.fn(),
    setSession: jest.fn(),
  },
  from: jest.fn(),
};

jest.mock('@/lib/supabase', () => ({
  __esModule: true,
  supabase: mockSupabase,
}));

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/login',
}));
jest.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/ui/LanguageToggle', () => ({
  LanguageToggle: () => null,
}));

import { AuthProvider } from '@/contexts/AuthContext';
import LoginForm from '@/components/auth/LoginForm';

const DE_TEXT =
  'Die Anmeldung dauert zu lange. Bitte laden Sie die Seite neu und versuchen Sie es erneut.';
const EN_TEXT =
  'Signing in is taking too long. Please reload the page and try again.';

const never = () => new Promise<never>(() => undefined);

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

async function renderForm() {
  renderWithProviders(
    <AuthProvider>
      <LoginForm />
    </AuthProvider>
  );
  // the start up of the providers and the public list of the occupations
  await advance(0);
}

async function submit() {
  fireEvent.change(document.getElementById('email') as HTMLInputElement, {
    target: { value: 'diag-niemand@example.invalid' },
  });
  fireEvent.change(document.getElementById('password') as HTMLInputElement, {
    target: { value: 'geheim' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Anmelden|Login/ }));
  });
}

describe('LoginForm when the sign in never answers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
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
    // the public list of the occupations answers, the token request never does
    global.fetch = jest.fn((input: unknown) =>
      String(input).includes('/api/catalogs')
        ? Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ catalogs: [] }),
          })
        : never()
    ) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows the message after the limits and resets the button', async () => {
    await renderForm();
    await submit();

    // while it waits: busy button, no message
    const busy = screen.getByRole('button', { name: /Anmeldung läuft/ });
    expect(busy).toBeDisabled();
    await advance(21_999);
    expect(screen.queryByText(DE_TEXT)).toBeNull();
    expect(
      screen.getByRole('button', { name: /Anmeldung läuft/ })
    ).toBeDisabled();

    // limits of the client (12 s) and of the direct request (10 s) are over
    await advance(1);
    expect(screen.getByText(DE_TEXT)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Anmelden' });
    expect(button).toBeEnabled();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('shows the English text in the English interface', async () => {
    window.localStorage.setItem('language', 'en');
    await renderForm();
    await submit();
    await advance(22_000);
    expect(screen.getByText(EN_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Login' })).toBeEnabled();
  });

  it('removes the message on the next attempt and can sign in again', async () => {
    await renderForm();
    await submit();
    await advance(22_000);
    expect(screen.getByText(DE_TEXT)).toBeInTheDocument();

    // second attempt: the client answers now
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });
    (global.fetch as jest.Mock).mockImplementation((input: unknown) =>
      String(input).includes('/api/catalogs')
        ? Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ catalogs: [] }),
          })
        : Promise.resolve({
            ok: false,
            status: 400,
            text: () => Promise.resolve('invalid'),
          })
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    });
    await advance(0);
    expect(screen.queryByText(DE_TEXT)).toBeNull();
    expect(
      screen.getByText('E-Mail oder Passwort ist falsch.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anmelden' })).toBeEnabled();
  });
});
