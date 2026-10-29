import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import ResendConfirmation from '@/components/auth/ResendConfirmation';

// Component under test: the button that asks for the confirmation e-mail
// again (src/components/auth/ResendConfirmation.tsx). It waits a minute after
// every request, in step with the limit of Supabase and of the server route.

const BUTTON = 'Bestätigungs-E-Mail erneut senden';

function answer(status: number, headers: Record<string, string> = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k] ?? null },
    json: () => Promise.resolve({}),
  });
}

describe('ResendConfirmation', () => {
  const originalFetch = global.fetch;
  beforeAll(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });
  beforeEach(() => {
    global.fetch = jest.fn(() => answer(200)) as any;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('sends the address to the server route and says that a new link is on its way', async () => {
    renderWithProviders(<ResendConfirmation email=" azubi@example.com " />);
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Wenn Ihr Konto noch nicht bestätigt ist, ist ein neuer Link unterwegs.'
      )
    );
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/resend-confirmation',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'azubi@example.com' }),
      })
    );
  });

  it('the button waits 60 seconds after a request and counts down', async () => {
    jest.useFakeTimers();
    renderWithProviders(<ResendConfirmation email="azubi@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    await act(async () => {
      await Promise.resolve();
    });

    const waiting = await screen.findByRole('button', {
      name: 'Erneut möglich in 60 s',
    });
    expect(waiting).toBeDisabled();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(
      screen.getByRole('button', { name: 'Erneut möglich in 59 s' })
    ).toBeDisabled();

    // every second is its own timer, set after the render of the one before
    for (let second = 0; second < 59; second++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(screen.getByRole('button', { name: BUTTON })).toBeEnabled();
  });

  it('on 429 it says so and waits as long as the server asks (Retry-After)', async () => {
    global.fetch = jest.fn(() => answer(429, { 'Retry-After': '120' })) as any;
    renderWithProviders(<ResendConfirmation email="azubi@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Es wurden zu viele E-Mails angefordert.'
      )
    );
    expect(
      screen.getByRole('button', { name: 'Erneut möglich in 120 s' })
    ).toBeDisabled();
  });

  it('on another error it says that the e-mail could not be sent, and the button stays usable', async () => {
    global.fetch = jest.fn(() => answer(500)) as any;
    renderWithProviders(<ResendConfirmation email="azubi@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Die E-Mail konnte nicht gesendet werden.'
      )
    );
    expect(screen.getByRole('button', { name: BUTTON })).toBeEnabled();
  });

  it('a network error is handled like another error', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as any;
    renderWithProviders(<ResendConfirmation email="azubi@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Die E-Mail konnte nicht gesendet werden.'
      )
    );
  });

  it('the message goes when the person changes the address', async () => {
    const { rerender } = renderWithProviders(
      <ResendConfirmation email="azubi@example.com" />
    );
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());

    rerender(<ResendConfirmation email="other@example.com" />);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('button', { name: BUTTON })).toBeEnabled();
  });

  it('is disabled without an address', () => {
    renderWithProviders(<ResendConfirmation email="  " />);
    expect(screen.getByRole('button', { name: BUTTON })).toBeDisabled();
  });
});
