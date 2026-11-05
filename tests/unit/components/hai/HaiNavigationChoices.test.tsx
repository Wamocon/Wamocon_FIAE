import React from 'react';
import { act } from '@testing-library/react';
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  jest,
} from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { HaiProvider, useHai } from '@/components/hai/HaiProvider';
import { authFetch } from '@/lib/authFetch';

// Questions back with cards (at most three, never opened by themselves) and the
// one way for the typed chat and the voice assistant of the chat: the same command
// opens the same page, and on a phone the panel steps away so the page is seen.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));
jest.mock('@/components/ui/MarkdownText', () => ({
  __esModule: true,
  MarkdownText: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  ...(jest.requireActual('next/navigation') as object),
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

const authFetchMock = authFetch as unknown as jest.Mock<
  (url: string, init?: RequestInit) => Promise<unknown>
>;

const E1 = '10000000-0000-4000-8000-000000000001';
const E2 = '10000000-0000-4000-8000-000000000002';
const E3 = '10000000-0000-4000-8000-000000000003';
const E4 = '10000000-0000-4000-8000-000000000004';
const card = (id: string, label: string) => ({
  path: `/trainee/enablers/${id}`,
  label,
  reason: `Das ist der Enabler ${label}.`,
});

let hai: ReturnType<typeof useHai>;
function Probe() {
  hai = useHai();
  return null;
}
const mount = () =>
  renderWithProviders(
    <HaiProvider userId="u1">
      <Probe />
    </HaiProvider>
  );

function answerWith(body: Record<string, unknown>) {
  authFetchMock.mockImplementation(async url =>
    String(url) === '/api/hai/chat'
      ? {
          ok: true,
          json: async () => ({
            sessionId: 's1',
            response: 'Antwort',
            citations: [],
            ...body,
          }),
        }
      : { ok: true, json: async () => ({}) }
  );
}

function setPhone(on: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: on && query.includes('767'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});
beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  setPhone(false);
});

const assistant = () => hai.messages.filter(m => m.role === 'assistant')[0];

describe('a question back with cards', () => {
  it('keeps at most three valid cards, each waiting for a tap', async () => {
    answerWith({
      navigationChoices: [
        card(E1, 'Eins'),
        card(E2, 'Zwei'),
        { ...card(E3, 'Drei'), auto: true },
        card(E4, 'Vier'),
      ],
    });
    mount();
    await act(async () => {
      await hai.sendMessage('Öffne den Enabler Sicherung');
    });
    const choices = assistant().navigationChoices ?? [];
    expect(choices.map(c => c.label)).toEqual(['Eins', 'Zwei', 'Drei']);
    expect(choices.every(c => c.status === 'open')).toBe(true);
    // a card is never opened by itself, `auto` is not taken over
    expect(choices.every(c => c.auto === undefined)).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('drops a card whose path is not on the allow list', async () => {
    answerWith({
      navigationChoices: [
        { path: '/admin/secret', label: 'Geheim', reason: 'x' },
        { path: 'https://evil.example/', label: 'Fremd', reason: 'x' },
        { path: `/trainee/enablers/${E1}?x=1`, label: 'Param', reason: 'x' },
        card(E2, 'Zwei'),
      ],
    });
    mount();
    await act(async () => {
      await hai.sendMessage('Öffne die Kantine');
    });
    expect((assistant().navigationChoices ?? []).map(c => c.label)).toEqual([
      'Zwei',
    ]);
  });

  it('opens exactly the tapped card and marks it', async () => {
    answerWith({
      navigationChoices: [card(E1, 'Eins'), card(E2, 'Zwei')],
    });
    mount();
    await act(async () => {
      await hai.sendMessage('Öffne den Enabler Sicherung');
    });
    act(() => hai.openNavigationChoice(assistant().id, 1));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(`/trainee/enablers/${E2}`);
    expect(assistant().navigationChoices?.[1].status).toBe('opened');
    expect(assistant().navigationChoices?.[0].status).toBe('open');
    act(() => hai.openNavigationChoice(assistant().id, 7));
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('typed and spoken (voice assistant of the chat) take one way', () => {
  const AUTO = {
    ...card(E1, 'Eins'),
    path: `/trainee/enablers/${E1}?document=${E2}`,
    auto: true,
  };

  it.each([
    ['typed', undefined],
    ['spoken in the chat, without the voice mode', { voice: true }],
  ])(
    '%s: the command opens the page through the router at once',
    async (_n, options) => {
      answerWith({
        navigationOffer: AUTO,
        response: 'Ich öffne das Dokument.',
      });
      mount();
      await act(async () => {
        await hai.sendMessage('Öffne das Dokument Szenario_14i', options);
      });
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(
        `/trainee/enablers/${E1}?document=${E2}`
      );
      expect(assistant().navigationOffer).toMatchObject({ status: 'opened' });
    }
  );

  it.each([
    ['typed', undefined],
    ['spoken', { voice: true }],
  ])(
    '%s: a wide screen keeps the panel, a large chat gives way',
    async (_n, options) => {
      answerWith({ navigationOffer: AUTO });
      mount();
      act(() => hai.setViewMode('full'));
      await act(async () => {
        await hai.sendMessage('Öffne das Dokument', options);
      });
      expect(hai.viewMode).toBe('widget');
    }
  );

  it.each([
    ['typed', undefined],
    ['spoken', { voice: true }],
  ])(
    '%s: on a phone the panel steps away so the opened page is seen',
    async (_n, options) => {
      setPhone(true);
      answerWith({ navigationOffer: AUTO });
      mount();
      act(() => hai.setViewMode('widget'));
      await act(async () => {
        await hai.sendMessage('Öffne das Dokument', options);
      });
      expect(hai.viewMode).toBe('hidden');
      expect(mockPush).toHaveBeenCalledTimes(1);
    }
  );

  it('a card that was only offered is still opened by a tap, and the spoken yes answers a spoken offer', async () => {
    answerWith({
      navigationOffer: {
        path: `/trainee/enablers/${E1}`,
        label: 'Eins',
        reason: 'Das ist der Enabler Eins.',
      },
      response: 'Ich habe den Enabler für dich. Soll ich sie öffnen?',
    });
    mount();
    await act(async () => {
      await hai.sendMessage('Wo finde ich den Enabler Eins?', { voice: true });
    });
    expect(mockPush).not.toHaveBeenCalled();
    await act(async () => {
      await hai.sendMessage('ja', { voice: true });
    });
    expect(mockPush).toHaveBeenCalledWith(`/trainee/enablers/${E1}`);
  });
});
