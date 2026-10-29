import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import LoginForm from '@/components/auth/LoginForm';
import { useAuth } from '@/contexts/AuthContext';
import { EmailNotConfirmedError } from '@/lib/auth/email-confirmation';

// The login page and the confirmation of the e-mail address: the notices after
// the link of the e-mail (?confirm=...), and the sign in of an address that is
// not confirmed yet, which offers to send the e-mail again.

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

const RESEND = 'Bestätigungs-E-Mail erneut senden';

function fetchMock(resendStatus = 200) {
  return jest.fn((url: string) => {
    if (url === '/api/auth/resend-confirmation') {
      return Promise.resolve({
        ok: resendStatus === 200,
        status: resendStatus,
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ catalogs: [] }),
    });
  });
}

function submit() {
  fireEvent.change(screen.getByLabelText('E-Mail-Adresse'), {
    target: { value: 'azubi@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Passwort'), {
    target: { value: 'geheim12' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
}

async function listLoaded() {
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
}

describe('LoginForm and the confirmation of the e-mail address', () => {
  const originalFetch = global.fetch;
  beforeAll(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    global.fetch = fetchMock() as any;
    (useAuth as jest.Mock).mockReturnValue({
      profile: null,
      signIn: jest.fn(),
    });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('the notice after the link of the e-mail', () => {
    it('"done": the address is confirmed, the person can sign in (status, not an alarm)', () => {
      renderWithProviders(<LoginForm confirmNotice="done" />);
      expect(screen.getByRole('status')).toHaveTextContent(
        'Ihre E-Mail-Adresse ist bestätigt. Sie können sich jetzt anmelden.'
      );
      expect(screen.getByRole('status')).toHaveTextContent(
        'schaltet Ihr Ausbilder Ihr Konto frei'
      );
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('"failed": the link is expired or used (alert)', () => {
      renderWithProviders(<LoginForm confirmNotice="failed" />);
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Der Bestätigungslink ist abgelaufen oder wurde schon benutzt.'
      );
    });

    it('"check": a neutral notice that claims nothing (status)', () => {
      renderWithProviders(<LoginForm confirmNotice="check" />);
      expect(screen.getByRole('status')).toHaveTextContent(
        'Wenn Sie Ihre E-Mail-Adresse gerade bestätigt haben'
      );
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('shows nothing without a notice', () => {
      renderWithProviders(<LoginForm />);
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('the notice goes away when the person submits', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        profile: null,
        signIn: jest.fn().mockResolvedValue(undefined),
      });
      renderWithProviders(<LoginForm confirmNotice="failed" />);
      await listLoaded();
      submit();
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });
  });

  describe('a sign in of an address that is not confirmed yet', () => {
    beforeEach(() => {
      (useAuth as jest.Mock).mockReturnValue({
        profile: null,
        signIn: jest.fn().mockRejectedValue(new EmailNotConfirmedError()),
      });
    });

    it('says so in its own words and offers to send the e-mail again', async () => {
      renderWithProviders(<LoginForm />);
      await listLoaded();
      submit();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Ihre E-Mail-Adresse ist noch nicht bestätigt.'
      );
      expect(screen.getByRole('button', { name: RESEND })).toBeEnabled();
    });

    it('the button asks for the e-mail of the address in the form', async () => {
      renderWithProviders(<LoginForm />);
      await listLoaded();
      submit();
      fireEvent.click(await screen.findByRole('button', { name: RESEND }));
      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/auth/resend-confirmation',
          expect.objectContaining({
            body: JSON.stringify({ email: 'azubi@example.com' }),
          })
        )
      );
    });

    it('the offer is gone after the next attempt that fails for another reason', async () => {
      const signIn = jest
        .fn()
        .mockRejectedValueOnce(new EmailNotConfirmedError())
        .mockRejectedValueOnce(new Error('E-Mail oder Passwort ist falsch.'));
      (useAuth as jest.Mock).mockReturnValue({ profile: null, signIn });
      renderWithProviders(<LoginForm />);
      await listLoaded();
      submit();
      await screen.findByRole('button', { name: RESEND });
      fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          'E-Mail oder Passwort ist falsch.'
        )
      );
      expect(screen.queryByRole('button', { name: RESEND })).toBeNull();
    });
  });

  it('no offer to resend for a wrong password or other errors', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      profile: null,
      signIn: jest
        .fn()
        .mockRejectedValue(new Error('E-Mail oder Passwort ist falsch.')),
    });
    renderWithProviders(<LoginForm />);
    await listLoaded();
    submit();
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: RESEND })).toBeNull();
  });
});
