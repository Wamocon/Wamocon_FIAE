import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react';
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
import { HaiQuizModeProvider } from '@/components/hai/HaiQuizMode';
import { HaiVoiceModeOverlay } from '@/components/hai/voice-mode/HaiVoiceModeOverlay';
import { HaiVoiceSessionProvider } from '@/components/hai/voice-mode/HaiVoiceSession';
import {
  SessionContext,
  type HaiVoiceSession,
} from '@/components/hai/voice-mode/voiceSessionContext';
import {
  spaceMayRecord,
  usePushToTalkKeys,
} from '@/components/hai/voice-mode/usePushToTalkKeys';
import type {
  RecognitionLike,
  SynthLike,
  VoiceEnv,
} from '@/components/hai/useHaiVoice';
import { authFetch } from '@/lib/authFetch';

// The protection against background voices as the person meets it: the settings in the
// panel, the button and the space bar of push to talk, the short notes in the voice mode.

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
jest.mock('next/navigation', () => ({
  ...(jest.requireActual('next/navigation') as object),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

beforeAll(() => {
  // jsdom does not scroll: the chat scrolls its last message into view
  Element.prototype.scrollIntoView = jest.fn();
});

const authFetchMock = authFetch as unknown as jest.Mock<
  (url: string, init?: RequestInit) => Promise<unknown>
>;

class FakeRecognition implements RecognitionLike {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: RecognitionLike['onresult'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null;
  started = false;
  aborted = false;
  stopped = 0;
  start() {
    this.started = true;
  }
  stop() {
    this.stopped += 1;
    this.onend?.();
  }
  abort() {
    this.aborted = true;
  }
  /** A word that became final. */
  final(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal: true })],
    });
  }
}

const CONSENT = 'hai-voice-consent-v1:u1';
const DAY_DONE = 'hai-voice-day-start:u1';
const consented = { [CONSENT]: 'yes', [DAY_DONE]: '2026-11-02' };

function makeEnv(stored: Record<string, string> = {}) {
  const store: Record<string, string> = { ...stored };
  const recognitions: FakeRecognition[] = [];
  const synth: SynthLike = {
    speak: () => undefined,
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
  return { env, store, recognitions };
}

let hai: ReturnType<typeof useHai>;
function Probe() {
  hai = useHai();
  return null;
}

async function mount(stored: Record<string, string> = consented) {
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
      return {
        ok: true,
        json: async () => ({
          sessionId: 's1',
          response: 'Antwort der HAI. Mehr dazu gern.',
          citations: [],
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });
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
    hai.setViewMode('widget');
  });
  await flush();
  return { browser, view };
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
const chatCalls = () =>
  authFetchMock.mock.calls.filter(([url]) => String(url) === '/api/hai/chat');

const openMode = async () => {
  const opener = screen.getAllByRole('button', {
    name: /Gespräch mit der HAI starten/,
  })[0];
  await act(async () => {
    fireEvent.click(opener);
  });
  await flush();
};
const figure = () =>
  screen.queryByRole('region', { name: 'Sprachmodus: Gespräch mit der HAI' });

describe('settings against background voices (panel, "Einstellungen zum Sprachassistenten")', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    window.localStorage.clear();
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows sensitivity, push to talk and signal words with the defaults, and the hint about the headset', async () => {
    await mount();
    const normal = screen.getByRole('radio', { name: 'Normal' });
    const strict = screen.getByRole('radio', {
      name: 'Streng, nur meine Stimme (laute und nahe Stimme)',
    });
    expect((normal as HTMLInputElement).checked).toBe(true);
    expect((strict as HTMLInputElement).checked).toBe(false);
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Drücken zum Sprechen',
        }) as HTMLInputElement
      ).checked
    ).toBe(false);
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Signalwörter (Stopp, Gespräch beenden)',
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect(
      screen.getByText(
        'Am besten schützt ein Headset oder ein Mikrofon nahe am Mund.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText(/zu 100 Prozent vor Hintergrundgesprächen/)
    ).toBeTruthy();
  });

  it('the choices are kept in the browser and read back', async () => {
    const { browser } = await mount();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('radio', {
          name: 'Streng, nur meine Stimme (laute und nahe Stimme)',
        })
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Drücken zum Sprechen' })
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: 'Signalwörter (Stopp, Gespräch beenden)',
        })
      );
    });
    expect(browser.store['hai-voice-sensitivity']).toBe('strict');
    expect(browser.store['hai-voice-ptt']).toBe('on');
    expect(browser.store['hai-voice-signals']).toBe('off');
    // the sensitivity does not matter while the button decides: the choice is disabled
    expect(
      (screen.getByTestId('hai-voice-sensitivity') as HTMLFieldSetElement)
        .disabled
    ).toBe(true);
  });

  it('reads a saved choice when it appears again', async () => {
    await mount({
      ...consented,
      'hai-voice-sensitivity': 'strict',
      'hai-voice-ptt': 'on',
      'hai-voice-signals': 'off',
    });
    expect(
      (
        screen.getByRole('radio', {
          name: 'Streng, nur meine Stimme (laute und nahe Stimme)',
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Drücken zum Sprechen',
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Signalwörter (Stopp, Gespräch beenden)',
        }) as HTMLInputElement
      ).checked
    ).toBe(false);
  });
});

describe('push to talk in the voice mode', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    window.localStorage.clear();
  });
  afterEach(() => jest.restoreAllMocks());

  const ptt = { ...consented, 'hai-voice-ptt': 'on' };

  it('records nothing until the button is held: no microphone, the state says what to do', async () => {
    const { browser } = await mount(ptt);
    await openMode();
    expect(figure()).not.toBeNull();
    expect(browser.recognitions).toHaveLength(0);
    expect(screen.getByTestId('hai-voice-status').textContent).toBe(
      'Knopf oder Leertaste halten, um zu sprechen'
    );
    const hold = screen.getByTestId('hai-voice-ptt');
    expect(hold.getAttribute('aria-label')).toBe('Zum Sprechen halten');
    expect(hold.getAttribute('aria-pressed')).toBe('false');
  });

  it('holding the button opens the microphone, releasing closes it and asks the question', async () => {
    const { browser } = await mount(ptt);
    await openMode();
    const hold = screen.getByTestId('hai-voice-ptt');
    await act(async () => {
      fireEvent.pointerDown(hold);
    });
    await flush();
    expect(browser.recognitions).toHaveLength(1);
    expect(
      screen.getByTestId('hai-voice-ptt').getAttribute('aria-pressed')
    ).toBe('true');
    expect(screen.getByTestId('hai-voice-status').textContent).toBe(
      'HAI hört zu'
    );
    act(() => browser.recognitions[0].final('Was ist ein Primärschlüssel?'));
    await act(async () => {
      fireEvent.pointerUp(hold);
    });
    await flush();
    expect(browser.recognitions[0].stopped).toBe(1);
    expect(chatCalls()).toHaveLength(1);
    expect(JSON.parse(String(chatCalls()[0][1]?.body)).message).toBe(
      'Was ist ein Primärschlüssel?'
    );
  });

  it('a lost pointer (leaves, is cancelled) releases as well, so the microphone never stays open', async () => {
    const { browser } = await mount(ptt);
    await openMode();
    const hold = screen.getByTestId('hai-voice-ptt');
    for (const release of [
      () => fireEvent.pointerCancel(hold),
      () => fireEvent.lostPointerCapture(hold),
    ]) {
      await act(async () => {
        fireEvent.pointerDown(hold);
      });
      await flush();
      const rec = browser.recognitions[browser.recognitions.length - 1];
      await act(async () => {
        release();
      });
      await flush();
      expect(rec.stopped).toBe(1);
    }
  });

  it('the space bar records while it is held, on the page', async () => {
    const { browser } = await mount(ptt);
    await openMode();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    });
    await flush();
    expect(browser.recognitions).toHaveLength(1);
    // the key repeats while it is held: still one recording
    await act(async () => {
      fireEvent.keyDown(document.body, {
        key: ' ',
        code: 'Space',
        repeat: true,
      });
    });
    expect(browser.recognitions).toHaveLength(1);
    act(() => browser.recognitions[0].final('Hallo HAI'));
    await act(async () => {
      fireEvent.keyUp(document.body, { key: ' ', code: 'Space' });
    });
    await flush();
    expect(browser.recognitions[0].stopped).toBe(1);
    expect(chatCalls()).toHaveLength(1);
  });

  it('the space bar does not record while the focus is in a text field', async () => {
    const { browser } = await mount(ptt);
    await openMode();
    const field = screen.getByRole('textbox');
    field.focus();
    await act(async () => {
      fireEvent.keyDown(field, { key: ' ', code: 'Space' });
      fireEvent.keyUp(field, { key: ' ', code: 'Space' });
    });
    await flush();
    expect(browser.recognitions).toHaveLength(0);
  });

  it('the space bar does not record while the focus is on something that uses it itself (a button, a switch)', async () => {
    const { browser } = await mount(ptt);
    await openMode();
    const other = screen.getByRole('button', { name: 'Mikrofon ausschalten' });
    other.focus();
    await act(async () => {
      fireEvent.keyDown(other, { key: ' ', code: 'Space' });
    });
    await flush();
    expect(browser.recognitions).toHaveLength(0);
    // the hold button of push to talk itself is the exception
    const hold = screen.getByTestId('hai-voice-ptt');
    hold.focus();
    await act(async () => {
      fireEvent.keyDown(hold, { key: ' ', code: 'Space' });
    });
    await flush();
    expect(browser.recognitions).toHaveLength(1);
    await act(async () => {
      fireEvent.keyUp(hold, { key: ' ', code: 'Space' });
    });
  });

  it('Ctrl or Alt with the space bar is something else and does not record', async () => {
    const { browser } = await mount(ptt);
    await openMode();
    await act(async () => {
      fireEvent.keyDown(document.body, {
        key: ' ',
        code: 'Space',
        ctrlKey: true,
      });
      fireEvent.keyDown(document.body, {
        key: ' ',
        code: 'Space',
        altKey: true,
      });
    });
    await flush();
    expect(browser.recognitions).toHaveLength(0);
  });

  it('the window losing the focus releases a held space bar', async () => {
    const { browser } = await mount(ptt);
    await openMode();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    });
    await flush();
    await act(async () => {
      fireEvent.blur(window);
    });
    await flush();
    expect(browser.recognitions[0].stopped).toBe(1);
  });

  it('without push to talk there is no hold button and the space bar does nothing', async () => {
    const { browser } = await mount(consented);
    await openMode();
    expect(screen.queryByTestId('hai-voice-ptt')).toBeNull();
    const before = browser.recognitions.length;
    await act(async () => {
      fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    });
    await flush();
    expect(browser.recognitions).toHaveLength(before);
  });

  it('with the microphone switched off the hold button is gone', async () => {
    await mount(ptt);
    await openMode();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Mikrofon ausschalten' })
      );
    });
    expect(screen.queryByTestId('hai-voice-ptt')).toBeNull();
  });

  it('in the panel, with the voice mode closed, the microphone button of the chat gets a hold button too', async () => {
    const { browser } = await mount(ptt);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mit HAI sprechen' }));
    });
    await flush();
    expect(browser.recognitions).toHaveLength(0);
    const hold = screen.getByTestId('hai-voice-control-ptt');
    await act(async () => {
      fireEvent.pointerDown(hold);
    });
    await flush();
    expect(browser.recognitions).toHaveLength(1);
    await act(async () => {
      fireEvent.pointerUp(hold);
    });
    expect(browser.recognitions[0].stopped).toBe(1);
  });
});

describe('spaceMayRecord', () => {
  it.each([
    ['div', true],
    ['p', true],
    ['span', true],
    ['input', false],
    ['textarea', false],
    ['select', false],
    ['button', false],
    ['a', true], // an anchor without href has no use for the space bar
  ])('%s -> %s', (tag, expected) => {
    const element = document.createElement(tag);
    expect(spaceMayRecord(element)).toBe(expected);
  });

  it('knows contenteditable, roles and its own button', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(spaceMayRecord(editable)).toBe(false);
    const role = document.createElement('div');
    role.setAttribute('role', 'switch');
    expect(spaceMayRecord(role)).toBe(false);
    const own = document.createElement('button');
    own.setAttribute('data-ptt-button', '');
    expect(spaceMayRecord(own)).toBe(true);
    expect(spaceMayRecord(null)).toBe(true);
  });

  it('a link with an address uses the space bar', () => {
    const link = document.createElement('a');
    link.setAttribute('href', '/x');
    expect(spaceMayRecord(link)).toBe(false);
  });
});

describe('usePushToTalkKeys', () => {
  function Host({
    enabled,
    onDown,
    onUp,
  }: {
    enabled: boolean;
    onDown: () => void;
    onUp: () => void;
  }) {
    usePushToTalkKeys({ enabled, onDown, onUp });
    return null;
  }

  it('does not listen while it is off, and a release comes when it is switched off while held', () => {
    const down = jest.fn();
    const up = jest.fn();
    const { rerender } = renderWithProviders(
      <Host enabled={false} onDown={down} onUp={up} />
    );
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    expect(down).not.toHaveBeenCalled();
    rerender(<Host enabled onDown={down} onUp={up} />);
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    expect(down).toHaveBeenCalledTimes(1);
    rerender(<Host enabled={false} onDown={down} onUp={up} />);
    expect(up).toHaveBeenCalledTimes(1);
  });

  it('a page that gets hidden releases', () => {
    const down = jest.fn();
    const up = jest.fn();
    renderWithProviders(<Host enabled onDown={down} onUp={up} />);
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    fireEvent(document, new Event('visibilitychange'));
    expect(up).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
  });

  it('other keys and a key that was already used are left alone', () => {
    const down = jest.fn();
    const up = jest.fn();
    renderWithProviders(<Host enabled onDown={down} onUp={up} />);
    fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA' });
    fireEvent.keyUp(document.body, { key: 'a', code: 'KeyA' });
    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' });
    expect(down).not.toHaveBeenCalled();
    expect(up).not.toHaveBeenCalled();
    const used = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      cancelable: true,
      bubbles: true,
    });
    used.preventDefault();
    document.body.dispatchEvent(used);
    expect(down).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// the notes of the voice mode, with a pretend session
// ---------------------------------------------------------------------------

function fakeSession(voice: Record<string, unknown>): HaiVoiceSession {
  const base = {
    consented: true,
    phase: 'listening',
    micOpen: true,
    live: true,
    interim: '',
    heard: '',
    spoken: [],
    level: null,
    error: null,
    chain: ['soniox'],
    region: 'eu',
    fallback: { stt: null, tts: null },
    provider: 'soniox',
    localRecognition: false,
    pushToTalk: false,
    holding: false,
    filterNote: null,
    signalHint: false,
    pressToTalk: jest.fn(),
    releaseToTalk: jest.fn(),
    interrupt: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  };
  return {
    voice: { ...base, ...voice } as unknown as HaiVoiceSession['voice'],
    available: true,
    view: 'open',
    captions: true,
    setCaptions: jest.fn(),
    offer: null,
    openNavigation: jest.fn(),
    openMode: jest.fn(),
    closeMode: jest.fn(),
    muted: false,
    toggleMic: jest.fn(),
    acceptConsent: jest.fn(),
  };
}

function renderOverlay(voice: Record<string, unknown>) {
  authFetchMock.mockImplementation(async () => ({
    ok: true,
    json: async () => ({}),
  }));
  return renderWithProviders(
    <HaiProvider userId="u1">
      <SessionContext.Provider value={fakeSession(voice)}>
        <HaiVoiceModeOverlay />
      </SessionContext.Provider>
    </HaiProvider>
  );
}

describe('notes in the voice mode (no text of anybody)', () => {
  beforeEach(() => authFetchMock.mockReset());

  it('shows nothing about left out utterances when nothing was left out', () => {
    renderOverlay({});
    expect(screen.queryByTestId('hai-voice-filter-note')).toBeNull();
    expect(screen.queryByTestId('hai-voice-signal-hint')).toBeNull();
  });

  it('"Ich habe nur dich gehört." after an utterance was left out, and no text with it', () => {
    renderOverlay({ filterNote: 'only-you' });
    const note = screen.getByTestId('hai-voice-filter-note');
    expect(note.textContent).toBe('Ich habe nur dich gehört.');
    expect(note.getAttribute('role')).toBe('status');
    // nothing but the note: no caption bubble with foreign text
    expect(screen.queryByTestId('hai-voice-captions')).toBeNull();
  });

  it('asks to speak louder or closer after several quiet ones', () => {
    renderOverlay({ filterNote: 'too-quiet' });
    expect(screen.getByTestId('hai-voice-filter-note').textContent).toBe(
      'Ich höre dich nicht deutlich. Sprich lauter oder näher am Mikrofon.'
    );
  });

  it('shows the first hint once the loop asks for it', () => {
    renderOverlay({ signalHint: true });
    expect(screen.getByTestId('hai-voice-signal-hint').textContent).toBe(
      'Sag Stopp, wenn ich aufhören soll.'
    );
  });

  it('the notes card names the words, the loud voice and the headset', () => {
    renderOverlay({});
    fireEvent.click(
      screen.getByRole('button', { name: 'Hinweise zum Sprachmodus' })
    );
    const card = screen.getByTestId('hai-voice-info');
    expect(within(card).getByText(/Gespräch beenden/)).toBeTruthy();
    expect(
      within(card).getByText(/Headset oder ein Mikrofon nahe am Mund/)
    ).toBeTruthy();
    expect(
      within(card).getByText(/„Stopp“, „Warte“ oder „Moment“/)
    ).toBeTruthy();
  });

  it('the hold button shows its state while it is held and gives press and release to the loop', () => {
    const pressToTalk = jest.fn();
    const releaseToTalk = jest.fn();
    renderOverlay({
      pushToTalk: true,
      holding: true,
      pressToTalk,
      releaseToTalk,
    });
    const hold = screen.getByTestId('hai-voice-ptt');
    expect(hold.getAttribute('aria-pressed')).toBe('true');
    expect(hold.getAttribute('data-holding')).toBe('true');
    fireEvent.pointerDown(hold);
    expect(pressToTalk).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(hold);
    expect(releaseToTalk).toHaveBeenCalledTimes(1);
    // a long press on a phone must not open the context menu
    expect(fireEvent.contextMenu(hold)).toBe(false);
  });
});
