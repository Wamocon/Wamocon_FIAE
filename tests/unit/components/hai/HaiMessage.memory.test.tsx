import React from 'react';
import { act, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { HaiMessage } from '@/components/hai/HaiMessage';
import {
  HaiProvider,
  useHai,
  type HaiMessage as MessageType,
} from '@/components/hai/HaiProvider';
import { authFetch } from '@/lib/authFetch';

// The question of the memory sits below the answer of the HAI. In the middle of
// a quiz round (the quiz card is on screen) it waits: the memory never asks then.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));

// the markdown renderer is an ES module that jest does not load
jest.mock('@/components/ui/MarkdownText', () => ({
  __esModule: true,
  MarkdownText: ({ content }: { content: string }) => <p>{content}</p>,
}));

let mockQuizActive = false;
jest.mock('@/components/hai/HaiQuizMode', () => ({
  __esModule: true,
  useHaiQuizMode: () => ({ active: mockQuizActive, start: () => undefined }),
}));

const authFetchMock = authFetch as unknown as jest.Mock<
  (url: string, init?: RequestInit) => Promise<unknown>
>;

const ID = '30000000-0000-4000-8000-000000000001';

let hai: ReturnType<typeof useHai>;
function Probe() {
  hai = useHai();
  return null;
}

async function assistantMessage(): Promise<MessageType> {
  authFetchMock.mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      sessionId: 's1',
      response: 'Gern.',
      citations: [],
      memoryProposal: {
        id: ID,
        kind: 'preference',
        source: 'stated',
        content: 'Bevorzugt kurze, knappe Antworten.',
      },
    }),
  }));
  renderWithProviders(
    <HaiProvider userId="u1">
      <Probe />
    </HaiProvider>
  );
  await act(async () => {
    await hai.sendMessage('Antworte bitte kürzer');
  });
  return hai.messages.find(m => m.role === 'assistant')!;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuizActive = false;
});

describe('HaiMessage and the question of the memory', () => {
  it('shows the card below the answer', async () => {
    const message = await assistantMessage();
    renderWithProviders(
      <HaiProvider userId="u2">
        <HaiMessage message={message} />
      </HaiProvider>
    );
    expect(screen.getByTestId('hai-memory-card')).toBeTruthy();
  });

  it('keeps the card back while a quiz round is running', async () => {
    const message = await assistantMessage();
    mockQuizActive = true;
    renderWithProviders(
      <HaiProvider userId="u2">
        <HaiMessage message={message} />
      </HaiProvider>
    );
    expect(screen.queryByTestId('hai-memory-card')).toBeNull();
  });

  it('shows no card while the answer is still streaming', async () => {
    const message = await assistantMessage();
    renderWithProviders(
      <HaiProvider userId="u2">
        <HaiMessage message={message} isStreaming />
      </HaiProvider>
    );
    expect(screen.queryByTestId('hai-memory-card')).toBeNull();
  });
});
