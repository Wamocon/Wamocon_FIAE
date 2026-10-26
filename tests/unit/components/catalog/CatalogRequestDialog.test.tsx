import { useRef, useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { CatalogRequestDialog } from '@/components/catalog/CatalogRequestDialog';
import { authFetch } from '@/lib/authFetch';

jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));

const authFetchMock = authFetch as jest.Mock;

const KFBM = { code: 'KFBM', title: 'Kaufmann/-frau für Büromanagement' };

function reply(status: number, body: unknown) {
  authFetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

/** An opener button that gets the focus back when the dialog closes. */
function Harness({ onClose }: { onClose: () => void }) {
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  return (
    <>
      <button ref={opener} type="button">
        Opener
      </button>
      {open && (
        <CatalogRequestDialog
          catalog={KFBM}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          restoreFocusTo={opener}
        />
      )}
    </>
  );
}

function setup(onClose = jest.fn()) {
  const user = userEvent.setup();
  renderWithProviders(<Harness onClose={onClose} />);
  return { user, onClose };
}

describe('CatalogRequestDialog', () => {
  // Radix moves the focus and mounts layers from timers and animation frames.
  // Those updates happen outside act() by design, so the act environment is
  // off here (findBy and userEvent wait for them on their own).
  beforeAll(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    reply(201, { ok: true, alreadyRequested: false });
  });

  describe('the dialog', () => {
    it('is a labelled modal dialog with the occupation and the explanation', async () => {
      setup();
      const dialog = await screen.findByRole('dialog', {
        name: 'Abo anfragen: Kaufmann/-frau für Büromanagement',
      });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAccessibleDescription(
        'Der Beruf ist für Ihre Organisation nicht freigeschaltet. Wir leiten Ihre Anfrage an die Plattformverwaltung weiter.'
      );
      // the page behind it is hidden from assistive technology
      expect(screen.queryByRole('button', { name: 'Opener' })).toBeNull();
    });

    it('puts the focus into the dialog, onto the message field', async () => {
      setup();
      const field = await screen.findByLabelText('Nachricht (optional)');
      await waitFor(() => expect(field).toHaveFocus());
    });

    it('limits the message to 500 characters and counts them', async () => {
      const { user } = setup();
      const field = await screen.findByLabelText('Nachricht (optional)');
      expect(field).toHaveAttribute('maxlength', '500');
      expect(screen.getByText('0 von 500 Zeichen')).toBeInTheDocument();
      await user.type(field, 'Hallo');
      expect(screen.getByText('5 von 500 Zeichen')).toBeInTheDocument();
    });

    it('closes with Cancel and gives the focus back to the opener', async () => {
      const { user, onClose } = setup();
      await screen.findByRole('dialog');
      await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(authFetchMock).not.toHaveBeenCalled();
    });

    it('closes with Escape', async () => {
      const { user, onClose } = setup();
      await screen.findByRole('dialog');
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('gives the focus back to the opener when it is closed', async () => {
      const onClose = jest.fn();
      const { user } = setup(onClose);
      await screen.findByRole('dialog');
      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Opener' })).toHaveFocus()
      );
    });
  });

  describe('sending', () => {
    it('sends the code and the message, then thanks the person', async () => {
      const { user } = setup();
      await user.type(
        await screen.findByLabelText('Nachricht (optional)'),
        'Drei Azubis ab Februar'
      );
      await user.click(screen.getByRole('button', { name: 'Anfrage senden' }));

      expect(authFetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = authFetchMock.mock.calls[0];
      expect(url).toBe('/api/me/catalog-requests');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({
        catalogCode: 'KFBM',
        message: 'Drei Azubis ab Februar',
      });

      expect(
        await screen.findByText(/Ihre Anfrage wurde an die Plattformverwaltung/)
      ).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(
        'Sobald der Beruf für Ihre Organisation freigeschaltet ist'
      );
      // the form is gone, one button is left and it has the focus
      expect(screen.queryByLabelText('Nachricht (optional)')).toBeNull();
      const close = screen.getByRole('button', { name: 'Schließen' });
      await waitFor(() => expect(close).toHaveFocus());
    });

    it('sends no message when the field is empty or blank', async () => {
      const { user } = setup();
      await user.type(
        await screen.findByLabelText('Nachricht (optional)'),
        '   '
      );
      await user.click(screen.getByRole('button', { name: 'Anfrage senden' }));
      await screen.findByRole('status');
      expect(JSON.parse(authFetchMock.mock.calls[0][1].body)).toEqual({
        catalogCode: 'KFBM',
      });
    });

    it('tells the person when the same request is already open', async () => {
      reply(200, { ok: true, alreadyRequested: true });
      const { user } = setup();
      await user.click(
        await screen.findByRole('button', { name: 'Anfrage senden' })
      );
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Sie haben diesen Beruf in den letzten 14 Tagen schon angefragt.'
      );
      // not an error
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('sends only once when the button is pressed twice', async () => {
      let release: (value: unknown) => void = () => {};
      authFetchMock.mockReturnValue(
        new Promise(resolve => {
          release = resolve;
        })
      );
      const { user } = setup();
      const send = await screen.findByRole('button', {
        name: 'Anfrage senden',
      });
      await user.click(send);
      await user.click(send);
      expect(authFetchMock).toHaveBeenCalledTimes(1);
      expect(send).toHaveAttribute('aria-disabled', 'true');
      expect(send).toHaveTextContent('Wird gesendet');
      release({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ ok: true, alreadyRequested: false }),
      });
      await screen.findByRole('status');
    });

    it('does not close with Escape while it is sending', async () => {
      authFetchMock.mockReturnValue(new Promise(() => {}));
      const { user, onClose } = setup();
      await user.click(
        await screen.findByRole('button', { name: 'Anfrage senden' })
      );
      await user.keyboard('{Escape}');
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('errors (German text per code, the form stays open)', () => {
    it.each([
      [
        409,
        { code: 'ALREADY_ENABLED' },
        'Der Beruf ist für Ihre Organisation bereits freigeschaltet.',
      ],
      [
        429,
        { code: 'RATE_LIMITED' },
        'Zu viele Anfragen in kurzer Zeit. Bitte versuchen Sie es in einigen Minuten erneut.',
      ],
      [404, { error: 'Training catalog not found' }, 'nicht mehr verfügbar'],
      [
        403,
        { error: 'Forbidden' },
        'Für Ihr Konto ist keine Anfrage möglich. Bitte wenden Sie sich an Ihren Ausbilder.',
      ],
      [
        401,
        { error: 'Unauthorized' },
        'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.',
      ],
      [
        503,
        { code: 'NO_RECIPIENT' },
        'Die Anfrage konnte nicht zugestellt werden.',
      ],
      [500, { error: 'Internal Server Error' }, 'konnte nicht gesendet werden'],
      [400, null, 'konnte nicht gesendet werden'],
    ])('%s %j', async (status, body, text) => {
      reply(status, body);
      const { user } = setup();
      await user.type(
        await screen.findByLabelText('Nachricht (optional)'),
        'x'
      );
      await user.click(screen.getByRole('button', { name: 'Anfrage senden' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(text);
      // the person can correct and send again
      expect(screen.getByLabelText('Nachricht (optional)')).toHaveValue('x');
      expect(
        screen.getByRole('button', { name: 'Anfrage senden' })
      ).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('shows the general error for a network error', async () => {
      authFetchMock.mockRejectedValue(new Error('offline'));
      const { user } = setup();
      await user.click(
        await screen.findByRole('button', { name: 'Anfrage senden' })
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Die Anfrage konnte nicht gesendet werden. Bitte prüfen Sie Ihre Verbindung'
      );
    });

    it('clears the error when the person sends again successfully', async () => {
      reply(500, { error: 'x' });
      const { user } = setup();
      await user.click(
        await screen.findByRole('button', { name: 'Anfrage senden' })
      );
      await screen.findByRole('alert');
      reply(201, { ok: true, alreadyRequested: false });
      await user.click(screen.getByRole('button', { name: 'Anfrage senden' }));
      await screen.findByRole('status');
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
