import React from 'react';
import { TextDecoder, TextEncoder } from 'util';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { HaiNavigationCard } from '@/components/hai/HaiNavigationCard';
import { HaiMessage } from '@/components/hai/HaiMessage';
import {
  HaiProvider,
  useHai,
  type HaiNavigationOffer,
} from '@/components/hai/HaiProvider';
import { authFetch } from '@/lib/authFetch';

// The navigation card: HAI offers a page, the text chat never changes the page
// by itself. A tap on "Öffnen" (or Enter on the button) takes the person there.
// Only a spoken "ja" to "Soll ich sie öffnen?" opens a page without the button.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));

// the markdown renderer is an ES module that Jest does not transform, and the
// text of the message is not what this test is about
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

const OFFER = {
  path: '/trainee/activity-reports',
  label: 'Ausbildungsnachweis',
  reason:
    'Dort führst du dein Berichtsheft mit den wöchentlichen Tätigkeitsnachweisen.',
};

const offer = (
  overrides: Partial<HaiNavigationOffer> = {}
): HaiNavigationOffer => ({
  ...OFFER,
  status: 'open',
  spoken: false,
  ...overrides,
});

describe('HaiNavigationCard', () => {
  it('shows the page, the reason and the button, and opens only on a tap', () => {
    const onOpen = jest.fn();
    renderWithProviders(<HaiNavigationCard offer={offer()} onOpen={onOpen} />);

    expect(screen.getByText('Ausbildungsnachweis')).toBeTruthy();
    expect(screen.getByText(OFFER.reason)).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Öffnen/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('opens with Enter on the focused button', async () => {
    const onOpen = jest.fn();
    renderWithProviders(<HaiNavigationCard offer={offer()} onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: /Öffnen/ });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('tells that the page was opened', () => {
    renderWithProviders(
      <HaiNavigationCard
        offer={offer({ status: 'opened' })}
        onOpen={jest.fn()}
      />
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Die Seite wurde geöffnet.'
    );
    expect(
      screen.getByTestId('hai-navigation-card').getAttribute('data-status')
    ).toBe('opened');
  });

  it('shows no status before it was opened and has no second button', () => {
    renderWithProviders(
      <HaiNavigationCard offer={offer()} onOpen={jest.fn()} />
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('the card inside the chat and the provider', () => {
  let hai: ReturnType<typeof useHai>;
  function Probe() {
    hai = useHai();
    return null;
  }

  const chatCalls = () =>
    authFetchMock.mock.calls.filter(([url]) => String(url) === '/api/hai/chat');

  /** The chat route answers with an offer for the first message, a plain answer after that. */
  function answerWith(first: unknown, later = 'Antwort') {
    let call = 0;
    authFetchMock.mockImplementation(async url => {
      if (String(url) === '/api/hai/chat') {
        call += 1;
        return {
          ok: true,
          json: async () => ({
            sessionId: 's1',
            response: call === 1 ? 'Ich habe die Seite.' : later,
            citations: [],
            navigationOffer: call === 1 ? first : undefined,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
  }

  function mount() {
    return renderWithProviders(
      <HaiProvider userId="u1">
        <Probe />
      </HaiProvider>
    );
  }

  const assistants = () => hai.messages.filter(m => m.role === 'assistant');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attaches the offer of the server as a card that waits (status open)', async () => {
    answerWith(OFFER);
    mount();
    await act(async () => {
      await hai.sendMessage('öffne meine Berichte');
    });
    expect(assistants()[0].navigationOffer).toEqual({
      ...OFFER,
      status: 'open',
      spoken: false,
    });
    // the text chat does not change the page by itself
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens the page on the tap: the router gets the allowed path, the card is opened', async () => {
    answerWith(OFFER);
    mount();
    await act(async () => {
      await hai.sendMessage('öffne meine Berichte');
    });
    const id = assistants()[0].id;
    act(() => hai.openNavigation(id));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/trainee/activity-reports');
    expect(assistants()[0].navigationOffer?.status).toBe('opened');
  });

  it('closes the large chat panel so it does not hide the page', async () => {
    answerWith(OFFER);
    mount();
    act(() => hai.setViewMode('full'));
    await act(async () => {
      await hai.sendMessage('öffne meine Berichte');
    });
    act(() => hai.openNavigation(assistants()[0].id));
    expect(hai.viewMode).toBe('widget');
  });

  it('shows no card for an offer with a path outside the allow list', async () => {
    for (const path of [
      '/trainer/admin/secret',
      'https://evil.example/x',
      '//evil.example',
      'javascript:alert(1)',
    ]) {
      jest.clearAllMocks();
      answerWith({ ...OFFER, path });
      const view = mount();
      await act(async () => {
        await hai.sendMessage('öffne meine Berichte');
      });
      expect(assistants()[0].navigationOffer).toBeUndefined();
      act(() => hai.openNavigation(assistants()[0].id));
      expect(mockPush).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('a typed "ja" never opens the page, it is a normal message', async () => {
    answerWith(OFFER);
    mount();
    await act(async () => {
      await hai.sendMessage('öffne meine Berichte');
    });
    await act(async () => {
      await hai.sendMessage('ja');
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(chatCalls()).toHaveLength(2);
  });

  it('a spoken "ja" to the spoken question opens the page without a call to the server', async () => {
    answerWith(OFFER);
    mount();
    await act(async () => {
      await hai.sendMessage('öffne meine Berichte', { voice: true });
    });
    expect(assistants()[0].navigationOffer).toMatchObject({
      status: 'open',
      spoken: true,
    });
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      await hai.sendMessage('Ja, bitte', { voice: true });
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/trainee/activity-reports');
    // no second call to the chat route, the reply is answered here
    expect(chatCalls()).toHaveLength(1);
    const last = hai.messages[hai.messages.length - 1];
    expect(last).toMatchObject({
      role: 'assistant',
      content: 'Ich öffne die Seite Ausbildungsnachweis.',
    });
    expect(hai.messages[hai.messages.length - 2]).toMatchObject({
      role: 'user',
      content: 'Ja, bitte',
    });
    expect(assistants()[0].navigationOffer?.status).toBe('opened');
  });

  it('a spoken "öffnen" opens it too, and a second "ja" opens nothing more', async () => {
    answerWith(OFFER);
    mount();
    await act(async () => {
      await hai.sendMessage('öffne meine Berichte', { voice: true });
    });
    await act(async () => {
      await hai.sendMessage('öffnen', { voice: true });
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    await act(async () => {
      await hai.sendMessage('ja', { voice: true });
    });
    // the offer is used up: the second "ja" goes to the server as a message
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(chatCalls()).toHaveLength(2);
  });

  it('a spoken "nein" drops the offer and is answered here', async () => {
    answerWith(OFFER);
    mount();
    await act(async () => {
      await hai.sendMessage('öffne meine Berichte', { voice: true });
    });
    await act(async () => {
      await hai.sendMessage('nein danke', { voice: true });
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(chatCalls()).toHaveLength(1);
    expect(assistants()[0].navigationOffer?.status).toBe('dismissed');
    expect(hai.messages[hai.messages.length - 1].content).toBe(
      'In Ordnung, ich bleibe hier.'
    );
    // a later "ja" opens nothing
    await act(async () => {
      await hai.sendMessage('ja', { voice: true });
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('another spoken question drops the offer and goes to the server', async () => {
    answerWith(OFFER, 'Eine Erklärung');
    mount();
    await act(async () => {
      await hai.sendMessage('öffne meine Berichte', { voice: true });
    });
    await act(async () => {
      await hai.sendMessage('Was ist ein Primärschlüssel', { voice: true });
    });
    expect(chatCalls()).toHaveLength(2);
    expect(assistants()[0].navigationOffer?.status).toBe('dismissed');
    await act(async () => {
      await hai.sendMessage('ja', { voice: true });
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('a typed offer is not opened by a spoken "ja" (the question was not spoken)', async () => {
    answerWith(OFFER);
    mount();
    await act(async () => {
      await hai.sendMessage('öffne meine Berichte');
    });
    await act(async () => {
      await hai.sendMessage('ja', { voice: true });
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(chatCalls()).toHaveLength(2);
  });

  it('opens nothing for a message id without an offer', async () => {
    answerWith(OFFER);
    mount();
    await act(async () => {
      await hai.sendMessage('öffne meine Berichte');
    });
    act(() => hai.openNavigation('unknown'));
    act(() => hai.openNavigation(hai.messages[0].id));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('reads the offer from the final event of the stream too', async () => {
    // jsdom has neither of them, the provider reads the stream with a decoder
    Object.assign(globalThis, { TextEncoder, TextDecoder });
    const encoder = new TextEncoder();
    const events = [
      { chunk: 'Ich habe die Seite.' },
      { done: true, sessionId: 's1', citations: [], navigationOffer: OFFER },
    ]
      .map(e => `data: ${JSON.stringify(e)}\n\n`)
      .join('');
    let sent = false;
    authFetchMock.mockImplementation(async url =>
      String(url) === '/api/hai/chat'
        ? ({
            ok: true,
            body: {
              getReader: () => ({
                read: async () =>
                  sent
                    ? { done: true, value: undefined }
                    : ((sent = true),
                      { done: false, value: encoder.encode(events) }),
                cancel: async () => undefined,
              }),
            },
          } as never)
        : ({ ok: true, json: async () => ({}) } as never)
    );
    mount();
    await act(async () => {
      await hai.sendMessage('öffne meine Berichte', { voice: true });
    });
    expect(assistants()[0].navigationOffer).toMatchObject({
      path: '/trainee/activity-reports',
      status: 'open',
      spoken: true,
    });
  });

  it('HaiMessage shows the card below the answer of the assistant, only when there is an offer', async () => {
    answerWith(OFFER);
    mount();
    await act(async () => {
      await hai.sendMessage('öffne meine Berichte');
    });
    const message = assistants()[0];
    const view = renderWithProviders(
      <HaiProvider userId="u2">
        <HaiMessage message={message} />
      </HaiProvider>
    );
    const card = view.getByTestId('hai-navigation-card');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Ausbildungsnachweis');
    // a message without an offer has no card
    view.rerender(
      <HaiProvider userId="u2">
        <HaiMessage message={{ ...message, navigationOffer: undefined }} />
      </HaiProvider>
    );
    expect(view.queryByTestId('hai-navigation-card')).toBeNull();
  });
});
