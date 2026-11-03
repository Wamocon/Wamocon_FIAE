import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { HaiMemoryCard } from '@/components/hai/HaiMemoryCard';
import {
  HaiProvider,
  toMemoryProposal,
  useHai,
  type HaiMemoryProposal,
} from '@/components/hai/HaiProvider';
import { authFetch } from '@/lib/authFetch';

// The HAI never saves something about a person silently. The card asks "Soll ich
// mir das merken?" with Yes, No and Change. Only the click calls the server
// (PATCH /api/hai/memory/[id]), Change lets the person correct the text first.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));

const authFetchMock = authFetch as unknown as jest.Mock<
  (url: string, init?: RequestInit) => Promise<unknown>
>;

const ID = '30000000-0000-4000-8000-000000000001';

const proposal = (
  overrides: Partial<HaiMemoryProposal> = {}
): HaiMemoryProposal => ({
  id: ID,
  kind: 'preference',
  content: 'Bevorzugt kurze, knappe Antworten.',
  status: 'open',
  ...overrides,
});

describe('HaiMemoryCard', () => {
  it('shows the text with Yes, No and Change, and calls nothing before a click', () => {
    const onAnswer = jest.fn();
    renderWithProviders(
      <HaiMemoryCard proposal={proposal()} onAnswer={onAnswer} />
    );
    expect(screen.getByText('Soll ich mir das merken?')).toBeTruthy();
    expect(screen.getByText('Bevorzugt kurze, knappe Antworten.')).toBeTruthy();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual([
      'Ja',
      'Nein',
      'Ändern',
    ]);
  });

  it('Yes confirms, No rejects', () => {
    const onAnswer = jest.fn();
    renderWithProviders(
      <HaiMemoryCard proposal={proposal()} onAnswer={onAnswer} />
    );
    fireEvent.click(screen.getByText('Ja'));
    expect(onAnswer).toHaveBeenLastCalledWith('confirm');
    fireEvent.click(screen.getByText('Nein'));
    expect(onAnswer).toHaveBeenLastCalledWith('reject');
  });

  it('Change opens the text, Save confirms with the changed text, Cancel goes back', () => {
    const onAnswer = jest.fn();
    renderWithProviders(
      <HaiMemoryCard proposal={proposal()} onAnswer={onAnswer} />
    );
    fireEvent.click(screen.getByText('Ändern'));
    const field = screen.getByLabelText('Text ändern') as HTMLTextAreaElement;
    expect(field.value).toBe('Bevorzugt kurze, knappe Antworten.');
    expect(field.maxLength).toBe(300);
    fireEvent.change(field, { target: { value: '  Lieber ausführlich.  ' } });
    fireEvent.click(screen.getByText('Speichern'));
    expect(onAnswer).toHaveBeenCalledWith('confirm', 'Lieber ausführlich.');
  });

  it('Cancel leaves the change and shows the original text again', () => {
    const onAnswer = jest.fn();
    renderWithProviders(
      <HaiMemoryCard proposal={proposal()} onAnswer={onAnswer} />
    );
    fireEvent.click(screen.getByText('Ändern'));
    fireEvent.change(screen.getByLabelText('Text ändern'), {
      target: { value: 'Etwas anderes' },
    });
    fireEvent.click(screen.getByText('Abbrechen'));
    expect(screen.queryByLabelText('Text ändern')).toBeNull();
    expect(screen.getByText('Bevorzugt kurze, knappe Antworten.')).toBeTruthy();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('does not save an empty text', () => {
    const onAnswer = jest.fn();
    renderWithProviders(
      <HaiMemoryCard proposal={proposal()} onAnswer={onAnswer} />
    );
    fireEvent.click(screen.getByText('Ändern'));
    fireEvent.change(screen.getByLabelText('Text ändern'), {
      target: { value: '   ' },
    });
    expect((screen.getByText('Speichern') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it.each(['running', 'saved', 'rejected'] as const)(
    'offers no buttons in the state %s',
    status => {
      renderWithProviders(
        <HaiMemoryCard proposal={proposal({ status })} onAnswer={jest.fn()} />
      );
      expect(screen.queryAllByRole('button')).toHaveLength(0);
      expect(
        screen.getByTestId('hai-memory-card').getAttribute('data-status')
      ).toBe(status);
    }
  );

  it('an error says what happened and lets the person answer again', () => {
    renderWithProviders(
      <HaiMemoryCard
        proposal={proposal({ status: 'error', errorKey: 'content' })}
        onAnswer={jest.fn()}
      />
    );
    expect(screen.getByRole('alert').textContent).toMatch(/Stil und Vorlieben/);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });
});

describe('toMemoryProposal', () => {
  it('takes a well formed proposal of the server and refuses everything else', () => {
    expect(
      toMemoryProposal({ id: ID, kind: 'weakness', content: 'Text' })
    ).toEqual({ id: ID, kind: 'weakness', content: 'Text', status: 'open' });
    for (const bad of [
      null,
      undefined,
      'x',
      {},
      { id: ID, kind: 'nonsense', content: 'Text' },
      { id: 1, kind: 'weakness', content: 'Text' },
      { id: ID, kind: 'weakness' },
    ]) {
      expect(toMemoryProposal(bad)).toBeUndefined();
    }
  });
});

describe('HaiProvider: answering the question of the memory', () => {
  let hai: ReturnType<typeof useHai>;
  function Probe() {
    hai = useHai();
    return null;
  }

  const memoryCalls = () =>
    authFetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith('/api/hai/memory')
    );

  async function sendWithProposal(memoryResponse: {
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
            response: 'Gern, ich fasse mich kürzer.',
            citations: [],
            memoryProposal: {
              id: ID,
              kind: 'preference',
              source: 'stated',
              content: 'Bevorzugt kurze, knappe Antworten.',
            },
          }),
        };
      }
      if (String(url).startsWith('/api/hai/memory')) {
        return {
          ok: memoryResponse.ok,
          status: memoryResponse.status,
          json: async () => memoryResponse.body,
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
      await hai.sendMessage('Antworte bitte kürzer');
    });
    return hai.messages.find(m => m.role === 'assistant')!.id;
  }

  beforeEach(() => jest.clearAllMocks());

  it('keeps the question open and calls nothing before the person answers', async () => {
    await sendWithProposal({ ok: true, status: 200, body: {} });
    const message = hai.messages.find(m => m.role === 'assistant')!;
    expect(message.memoryProposal).toMatchObject({ id: ID, status: 'open' });
    expect(memoryCalls()).toHaveLength(0);
  });

  it('Yes sends one decision call, a double click is one call', async () => {
    const id = await sendWithProposal({
      ok: true,
      status: 200,
      body: { entry: { content: 'Bevorzugt kurze, knappe Antworten.' } },
    });
    await act(async () => {
      await Promise.all([
        hai.answerMemoryProposal(id, 'confirm'),
        hai.answerMemoryProposal(id, 'confirm'),
      ]);
    });
    expect(memoryCalls()).toHaveLength(1);
    const [url, init] = memoryCalls()[0];
    expect(url).toBe(`/api/hai/memory/${ID}`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ decision: 'confirm' });
    await waitFor(() =>
      expect(hai.messages.find(m => m.id === id)?.memoryProposal?.status).toBe(
        'saved'
      )
    );
  });

  it('Change sends the changed text and shows the saved one', async () => {
    const id = await sendWithProposal({
      ok: true,
      status: 200,
      body: { entry: { content: 'Lieber ausführlich.' } },
    });
    await act(async () => {
      await hai.answerMemoryProposal(id, 'confirm', 'Lieber ausführlich.');
    });
    expect(JSON.parse(String(memoryCalls()[0][1]?.body))).toEqual({
      decision: 'confirm',
      content: 'Lieber ausführlich.',
    });
    expect(hai.messages.find(m => m.id === id)?.memoryProposal).toMatchObject({
      status: 'saved',
      content: 'Lieber ausführlich.',
    });
  });

  it('No sends the rejection and nothing is saved', async () => {
    const id = await sendWithProposal({ ok: true, status: 200, body: {} });
    await act(async () => {
      await hai.answerMemoryProposal(id, 'reject');
    });
    expect(JSON.parse(String(memoryCalls()[0][1]?.body))).toEqual({
      decision: 'reject',
    });
    expect(hai.messages.find(m => m.id === id)?.memoryProposal?.status).toBe(
      'rejected'
    );
    // answered: a second click calls nothing
    await act(async () => {
      await hai.answerMemoryProposal(id, 'confirm');
    });
    expect(memoryCalls()).toHaveLength(1);
  });

  it.each([
    [422, 'content'],
    [404, 'gone'],
    [409, 'gone'],
    [500, 'generic'],
  ])(
    'maps the server status %s to the error %s and lets the person try again',
    async (status, key) => {
      const id = await sendWithProposal({
        ok: false,
        status,
        body: { code: 'X' },
      });
      await act(async () => {
        await hai.answerMemoryProposal(id, 'confirm', 'Text');
      });
      expect(hai.messages.find(m => m.id === id)?.memoryProposal).toMatchObject(
        {
          status: 'error',
          errorKey: key,
        }
      );
    }
  );

  it('a message without a question has no card state and an unknown id calls nothing', async () => {
    await sendWithProposal({ ok: true, status: 200, body: {} });
    await act(async () => {
      await hai.answerMemoryProposal('unknown-message', 'confirm');
    });
    expect(memoryCalls()).toHaveLength(0);
  });
});
