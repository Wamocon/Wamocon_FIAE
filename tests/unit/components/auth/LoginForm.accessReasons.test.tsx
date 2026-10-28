import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import LoginForm from '@/components/auth/LoginForm';
import { useAuth } from '@/contexts/AuthContext';
import { SignInBlockedError } from '@/lib/auth/access-state';

// The login page after a return (?reason=...) and after a sign in that is
// stopped: every case shows its own message, none is lost by a jump to the
// dashboard that happens while the sign in is still deciding.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn() },
}));
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/ui/LanguageToggle', () => ({
  LanguageToggle: () => null,
}));

const list = (catalogs: unknown[]) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ catalogs }) });

function submit() {
  fireEvent.change(screen.getByLabelText('E-Mail-Adresse'), {
    target: { value: 'azubi@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Passwort'), {
    target: { value: 'geheim' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
}

async function listLoaded() {
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
}

describe('LoginForm reasons and blocked sign ins', () => {
  const originalFetch = global.fetch;
  beforeAll(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    global.fetch = jest.fn(() => list([])) as any;
    (useAuth as jest.Mock).mockReturnValue({
      profile: null,
      signIn: jest.fn(),
    });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('the banner of a return to the login', () => {
    it('says that a sign in is needed (status, not an alarm)', () => {
      renderWithProviders(<LoginForm reason="signin-required" />);
      expect(screen.getByRole('status')).toHaveTextContent(
        'Bitte melden Sie sich an, um fortzufahren. Möglicherweise ist Ihre Sitzung abgelaufen.'
      );
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('says that the account is deactivated (alert)', () => {
      renderWithProviders(<LoginForm reason="deactivated" />);
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Ihr Konto wurde deaktiviert. Bitte wenden Sie sich an Ihren Administrator.'
      );
    });

    it('says that the organization is deactivated (alert)', () => {
      renderWithProviders(<LoginForm reason="organization-deactivated" />);
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Die Organisation Ihres Kontos ist deaktiviert.'
      );
    });

    it('shows nothing without a reason', () => {
      renderWithProviders(<LoginForm />);
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('the banner goes away when the person submits', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        profile: null,
        signIn: jest.fn().mockResolvedValue(undefined),
      });
      renderWithProviders(<LoginForm reason="deactivated" />);
      await listLoaded();
      submit();
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });
  });

  describe('a sign in that is stopped', () => {
    it.each([
      [
        'deactivated',
        'Ihr Konto wurde deaktiviert. Bitte kontaktieren Sie Ihren Administrator.',
      ],
      ['organizationDeactivated', 'Ihre Organisation ist derzeit deaktiviert.'],
      [
        'profileUnavailable',
        'Ihr Profil konnte nicht geladen werden. Bitte wenden Sie sich an Ihren Administrator.',
      ],
    ] as const)('shows the translated message of %s', async (code, text) => {
      (useAuth as jest.Mock).mockReturnValue({
        profile: null,
        signIn: jest
          .fn()
          .mockRejectedValue(new SignInBlockedError(code, 'roher Text')),
      });
      renderWithProviders(<LoginForm />);
      await listLoaded();
      submit();
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      expect(screen.queryByText('roher Text')).toBeNull();
    });

    it('shows the message of any other error as it is', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        profile: null,
        signIn: jest
          .fn()
          .mockRejectedValue(new Error('E-Mail oder Passwort ist falsch.')),
      });
      renderWithProviders(<LoginForm />);
      await listLoaded();
      submit();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'E-Mail oder Passwort ist falsch.'
      );
    });

    it('does not jump to the dashboard when the profile arrives before the sign in is stopped (one occupation)', async () => {
      // AuthProvider puts the profile into its state before it checks the
      // gates. The form used to follow it to the dashboard, and the message
      // of the stopped sign in was lost.
      global.fetch = jest.fn(() =>
        list([{ code: 'FIAE', title: 'Fachinformatiker' }])
      ) as any;
      let current: unknown = null;
      const signIn = jest.fn(async () => {
        current = { id: 'u1', role: 'trainee' };
        view.rerender(<LoginForm />);
        throw new SignInBlockedError('deactivated', 'x');
      });
      (useAuth as jest.Mock).mockImplementation(() => ({
        profile: current,
        signIn,
      }));
      const view = renderWithProviders(<LoginForm />);
      await listLoaded();
      submit();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Ihr Konto wurde deaktiviert'
      );
      expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it('does not jump either when the occupation list did not load', async () => {
      global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as any;
      let current: unknown = null;
      const signIn = jest.fn(async () => {
        current = { id: 'u1', role: 'trainee' };
        view.rerender(<LoginForm />);
        throw new SignInBlockedError('profileUnavailable', 'x');
      });
      (useAuth as jest.Mock).mockImplementation(() => ({
        profile: current,
        signIn,
      }));
      const view = renderWithProviders(<LoginForm />);
      await listLoaded();
      submit();
      await screen.findByRole('alert');
      expect(mockRouter.push).not.toHaveBeenCalled();
    });
  });
});
