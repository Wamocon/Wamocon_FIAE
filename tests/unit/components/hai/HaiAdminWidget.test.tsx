import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import HaiAdminWidget from '@/components/hai/HaiAdminWidget';
import { authFetch } from '@/lib/authFetch';

// embed (reindex, cancel) asks for the proof of the admin PIN in the header
// x-admin-pin-proof. The widget gets the proof from the dialog and sends it
// with every call that starts or stops work. When the server refuses it (403),
// the widget hands control back so the dialog asks for the PIN again.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));
jest.mock('@/contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({ user: { id: 'staff' } }),
}));

const authFetchMock = authFetch as unknown as jest.Mock<
  (url: string, init?: RequestInit) => Promise<unknown>
>;

const PROOF = 'v1.1800000600000.' + 'b'.repeat(64);

const answer = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const postCalls = () =>
  authFetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

function renderWidget(onProofRejected = jest.fn()) {
  renderWithProviders(
    <HaiAdminWidget adminProof={PROOF} onProofRejected={onProofRejected} />
  );
  return onProofRejected;
}

describe('HaiAdminWidget admin PIN proof', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    // the status read on mount and the polling carry no proof
    authFetchMock.mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? answer(200, { jobId: 'j1' }) : answer(200, {})
    );
  });

  async function clickStart() {
    const buttons = await screen.findAllByRole('button');
    // the first button of the widget starts the reindex
    fireEvent.click(buttons[0]);
  }

  it('sends the proof with the reindex request', async () => {
    renderWidget();
    await clickStart();
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const [url, init] = postCalls()[0];
    expect(url).toBe('/api/hai/embed');
    expect(new Headers(init?.headers).get('x-admin-pin-proof')).toBe(PROOF);
    expect(JSON.parse(String(init?.body)).action).toBe('index_all');
  });

  it('does not send the proof with the status reads', async () => {
    renderWidget();
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled());
    for (const [, init] of authFetchMock.mock.calls) {
      if (init?.method === 'POST') continue;
      expect(new Headers(init?.headers).get('x-admin-pin-proof')).toBeNull();
    }
  });

  it('hands control back when the server refuses the proof', async () => {
    authFetchMock.mockImplementation(async (_url, init) =>
      init?.method === 'POST'
        ? answer(403, { error: 'Admin PIN required' })
        : answer(200, {})
    );
    const onProofRejected = renderWidget();
    await clickStart();
    await waitFor(() => expect(onProofRejected).toHaveBeenCalledTimes(1));
  });

  it('does not hand control back for a successful call', async () => {
    const onProofRejected = renderWidget();
    await clickStart();
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(onProofRejected).not.toHaveBeenCalled();
  });
});
