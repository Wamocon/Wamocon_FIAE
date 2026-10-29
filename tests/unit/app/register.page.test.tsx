import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import RegisterPage from '@/app/register/page';

// The registration page with and without the confirmation of the e-mail
// address (the answer of POST /api/register carries confirmationRequired), and
// the password rule of 8 characters.

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/ui/LanguageToggle', () => ({
  LanguageToggle: () => null,
}));

function reply(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  });
}

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('E-Mail-Adresse *'), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText('Passwort *'), {
    target: { value: password },
  });
}

const submitButton = () =>
  screen.getByRole('button', { name: 'Konto erstellen' });

describe('RegisterPage', () => {
  const originalFetch = global.fetch;
  beforeAll(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('the password rule', () => {
    it.each(['1234567', 'abc', 'sechs6'])(
      'refuses %j before anything is sent',
      async password => {
        global.fetch = jest.fn(() => reply(200, {})) as any;
        renderWithProviders(<RegisterPage />);
        fill('azubi@example.com', password);
        fireEvent.click(submitButton());
        expect(await screen.findByText(/mindestens 8 Zeichen/)).toBeTruthy();
        expect(global.fetch).not.toHaveBeenCalled();
      }
    );

    it('sends 8 characters, nothing else is demanded', async () => {
      global.fetch = jest.fn(() =>
        reply(200, {
          success: true,
          role: 'TRAINEE',
          confirmationRequired: true,
        })
      ) as any;
      renderWithProviders(<RegisterPage />);
      fill('azubi@example.com', 'aaaaaaaa');
      fireEvent.click(submitButton());
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/register',
        expect.objectContaining({
          body: JSON.stringify({
            email: 'azubi@example.com',
            password: 'aaaaaaaa',
          }),
        })
      );
    });
  });

  describe('Confirm email on (confirmationRequired)', () => {
    beforeEach(() => {
      global.fetch = jest.fn((url: string) =>
        url === '/api/register'
          ? reply(200, {
              success: true,
              role: 'TRAINEE',
              confirmationRequired: true,
            })
          : reply(200, { success: true })
      ) as any;
    });

    it('tells the person to confirm the address, names it, and says what follows', async () => {
      renderWithProviders(<RegisterPage />);
      fill('azubi@example.com', 'secret12');
      fireEvent.click(submitButton());

      const note = await screen.findByRole('status');
      expect(note).toHaveTextContent(
        'Bitte bestätigen Sie Ihre E-Mail-Adresse'
      );
      expect(note).toHaveTextContent(
        'Wir haben Ihnen einen Link an azubi@example.com geschickt.'
      );
      expect(note).toHaveTextContent(
        'Danach prüft Ihr Ausbilder Ihre Registrierung und schaltet Ihr Konto frei.'
      );
      // not the message of the plain success
      expect(
        screen.queryByText(/wartet auf die Freischaltung durch einen Ausbilder/)
      ).toBeNull();
    });

    it('does not redirect on its own, the person needs this page', async () => {
      jest.useFakeTimers();
      renderWithProviders(<RegisterPage />);
      fill('azubi@example.com', 'secret12');
      fireEvent.click(submitButton());
      await act(async () => {
        await Promise.resolve();
      });
      await screen.findByRole('status');
      await act(async () => {
        jest.advanceTimersByTime(60 * 1000);
      });
      expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it('offers the e-mail again, for the address that was entered', async () => {
      renderWithProviders(<RegisterPage />);
      fill(' azubi@example.com ', 'secret12');
      fireEvent.click(submitButton());
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'Bestätigungs-E-Mail erneut senden',
        })
      );
      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/auth/resend-confirmation',
          expect.objectContaining({
            body: JSON.stringify({ email: 'azubi@example.com' }),
          })
        )
      );
    });

    it('"use another address" brings the form back, for a mistyped address', async () => {
      renderWithProviders(<RegisterPage />);
      fill('azubi@exmaple.com', 'secret12');
      fireEvent.click(submitButton());
      await screen.findByRole('status');
      expect(submitButton()).toBeDisabled();

      fireEvent.click(
        screen.getByRole('button', { name: 'Andere E-Mail-Adresse verwenden' })
      );
      expect(screen.queryByRole('status')).toBeNull();
      expect(submitButton()).toBeEnabled();
    });

    it('the form cannot be sent a second time', async () => {
      renderWithProviders(<RegisterPage />);
      fill('azubi@example.com', 'secret12');
      fireEvent.click(submitButton());
      await screen.findByRole('status');
      expect(submitButton()).toBeDisabled();
    });
  });

  describe('Confirm email off (mailer_autoconfirm, as before)', () => {
    it('shows the message about the release by a trainer and goes to the login after 5 seconds', async () => {
      jest.useFakeTimers();
      global.fetch = jest.fn(() =>
        reply(200, {
          success: true,
          role: 'TRAINEE',
          confirmationRequired: false,
        })
      ) as any;
      renderWithProviders(<RegisterPage />);
      fill('azubi@example.com', 'secret12');
      fireEvent.click(submitButton());
      await act(async () => {
        await Promise.resolve();
      });

      expect(
        await screen.findByText(
          /wartet auf die Freischaltung durch einen Ausbilder/
        )
      ).toBeTruthy();
      expect(
        screen.queryByText(/Bitte bestätigen Sie Ihre E-Mail-Adresse/)
      ).toBeNull();
      expect(mockRouter.push).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });
      expect(mockRouter.push).toHaveBeenCalledWith('/login');
    });

    it('an answer without the field (an older server) behaves the same way', async () => {
      global.fetch = jest.fn(() =>
        reply(200, { success: true, role: 'TRAINEE' })
      ) as any;
      renderWithProviders(<RegisterPage />);
      fill('azubi@example.com', 'secret12');
      fireEvent.click(submitButton());
      expect(
        await screen.findByText(
          /wartet auf die Freischaltung durch einen Ausbilder/
        )
      ).toBeTruthy();
      expect(
        screen.queryByText(/Bitte bestätigen Sie Ihre E-Mail-Adresse/)
      ).toBeNull();
    });
  });

  it('shows the message of the server for a refused registration', async () => {
    global.fetch = jest.fn(() =>
      reply(409, {
        error:
          'Diese E-Mail-Adresse ist bereits registriert. Bitte melden Sie sich an.',
      })
    ) as any;
    renderWithProviders(<RegisterPage />);
    fill('azubi@example.com', 'secret12');
    fireEvent.click(submitButton());
    expect(await screen.findByText(/bereits registriert/)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
