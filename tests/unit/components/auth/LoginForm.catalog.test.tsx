import { screen, waitFor, fireEvent } from '@testing-library/react';
import toast from 'react-hot-toast';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import LoginForm from '@/components/auth/LoginForm';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn() },
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/ui/LanguageToggle', () => ({
  LanguageToggle: () => null,
}));

const FIAE = {
  code: 'FIAE',
  title: 'Fachinformatiker/in Anwendungsentwicklung',
};
const KFBM = { code: 'KFBM', title: 'Kaufmann/-frau für Büromanagement' };

const list = (catalogs: unknown[]) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ catalogs }) });

// Like AuthProvider.signIn, the default double asks the redirect hint (the
// third argument) before it returns.
function signInAs(
  signIn: jest.Mock = jest.fn(
    async (
      _email: string,
      _password: string,
      hint?: () => Promise<unknown>
    ) => {
      await hint?.();
    }
  )
) {
  (useAuth as jest.Mock).mockReturnValue({ profile: null, signIn });
  return signIn;
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

describe('LoginForm with an occupation context', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    (authFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('changes nothing without an occupation code (FIAE regression)', async () => {
    // Platform with one active occupation: the only request of the form is the
    // public list that tells it so, the sign in is the one of today.
    global.fetch = jest.fn(() => list([FIAE])) as any;
    const signIn = signInAs();
    renderWithProviders(<LoginForm />);

    expect(
      screen.queryByText(/Anmeldung für den Beruf/)
    ).not.toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    submit();
    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith('azubi@example.com', 'geheim')
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/catalogs');
    expect(authFetch).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    // no occupation is stored in the browser either
    expect(window.localStorage.getItem('lfa.preferredCatalog')).toBeNull();
  });

  it('names the occupation from the public list above the form', async () => {
    global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
    signInAs();
    renderWithProviders(<LoginForm catalogCode="KFBM" />);

    expect(
      await screen.findByText(
        'Anmeldung für den Beruf: Kaufmann/-frau für Büromanagement'
      )
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('/api/catalogs');
  });

  it('asks the server after the sign in whether the account has this occupation', async () => {
    global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
    const signIn = signInAs();
    renderWithProviders(<LoginForm catalogCode="KFBM" />);
    await screen.findByText(/Anmeldung für den Beruf/);

    submit();
    await waitFor(() =>
      expect(authFetch).toHaveBeenCalledWith('/api/me/catalogs?catalog=KFBM')
    );
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('tells the user when the account is not enabled for the occupation and keeps the sign in', async () => {
    // one active occupation: the old hint (several: see LoginForm.occupationChoice)
    global.fetch = jest.fn(() => list([KFBM])) as any;
    signInAs();
    (authFetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 });
    renderWithProviders(<LoginForm catalogCode="KFBM" />);
    await screen.findByText(/Anmeldung für den Beruf/);

    submit();
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(
      'Ihr Konto ist für den Beruf Kaufmann/-frau für Büromanagement nicht freigeschaltet. Sie sind in Ihrem eigenen Beruf angemeldet.'
    );
    // not a failed sign in: no error in the form
    expect(
      screen.queryByText('Anmeldung fehlgeschlagen')
    ).not.toBeInTheDocument();
  });

  it('shows a hint and does not ask the server for an occupation that is not in the list', async () => {
    global.fetch = jest.fn(() => list([FIAE])) as any;
    const signIn = signInAs();
    renderWithProviders(<LoginForm catalogCode="KFBM" />);

    expect(
      await screen.findByText(
        'Der gewählte Beruf ist nicht verfügbar. Sie melden sich in Ihrem eigenen Beruf an.'
      )
    ).toBeInTheDocument();
    submit();
    await waitFor(() => expect(signIn).toHaveBeenCalled());
    expect(authFetch).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('still checks the occupation when the public list cannot be loaded', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as any;
    signInAs();
    (authFetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 });
    renderWithProviders(<LoginForm catalogCode="KFBM" />);

    submit();
    await waitFor(() =>
      expect(authFetch).toHaveBeenCalledWith('/api/me/catalogs?catalog=KFBM')
    );
    expect(
      screen.queryByText(/Anmeldung für den Beruf/)
    ).not.toBeInTheDocument();
    // without a title the code stands in for it
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Beruf KFBM')
      )
    );
  });

  it('ignores a failed check (network error) and does not break the sign in', async () => {
    global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
    const signIn = signInAs();
    (authFetch as jest.Mock).mockRejectedValue(new Error('offline'));
    renderWithProviders(<LoginForm catalogCode="KFBM" />);
    await screen.findByText(/Anmeldung für den Beruf/);

    submit();
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(
      screen.queryByText('Anmeldung fehlgeschlagen')
    ).not.toBeInTheDocument();
  });

  it('does not check anything after a failed sign in and shows the error as before', async () => {
    global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
    signInAs(jest.fn().mockRejectedValue(new Error('Falsches Passwort')));
    renderWithProviders(<LoginForm catalogCode="KFBM" />);
    await screen.findByText(/Anmeldung für den Beruf/);

    submit();
    expect(await screen.findByText('Falsches Passwort')).toBeInTheDocument();
    expect(authFetch).not.toHaveBeenCalled();
  });
  it('remembers the occupation of the link as the choice to work in', async () => {
    global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
    const signIn = signInAs();
    renderWithProviders(<LoginForm catalogCode="KFBM" />);
    await screen.findByText(/Anmeldung für den Beruf/);
    expect(window.localStorage.getItem('lfa.preferredCatalog')).toBeNull();

    submit();
    await waitFor(() => expect(signIn).toHaveBeenCalled());
    expect(window.localStorage.getItem('lfa.preferredCatalog')).toBe('KFBM');
  });

  it('does not remember an occupation that is not in the public list', async () => {
    global.fetch = jest.fn(() => list([FIAE])) as any;
    const signIn = signInAs();
    renderWithProviders(<LoginForm catalogCode="KFBM" />);
    await screen.findByText(/nicht verfügbar/);

    submit();
    await waitFor(() => expect(signIn).toHaveBeenCalled());
    expect(window.localStorage.getItem('lfa.preferredCatalog')).toBeNull();
  });

  it('still signs in when the browser storage is blocked', async () => {
    global.fetch = jest.fn(() => list([FIAE, KFBM])) as any;
    const signIn = signInAs();
    const setItem = Storage.prototype.setItem;
    const spy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === 'lfa.preferredCatalog') throw new Error('blocked');
        setItem.call(this, key, value);
      });
    try {
      renderWithProviders(<LoginForm catalogCode="KFBM" />);
      await screen.findByText(/Anmeldung für den Beruf/);
      submit();
      await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
      expect(
        screen.queryByText('Anmeldung fehlgeschlagen')
      ).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
});
