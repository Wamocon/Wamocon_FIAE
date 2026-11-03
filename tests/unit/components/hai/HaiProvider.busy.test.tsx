import React from 'react';
import { TextDecoder, TextEncoder } from 'util';
import { act, fireEvent, screen } from '@testing-library/react';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { HaiMessage } from '@/components/hai/HaiMessage';
import { HaiProvider, useHai } from '@/components/hai/HaiProvider';
import { authFetch } from '@/lib/authFetch';
import de from '@/locales/de.json';
import en from '@/locales/en.json';

// A busy model server (docs/hai-geschwindigkeit.md, "Ausgelastet"), seen from
// the chat in the browser:
//  - the waiting stages of the server are shown under "thinking" and go with the
//    first piece of text, a stage event is not text;
//  - MODEL_BUSY gives the message "stark ausgelastet" and the button "Erneut
//    versuchen" that asks the same question again;
//  - "Verbindungsfehler" only for a fetch that got no answer, every other
//    failure says "Das hat nicht geklappt";
//  - the client does not give up before the server does (it used to abort after
//    60 seconds, also in the middle of an answer, and show a connection error).

// jsdom has no TextDecoder and TextEncoder, the stream reader of the provider needs them
Object.assign(globalThis, { TextDecoder, TextEncoder });

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));

// the markdown renderer is an ES module that Jest does not transform
jest.mock('@/components/ui/MarkdownText', () => ({
  __esModule: true,
  MarkdownText: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="hai-text">{children}</div>
  ),
}));

const authFetchMock = authFetch as unknown as jest.Mock<
  (url: string, init?: RequestInit) => Promise<unknown>
>;

const locale = (key: string, lang: 'de' | 'en' = 'de') =>
  (lang === 'de' ? de : en)[key as keyof typeof de] as string;

let hai: ReturnType<typeof useHai>;
function Chat() {
  hai = useHai();
  return (
    <div>
      {hai.messages.map(m => (
        <HaiMessage
          key={m.id}
          message={m}
          isStreaming={hai.streamingMessageId === m.id}
        />
      ))}
    </div>
  );
}

function mount() {
  return renderWithProviders(
    <HaiProvider userId="u1">
      <Chat />
    </HaiProvider>
  );
}

/** A stream the test feeds by hand: push events, then end it. */
function controlled() {
  const encoder = new TextEncoder();
  const waiting: Array<(r: { done: boolean; value?: Uint8Array }) => void> = [];
  const ready: Array<{ done: boolean; value?: Uint8Array }> = [];
  const deliver = (item: { done: boolean; value?: Uint8Array }) => {
    const next = waiting.shift();
    if (next) next(item);
    else ready.push(item);
  };
  return {
    response: {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: () =>
            ready.length > 0
              ? Promise.resolve(ready.shift()!)
              : new Promise<{ done: boolean; value?: Uint8Array }>(resolve =>
                  waiting.push(resolve)
                ),
          cancel: async () => undefined,
        }),
      },
    },
    push: (...events: object[]) =>
      deliver({
        done: false,
        value: encoder.encode(
          events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')
        ),
      }),
    end: () => deliver({ done: true }),
  };
}

const chatCalls = () =>
  authFetchMock.mock.calls.filter(([url]) => String(url) === '/api/hai/chat');
const bodyOf = (index: number) =>
  JSON.parse(String(chatCalls()[index][1]!.body)) as Record<string, unknown>;
const last = () => hai.messages[hai.messages.length - 1];
const stageText = () => screen.queryByTestId('hai-stage')?.textContent;

function route(responses: unknown[]) {
  let call = 0;
  authFetchMock.mockImplementation(async url => {
    if (String(url) !== '/api/hai/chat') {
      return { ok: true, json: async () => ({}) };
    }
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (next instanceof Error) throw next;
    return next;
  });
}

function failing(status: number, body: unknown) {
  return {
    ok: false,
    status,
    json: async () => body,
    clone() {
      return this;
    },
  };
}

/** An answer in one go: a chunk and the end event. */
function answerStream(text = 'Antwort') {
  const s = controlled();
  s.push({ chunk: text }, { done: true, sessionId: 's1', citations: [] });
  s.end();
  return s.response;
}

/** The busy event of the server, then the end event, as the route sends it. */
function busyStream() {
  const s = controlled();
  s.push(
    { error: 'hai.error.modelBusy', code: 'MODEL_BUSY', retryAfterSec: 30 },
    { done: true, sessionId: 's1', citations: [], intent: 'question' }
  );
  s.end();
  return s.response;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the new texts', () => {
  const KEYS = [
    'hai.error.modelBusy',
    'hai.error.generic',
    'hai.error.retry',
    'hai.loading.stage.search',
    'hai.loading.stage.answer',
    'hai.loading.stage.busy',
  ];

  it.each(KEYS)(
    '%s exists in German and English, without a dash as a pause',
    key => {
      for (const lang of ['de', 'en'] as const) {
        const text = locale(key, lang);
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(3);
        expect(text).not.toMatch(/[–—]/);
      }
    }
  );

  it('say what the person should know', () => {
    expect(locale('hai.error.modelBusy')).toBe(
      'Die HAI ist gerade stark ausgelastet und antwortet langsamer als sonst. Bitte versuche es in einer Minute noch einmal.'
    );
    expect(locale('hai.error.generic')).toBe(
      'Das hat nicht geklappt. Bitte versuche es noch einmal.'
    );
    expect(locale('hai.error.retry')).toBe('Erneut versuchen');
    expect(locale('hai.loading.stage.search')).toBe(
      'Ich suche in den Unterlagen ...'
    );
    expect(locale('hai.loading.stage.answer')).toBe(
      'Ich formuliere die Antwort ...'
    );
    expect(locale('hai.loading.stage.busy')).toBe(
      'Das dauert länger als sonst, die HAI ist gerade ausgelastet. Ich warte weiter ...'
    );
    // no word of a network problem in the busy message
    expect(locale('hai.error.modelBusy')).not.toMatch(/Internet|Verbindung/);
  });
});

describe('the waiting stages', () => {
  it('asks the server for them in the text chat, not in the voice chat', async () => {
    route([answerStream(), answerStream()]);
    mount();
    await act(async () => {
      await hai.sendMessage('Was ist ein Join?');
      await hai.sendMessage('Was ist ein Join?', { voice: true });
    });
    expect(bodyOf(0).stageEvents).toBe(true);
    expect(bodyOf(0)).not.toHaveProperty('voice');
    expect(bodyOf(1).voice).toBe(true);
    expect(bodyOf(1)).not.toHaveProperty('stageEvents');
  });

  it('shows search, answer and busy under "thinking" and keeps busy once it was said', async () => {
    const s = controlled();
    route([s.response]);
    mount();
    let sending!: Promise<void>;
    await act(async () => {
      sending = hai.sendMessage('Was ist ein Join?');
    });

    // before any event: the region is in the page (a screen reader hears the
    // changes), it says nothing yet
    const region = screen.getByTestId('hai-stage');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');

    await act(async () => s.push({ stage: 'search' }));
    expect(stageText()).toBe('Ich suche in den Unterlagen ...');
    // a stage event is no text: "thinking" stays
    expect(last().content).toBe('');
    expect(hai.streamingMessageId).toBe(last().id);

    await act(async () => s.push({ stage: 'answer' }));
    expect(stageText()).toBe('Ich formuliere die Antwort ...');

    await act(async () => s.push({ stage: 'busy' }));
    expect(stageText()).toBe(
      'Das dauert länger als sonst, die HAI ist gerade ausgelastet. Ich warte weiter ...'
    );

    // busy stays: a later "answer" must not hide that the model is slow
    await act(async () => s.push({ stage: 'answer' }));
    expect(stageText()).toBe(
      'Das dauert länger als sonst, die HAI ist gerade ausgelastet. Ich warte weiter ...'
    );

    await act(async () => {
      s.push(
        { chunk: 'Ein Join' },
        { done: true, sessionId: 's1', citations: [] }
      );
      s.end();
      await sending;
    });
  });

  it('the stage text goes with the first piece of text', async () => {
    const s = controlled();
    route([s.response]);
    mount();
    let sending!: Promise<void>;
    await act(async () => {
      sending = hai.sendMessage('Was ist ein Join?');
    });
    await act(async () => s.push({ stage: 'search' }, { stage: 'answer' }));
    expect(stageText()).toBe('Ich formuliere die Antwort ...');

    await act(async () => s.push({ chunk: 'Ein ' }));
    expect(last().content).toBe('Ein ');
    expect(last().stage).toBeUndefined();
    expect(screen.queryByTestId('hai-stage')).toBeNull();

    // a stage event that comes late (after text) changes nothing
    await act(async () => s.push({ stage: 'busy' }));
    expect(last().stage).toBeUndefined();

    await act(async () => {
      s.push({ chunk: 'Join' }, { done: true, sessionId: 's1', citations: [] });
      s.end();
      await sending;
    });
    expect(last().content).toBe('Ein Join');
    expect(screen.queryByTestId('hai-stage')).toBeNull();
  });

  it('the thinking text after 3 seconds is not text either: the stage stays under it', async () => {
    jest.useFakeTimers();
    const s = controlled();
    route([s.response]);
    mount();
    let sending!: Promise<void>;
    await act(async () => {
      sending = hai.sendMessage('Was ist ein Join?');
    });
    await act(async () => s.push({ stage: 'search' }));
    await act(async () => {
      jest.advanceTimersByTime(3100);
    });
    expect(last().content).toBe(locale('hai.loading.thinking'));
    expect(stageText()).toBe('Ich suche in den Unterlagen ...');

    await act(async () => {
      s.push(
        { chunk: 'Antwort' },
        { done: true, sessionId: 's1', citations: [] }
      );
      s.end();
      await sending;
    });
    expect(last().content).toBe('Antwort');
    expect(screen.queryByTestId('hai-stage')).toBeNull();
  });
});

describe('MODEL_BUSY', () => {
  it('shows the message and the button "Erneut versuchen", not a connection error', async () => {
    route([busyStream()]);
    mount();
    await act(async () => {
      await hai.sendMessage('Was ist ein Join?');
    });
    expect(last().content).toBe(locale('hai.error.modelBusy'));
    expect(last().failure).toBe('busy');
    expect(hai.streamingMessageId).toBeNull();
    expect(screen.queryByText(/Verbindungsfehler/)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Erneut versuchen' })
    ).toBeTruthy();
  });

  it('also for the HTTP answer 503 with the code (blocking path)', async () => {
    route([failing(503, { code: 'MODEL_BUSY', retryAfterSec: 30 })]);
    mount();
    await act(async () => {
      await hai.sendMessage('Was ist ein Join?');
    });
    expect(last().content).toBe(locale('hai.error.modelBusy'));
    expect(last().failure).toBe('busy');
    expect(
      screen.getByRole('button', { name: 'Erneut versuchen' })
    ).toBeTruthy();
  });

  it('a 503 without the code is not taken for a busy model', async () => {
    route([failing(503, { error: 'x' })]);
    mount();
    await act(async () => {
      await hai.sendMessage('Was ist ein Join?');
    });
    expect(last().failure).toBeUndefined();
    expect(
      screen.queryByRole('button', { name: 'Erneut versuchen' })
    ).toBeNull();
  });

  it('the button asks the same question again and replaces the failed answer', async () => {
    route([busyStream(), answerStream('Jetzt klappt es')]);
    mount();
    await act(async () => {
      await hai.sendMessage('Was ist ein Join?');
    });
    expect(chatCalls()).toHaveLength(1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    });
    await act(async () => undefined);

    expect(chatCalls()).toHaveLength(2);
    expect(bodyOf(1).message).toBe('Was ist ein Join?');
    // the failed answer and its question are gone, one question and one answer stay
    expect(hai.messages.map(m => [m.role, m.content])).toEqual([
      ['user', 'Was ist ein Join?'],
      ['assistant', 'Jetzt klappt es'],
    ]);
    expect(
      screen.queryByRole('button', { name: 'Erneut versuchen' })
    ).toBeNull();
  });

  it('a second busy answer offers the button again', async () => {
    route([busyStream(), busyStream()]);
    mount();
    await act(async () => {
      await hai.sendMessage('Was ist ein Join?');
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    });
    await act(async () => undefined);
    expect(chatCalls()).toHaveLength(2);
    expect(last().failure).toBe('busy');
    expect(
      screen.getAllByRole('button', { name: 'Erneut versuchen' })
    ).toHaveLength(1);
  });

  it('only the last message can be asked again', async () => {
    route([busyStream(), answerStream('Zweite Antwort')]);
    mount();
    await act(async () => {
      await hai.sendMessage('Erste Frage');
    });
    const failedId = last().id;
    await act(async () => {
      await hai.sendMessage('Zweite Frage');
    });
    // the first failure is not the last message: no button, and no effect
    expect(
      screen.queryByRole('button', { name: 'Erneut versuchen' })
    ).toBeNull();
    await act(async () => {
      await hai.retryMessage(failedId);
    });
    expect(chatCalls()).toHaveLength(2);
  });

  it('a failure the server reports without the busy code has no button', async () => {
    const s = controlled();
    s.push(
      { error: 'hai.error.chatUnavailable' },
      { done: true, sessionId: 's1', citations: [] }
    );
    s.end();
    route([s.response]);
    mount();
    await act(async () => {
      await hai.sendMessage('Was ist ein Join?');
    });
    expect(last().content).toBe(locale('hai.error.chatUnavailable'));
    expect(last().failure).toBeUndefined();
    expect(
      screen.queryByRole('button', { name: 'Erneut versuchen' })
    ).toBeNull();
  });
});

describe('what is said for a failure of the client', () => {
  it('a fetch that got no answer is a connection error', async () => {
    route([new TypeError('Failed to fetch')]);
    mount();
    await act(async () => {
      await hai.sendMessage('Was ist ein Join?');
    });
    expect(last().content).toBe(locale('hai.error.connectionError'));
    expect(last().failure).toBe('network');
    expect(
      screen.getByRole('button', { name: 'Erneut versuchen' })
    ).toBeTruthy();
  });

  it.each([
    'Failed to fetch',
    'Load failed',
    'NetworkError when attempting to fetch resource.',
  ])('"%s" is a connection error', async message => {
    route([new TypeError(message)]);
    mount();
    await act(async () => {
      await hai.sendMessage('Was ist ein Join?');
    });
    expect(last().content).toBe(locale('hai.error.connectionError'));
  });

  it('any other error is not blamed on the internet connection', async () => {
    route([new Error('something broke')]);
    mount();
    await act(async () => {
      await hai.sendMessage('Was ist ein Join?');
    });
    expect(last().content).toBe(locale('hai.error.generic'));
    expect(last().content).not.toMatch(/Internet|Verbindung/);
    expect(last().failure).toBe('generic');
    expect(
      screen.getByRole('button', { name: 'Erneut versuchen' })
    ).toBeTruthy();
  });

  it('a TypeError that is a bug in the code is not a connection error either', async () => {
    route([new TypeError("Cannot read properties of undefined (reading 'x')")]);
    mount();
    await act(async () => {
      await hai.sendMessage('Was ist ein Join?');
    });
    expect(last().content).toBe(locale('hai.error.generic'));
  });

  it('a stream that breaks after the answer began is not blamed on the connection', async () => {
    const reader = {
      read: async () => {
        throw new TypeError('network error');
      },
      cancel: async () => undefined,
    };
    route([
      {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: { getReader: () => reader },
      },
    ]);
    mount();
    await act(async () => {
      await hai.sendMessage('Was ist ein Join?');
    });
    expect(last().content).toBe(locale('hai.error.generic'));
  });
});

describe('the time limit of the client', () => {
  /** A request that never answers and ends with the reason of the abort, like fetch. */
  function neverAnswers() {
    authFetchMock.mockImplementation((url, init) =>
      String(url) !== '/api/hai/chat'
        ? Promise.resolve({ ok: true, json: async () => ({}) })
        : new Promise((_resolve, reject) => {
            init!.signal!.addEventListener('abort', () =>
              reject(
                (init!.signal as AbortSignal & { reason?: unknown }).reason
              )
            );
          })
    );
  }

  it('does not give up after one minute: the model server may need more', async () => {
    jest.useFakeTimers();
    neverAnswers();
    mount();
    let sending!: Promise<void>;
    await act(async () => {
      sending = hai.sendMessage('Was ist ein Join?');
    });
    await act(async () => {
      jest.advanceTimersByTime(100_000);
    });
    expect(hai.streamingMessageId).toBe(last().id);
    expect(last().failure).toBeUndefined();
    expect(last().content).not.toBe(locale('hai.error.connectionError'));

    await act(async () => {
      jest.advanceTimersByTime(81_000);
      await sending;
    });
    expect(last().content).toBeTruthy();
  });

  it('the abort after the limit says "took too long", never "connection error" (the reason is a string)', async () => {
    jest.useFakeTimers();
    neverAnswers();
    mount();
    let sending!: Promise<void>;
    await act(async () => {
      sending = hai.sendMessage('Was ist ein Join?');
    });
    await act(async () => {
      jest.advanceTimersByTime(181_000);
      await sending;
    });
    expect(last().content).toBe(locale('hai.error.timeout'));
    expect(last().content).not.toBe(locale('hai.error.connectionError'));
    expect(hai.streamingMessageId).toBeNull();
    expect(hai.isLoading).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Erneut versuchen' })
    ).toBeTruthy();
  });

  it('an answer that has started is not cut by the limit that guards the wait', async () => {
    jest.useFakeTimers();
    const s = controlled();
    route([s.response]);
    mount();
    let sending!: Promise<void>;
    await act(async () => {
      sending = hai.sendMessage('Was ist ein Join?');
    });
    await act(async () => s.push({ chunk: 'Anfang ' }));
    // far beyond the limit of the wait (it used to be 60 seconds for everything)
    await act(async () => {
      jest.advanceTimersByTime(300_000);
    });
    await act(async () => {
      s.push(
        { chunk: 'und Ende' },
        { done: true, sessionId: 's1', citations: [] }
      );
      s.end();
      await sending;
    });
    expect(last().content).toBe('Anfang und Ende');
    expect(last().failure).toBeUndefined();
  });

  it('stopping the answer by hand shows no error', async () => {
    const s = controlled();
    route([s.response]);
    mount();
    await act(async () => {
      void hai.sendMessage('Was ist ein Join?');
    });
    await act(async () => {
      hai.stopGeneration();
    });
    expect(last().failure).toBeUndefined();
    expect(screen.queryByText(/Verbindungsfehler/)).toBeNull();
  });
});
