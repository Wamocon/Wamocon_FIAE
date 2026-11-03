import React from 'react';
import { TextDecoder, TextEncoder } from 'util';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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
import { HaiChat } from '@/components/hai/HaiChat';
import { HaiQuizModeProvider } from '@/components/hai/HaiQuizMode';
import { HaiVoiceSessionProvider } from '@/components/hai/voice-mode/HaiVoiceSession';
import type {
  RecognitionLike,
  SynthLike,
  UtteranceLike,
  VoiceEnv,
} from '@/components/hai/useHaiVoice';
import { authFetch } from '@/lib/authFetch';

// A clear command ("Öffne den Ausbildungsnachweis", "Bring mich zu den Quizzen")
// is carried out right away: the offer of the server is marked `auto`, the
// client opens the page through the router without a tap and without a "ja", in
// the text chat, in the stream and in the voice mode (which keeps listening). An
// offer without the mark still waits (see HaiNavigationCard.test.tsx).

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

// the markdown renderer is an ES module that Jest does not transform
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
const AUTO_OFFER = { ...OFFER, auto: true };
const REPORT = 'Ich öffne die Seite Ausbildungsnachweis.';

const chatCalls = () =>
  authFetchMock.mock.calls.filter(([url]) => String(url) === '/api/hai/chat');

let hai: ReturnType<typeof useHai>;
function Probe() {
  hai = useHai();
  return null;
}
const assistants = () => hai.messages.filter(m => m.role === 'assistant');

/** The chat route answers the first call with this text and offer, later calls plainly. */
function answerWith(text: string, offer: unknown) {
  let call = 0;
  authFetchMock.mockImplementation(async url => {
    if (String(url) === '/api/hai/chat') {
      call += 1;
      return {
        ok: true,
        json: async () => ({
          sessionId: 's1',
          response: call === 1 ? text : 'Antwort',
          citations: [],
          navigationOffer: call === 1 ? offer : undefined,
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });
}

beforeAll(() => {
  // jsdom does not scroll: the chat scrolls its last message into view
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

describe('a command that is carried out (typed)', () => {
  function mount() {
    return renderWithProviders(
      <HaiProvider userId="u1">
        <Probe />
      </HaiProvider>
    );
  }

  it('pushes the allowed path through the router at once, without a tap', async () => {
    answerWith(REPORT, AUTO_OFFER);
    mount();
    await act(async () => {
      await hai.sendMessage('Öffne den Ausbildungsnachweis.');
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/trainee/activity-reports');
    expect(assistants()[0].content).toBe(REPORT);
    // the card reports it, it does not wait
    expect(assistants()[0].navigationOffer).toMatchObject({
      path: '/trainee/activity-reports',
      status: 'opened',
      auto: true,
    });
  });

  it('keeps the tab of the page in the path', async () => {
    answerWith('Ich öffne die Seite Blockkalender.', {
      path: '/trainee/school?tab=calendar',
      label: 'Blockkalender',
      reason: 'Dort siehst du deine Schul- und Betriebsblöcke.',
      auto: true,
    });
    mount();
    await act(async () => {
      await hai.sendMessage('Ich will zum Blockkalender.');
    });
    expect(mockPush).toHaveBeenCalledWith('/trainee/school?tab=calendar');
  });

  it('opens the page of an enabler by its path', async () => {
    const path = '/trainee/enablers/20000000-0000-4000-8000-000000000001';
    answerWith('Ich öffne den Enabler SQL Grundlagen.', {
      path,
      label: 'SQL Grundlagen',
      reason: 'Das ist der Enabler im Kurs Datenbanken.',
      auto: true,
    });
    mount();
    await act(async () => {
      await hai.sendMessage('Öffne Enabler 3');
    });
    expect(mockPush).toHaveBeenCalledWith(path);
  });

  it('closes the large chat panel so it does not hide the page', async () => {
    answerWith(REPORT, AUTO_OFFER);
    mount();
    act(() => hai.setViewMode('full'));
    await act(async () => {
      await hai.sendMessage('Öffne den Ausbildungsnachweis.');
    });
    expect(hai.viewMode).toBe('widget');
  });

  it('does not push for an offer without the mark: the card waits for the tap', async () => {
    answerWith('Ich habe die Seite für dich.', OFFER);
    mount();
    await act(async () => {
      await hai.sendMessage('Wo finde ich meine Berichte?');
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(assistants()[0].navigationOffer?.status).toBe('open');
  });

  it('does not push for a mark that is not exactly true', async () => {
    for (const auto of ['true', 1, 'yes']) {
      jest.clearAllMocks();
      answerWith('Ich habe die Seite für dich.', { ...OFFER, auto });
      const view = mount();
      await act(async () => {
        await hai.sendMessage('Wo finde ich meine Berichte?');
      });
      expect(mockPush).not.toHaveBeenCalled();
      expect(assistants()[0].navigationOffer?.status).toBe('open');
      view.unmount();
    }
  });

  it('never pushes a path outside the allow list, whatever the mark says', async () => {
    for (const path of [
      '/trainer/admin/secret',
      'https://evil.example/x',
      '//evil.example',
      'javascript:alert(1)',
      '/trainee/dashboard?x=1',
    ]) {
      jest.clearAllMocks();
      answerWith(REPORT, { ...AUTO_OFFER, path });
      const view = mount();
      await act(async () => {
        await hai.sendMessage('Öffne den Ausbildungsnachweis.');
      });
      expect(mockPush).not.toHaveBeenCalled();
      expect(assistants()[0].navigationOffer).toBeUndefined();
      view.unmount();
    }
  });

  it('reads the mark from the final event of the stream and pushes once', async () => {
    // jsdom has neither of them, the provider reads the stream with a decoder
    Object.assign(globalThis, { TextEncoder, TextDecoder });
    const encoder = new TextEncoder();
    const events = [
      { chunk: REPORT },
      {
        done: true,
        sessionId: 's1',
        citations: [],
        navigationOffer: AUTO_OFFER,
      },
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
      await hai.sendMessage('Öffne den Ausbildungsnachweis.');
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/trainee/activity-reports');
    expect(assistants()[0].navigationOffer?.status).toBe('opened');
  });

  it('a spoken command is carried out as well, and a later "ja" opens nothing a second time', async () => {
    answerWith(REPORT, AUTO_OFFER);
    mount();
    await act(async () => {
      await hai.sendMessage('öffne den ausbildungsnachweis', { voice: true });
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(assistants()[0].navigationOffer).toMatchObject({
      status: 'opened',
      spoken: true,
    });
    // the offer is used up: "ja" is a normal message and goes to the server
    await act(async () => {
      await hai.sendMessage('ja', { voice: true });
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(chatCalls()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// the voice mode: the loop keeps listening while the page changes
// ---------------------------------------------------------------------------

class FakeRecognition implements RecognitionLike {
  lang = '';
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onresult: RecognitionLike['onresult'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null;
  started = false;
  aborted = false;
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.aborted = true;
  }
  say(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal: true })],
    });
    this.onend?.();
  }
}

function makeEnv() {
  const store: Record<string, string> = {
    'hai-voice-consent-v1:u1': 'yes',
    'hai-voice-day-start:u1': '2026-11-02',
  };
  const recognitions: FakeRecognition[] = [];
  const spoken: UtteranceLike[] = [];
  const synth: SynthLike = {
    speak: u => {
      spoken.push(u);
    },
    cancel: () => undefined,
    getVoices: () => [{ lang: 'de-DE', localService: true, name: 'lokal' }],
  };
  const env: VoiceEnv = {
    createRecognition: async () => {
      const rec = new FakeRecognition();
      recognitions.push(rec);
      return { rec, local: false };
    },
    synth,
    makeUtterance: text => ({
      text,
      lang: '',
      voice: undefined,
      rate: 0,
      onend: null,
      onerror: null,
    }),
    storage: {
      getItem: k => store[k] ?? null,
      setItem: (k, v) => {
        store[k] = v;
      },
    },
    now: () => new Date('2026-11-02T07:30:00Z'),
  };
  return { env, recognitions, spoken };
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('a command in the voice mode', () => {
  function routes(answers: Array<{ text: string; offer?: unknown }>) {
    let call = 0;
    authFetchMock.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path === '/api/hai/voice') {
        return { ok: true, json: async () => ({ enabled: true }) };
      }
      if (path === '/api/hai/voice/config') {
        return {
          ok: true,
          json: async () => ({ provider: 'browser', chain: ['browser'] }),
        };
      }
      if (path === '/api/hai/chat') {
        const answer = answers[Math.min(call, answers.length - 1)];
        call += 1;
        return {
          ok: true,
          json: async () => ({
            sessionId: 's1',
            response: answer.text,
            citations: [],
            navigationOffer: answer.offer,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
  }

  async function mountVoice() {
    const browser = makeEnv();
    renderWithProviders(
      <HaiQuizModeProvider>
        <HaiProvider userId="u1">
          <HaiVoiceSessionProvider env={browser.env}>
            <Probe />
            <HaiChat />
          </HaiVoiceSessionProvider>
        </HaiProvider>
      </HaiQuizModeProvider>
    );
    await act(async () => {
      hai.setViewMode('widget');
    });
    await waitFor(() =>
      expect(
        screen.queryAllByRole('button', {
          name: /Gespräch mit der HAI starten/,
        }).length
      ).toBeGreaterThan(0)
    );
    await act(async () => {
      fireEvent.click(
        screen.queryAllByRole('button', {
          name: /Gespräch mit der HAI starten/,
        })[0]
      );
    });
    await flush();
    return browser;
  }

  it('opens the page at once, says what it does and keeps listening, without a question and without a "ja"', async () => {
    routes([{ text: REPORT, offer: AUTO_OFFER }]);
    const browser = await mountVoice();
    expect(browser.recognitions).toHaveLength(1);

    await act(async () => {
      browser.recognitions[0].say('Öffne den Ausbildungsnachweis');
    });
    await flush();
    await waitFor(() => expect(browser.spoken.length).toBeGreaterThan(0));

    // the router got the allowed path from the one spoken sentence
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/trainee/activity-reports');
    expect(chatCalls()).toHaveLength(1);
    // the voice says it in one short sentence, no question
    expect(browser.spoken.map(u => u.text)).toEqual([REPORT]);

    // the same loop goes on: it listens again after the sentence
    await act(async () => {
      for (const piece of browser.spoken) piece.onend?.();
    });
    await flush();
    expect(browser.recognitions.length).toBeGreaterThanOrEqual(2);
    for (const rec of browser.recognitions.slice(0, -1)) {
      expect(rec.aborted).toBe(false);
    }
    expect(
      hai.messages
        .slice(-2)
        .map(m => [m.role, m.content, m.navigationOffer?.status])
    ).toEqual([
      ['user', 'Öffne den Ausbildungsnachweis', undefined],
      ['assistant', REPORT, 'opened'],
    ]);
  });

  it('a question for the way is still asked: nothing opens before the "ja"', async () => {
    routes([
      {
        text: 'Ich habe die Seite Ausbildungsnachweis für dich. Soll ich sie öffnen?',
        offer: OFFER,
      },
    ]);
    const browser = await mountVoice();
    await act(async () => {
      browser.recognitions[0].say('Wo finde ich meine Berichte');
    });
    await flush();
    await waitFor(() => expect(browser.spoken.length).toBeGreaterThan(0));
    expect(mockPush).not.toHaveBeenCalled();
    expect(assistants()[0].navigationOffer?.status).toBe('open');
  });
});
