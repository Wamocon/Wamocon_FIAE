import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import toast from 'react-hot-toast';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import LoginForm from '@/components/auth/LoginForm';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// The sign in on a platform with more than one active occupation: the form
// asks AuthProvider.signIn to send the person to the occupation choice page
// (/berufswahl), unless the login link already chose an occupation the account
// has. Everything uncertain, and every platform with one active occupation,
// keeps today's flow (signIn(email, password) and the dashboard).

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

const FIAE = {
  code: 'FIAE',
  title: 'Fachinformatiker/in Anwendungsentwicklung',
};
const KFBM = { code: 'KFBM', title: 'Kaufmann/-frau für Büromanagement' };
const OTHER = { code: 'ZZZ', title: 'Anderer Beruf' };

const list = (catalogs: unknown[]) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ catalogs }) });

type Hint = () => Promise<string | null | undefined>;

/** A signIn double that, like AuthProvider, asks the hint before it navigates. */
function signInDouble() {
  const answers: Array<string | null | undefined> = [];
  const signIn = jest.fn(
    async (_email: string, _password: string, hint?: Hint) => {
      if (hint) answers.push(await hint());
    }
  );
  return { signIn, answers };
}

function useSignIn(signIn: jest.Mock, profile: unknown = null) {
  (useAuth as jest.Mock).mockReturnValue({ profile, signIn });
}

function submit() {
  fireEvent.change(screen.getByLabelText('E-Mail-Adresse'), {
    target: { value: 'azubi@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Passwort'), {
    target: { value: 'geheim' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
}

/** The form has asked for the public list of the occupations. */
async function listLoaded() {
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  // let the answer be processed
  await act(async () => {
    await Promise.resolve();
  });
}

describe('LoginForm and the occupation choice', () => {
  const originalFetch = global.fetch;
  // The form loads the public list in an effect, its answer arrives outside
  // act() by design (waitFor and findBy wait for it).
  beforeAll(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    (authFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('a platform with one active occupation (Production today: FIAE only)', () => {
    it('signs in exactly as before: signIn(email, password), no hint, no check, no choice', async () => {
      global.fetch = jest.fn(() => list([FIAE])) as any;
      const { signIn } = signInDouble();
      useSignIn(signIn);
      renderWithProviders(<LoginForm />);
      await listLoaded();

      submit();
      await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
      expect(signIn.mock.calls[0]).toEqual(['azubi@example.com', 'geheim']);
      expect(signIn.mock.calls[0]).toHaveLength(2);
      expect(authFetch).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(mockRouter.push).not.toHaveBeenCalled();
      expect(mockRouter.replace).not.toHaveBeenCalled();
      expect(window.localStorage.getItem('lfa.preferredCatalog')).toBeNull();
      // the only request of the form is the public list
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith('/api/catalogs');
    });

    it('does the same with a login link (check after the sign in, as before)', async () => {
      global.fetch = jest.fn(() => list([KFBM])) as any;
      const { signIn } = signInDouble();
      useSignIn(signIn);
      renderWithProviders(<LoginForm catalogCode="KFBM" />);
      await screen.findByText(/Anmeldung für den Beruf/);

      submit();
      await waitFor(() =>
        expect(authFetch).toHaveBeenCalledWith('/api/me/catalogs?catalog=KFBM')
      );
      expect(signIn.mock.calls[0]).toHaveLength(2);
    });

    it('does not ask again for the list when the link already did', async () => {
      global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
      useSignIn(signInDouble().signIn);
      renderWithProviders(<LoginForm catalogCode="KFBM" />);
      await screen.findByText(/Anmeldung für den Beruf/);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('nothing is known about the platform (the list cannot be loaded)', () => {
    it.each([
      ['a network error', () => Promise.reject(new Error('offline'))],
      ['a server error', () => Promise.resolve({ ok: false, status: 500 })],
      [
        'an answer that is no list',
        () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
      ],
    ])('keeps the old flow after %s', async (_name, answer) => {
      global.fetch = jest.fn(answer) as any;
      const { signIn } = signInDouble();
      useSignIn(signIn);
      renderWithProviders(<LoginForm />);
      await listLoaded();

      submit();
      await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
      expect(signIn.mock.calls[0]).toHaveLength(2);
    });
  });

  describe('a platform with several active occupations', () => {
    it.each([
      ['two', [FIAE, KFBM]],
      ['three', [FIAE, KFBM, OTHER]],
    ])(
      'sends the person to the choice after a plain sign in (%s occupations)',
      async (_name, catalogs) => {
        global.fetch = jest.fn(() => list(catalogs)) as any;
        const { signIn, answers } = signInDouble();
        useSignIn(signIn);
        renderWithProviders(<LoginForm />);
        await listLoaded();

        submit();
        await waitFor(() => expect(answers).toEqual(['/berufswahl']));
        expect(signIn.mock.calls[0].slice(0, 2)).toEqual([
          'azubi@example.com',
          'geheim',
        ]);
        // no check, nothing stored, no hint for the person
        expect(authFetch).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
        expect(window.localStorage.getItem('lfa.preferredCatalog')).toBeNull();
      }
    );

    it('goes to the dashboard when the login link chose an occupation the account has', async () => {
      global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
      const { signIn, answers } = signInDouble();
      useSignIn(signIn);
      renderWithProviders(<LoginForm catalogCode="KFBM" />);
      await screen.findByText(/Anmeldung für den Beruf/);

      submit();
      await waitFor(() => expect(answers).toEqual([null]));
      expect(authFetch).toHaveBeenCalledWith('/api/me/catalogs?catalog=KFBM');
      expect(toast.error).not.toHaveBeenCalled();
      // the occupation of the link is the one to work in
      expect(window.localStorage.getItem('lfa.preferredCatalog')).toBe('KFBM');
    });

    it('sends the person to the choice when the login link named an occupation the account does not have', async () => {
      global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
      (authFetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 });
      const { signIn, answers } = signInDouble();
      useSignIn(signIn);
      renderWithProviders(<LoginForm catalogCode="KFBM" />);
      await screen.findByText(/Anmeldung für den Beruf/);

      submit();
      await waitFor(() => expect(answers).toEqual(['/berufswahl']));
      // the hint stays on screen while the choice page opens
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith(
        'Ihr Konto ist für den Beruf Kaufmann/-frau für Büromanagement nicht freigeschaltet. Bitte wählen Sie einen Ihrer Berufe oder fragen Sie ein Abo an.'
      );
    });

    it.each([
      ['a network error', () => Promise.reject(new Error('offline'))],
      ['a server error', () => Promise.resolve({ ok: false, status: 503 })],
    ])(
      'keeps the dashboard when the check of the login link fails (%s)',
      async (_name, answer) => {
        global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
        (authFetch as jest.Mock).mockImplementation(answer);
        const { signIn, answers } = signInDouble();
        useSignIn(signIn);
        renderWithProviders(<LoginForm catalogCode="KFBM" />);
        await screen.findByText(/Anmeldung für den Beruf/);

        submit();
        await waitFor(() => expect(answers).toEqual([null]));
        expect(toast.error).not.toHaveBeenCalled();
      }
    );

    it('does not hold the sign in back when the check of the login link hangs', async () => {
      global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
      (authFetch as jest.Mock).mockReturnValue(new Promise(() => {}));
      const { signIn, answers } = signInDouble();
      useSignIn(signIn);
      renderWithProviders(<LoginForm catalogCode="KFBM" />);
      await screen.findByText(/Anmeldung für den Beruf/);

      jest.useFakeTimers();
      try {
        submit();
        await act(async () => {
          jest.advanceTimersByTime(4100);
        });
      } finally {
        jest.useRealTimers();
      }
      await waitFor(() => expect(answers).toEqual([null]));
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('sends the person to the choice when the login link named an occupation that is not active', async () => {
      global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
      const { signIn, answers } = signInDouble();
      useSignIn(signIn);
      renderWithProviders(<LoginForm catalogCode="ZZZ" />);
      await screen.findByText(/nicht verfügbar/);

      submit();
      await waitFor(() => expect(answers).toEqual(['/berufswahl']));
      expect(authFetch).not.toHaveBeenCalled();
      expect(window.localStorage.getItem('lfa.preferredCatalog')).toBeNull();
    });

    it('shows a failed sign in as before and does not ask where to go', async () => {
      global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
      const signIn = jest
        .fn()
        .mockRejectedValue(new Error('Falsches Passwort'));
      useSignIn(signIn);
      renderWithProviders(<LoginForm />);
      await listLoaded();

      submit();
      expect(await screen.findByText('Falsches Passwort')).toBeInTheDocument();
      expect(authFetch).not.toHaveBeenCalled();
    });
  });

  describe('the redirect of the form itself (profile appears while signing in)', () => {
    it('does not go to the dashboard while the choice page is pending', async () => {
      global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
      let current: unknown = null;
      const answers: Array<string | null | undefined> = [];
      const signIn = jest.fn(
        async (_email: string, _password: string, hint?: Hint) => {
          // AuthProvider has the profile before it asks where to go
          current = { id: 'u1', role: 'trainer' };
          view.rerender(<LoginForm />);
          if (hint) answers.push(await hint());
        }
      );
      (useAuth as jest.Mock).mockImplementation(() => ({
        profile: current,
        signIn,
      }));
      const view = renderWithProviders(<LoginForm />);
      await listLoaded();

      submit();
      await waitFor(() => expect(answers).toEqual(['/berufswahl']));
      expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it('still goes to the dashboard of the role when somebody who is signed in opens the login', async () => {
      global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
      (useAuth as jest.Mock).mockReturnValue({
        profile: { id: 'u1', role: 'trainer' },
        signIn: jest.fn(),
      });
      renderWithProviders(<LoginForm />);
      expect(mockRouter.push).toHaveBeenCalledWith('/trainer/dashboard');

      jest.clearAllMocks();
      (useAuth as jest.Mock).mockReturnValue({
        profile: { id: 'u2', role: 'trainee' },
        signIn: jest.fn(),
      });
      renderWithProviders(<LoginForm />);
      expect(mockRouter.push).toHaveBeenCalledWith('/trainee/dashboard');
    });

    it('goes back to the normal redirect after a failed sign in', async () => {
      global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
      let current: unknown = null;
      const signIn = jest
        .fn()
        .mockRejectedValue(new Error('Konto deaktiviert'));
      (useAuth as jest.Mock).mockImplementation(() => ({
        profile: current,
        signIn,
      }));
      const view = renderWithProviders(<LoginForm />);
      await listLoaded();
      submit();
      await screen.findByText('Konto deaktiviert');

      current = { id: 'u1', role: 'trainee' };
      view.rerender(<LoginForm />);
      expect(mockRouter.push).toHaveBeenCalledWith('/trainee/dashboard');
    });
  });
});
