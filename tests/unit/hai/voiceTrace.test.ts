import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  categorizeReason,
  isPermanentReason,
  reasonCode,
} from '@/lib/hai/voice/client/fallback';
import {
  TOKEN_MARGIN_MS,
  createTokenStore,
} from '@/lib/hai/voice/client/tokenStore';
import {
  TRACE_STORAGE_KEY,
  markServerDone,
  markServerTiming,
  mark,
  resetTraceForTests,
  sanitizeTraceData,
  traceEnabled,
  traceEntries,
} from '@/lib/hai/voice/client/trace';
import type { TokenGrant } from '@/lib/hai/voice/client/soniox';

// The measuring points (step 1): off without the switch, only numbers and short
// tokens (never a text), the derived times A to I. The stock of keys (step 2) and
// the reasons of a fallback (step 7).

describe('the measuring points', () => {
  let info: jest.SpiedFunction<typeof console.info>;
  let now = 0;
  beforeEach(() => {
    info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    now = 1_000;
    resetTraceForTests(() => now);
    window.localStorage.removeItem(TRACE_STORAGE_KEY);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    window.localStorage.removeItem(TRACE_STORAGE_KEY);
    resetTraceForTests();
  });

  it('is off without the switch: nothing is written, nothing is kept', () => {
    expect(traceEnabled()).toBe(false);
    mark('submit', { phase: 'thinking' });
    expect(info).not.toHaveBeenCalled();
    expect(traceEntries()).toEqual([]);
    expect(
      (window as unknown as Record<string, unknown>).haiVoiceTrace
    ).toBeUndefined();
  });

  it('is on with localStorage hai-voice-trace = 1 and writes the time since the first mark', () => {
    window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
    mark('listen.start');
    now += 250;
    mark('stt.mic.ready', { sampleRate: 48_000, echoCancellation: false });
    expect(traceEntries().map(e => [e.name, e.at])).toEqual([
      ['listen.start', 0],
      ['stt.mic.ready', 250],
    ]);
    expect(info).toHaveBeenCalledWith(
      '[hai-voice]',
      'stt.mic.ready',
      '+250ms',
      { sampleRate: 48_000, echoCancellation: false }
    );
    // for the console of the browser
    const read = (window as unknown as { haiVoiceTrace: () => unknown[] })
      .haiVoiceTrace;
    expect(read()).toHaveLength(2);
  });

  it('only a value of exactly "1" switches it on', () => {
    for (const value of ['0', 'true', 'yes', '']) {
      window.localStorage.setItem(TRACE_STORAGE_KEY, value);
      expect(traceEnabled()).toBe(false);
    }
  });

  it('never carries a text: sentences, transcripts, keys and addresses are dropped', () => {
    expect(
      sanitizeTraceData({
        provider: 'soniox',
        ms: 12.3456789,
        ok: true,
        text: 'Was ist ein Join?',
        address: 'wss://stt-rt.eu.soniox.com/transcribe-websocket',
        key: 'temp key with spaces',
        long: 'a'.repeat(49),
        nan: Number.NaN,
        obj: { a: 1 },
        'bad key!': 1,
      })
    ).toEqual({ provider: 'soniox', ms: 12.346, ok: true });
  });

  it('a mark with a sentence leaves no sentence in the log', () => {
    window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
    mark('submit', { question: 'Wie lange dauert die Ausbildung?', n: 1 });
    expect(JSON.stringify(traceEntries())).not.toContain('Ausbildung');
    expect(JSON.stringify(info.mock.calls)).not.toContain('Ausbildung');
    expect(traceEntries()[0].data).toEqual({ n: 1 });
  });

  it('derives the times A to E and the parts of D: the voice is late by this much', () => {
    window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
    const at = (ms: number, name: string) => {
      now = 1_000 + ms;
      mark(name);
    };
    at(0, 'listen.start');
    at(900, 'stt.interim.first');
    at(2_100, 'stt.endpoint');
    at(2_150, 'submit');
    at(3_650, 'chat.first.text');
    at(3_700, 'piece.first');
    at(3_720, 'tts.token.start');
    at(3_740, 'tts.token.end');
    at(3_740, 'tts.ws.start');
    at(3_900, 'tts.ws.open');
    at(4_300, 'tts.audio.first');
    at(4_320, 'play.first');
    const times = Object.fromEntries(
      traceEntries()
        .filter(e => e.name.startsWith('time.'))
        .map(e => [e.name.slice(5), e.data.ms])
    );
    expect(times).toEqual({
      E: 900,
      A: 1_200,
      B: 1_500,
      C: 50,
      G: 20,
      H: 160,
      I: 600,
      D: 620,
    });
  });

  it('a new round forgets the stages of the old one: no time across two questions', () => {
    window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
    mark('submit');
    now += 100;
    mark('chat.first.text');
    now += 100;
    mark('piece.first');
    now += 100;
    mark('play.first');
    resetTraceForTests(() => now);
    window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
    mark('submit');
    now += 5_000;
    mark('play.first');
    // no piece.first in this round: D does not exist
    expect(traceEntries().some(e => e.name === 'time.D')).toBe(false);
  });

  it('keeps at most 400 entries', () => {
    window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
    for (let i = 0; i < 450; i++) mark('stt.msg.first');
    expect(traceEntries().length).toBe(400);
  });

  it('never throws, not even when the console or the storage breaks', () => {
    window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
    info.mockImplementation(() => {
      throw new Error('console broke');
    });
    expect(() => mark('submit')).not.toThrow();
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('no storage');
    });
    expect(traceEnabled()).toBe(false);
    expect(() => mark('submit')).not.toThrow();
  });

  it('reads the Server-Timing header of the chat route (numbers only)', () => {
    window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
    markServerTiming('auth;dur=12, prep;dur=140.5, junk, bad name;dur=3');
    expect(traceEntries()[0]).toMatchObject({
      name: 'chat.server.header',
      data: { auth: 12, prep: 140.5 },
    });
    markServerTiming(null);
    markServerTiming('');
    expect(traceEntries()).toHaveLength(1);
  });

  it('reads the stages of the done event, drops what is not a number', () => {
    window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
    markServerDone({
      auth: 10,
      prep: 120,
      search: 800,
      first: 1_500,
      total: 3_000,
      note: 'Antworttext',
    });
    expect(traceEntries()[0].data).toEqual({
      auth: 10,
      prep: 120,
      search: 800,
      first: 1_500,
      total: 3_000,
    });
    markServerDone(undefined);
    markServerDone('x');
    expect(traceEntries()).toHaveLength(1);
  });
});

describe('the stock of keys', () => {
  const grant = (n: number, seconds = 90): TokenGrant => ({
    apiKey: `key-${n}`,
    wsUrl: 'wss://x',
    expiresInSeconds: seconds,
    config: {},
  });

  it('hands out a key fetched in advance without asking the server again', async () => {
    let calls = 0;
    const store = createTokenStore(async () => grant(++calls));
    store.prefetch('stt');
    store.prefetch('stt');
    expect(calls).toBe(1);
    expect((await store.take('stt')).apiKey).toBe('key-1');
    expect(calls).toBe(1);
  });

  it('hands out a key only once: the next one is fresh (one key per connection)', async () => {
    let calls = 0;
    const store = createTokenStore(async () => grant(++calls));
    store.prefetch('tts');
    await store.take('tts');
    expect((await store.take('tts')).apiKey).toBe('key-2');
    expect(calls).toBe(2);
  });

  it('keeps a slot per purpose', async () => {
    const purposes: string[] = [];
    const store = createTokenStore(async purpose => {
      purposes.push(purpose);
      return grant(purposes.length);
    });
    store.prefetch('stt');
    store.prefetch('stt-live');
    store.prefetch('tts');
    expect(purposes).toEqual(['stt', 'stt-live', 'tts']);
    expect((await store.take('stt-live')).apiKey).toBe('key-2');
  });

  it('does not use a key in its last 15 seconds', async () => {
    let time = 0;
    let calls = 0;
    const store = createTokenStore(
      async () => grant(++calls, 90),
      () => time
    );
    store.prefetch('stt');
    await Promise.resolve();
    await Promise.resolve();
    time = 90_000 - TOKEN_MARGIN_MS - 1;
    expect((await store.take('stt')).apiKey).toBe('key-1');
    store.prefetch('stt');
    await Promise.resolve();
    await Promise.resolve();
    time += 90_000 - TOKEN_MARGIN_MS + 1;
    expect((await store.take('stt')).apiKey).toBe('key-3');
    expect(calls).toBe(3);
  });

  it('a prefetch that failed is forgotten, the real call asks again and its error counts', async () => {
    let calls = 0;
    const store = createTokenStore(async () => {
      calls += 1;
      if (calls === 1) throw new Error('first fails');
      if (calls === 2) throw new Error('second fails');
      return grant(calls);
    });
    store.prefetch('stt');
    await expect(store.take('stt')).rejects.toThrow('second fails');
    // not stocked: a later prefetch asks anew
    store.prefetch('stt');
    expect((await store.take('stt')).apiKey).toBe('key-3');
  });

  it('prefetch asks again when the stocked key is too old', async () => {
    let time = 0;
    let calls = 0;
    const store = createTokenStore(
      async () => grant(++calls, 60),
      () => time
    );
    store.prefetch('stt');
    await Promise.resolve();
    await Promise.resolve();
    time = 60_000;
    store.prefetch('stt');
    expect(calls).toBe(2);
  });

  it('clear forgets the stock', async () => {
    let calls = 0;
    const store = createTokenStore(async () => grant(++calls));
    store.prefetch('stt');
    store.clear();
    expect((await store.take('stt')).apiKey).toBe('key-2');
  });
});

describe('the reasons of a fallback', () => {
  it.each([
    ['token-401', 'key-refused'],
    ['token-400', 'key-refused'],
    ['token-503-upstream_refused', 'key-refused'],
    ['stt-error-401-unauthenticated', 'key-refused'],
    ['token-403', 'organization'],
    ['token-402', 'organization'],
    ['tts-error-403', 'organization'],
    ['token-429', 'limit'],
    ['tts-error-429', 'limit'],
    ['stt-error-429-max_concurrent_connections_reached', 'limit'],
    ['token-503-no_key', 'not-configured'],
    ['token-503-bad_region', 'region'],
    ['token-timeout', 'timeout'],
    ['stt-connect-timeout', 'timeout'],
    ['tts-connect-timeout', 'timeout'],
    ['stt-error-408-request_timeout', 'timeout'],
    ['token-network', 'network'],
    ['tts-socket-closed', 'network'],
    ['stt-socket-error', 'network'],
    ['token-503', 'unavailable'],
    ['token-503-upstream_unavailable', 'unavailable'],
    ['speech-503', 'unavailable'],
    [undefined, 'unavailable'],
  ])('%s is %s', (reason, category) => {
    expect(categorizeReason(reason)).toBe(category);
  });

  it('a refused key, a missing setup, the region and the organization will not go away within a second', () => {
    for (const reason of [
      'token-401',
      'token-403',
      'token-503-no_key',
      'token-503-bad_region',
    ]) {
      expect(isPermanentReason(reason)).toBe(true);
    }
    for (const reason of [
      'token-503',
      'token-timeout',
      'tts-socket-closed',
      'token-429',
      undefined,
    ]) {
      expect(isPermanentReason(reason)).toBe(false);
    }
  });

  it('the raw code is safe for the measuring points', () => {
    expect(reasonCode('stt-error-429-limit exceeded!')).toBe(
      'stt-error-429-limitexceeded'
    );
    expect(reasonCode(undefined)).toBe('unknown');
    expect(reasonCode('x'.repeat(100))).toHaveLength(48);
  });
});
