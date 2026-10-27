import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import HaiAdminDialog from '@/components/hai/HaiAdminDialog';
import { authFetch } from '@/lib/authFetch';

// The PIN gate of the HAI admin dialog. The server counts wrong PINs and locks
// the person after a few attempts (429 with retryAfterSec): the dialog has to
// say that in words, a lock is not "wrong PIN".

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));
jest.mock('@/components/hai/HaiAdminWidget', () => ({
  __esModule: true,
  default: (props: { adminProof: string; onProofRejected: () => void }) => (
    <div data-testid="admin-widget" data-proof={props.adminProof}>
      <button data-testid="reject-proof" onClick={props.onProofRejected} />
    </div>
  ),
}));

const authFetchMock = authFetch as unknown as jest.Mock<
  (url: string, init?: RequestInit) => Promise<unknown>
>;

const answer = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const PROOF = 'v1.1800000600000.' + 'a'.repeat(64);
const granted = (expiresAt = Date.now() + 600_000) =>
  answer(200, { success: true, proof: PROOF, expiresAt });

async function submitPin(pin: string) {
  renderWithProviders(<HaiAdminDialog open onClose={() => undefined} />);
  const input = await screen.findByPlaceholderText(/PIN/i);
  fireEvent.change(input, { target: { value: pin } });
  const buttons = screen.getAllByRole('button');
  fireEvent.click(buttons[buttons.length - 1]);
}

describe('HaiAdminDialog PIN gate', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('opens the admin widget after the right PIN', async () => {
    authFetchMock.mockResolvedValue(granted());
    await submitPin('4711');
    expect(await screen.findByTestId('admin-widget')).toBeTruthy();
    const [url, init] = authFetchMock.mock.calls[0];
    expect(url).toBe('/api/hai/verify-pin');
    expect(JSON.parse(String(init?.body))).toEqual({ pin: '4711' });
  });

  it('says the PIN is wrong after a 401', async () => {
    authFetchMock.mockResolvedValue(answer(401, { success: false }));
    await submitPin('0000');
    await waitFor(() =>
      expect(
        screen.getByText(/PIN/i, { selector: 'p.text-red-400' })
      ).toBeTruthy()
    );
    expect(screen.queryByTestId('admin-widget')).toBeNull();
    expect(screen.queryByText(/\d+ min\b/)).toBeNull();
  });

  it('says how long to wait after a 429, rounded up to whole minutes', async () => {
    authFetchMock.mockResolvedValue(
      answer(429, { success: false, retryAfterSec: 110 })
    );
    await submitPin('0000');
    expect(await screen.findByText(/2 min/)).toBeTruthy();
    expect(screen.queryByTestId('admin-widget')).toBeNull();
  });

  it('names at least one minute, also for a short lock or a missing value', async () => {
    authFetchMock.mockResolvedValue(answer(429, { success: false }));
    await submitPin('0000');
    expect(await screen.findByText(/1 min/)).toBeTruthy();
  });

  it('says the check is unavailable after a 503', async () => {
    authFetchMock.mockResolvedValue(
      answer(503, { success: false, error: 'Temporarily unavailable' })
    );
    await submitPin('4711');
    const message = await screen.findByText(
      (_content, element) =>
        element?.tagName === 'P' &&
        element.classList.contains('text-red-400') &&
        /(nicht verfügbar|unavailable)/i.test(element.textContent ?? '')
    );
    expect(message).toBeTruthy();
    expect(screen.queryByTestId('admin-widget')).toBeNull();
  });

  // The server answers a right PIN with a proof that embed and sync ask for.
  // The browser keeps it in memory only and hands it to the widget.
  describe('admin PIN proof', () => {
    beforeEach(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });

    it('hands the proof to the widget', async () => {
      authFetchMock.mockResolvedValue(granted());
      await submitPin('4711');
      const widget = await screen.findByTestId('admin-widget');
      expect(widget.getAttribute('data-proof')).toBe(PROOF);
    });

    it('keeps the proof out of localStorage, sessionStorage and cookies', async () => {
      authFetchMock.mockResolvedValue(granted());
      await submitPin('4711');
      await screen.findByTestId('admin-widget');
      const stores = [
        JSON.stringify({ ...window.localStorage }),
        JSON.stringify({ ...window.sessionStorage }),
        document.cookie,
      ].join(' ');
      expect(stores).not.toContain(PROOF);
      expect(stores).not.toContain('4711');
    });

    it('does not open the widget when the answer carries no proof', async () => {
      authFetchMock.mockResolvedValue(answer(200, { success: true }));
      await submitPin('4711');
      await waitFor(() =>
        expect(
          screen.getByText(/(nicht verfügbar|unavailable)/i, {
            selector: 'p.text-red-400',
          })
        ).toBeTruthy()
      );
      expect(screen.queryByTestId('admin-widget')).toBeNull();
    });

    it('goes back to the PIN gate when the server rejects the proof', async () => {
      authFetchMock.mockResolvedValue(granted());
      await submitPin('4711');
      fireEvent.click(await screen.findByTestId('reject-proof'));
      expect(await screen.findByPlaceholderText(/PIN/i)).toBeTruthy();
      expect(screen.queryByTestId('admin-widget')).toBeNull();
    });

    it('asks for the PIN again when the proof has expired while the dialog was closed', async () => {
      authFetchMock.mockResolvedValue(granted(Date.now() + 5_000));
      const view = renderWithProviders(
        <HaiAdminDialog open onClose={() => undefined} />
      );
      const input = await screen.findByPlaceholderText(/PIN/i);
      fireEvent.change(input, { target: { value: '4711' } });
      const buttons = screen.getAllByRole('button');
      fireEvent.click(buttons[buttons.length - 1]);
      await screen.findByTestId('admin-widget');

      view.rerender(<HaiAdminDialog open={false} onClose={() => undefined} />);
      const realNow = Date.now;
      jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 60_000);
      view.rerender(<HaiAdminDialog open onClose={() => undefined} />);
      expect(await screen.findByPlaceholderText(/PIN/i)).toBeTruthy();
      expect(screen.queryByTestId('admin-widget')).toBeNull();
      jest.restoreAllMocks();
    });

    it('keeps the proof while the dialog is closed and reopened within its lifetime', async () => {
      authFetchMock.mockResolvedValue(granted());
      const view = renderWithProviders(
        <HaiAdminDialog open onClose={() => undefined} />
      );
      const input = await screen.findByPlaceholderText(/PIN/i);
      fireEvent.change(input, { target: { value: '4711' } });
      const buttons = screen.getAllByRole('button');
      fireEvent.click(buttons[buttons.length - 1]);
      await screen.findByTestId('admin-widget');
      view.rerender(<HaiAdminDialog open={false} onClose={() => undefined} />);
      view.rerender(<HaiAdminDialog open onClose={() => undefined} />);
      expect(await screen.findByTestId('admin-widget')).toBeTruthy();
    });
  });
});
