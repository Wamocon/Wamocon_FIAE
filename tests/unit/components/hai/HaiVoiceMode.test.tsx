import React from 'react';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { HaiProvider, useHai } from '@/components/hai/HaiProvider';
import { HaiChat } from '@/components/hai/HaiChat';
import {
  HaiQuizModeProvider,
  useHaiQuizMode,
} from '@/components/hai/HaiQuizMode';
import { HaiVoiceSessionProvider } from '@/components/hai/voice-mode/HaiVoiceSession';
import type {
  RecognitionLike,
  SynthLike,
  UtteranceLike,
  VoiceEnv,
} from '@/components/hai/useHaiVoice';
import { authFetch } from '@/lib/authFetch';

// The voice mode with the mascot, tested as a person meets it: the real chat
// provider (HaiProvider), the real voice loop (useHaiVoice) and the real voice
// session, with a pretend browser: no microphone, no audio, no server. The routes
// of the HAI are answered by a double of authFetch, the router is a double.

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

// ---------------------------------------------------------------------------
// the pretend browser
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
  /** Words arrive while the person talks (an interim result). */
  hear(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal: false })],
    });
  }
  /** The person says something and the round ends. */
  say(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal: true })],
    });
    this.onend?.();
  }
}

const CONSENT = 'hai-voice-consent-v1:u1';
const DAY_DONE = 'hai-voice-day-start:u1';

function makeEnv(stored: Record<string, string> = {}) {
  const store: Record<string, string> = { ...stored };
  const recognitions: FakeRecognition[] = [];
  const spoken: UtteranceLike[] = [];
  let cancelled = 0;
  const synth: SynthLike = {
    speak: u => {
      spoken.push(u);
    },
    cancel: () => {
      cancelled += 1;
    },
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
  return { env, store, recognitions, spoken, cancelled: () => cancelled };
}

const consented = { [CONSENT]: 'yes', [DAY_DONE]: '2026-11-02' };
const NAV = {
  path: '/trainee/activity-reports',
  label: 'Ausbildungsnachweis',
  reason: 'Dort führst du dein Berichtsheft.',
};

// ---------------------------------------------------------------------------
// the routes of the HAI
// ---------------------------------------------------------------------------

interface Routes {
  voiceEnabled: boolean;
  /** Answers of the chat route, one per call (the last one repeats). */
  answers: Array<{ text: string; offer?: unknown }>;
}

function routes(config: Partial<Routes> = {}) {
  const state: Routes = { voiceEnabled: true, answers: [], ...config };
  let call = 0;
  authFetchMock.mockImplementation(async (url: string) => {
    const path = String(url);
    if (path === '/api/hai/voice') {
      return { ok: true, json: async () => ({ enabled: state.voiceEnabled }) };
    }
    if (path === '/api/hai/voice/config') {
      return {
        ok: true,
        json: async () => ({ provider: 'browser', chain: ['browser'] }),
      };
    }
    if (path === '/api/hai/chat') {
      const answer = state.answers[
        Math.min(call, state.answers.length - 1)
      ] ?? {
        text: 'Antwort der HAI. Mehr dazu gern.',
      };
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
  return state;
}

const chatCalls = () =>
  authFetchMock.mock.calls.filter(([url]) => String(url) === '/api/hai/chat');
const chatBody = (index: number) =>
  JSON.parse(String(chatCalls()[index][1]?.body));

// ---------------------------------------------------------------------------
// mounting
// ---------------------------------------------------------------------------

let hai: ReturnType<typeof useHai>;
let quiz: ReturnType<typeof useHaiQuizMode>;
function Probe() {
  hai = useHai();
  quiz = useHaiQuizMode();
  return null;
}

async function mount(
  stored: Record<string, string> = consented,
  options: { chat?: 'widget' | 'full' } = {}
) {
  const browser = makeEnv(stored);
  const view = renderWithProviders(
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
    hai.setViewMode(options.chat ?? 'widget');
  });
  return { browser, view };
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const openButtons = () =>
  screen.queryAllByRole('button', { name: /Gespräch mit der HAI starten/ });
const figure = () =>
  screen.queryByRole('region', { name: 'Sprachmodus: Gespräch mit der HAI' });
const status = () => screen.getByTestId('hai-voice-status').textContent;
const character = () =>
  within(figure()!).getByTestId('hai-character') as HTMLElement;
const mascotState = () => character().getAttribute('data-state');

/** The first "Gespräch" button (header of the chat) opens the voice mode. */
async function openVoiceMode() {
  await waitFor(() => expect(openButtons().length).toBeGreaterThan(0));
  await act(async () => {
    openButtons()[0].focus();
    fireEvent.click(openButtons()[0]);
  });
  await flush();
}

/** The person says something, the answer arrives and is read aloud. */
async function ask(t: ReturnType<typeof makeEnv>, text: string, round: number) {
  await act(async () => {
    t.recognitions[round].say(text);
  });
  await flush();
  await waitFor(() => expect(t.spoken.length).toBeGreaterThan(0));
}

/** The voice has said everything: the loop listens again. */
async function finishSpeech(t: ReturnType<typeof makeEnv>) {
  await act(async () => {
    for (const piece of t.spoken) piece.onend?.();
  });
  await flush();
}

beforeAll(() => {
  // jsdom does not scroll: the chat scrolls its last message into view
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

// ===========================================================================

describe('the button "Gespräch"', () => {
  it('is in the header of the chat and next to the microphone when the switch of the organization is on', async () => {
    routes();
    await mount();
    await waitFor(() => expect(openButtons()).toHaveLength(2));
    // a real, named button that Tab can reach
    for (const button of openButtons()) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.textContent).toContain('Gespräch');
      expect(button.getAttribute('tabindex')).toBeNull();
    }
  });

  it('is not there when the switch of the organization is off', async () => {
    routes({ voiceEnabled: false });
    await mount();
    await flush();
    await flush();
    expect(openButtons()).toHaveLength(0);
    // and no microphone either, as before
    expect(
      screen.queryByRole('button', { name: 'Mit HAI sprechen' })
    ).toBeNull();
  });

  it('asks the organization only once the chat was opened', async () => {
    routes();
    const browser = makeEnv(consented);
    renderWithProviders(
      <HaiProvider userId="u1">
        <HaiVoiceSessionProvider env={browser.env}>
          <Probe />
          <HaiChat />
        </HaiVoiceSessionProvider>
      </HaiProvider>
    );
    await flush();
    expect(authFetchMock.mock.calls.map(([u]) => String(u))).not.toContain(
      '/api/hai/voice'
    );
    await act(async () => {
      hai.setViewMode('widget');
    });
    await waitFor(() =>
      expect(authFetchMock.mock.calls.map(([u]) => String(u))).toContain(
        '/api/hai/voice'
      )
    );
  });

  it('is in the large chat as well', async () => {
    routes();
    await mount(consented, { chat: 'full' });
    await waitFor(() => expect(openButtons().length).toBeGreaterThan(0));
  });
});

describe('opening and ending the voice mode', () => {
  it('starts from the chat panel at the left: the panel stays, the figure stands at the place of the symbol (right of the panel)', async () => {
    routes();
    await mount();
    const panel = screen.getByTestId('hai-chat-panel');
    expect(panel.getAttribute('data-side')).toBe('left');
    await openVoiceMode();
    // a wide screen: the panel stays open at its side
    expect(screen.getByTestId('hai-chat-panel')).toBe(panel);
    // the figure shares the anchor of the symbol: bottom left, moved by the panel
    const root = figure()!;
    expect(root.className).toContain('bottom-4');
    expect(root.className).toContain('left-4');
    expect(root.className).toContain('md:translate-x-[420px]');
    expect(root.className).not.toMatch(/(^|\s)(sm:)?right-/);
    // the pond is as wide as the grown symbol (the symbol scales by 2 and 2.8)
    expect(screen.getByTestId('hai-voice-figure-body').className).toContain(
      'sm:w-56'
    );
  });

  it('opens the HAI figure at the bottom left: no dialog, no full screen, the state as text', async () => {
    routes();
    const { browser } = await mount();
    await openVoiceMode();

    const root = figure()!;
    expect(root).toBeTruthy();
    // a figure next to the page, not a dialog and not a full screen
    expect(screen.queryByRole('dialog', { name: /Sprachmodus/ })).toBeNull();
    expect(root.getAttribute('aria-modal')).toBeNull();
    expect(root.className).toContain('fixed');
    expect(root.className).not.toContain('inset-0');
    expect(document.querySelector('[data-testid="hai-voice-mode"]')).toBeNull();
    // bottom left, under the dialogs and viewers (z-40, like the HAI button)
    expect(root.className).toContain('z-40');
    expect(root.className).toContain('bottom-4');
    expect(root.className).toContain('left-4');
    // with the safe area of a phone (notch, home bar)
    expect(root.className).toContain('safe-area-inset-bottom');
    // clicks go through to the page, only the figure and the controls take them
    expect(root.className).toContain('pointer-events-none');
    expect(
      within(root).getByRole('button', { name: 'Sprachmodus beenden' })
        .className
    ).toContain('pointer-events-auto');
    // the figure is decoration, the state is text (small, polite)
    expect(character().getAttribute('aria-hidden')).toBe('true');
    // with the consent given it listens at once
    expect(browser.recognitions).toHaveLength(1);
    expect(browser.recognitions[0].started).toBe(true);
    expect(status()).toBe('HAI hört zu');
    expect(mascotState()).toBe('listening');
    expect(
      screen.getByTestId('hai-voice-status').getAttribute('aria-live')
    ).toBe('polite');
  });

  it('lets the figure rise out of the water and stand there while the mode runs', async () => {
    routes();
    await mount();
    await openVoiceMode();
    expect(character().getAttribute('data-phase')).toBe('rising');
    await waitFor(
      () => expect(character().getAttribute('data-phase')).toBe('standing'),
      { timeout: 3000 }
    );
    // it keeps standing: the phase does not change again while the mode is open
    expect(character().getAttribute('data-phase')).toBe('standing');
  });

  it('ends with Esc, turns the microphone off and gives the focus back to the button', async () => {
    routes();
    const { browser } = await mount();
    await openVoiceMode();
    const opener = openButtons()[0];

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(figure()).toBeNull();
    expect(browser.recognitions[0].aborted).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it('leaves Esc alone when something else on the page already used it', async () => {
    routes();
    await mount();
    await openVoiceMode();
    await act(async () => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault();
      document.dispatchEvent(event);
    });
    expect(figure()).toBeTruthy();
  });

  it('ends with the close button', async () => {
    routes();
    const { browser } = await mount();
    await openVoiceMode();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Sprachmodus beenden' })
      );
    });
    expect(figure()).toBeNull();
    expect(browser.recognitions[0].aborted).toBe(true);
  });

  it('dives into the water at the end: only the figure stays for a moment, without controls and text', async () => {
    routes();
    await mount();
    await openVoiceMode();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    // the controls and the state text are gone at once
    expect(figure()).toBeNull();
    expect(screen.queryByTestId('hai-voice-status')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Sprachmodus beenden' })
    ).toBeNull();
    // the figure dives, then it is gone
    const diving = screen.getByTestId('hai-voice-figure');
    expect(diving.getAttribute('data-phase')).toBe('diving');
    expect(
      within(diving).getByTestId('hai-character').getAttribute('data-phase')
    ).toBe('diving');
    await waitFor(
      () => expect(screen.queryByTestId('hai-voice-figure')).toBeNull(),
      { timeout: 3000 }
    );
  });

  it('ends with the spoken command "Sprachmodus beenden" and sends nothing', async () => {
    routes();
    const { browser } = await mount();
    await openVoiceMode();
    await act(async () => {
      browser.recognitions[0].say('Sprachmodus beenden');
    });
    await flush();
    expect(figure()).toBeNull();
    expect(chatCalls()).toHaveLength(0);
    // the round was over when the command arrived: nothing listens any more
    expect(browser.recognitions).toHaveLength(1);
  });

  it('opens again after it ended', async () => {
    routes();
    const { browser } = await mount();
    await openVoiceMode();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    await openVoiceMode();
    expect(figure()).toBeTruthy();
    expect(browser.recognitions).toHaveLength(2);
  });

  it('puts the large chat back to the panel, so it does not cover the figure', async () => {
    routes();
    await mount(consented, { chat: 'full' });
    await openVoiceMode();
    expect(figure()).toBeTruthy();
    expect(hai.viewMode).toBe('widget');
  });

  it('puts the chat panel away on a phone, where it would cover the whole width', async () => {
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
    try {
      routes();
      await mount();
      await openVoiceMode();
      expect(figure()).toBeTruthy();
      expect(hai.viewMode).toBe('hidden');
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: original,
      });
    }
  });
});

describe('the page behind stays usable', () => {
  it('has no focus trap: Tab leaves the controls of the figure and reaches the page', async () => {
    routes();
    await mount();
    await openVoiceMode();
    const root = figure()!;
    // the first focus is on the microphone button of the figure
    expect(root.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.getAttribute('data-autofocus')).toBe('');
    // the controls are real buttons that Tab reaches in turn
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('button'));
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    // walking on from the last control leaves the figure
    buttons[buttons.length - 1].focus();
    let left = false;
    for (let i = 0; i < 40 && !left; i++) {
      await userEvent.tab();
      left = !root.contains(document.activeElement);
    }
    expect(left).toBe(true);
  });

  it('puts no dark layer and nothing that fills the screen over the page', async () => {
    routes();
    await mount();
    await openVoiceMode();
    const root = figure()!;
    for (const node of [root, ...Array.from(root.querySelectorAll('*'))]) {
      const classes = String(node.getAttribute('class') ?? '');
      expect(classes).not.toContain('inset-0');
      expect(classes).not.toContain('bg-black');
    }
    // the voice mode does not lock the page: no modal, no aria-hidden on the rest
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    expect(document.body.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('consent comes first', () => {
  it('records nothing before the answer, names the provider and starts after "Einverstanden"', async () => {
    routes();
    const { browser } = await mount({ [DAY_DONE]: '2026-11-02' });
    await openVoiceMode();

    const consent = screen.getByTestId('hai-voice-mode-consent');
    expect(within(consent).getByText('Sprachassistent verwenden')).toBeTruthy();
    // where the audio goes: the provider is named
    expect(consent.textContent).toMatch(/Browser/);
    expect(browser.recognitions).toHaveLength(0);
    expect(status()).toBe('HAI wartet');
    // the consent is a small card next to the basin, not a full screen
    expect(figure()!.contains(consent)).toBe(true);
    expect(consent.className).not.toContain('inset-0');
    // the microphone button waits for the answer
    expect(screen.getByTestId('hai-voice-mic').hasAttribute('disabled')).toBe(
      true
    );

    await act(async () => {
      fireEvent.click(
        within(consent).getByRole('button', {
          name: 'Einverstanden und starten',
        })
      );
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
    });
    await flush();
    expect(browser.store[CONSENT]).toBe('yes');
    expect(browser.recognitions).toHaveLength(1);
    expect(screen.queryByTestId('hai-voice-mode-consent')).toBeNull();
    expect(status()).toBe('HAI hört zu');
    // the focus goes on to the microphone button
    expect(document.activeElement?.getAttribute('data-autofocus')).toBe('');
  });

  it('ends without recording when the person says no', async () => {
    routes();
    const { browser } = await mount({ [DAY_DONE]: '2026-11-02' });
    await openVoiceMode();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    });
    expect(figure()).toBeNull();
    expect(browser.recognitions).toHaveLength(0);
    expect(browser.store[CONSENT]).toBeUndefined();
  });

  it('never starts a recording by a tap on the figure without consent', async () => {
    routes();
    const { browser } = await mount({ [DAY_DONE]: '2026-11-02' });
    await openVoiceMode();
    await act(async () => {
      fireEvent.click(screen.getByTestId('hai-voice-figure-body'));
    });
    await flush();
    expect(browser.recognitions).toHaveLength(0);
  });
});

describe('the states of the figure follow the voice loop', () => {
  it('listens, thinks, speaks and listens again, each state as text and as figure', async () => {
    routes({
      answers: [
        { text: 'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig.' },
      ],
    });
    const { browser } = await mount();
    await openVoiceMode();
    expect(mascotState()).toBe('listening');

    await ask(browser, 'Was ist ein Primärschlüssel?', 0);
    expect(status()).toBe('HAI spricht');
    expect(mascotState()).toBe('speaking');

    await finishSpeech(browser);
    expect(browser.recognitions).toHaveLength(2);
    expect(status()).toBe('HAI hört zu');
    expect(mascotState()).toBe('listening');
  });

  it('shows "denkt nach" while the answer is on its way', async () => {
    routes();
    const { browser } = await mount();
    // the chat route does not answer yet
    let release: (value: unknown) => void = () => undefined;
    authFetchMock.mockImplementation(async (url: string) => {
      if (String(url) === '/api/hai/chat') {
        await new Promise(resolve => {
          release = resolve;
        });
        return {
          ok: true,
          json: async () => ({
            sessionId: 's1',
            response: 'Später.',
            citations: [],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ enabled: true, chain: ['browser'] }),
      };
    });
    await openVoiceMode();
    await act(async () => {
      browser.recognitions[0].say('Erkläre mir SQL');
    });
    expect(status()).toBe('HAI denkt nach');
    expect(mascotState()).toBe('thinking');
    await act(async () => {
      release(undefined);
    });
    await flush();
  });

  it('shows the pause after three silent rounds, with a text and a way to go on', async () => {
    routes();
    const { browser } = await mount();
    jest.useFakeTimers();
    try {
      await openVoiceMode();
      for (let round = 0; round < 3; round++) {
        await act(async () => {
          browser.recognitions[round].onend?.();
          jest.advanceTimersByTime(300);
        });
        await flush();
      }
    } finally {
      jest.useRealTimers();
    }
    expect(mascotState()).toBe('paused');
    expect(status()).toBe('HAI macht Pause');
    expect(screen.getByRole('alert').textContent).toContain(
      'Tippen Sie auf die HAI'
    );
    // the button listens again
    const before = browser.recognitions.length;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Erneut zuhören' }));
    });
    await flush();
    expect(browser.recognitions.length).toBe(before + 1);
    expect(mascotState()).toBe('listening');
  });

  it('shows a refused microphone as an error state, not as silence', async () => {
    routes();
    const { browser } = await mount();
    await openVoiceMode();
    await act(async () => {
      browser.recognitions[0].onerror?.({ error: 'not-allowed' });
    });
    expect(mascotState()).toBe('error');
    expect(status()).toBe('Das Gespräch ist angehalten');
    expect(screen.getByRole('alert').textContent).toContain(
      'Das Mikrofon ist nicht freigegeben'
    );
  });

  it('the interrupt button stops the speech and listens', async () => {
    routes({
      answers: [
        {
          text: 'Eine lange Antwort der HAI, die ihr Ende noch nicht erreicht hat.',
        },
      ],
    });
    const { browser } = await mount();
    await openVoiceMode();
    await ask(browser, 'Erkläre mir SQL', 0);
    expect(mascotState()).toBe('speaking');
    const cancelledBefore = browser.cancelled();

    await act(async () => {
      fireEvent.click(
        within(figure()!).getByRole('button', {
          name: 'Unterbrechen und zuhören',
        })
      );
    });
    await flush();
    expect(browser.cancelled()).toBeGreaterThan(cancelledBefore);
    expect(browser.recognitions).toHaveLength(2);
    expect(mascotState()).toBe('listening');
  });

  it('lets the figure react while the person talks (words arrive)', async () => {
    routes();
    const { browser } = await mount();
    await openVoiceMode();
    const mascot = () => character();
    expect(mascot().getAttribute('data-activity')).toBe('false');
    await act(async () => {
      browser.recognitions[0].hear('Was ist');
    });
    expect(mascot().getAttribute('data-activity')).toBe('true');
    await waitFor(() =>
      expect(mascot().getAttribute('data-activity')).toBe('false')
    );
  });
});

describe('subtitles', () => {
  it('show the question as it is understood and the answer sentence by sentence, as plain text', async () => {
    routes({
      answers: [
        {
          text: '**Ein Primärschlüssel** kennzeichnet eine Zeile eindeutig. Er darf nie leer sein.',
        },
      ],
    });
    const { browser } = await mount();
    await openVoiceMode();

    // the interim result is the question, while it is spoken
    await act(async () => {
      browser.recognitions[0].hear('Was ist ein Primär');
    });
    expect(screen.getByTestId('hai-caption-heard').textContent).toContain(
      'Was ist ein Primär'
    );

    await ask(browser, 'Was ist ein Primärschlüssel?', 0);
    expect(screen.getByTestId('hai-caption-heard').textContent).toContain(
      'Was ist ein Primärschlüssel?'
    );
    const answer = screen.getByTestId('hai-caption-answer');
    // no markdown signs in the subtitles
    expect(answer.textContent).toContain(
      'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig.'
    );
    expect(answer.textContent).toContain('Er darf nie leer sein.');
    expect(answer.textContent).not.toContain('*');
    // the last sentence is the emphasized one, in the speech bubble next to the head
    const pieces = answer.querySelectorAll('span:not(.sr-only)');
    expect(pieces[pieces.length - 1].className).toContain('font-medium');
    expect(pieces[0].className).toContain('/60');
  });

  it('can be switched off and on, and the choice stays in the browser', async () => {
    routes({ answers: [{ text: 'Eine Antwort, die man auch lesen könnte.' }] });
    const { browser } = await mount();
    await openVoiceMode();
    await ask(browser, 'Eine Frage', 0);
    expect(screen.getByTestId('hai-voice-captions')).toBeTruthy();

    const toggle = screen.getByRole('switch', { name: 'Untertitel' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(screen.queryByTestId('hai-voice-captions')).toBeNull();
    expect(
      screen
        .getByRole('switch', { name: 'Untertitel' })
        .getAttribute('aria-checked')
    ).toBe('false');
    expect(window.localStorage.getItem('hai-voice-mode-captions')).toBe('off');
    // the state as text stays
    expect(status()).toBe('HAI spricht');

    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Untertitel' }));
    });
    expect(screen.getByTestId('hai-voice-captions')).toBeTruthy();
    expect(window.localStorage.getItem('hai-voice-mode-captions')).toBe('on');
  });

  it('start switched off when the person chose so earlier', async () => {
    window.localStorage.setItem('hai-voice-mode-captions', 'off');
    routes();
    await mount();
    await openVoiceMode();
    expect(screen.queryByTestId('hai-voice-captions')).toBeNull();
    expect(
      screen
        .getByRole('switch', { name: 'Untertitel' })
        .getAttribute('aria-checked')
    ).toBe('false');
  });
});

describe('the chat in the background', () => {
  it('has every spoken question and every answer in the same chat and the same session', async () => {
    routes({
      answers: [
        { text: 'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig.' },
        { text: 'Ein Fremdschlüssel verweist auf einen Primärschlüssel.' },
      ],
    });
    const { browser } = await mount();
    await openVoiceMode();

    await ask(browser, 'Was ist ein Primärschlüssel?', 0);
    await finishSpeech(browser);
    browser.spoken.length = 0;
    await ask(browser, 'Und ein Fremdschlüssel?', 1);
    await finishSpeech(browser);

    // the history of the one chat holds both rounds, in order
    const roles = hai.messages.map(m => [m.role, m.content]);
    expect(roles).toEqual([
      ['user', 'Was ist ein Primärschlüssel?'],
      ['assistant', 'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig.'],
      ['user', 'Und ein Fremdschlüssel?'],
      ['assistant', 'Ein Fremdschlüssel verweist auf einen Primärschlüssel.'],
    ]);

    // the normal chat route, as a spoken question, in one session
    expect(chatCalls()).toHaveLength(2);
    expect(chatBody(0)).toMatchObject({
      message: 'Was ist ein Primärschlüssel?',
      voice: true,
    });
    expect(chatBody(1)).toMatchObject({
      message: 'Und ein Fremdschlüssel?',
      voice: true,
      sessionId: 's1',
    });

    // the person ends the conversation and reads it in the chat
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(figure()).toBeNull();
    const chat = screen.getAllByText('Und ein Fremdschlüssel?');
    expect(chat.length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        'Ein Fremdschlüssel verweist auf einen Primärschlüssel.'
      ).length
    ).toBeGreaterThan(0);
  });

  it('opens the day with the question of the HAI as the first utterance, once a day', async () => {
    routes({
      answers: [{ text: 'Guten Morgen. Heute steht ein Bericht an.' }],
    });
    const { browser } = await mount({ [CONSENT]: 'yes' });
    await openVoiceMode();
    await waitFor(() => expect(chatCalls()).toHaveLength(1));
    expect(chatBody(0)).toMatchObject({
      message: 'Guten Morgen, was steht heute an?',
      voice: true,
    });
    await waitFor(() => expect(browser.spoken.length).toBeGreaterThan(0));
    // the greeting is the first thing the figure says, as subtitle too
    expect(screen.getByTestId('hai-caption-answer').textContent).toContain(
      'Guten Morgen. Heute steht ein Bericht an.'
    );
    expect(screen.queryByTestId('hai-caption-heard')).toBeNull();
  });
});

describe('navigation by voice', () => {
  const offerAnswer = {
    text: 'Dort findest du deine Berichte. Soll ich sie öffnen?',
    offer: NAV,
  };

  /** Asks, the HAI offers the page, the person says "Ja", the page opens. */
  async function openByVoice() {
    routes({ answers: [offerAnswer] });
    const { browser } = await mount();
    await openVoiceMode();
    await ask(browser, 'Öffne meine Berichte', 0);
    await finishSpeech(browser);
    await act(async () => {
      browser.recognitions[1].say('Ja');
    });
    await flush();
    return browser;
  }

  it('shows a button for the offered page next to the figure, opens nothing by itself', async () => {
    routes({ answers: [offerAnswer] });
    const { browser } = await mount();
    await openVoiceMode();
    await ask(browser, 'Öffne meine Berichte', 0);

    const card = within(figure()!).getByTestId('hai-navigation-card');
    expect(within(card).getByText('Ausbildungsnachweis')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
    expect(figure()).toBeTruthy();
  });

  it('"ja" opens the page, the figure keeps standing and keeps listening', async () => {
    routes({ answers: [offerAnswer] });
    const { browser } = await mount();
    await openVoiceMode();
    await ask(browser, 'Öffne meine Berichte', 0);
    await finishSpeech(browser);
    browser.spoken.length = 0;
    expect(browser.recognitions).toHaveLength(2);
    const standing = figure()!;

    await act(async () => {
      browser.recognitions[1].say('Ja');
    });
    await flush();

    // the router got the allowed path, no second call to the chat route
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/trainee/activity-reports');
    expect(chatCalls()).toHaveLength(1);

    // the same figure keeps standing (no small state, nothing rebuilt)
    expect(figure()).toBe(standing);
    expect(status()).toBe('HAI spricht');
    // the chat panel does not cover the page
    expect(hai.viewMode).toBe('hidden');

    // it says it and listens again, the same loop
    await waitFor(() =>
      expect(browser.spoken.map(u => u.text)).toEqual([
        'Ich öffne die Seite Ausbildungsnachweis.',
      ])
    );
    await finishSpeech(browser);
    expect(browser.recognitions).toHaveLength(3);
    expect(status()).toBe('HAI hört zu');

    // both turns are in the chat
    expect(hai.messages.slice(-2).map(m => [m.role, m.content])).toEqual([
      ['user', 'Ja'],
      ['assistant', 'Ich öffne die Seite Ausbildungsnachweis.'],
    ]);
  });

  it('"öffnen" works like "ja"', async () => {
    routes({ answers: [offerAnswer] });
    const { browser } = await mount();
    await openVoiceMode();
    await ask(browser, 'Öffne meine Berichte', 0);
    await finishSpeech(browser);
    await act(async () => {
      browser.recognitions[1].say('Öffnen');
    });
    await flush();
    expect(mockPush).toHaveBeenCalledWith('/trainee/activity-reports');
    expect(figure()).toBeTruthy();
  });

  it('"nein" opens nothing and the figure stays', async () => {
    routes({ answers: [offerAnswer] });
    const { browser } = await mount();
    await openVoiceMode();
    await ask(browser, 'Öffne meine Berichte', 0);
    await finishSpeech(browser);
    await act(async () => {
      browser.recognitions[1].say('Nein');
    });
    await flush();
    expect(mockPush).not.toHaveBeenCalled();
    expect(figure()).toBeTruthy();
    expect(within(figure()!).queryByTestId('hai-navigation-card')).toBeNull();
  });

  it('the button of the card opens the page as well, the figure stays', async () => {
    routes({ answers: [offerAnswer] });
    const { browser } = await mount();
    await openVoiceMode();
    await ask(browser, 'Öffne meine Berichte', 0);

    await act(async () => {
      fireEvent.click(
        within(figure()!).getByRole('button', {
          name: /Öffnen/,
        })
      );
    });
    expect(mockPush).toHaveBeenCalledWith('/trainee/activity-reports');
    expect(figure()).toBeTruthy();
  });

  it('keeps the microphone untouched while the page changes', async () => {
    const browser = await openByVoice();
    await finishSpeech(browser);
    const last = browser.recognitions[browser.recognitions.length - 1];
    expect(figure()).toBeTruthy();
    // the same loop goes on: the microphone of the last round was not touched
    expect(last.aborted).toBe(false);
    expect(status()).toBe('HAI hört zu');
    // the page stays opened, nothing opens it again
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('the close button ends the mode and the microphone after a page was opened', async () => {
    const browser = await openByVoice();
    await finishSpeech(browser);
    const last = browser.recognitions[browser.recognitions.length - 1];
    expect(last.aborted).toBe(false);

    await act(async () => {
      fireEvent.click(
        within(figure()!).getByRole('button', {
          name: 'Sprachmodus beenden',
        })
      );
    });
    expect(figure()).toBeNull();
    expect(last.aborted).toBe(true);
  });

  it('the spoken "Sprachmodus beenden" ends the mode after a page was opened', async () => {
    const browser = await openByVoice();
    await finishSpeech(browser);
    const last = browser.recognitions[browser.recognitions.length - 1];
    await act(async () => {
      last.say('Sprachmodus beenden');
    });
    await flush();
    expect(figure()).toBeNull();
  });

  it('the session survives the new page: the provider lives above the pages, nothing is rebuilt', async () => {
    routes({ answers: [offerAnswer] });
    const { browser } = await mount();
    await openVoiceMode();
    await ask(browser, 'Öffne meine Berichte', 0);
    await finishSpeech(browser);
    const before = hai.messages.map(m => m.id);
    await act(async () => {
      browser.recognitions[1].say('Ja');
    });
    await flush();
    // the earlier messages are still there, the session is the same one
    expect(hai.messages.map(m => m.id).slice(0, before.length)).toEqual(before);
    await finishSpeech(browser);
    await act(async () => {
      browser.recognitions[browser.recognitions.length - 1].say(
        'Und noch eine Frage'
      );
    });
    await flush();
    expect(chatBody(1)).toMatchObject({ sessionId: 's1', voice: true });
  });

  it('does not open the figure for a page that was opened outside of the voice mode', async () => {
    routes({ answers: [offerAnswer] });
    await mount();
    await act(async () => {
      await hai.sendMessage('Öffne meine Berichte');
    });
    const id = hai.messages.filter(m => m.role === 'assistant')[0].id;
    await act(async () => {
      hai.openNavigation(id);
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(figure()).toBeNull();
  });
});

describe('quiz mode', () => {
  it('is not run inside the voice mode: a started quiz ends it and the chat shows the card', async () => {
    routes();
    const { browser } = await mount();
    await openVoiceMode();
    expect(figure()).toBeTruthy();

    await act(async () => {
      quiz.start();
    });
    expect(figure()).toBeNull();
    expect(browser.recognitions[0].aborted).toBe(true);
    // the chat is open, so the quiz card is seen
    expect(hai.viewMode).toBe('widget');
  });

  it('opens the hidden chat for the quiz that a page opened by voice leaves behind', async () => {
    routes({
      answers: [
        {
          text: 'Dort findest du deine Berichte. Soll ich sie öffnen?',
          offer: NAV,
        },
      ],
    });
    const { browser } = await mount();
    await openVoiceMode();
    await ask(browser, 'Öffne meine Berichte', 0);
    await finishSpeech(browser);
    await act(async () => {
      browser.recognitions[1].say('Ja');
    });
    await flush();
    expect(hai.viewMode).toBe('hidden');
    await act(async () => {
      quiz.start();
    });
    expect(figure()).toBeNull();
    expect(hai.viewMode).toBe('widget');
  });

  it('does not touch the quiz mode when none is started', async () => {
    routes();
    await mount();
    await openVoiceMode();
    expect(quiz.active).toBe(false);
    expect(figure()).toBeTruthy();
  });
});

describe('reduced motion', () => {
  const original = window.matchMedia;
  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: original,
    });
  });

  function reduceMotion() {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }

  it('the figure stands without rising, the state stays as text and the controls work as before', async () => {
    reduceMotion();
    routes();
    const { browser } = await mount();
    await openVoiceMode();
    expect(character().getAttribute('data-motion')).toBe('reduced');
    // no rise: it stands at once
    await waitFor(() =>
      expect(character().getAttribute('data-phase')).toBe('standing')
    );
    expect(status()).toBe('HAI hört zu');
    expect(mascotState()).toBe('listening');
    // the mouth shape is still written (data attribute), only motion is off
    expect(character().getAttribute('data-mouth')).toBe('closed');

    // the microphone button works the same
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Mikrofon ausschalten' })
      );
    });
    expect(status()).toBe('Mikrofon ist aus');
    expect(browser.recognitions[0].aborted).toBe(true);
  });

  it('ends without diving: the figure is gone at once', async () => {
    reduceMotion();
    routes();
    await mount();
    await openVoiceMode();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByTestId('hai-voice-figure')).toBeNull();
  });
});

describe('the microphone button', () => {
  it('switches the microphone off (the figure stays, nothing is recorded) and on again', async () => {
    routes();
    const { browser } = await mount();
    await openVoiceMode();
    expect(browser.recognitions).toHaveLength(1);
    const mic = () => screen.getByTestId('hai-voice-mic');
    expect(mic().getAttribute('aria-label')).toBe('Mikrofon ausschalten');

    await act(async () => {
      fireEvent.click(mic());
    });
    await flush();
    expect(figure()).toBeTruthy();
    expect(browser.recognitions[0].aborted).toBe(true);
    expect(status()).toBe('Mikrofon ist aus');
    expect(mascotState()).toBe('paused');
    expect(mic().getAttribute('aria-label')).toBe('Mikrofon einschalten');
    expect(mic().getAttribute('data-muted')).toBe('true');
    // nothing listens while it is off
    expect(browser.recognitions).toHaveLength(1);

    await act(async () => {
      fireEvent.click(mic());
    });
    await flush();
    expect(browser.recognitions).toHaveLength(2);
    expect(status()).toBe('HAI hört zu');
    expect(mic().getAttribute('data-muted')).toBe('false');
  });

  it('is reached and used with the keyboard', async () => {
    routes();
    const { browser } = await mount();
    await openVoiceMode();
    const mic = screen.getByTestId('hai-voice-mic');
    // the focus is on it after the opening
    expect(document.activeElement).toBe(mic);
    await userEvent.keyboard('{Enter}');
    await flush();
    expect(browser.recognitions[0].aborted).toBe(true);
    expect(screen.getByTestId('hai-voice-mic').getAttribute('data-muted')).toBe(
      'true'
    );
  });
});

describe('names and roles', () => {
  it('every control of the figure has a role and a name, the figure itself is decoration', async () => {
    routes({ answers: [{ text: 'Eine Antwort, die man auch lesen könnte.' }] });
    const { browser } = await mount();
    await openVoiceMode();
    await ask(browser, 'Eine Frage', 0);
    const root = within(figure()!);
    expect(
      root.getByRole('button', { name: 'Sprachmodus beenden' })
    ).toBeTruthy();
    expect(
      root.getByRole('button', { name: 'Mikrofon ausschalten' })
    ).toBeTruthy();
    expect(root.getByRole('switch', { name: 'Untertitel' })).toBeTruthy();
    expect(
      root.getByRole('button', { name: 'Hinweise zum Sprachmodus' })
    ).toBeTruthy();
    expect(
      root.getByRole('button', { name: 'Unterbrechen und zuhören' })
    ).toBeTruthy();
    expect(root.getByRole('status')).toBeTruthy();
    expect(
      root.getByRole('region', { name: 'Untertitel des Gesprächs' })
    ).toBeTruthy();
    // the figure is decoration, hidden from assistive technology
    expect(character().getAttribute('aria-hidden')).toBe('true');
    expect(root.queryByRole('img')).toBeNull();
    for (const button of root.getAllByRole('button')) {
      expect(
        (button.getAttribute('aria-label') ?? button.textContent ?? '').trim()
      ).not.toBe('');
    }
  });

  it('writes down where the audio goes and how to end it, behind the notes button', async () => {
    routes();
    await mount();
    await openVoiceMode();
    expect(screen.queryByTestId('hai-voice-info')).toBeNull();
    const notes = screen.getByRole('button', {
      name: 'Hinweise zum Sprachmodus',
    });
    expect(notes.getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      fireEvent.click(notes);
    });
    expect(notes.getAttribute('aria-expanded')).toBe('true');
    const info = screen.getByTestId('hai-voice-info');
    expect(info.textContent).toMatch(
      /Sprachmodus beenden“ oder drücken Sie Esc/
    );
    expect(info.textContent).toMatch(/Browser|Spracherkennung/);
  });

  it('a tap on the figure interrupts the speech and listens, like the button', async () => {
    routes({
      answers: [
        {
          text: 'Eine lange Antwort der HAI, die ihr Ende noch nicht erreicht hat.',
        },
      ],
    });
    const { browser } = await mount();
    await openVoiceMode();
    await ask(browser, 'Erkläre mir SQL', 0);
    expect(mascotState()).toBe('speaking');
    await act(async () => {
      fireEvent.click(screen.getByTestId('hai-voice-figure-body'));
    });
    await flush();
    expect(browser.recognitions).toHaveLength(2);
    expect(mascotState()).toBe('listening');
  });
});

describe('the mic panel of the chat', () => {
  it('still works with the same loop', async () => {
    routes();
    const { browser } = await mount();
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'Mit HAI sprechen' }).length
      ).toBeGreaterThan(0)
    );
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole('button', { name: 'Mit HAI sprechen' })[0]
      );
    });
    await flush();
    expect(browser.recognitions).toHaveLength(1);
    // the voice mode joins the running loop, it does not start a second one
    await act(async () => {
      fireEvent.click(openButtons()[0]);
    });
    await flush();
    expect(figure()).toBeTruthy();
    expect(browser.recognitions).toHaveLength(1);
    expect(status()).toBe('HAI hört zu');
  });
});
