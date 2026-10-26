import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { HaiActionCard } from '@/components/hai/HaiActionCard';
import { HaiProvider, useHai } from '@/components/hai/HaiProvider';
import type { HaiPendingAction } from '@/components/hai/HaiProvider';
import { authFetch } from '@/lib/authFetch';

// HAI never executes a write by itself. The card shows the proposal, only
// "Confirm" calls /api/hai/action (with confirmed: true), "Cancel" calls
// nothing.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));

const authFetchMock = authFetch as unknown as jest.Mock<
  (url: string, init?: RequestInit) => Promise<unknown>
>;

const ENABLER = '20000000-0000-4000-8000-000000000001';

const pending = (
  overrides: Partial<HaiPendingAction> = {}
): HaiPendingAction => ({
  type: 'complete_enabler',
  parameters: { enablerId: ENABLER },
  description: 'Enabler "SQL Grundlagen" als abgeschlossen markieren',
  status: 'pending',
  ...overrides,
});

describe('HaiActionCard', () => {
  it('shows the description with Confirm and Cancel, and acts only on a click', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    renderWithProviders(
      <HaiActionCard
        action={pending()}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(
      screen.getByText('Enabler "SQL Grundlagen" als abgeschlossen markieren')
    ).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[1]);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it.each(['running', 'done', 'cancelled', 'error'] as const)(
    'offers no buttons in the state %s',
    status => {
      renderWithProviders(
        <HaiActionCard
          action={pending({
            status,
            errorKey: 'forbidden',
            resultMessage: 'ok',
          })}
          onConfirm={jest.fn()}
          onCancel={jest.fn()}
        />
      );
      expect(screen.queryAllByRole('button')).toHaveLength(0);
      expect(
        screen.getByTestId('hai-action-card').getAttribute('data-status')
      ).toBe(status);
    }
  );

  it('shows the error of the server status as text, not the raw server answer', () => {
    renderWithProviders(
      <HaiActionCard
        action={pending({ status: 'error', errorKey: 'notFound' })}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(screen.getByRole('alert').textContent).toMatch(/\S/);
  });
});

describe('HaiProvider: confirming a proposal', () => {
  let hai: ReturnType<typeof useHai>;
  function Probe() {
    hai = useHai();
    return null;
  }

  const proposal = {
    type: 'complete_enabler',
    parameters: { enablerId: ENABLER },
    description: 'Enabler "SQL Grundlagen" als abgeschlossen markieren',
  };

  const actionCalls = () =>
    authFetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith('/api/hai/action')
    );

  async function sendProposal(actionResponse: {
    ok: boolean;
    status: number;
    body: unknown;
  }) {
    authFetchMock.mockImplementation(async url => {
      if (String(url).startsWith('/api/hai/chat')) {
        return {
          ok: true,
          json: async () => ({
            sessionId: 's1',
            response: 'Ich habe diese Aktion vorbereitet',
            citations: [],
            pendingAction: proposal,
          }),
        };
      }
      if (String(url).startsWith('/api/hai/action')) {
        return {
          ok: actionResponse.ok,
          status: actionResponse.status,
          json: async () => actionResponse.body,
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    renderWithProviders(
      <HaiProvider userId="u1">
        <Probe />
      </HaiProvider>
    );
    await act(async () => {
      await hai.sendMessage('Enabler fertig');
    });
    const message = hai.messages.find(m => m.role === 'assistant')!;
    return message.id;
  }

  beforeEach(() => jest.clearAllMocks());

  it('keeps the proposal open and calls nothing before the person decides', async () => {
    await sendProposal({ ok: true, status: 200, body: { success: true } });
    const message = hai.messages.find(m => m.role === 'assistant')!;
    expect(message.pendingAction).toMatchObject({
      type: 'complete_enabler',
      status: 'pending',
    });
    expect(actionCalls()).toHaveLength(0);
  });

  it('sends the confirmed call once after Confirm', async () => {
    const id = await sendProposal({
      ok: true,
      status: 200,
      body: { success: true, message: 'Erledigt' },
    });
    await act(async () => {
      // A double click must not execute twice
      await Promise.all([
        hai.confirmPendingAction(id),
        hai.confirmPendingAction(id),
      ]);
    });
    expect(actionCalls()).toHaveLength(1);
    const [url, init] = actionCalls()[0];
    expect(url).toBe('/api/hai/action');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      actionType: 'complete_enabler',
      parameters: { enablerId: ENABLER },
      confirmed: true,
    });
    await waitFor(() =>
      expect(hai.messages.find(m => m.id === id)?.pendingAction?.status).toBe(
        'done'
      )
    );
  });

  it('calls nothing after Cancel', async () => {
    const id = await sendProposal({
      ok: true,
      status: 200,
      body: { success: true },
    });
    act(() => hai.cancelPendingAction(id));
    expect(hai.messages.find(m => m.id === id)?.pendingAction?.status).toBe(
      'cancelled'
    );
    await act(async () => {
      await hai.confirmPendingAction(id);
    });
    expect(actionCalls()).toHaveLength(0);
  });

  it.each([
    [403, 'forbidden'],
    [404, 'notFound'],
    [409, 'conflict'],
    [503, 'unavailable'],
    [500, 'generic'],
  ])('maps the server status %s to the error %s', async (status, key) => {
    const id = await sendProposal({
      ok: false,
      status,
      body: { success: false, error: 'raw server text' },
    });
    await act(async () => {
      await hai.confirmPendingAction(id);
    });
    expect(hai.messages.find(m => m.id === id)?.pendingAction).toMatchObject({
      status: 'error',
      errorKey: key,
    });
  });
});
