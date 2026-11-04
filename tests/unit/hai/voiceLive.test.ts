import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  LEAD_MAX_S,
  LEAD_STORAGE_KEY,
  OrderedPlayback,
  currentLeadSeconds,
  resetLeadForTests,
} from '@/lib/hai/voice/client/audio';
import { micConstraints } from '@/lib/hai/voice/client/deps';
import { createVoiceEnv } from '@/lib/hai/voice/client/engine';
import {
  CONNECT_MS,
  LIMIT_RETRY_MS,
  RECORDER_SLICE_MS,
  SonioxRecognition,
  SonioxSpeaker,
  WARM_IDLE_MS,
  mimeInfo,
} from '@/lib/hai/voice/client/soniox';
import type { ProviderFallback } from '@/lib/hai/voice/client/fallback';
import {
  TRACE_STORAGE_KEY,
  resetTraceForTests,
  traceEntries,
} from '@/lib/hai/voice/client/trace';
import type {
  RecognitionEventLike,
  SynthLike,
  UtteranceLike,
  VoiceEnv,
} from '@/lib/hai/voice/client/types';
import { FakeAudioContext, makeDeps, pcmBase64 } from './voiceClient.helpers';

// Step 1 to 5, 7 and the live mode of the voice assistant in the browser: the
// microphone like the official SDK, the level, the proof of sent audio, the live
// session over several utterances, the warm speech output, the limits, the retry
// before a fallback and the lead of the playback. All doubles, no device, no network.

function baseEnv() {
  const recognitions: Array<Record<string, any>> = [];
  const spoken: UtteranceLike[] = [];
  const synth: SynthLike = {
    speak: u => {
      spoken.push(u);
    },
    cancel: () => undefined,
    getVoices: () => [{ lang: 'de-DE', localService: true }],
  };
  const env: VoiceEnv = {
    async createRecognition() {
      const rec = {
        lang: '',
        continuous: false,
        interimResults: false,
        maxAlternatives: 1,
        started: 0,
        onresult: null,
        onerror: null,
        onend: null,
        start() {
          rec.started += 1;
        },
        stop() {},
        abort() {},
      };
      recognitions.push(rec);
      return { rec: rec as never, local: false };
    },
    synth,
    makeUtterance: text =>
      ({
        text,
        lang: '',
        voice: null,
        rate: 1,
        onend: null,
        onerror: null,
      }) as UtteranceLike,
    storage: null,
    now: () => new Date(),
  };
  return { env, recognitions, spoken };
}

const texts = (e: RecognitionEventLike) =>
  Array.from(e.results).map(r => [r[0].transcript, r.isFinal]);

describe('micConstraints', () => {
  it('raw: nothing processed, only the gain, like the official SDK', () => {
    expect(micConstraints('raw')).toMatchObject({
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
    });
    expect(micConstraints('raw').sampleRate).toEqual({ ideal: 16_000 });
  });

  it('live: the echo cancellation is on (the assistant must not hear itself), noise suppression and automatic gain are off (a quiet voice stays quiet)', () => {
    expect(micConstraints('live')).toMatchObject({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
    });
    // the rounds keep the gain (nobody else speaks while the microphone is open)
    expect(micConstraints('raw').autoGainControl).toBe(true);
    // the device override 'live' takes the same profile
    expect(micConstraints('raw', 'live').autoGainControl).toBe(false);
  });

  it('processed: echo and noise suppression (Sokrates)', () => {
    expect(micConstraints('processed')).toEqual({
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    });
  });

  it('the setting of the device replaces raw and live, not the processed profile of Sokrates', () => {
    expect(micConstraints('raw', 'processed').noiseSuppression).toBe(true);
    expect(micConstraints('raw', 'live').echoCancellation).toBe(true);
    expect(micConstraints('live', 'raw').echoCancellation).toBe(false);
    expect(micConstraints('processed', 'raw').noiseSuppression).toBe(true);
    // nonsense is ignored
    expect(micConstraints('raw', 'banana').echoCancellation).toBe(false);
  });
});

describe('mimeInfo', () => {
  it('reduces a mime type to short plain tokens', () => {
    expect(mimeInfo('audio/webm;codecs=opus')).toEqual({
      container: 'webm',
      codec: 'opus',
    });
    expect(mimeInfo('audio/mp4')).toEqual({ container: 'mp4' });
    expect(mimeInfo(undefined)).toEqual({ container: 'none' });
    expect(mimeInfo('')).toEqual({ container: 'none' });
  });
});

describe('SonioxRecognition: microphone, level, proof of audio', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
    resetTraceForTests();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    window.localStorage.removeItem(TRACE_STORAGE_KEY);
    resetTraceForTests();
  });

  const setup = (options = {}) => {
    const t = makeDeps(options);
    const rec = new SonioxRecognition(t.deps);
    const events: RecognitionEventLike[] = [];
    const errors: Array<{ error: string; reason?: string }> = [];
    const levels: number[] = [];
    let opened = 0;
    let ended = 0;
    rec.onresult = e => events.push(e);
    rec.onerror = e => errors.push(e);
    rec.onlevel = v => levels.push(v);
    rec.onaudiostart = () => {
      opened += 1;
    };
    rec.onend = () => {
      ended += 1;
    };
    return {
      ...t,
      rec,
      events,
      errors,
      levels,
      opened: () => opened,
      ended: () => ended,
    };
  };

  it('asks for the raw microphone, records in slices of 100 ms and reports the microphone as open', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.calls.profiles).toEqual(['raw']);
    expect(t.recorders[0].slice).toBe(RECORDER_SLICE_MS);
    expect(RECORDER_SLICE_MS).toBe(100);
    expect(t.opened()).toBe(1);
  });

  it('the microphone is reported open before the key is there (state "listening" only then)', async () => {
    const t = setup({ tokenHangs: true });
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.opened()).toBe(1);
    expect(t.sockets).toHaveLength(0);
  });

  it('reports the loudness of the recording ten times a second, scaled to 0 to 1', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.ctx.analyser.level = 0.1;
    await jest.advanceTimersByTimeAsync(300);
    expect(t.levels).toHaveLength(3);
    expect(t.levels[0]).toBeCloseTo(0.5, 5);
    t.ctx.analyser.level = 0.5;
    await jest.advanceTimersByTimeAsync(100);
    expect(t.levels.at(-1)).toBe(1);
    // and stops with the round
    t.rec.abort();
    const count = t.levels.length;
    await jest.advanceTimersByTimeAsync(500);
    expect(t.levels).toHaveLength(count);
  });

  it('wakes the audio context and records its state and the real settings of the microphone', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.ctx.resumed).toBeGreaterThan(0);
    const ready = traceEntries().find(e => e.name === 'stt.mic.ready');
    expect(ready?.data).toMatchObject({
      sampleRate: 48_000,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
      muted: false,
      readyState: 'live',
      ctx: 'running',
    });
  });

  it('counts the chunks that went to Soniox: the proof that the browser sends audio', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.recorders[0].emit(10);
    t.sockets[0].open();
    t.recorders[0].emit(6);
    t.ctx.analyser.level = 0.2;
    await jest.advanceTimersByTimeAsync(100);
    t.sockets[0].receive({
      tokens: [
        { text: 'Hallo', is_final: true },
        { text: '<end>', is_final: true },
      ],
    });
    const end = traceEntries().find(e => e.name === 'stt.end');
    expect(end?.data).toMatchObject({
      why: 'endpoint',
      heard: true,
      sentChunks: 2,
      sentBytes: 16,
      pendingChunks: 0,
    });
    const first = traceEntries().find(e => e.name === 'stt.audio.first');
    expect(first?.data).toMatchObject({ container: 'webm' });
    // the measuring points name the stages and never carry the words
    expect(JSON.stringify(traceEntries())).not.toContain('Hallo');
  });

  it('a round without any audio sent shows it: zero chunks, nothing heard', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    await jest.advanceTimersByTimeAsync(NO_SPEECH_FOR_TEST);
    const end = traceEntries().find(e => e.name === 'stt.end');
    expect(end?.data).toMatchObject({
      why: 'no-speech',
      heard: false,
      sentChunks: 0,
      peak: 0,
    });
  });

  it('a key that never comes: after the time limit provider-unavailable with the reason', async () => {
    const t = setup({ tokenHangs: true });
    t.rec.start();
    await jest.advanceTimersByTimeAsync(CONNECT_MS + 10);
    expect(t.errors).toEqual([
      { error: 'provider-unavailable', reason: 'token-timeout' },
    ]);
    expect(t.streams[0].stopped).toBeGreaterThan(0);
  });

  it('the reason of a refused key goes with the error', async () => {
    const t = setup({ tokenFails: true, tokenReason: 'token-403' });
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.errors).toEqual([
      { error: 'provider-unavailable', reason: 'token-403' },
    ]);
  });

  it('an error frame of Soniox before any word carries its code and type as reason', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    t.sockets[0].receive({
      error_code: 429,
      error_type: 'max_concurrent_connections_reached',
      error_message: 'secret words',
    });
    expect(t.errors[0].reason).toBe(
      'stt-error-429-max_concurrent_connections_reached'
    );
    const entry = traceEntries().find(e => e.name === 'stt.error');
    expect(entry?.data).toMatchObject({
      code: 429,
      type: 'max_concurrent_connections_reached',
    });
    expect(JSON.stringify(traceEntries())).not.toContain('secret');
  });

  it('a connection that never opens is a time limit', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(CONNECT_MS + 10);
    expect(t.errors[0].reason).toBe('stt-connect-timeout');
  });
});

const NO_SPEECH_FOR_TEST = 8_100;

describe('SonioxRecognition in live mode', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const setup = (options = {}) => {
    const t = makeDeps(options);
    const rec = new SonioxRecognition(t.deps);
    rec.continuous = true;
    const utterances: string[] = [];
    const events: RecognitionEventLike[] = [];
    const errors: Array<{
      error: string;
      reason?: string;
      established?: boolean;
    }> = [];
    let ended = 0;
    rec.onutterance = text => utterances.push(text);
    rec.onresult = e => events.push(e);
    rec.onerror = e => errors.push(e);
    rec.onend = () => {
      ended += 1;
    };
    return { ...t, rec, utterances, events, errors, ended: () => ended };
  };

  it('says it is live, opens the microphone with echo cancellation and asks for the long key', async () => {
    const t = setup();
    expect(t.rec.live).toBe(true);
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.calls.profiles).toEqual(['live']);
    expect(t.calls.tokens).toEqual(['stt-live']);
  });

  it('is not live as long as it was not asked to be', () => {
    const rec = new SonioxRecognition(makeDeps().deps);
    expect(rec.live).toBe(false);
  });

  it('delivers one utterance per endpoint and stays open: no end of the stream, no onend', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    const socket = t.sockets[0];
    socket.open();
    socket.receive({
      tokens: [
        { text: 'Was', is_final: true },
        { text: ' ist', is_final: false },
      ],
    });
    expect(texts(t.events[0])).toEqual([
      ['Was', true],
      [' ist', false],
    ]);
    socket.receive({
      tokens: [
        { text: ' ist', is_final: true },
        { text: ' ein Join?', is_final: true },
        { text: '<end>', is_final: true },
      ],
    });
    expect(t.utterances).toEqual(['Was ist ein Join?']);
    // the recording goes on: no empty text frame, the microphone is not released
    expect(socket.sent).not.toContain('');
    expect(t.streams[0].stopped).toBe(0);
    expect(t.ended()).toBe(0);
    // the next utterance is a new one, not added to the first
    socket.receive({
      tokens: [
        { text: 'Und', is_final: true },
        { text: ' ein Fremdschlüssel?', is_final: true },
        { text: '<end>', is_final: true },
      ],
    });
    expect(t.utterances).toEqual([
      'Was ist ein Join?',
      'Und ein Fremdschlüssel?',
    ]);
    expect(socket.closed).toBe(false);
  });

  it('an endpoint without a word delivers nothing', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    t.sockets[0].receive({ tokens: [{ text: '<end>', is_final: true }] });
    expect(t.utterances).toEqual([]);
  });

  it('silence never ends a live session (the loop counts the silent time)', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(t.ended()).toBe(0);
    expect(t.errors).toEqual([]);
    expect(t.sockets[0].closed).toBe(false);
    // the keepalive holds the connection
    expect(
      t.sockets[0].json().filter(m => m.type === 'keepalive').length
    ).toBeGreaterThan(4);
  });

  it('a session that Soniox ends is opened anew with the same microphone', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    t.sockets[0].drop();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.errors).toEqual([]);
    expect(t.sockets).toHaveLength(2);
    expect(t.calls.tokens).toEqual(['stt-live', 'stt-live']);
    expect(t.recorders).toHaveLength(2);
    // one microphone for the whole conversation
    expect(t.calls.getUserMedia).toBe(1);
    t.sockets[1].open();
    t.recorders[1].emit();
    expect(t.sockets[1].sent.length).toBe(2);
    t.sockets[1].receive({
      tokens: [
        { text: 'Hallo', is_final: true },
        { text: '<end>', is_final: true },
      ],
    });
    expect(t.utterances).toEqual(['Hallo']);
  });

  it('the limit of the key (an error frame 403 or 413) also opens a new session', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    t.sockets[0].receive({
      error_code: 413,
      error_type: 'max_duration_reached',
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(t.errors).toEqual([]);
    expect(t.sockets).toHaveLength(2);
  });

  it('a session that breaks again and again fails, marked as established', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    for (let i = 0; i < 4; i++) {
      t.sockets[i].drop();
      await jest.advanceTimersByTimeAsync(0);
    }
    expect(t.errors).toHaveLength(1);
    expect(t.errors[0]).toMatchObject({
      error: 'provider-unavailable',
      established: true,
    });
    expect(t.sockets).toHaveLength(4);
    expect(t.streams[0].stopped).toBeGreaterThan(0);
  });

  it('a key refused at the start is a failure at once, not a restart', async () => {
    const t = setup({ tokenFails: true, tokenReason: 'token-401' });
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.errors).toEqual([
      { error: 'provider-unavailable', reason: 'token-401' },
    ]);
    expect(t.sockets).toHaveLength(0);
  });

  it('stop() ends the session the orderly way', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    t.rec.stop();
    expect(t.sockets[0].sent.at(-1)).toBe('');
    t.sockets[0].receive({ tokens: [], finished: true });
    expect(t.ended()).toBe(1);
  });
});

describe('SonioxSpeaker: warm, limits, time limit', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const setup = (options = {}) => {
    const t = makeDeps(options);
    return { ...t, speaker: new SonioxSpeaker(t.deps) };
  };

  it('warm opens the connection and no stream, speak then uses the same connection', async () => {
    const t = setup();
    t.speaker.warm();
    t.speaker.warm();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.calls.tokens).toEqual(['tts']);
    expect(t.sockets).toHaveLength(1);
    t.sockets[0].open();
    await jest.advanceTimersByTimeAsync(0);
    // nothing is sent but keepalives: a stream without text would end by itself
    expect(t.sockets[0].json().filter(m => 'stream_id' in m)).toHaveLength(0);
    const done = t.speaker.speak('Erster Satz.');
    await jest.advanceTimersByTimeAsync(0);
    expect(t.sockets).toHaveLength(1);
    expect(t.calls.tokens).toEqual(['tts']);
    const messages = t.sockets[0].json();
    expect(messages.some(m => m.stream_id === 'hai-1' && m.text)).toBe(true);
    t.sockets[0].receive({
      audio: pcmBase64([1, 2]),
      audio_end: true,
      stream_id: 'hai-1',
    });
    t.ctx.sources[0].end();
    await expect(done).resolves.toBeUndefined();
  });

  it('a warm connection that gets no piece closes after 20 seconds, the speaker stays usable', async () => {
    const t = setup();
    t.speaker.warm();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    await jest.advanceTimersByTimeAsync(WARM_IDLE_MS - 1);
    expect(t.sockets[0].closed).toBe(false);
    await jest.advanceTimersByTimeAsync(2);
    expect(t.sockets[0].closed).toBe(true);
    // a piece afterwards opens a new connection, this is no failure
    const done = t.speaker.speak('Spät.');
    done.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(0);
    expect(t.sockets).toHaveLength(2);
    t.sockets[1].open();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[1].receive({
      audio: pcmBase64([1]),
      audio_end: true,
      stream_id: 'hai-1',
    });
    t.ctx.sources[0].end();
    await expect(done).resolves.toBeUndefined();
  });

  it('a piece cancels the idle timer, cancel stops everything', async () => {
    const t = setup();
    t.speaker.warm();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    void t.speaker.speak('Hallo.').catch(() => undefined);
    await jest.advanceTimersByTimeAsync(WARM_IDLE_MS * 2);
    expect(t.sockets[0].closed).toBe(false);
    t.speaker.cancel();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.sockets[0].closed).toBe(true);
  });

  it('warm after cancel does nothing', async () => {
    const t = setup();
    t.speaker.cancel();
    t.speaker.warm();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.calls.tokens).toEqual([]);
  });

  it('keeps one stream of the account in reserve: two at a time, the third waits', async () => {
    const t = setup();
    for (const text of ['A.', 'B.', 'C.']) {
      void t.speaker.speak(text).catch(() => undefined);
    }
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    await jest.advanceTimersByTimeAsync(0);
    const started = () =>
      t.sockets[0]
        .json()
        .filter(m => m.voice)
        .map(m => m.stream_id);
    expect(started()).toEqual(['hai-1', 'hai-2']);
    t.sockets[0].receive({
      audio: pcmBase64([1]),
      audio_end: true,
      stream_id: 'hai-1',
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(started()).toEqual(['hai-1', 'hai-2', 'hai-3']);
  });

  it('the limit of the account (429) gets the sentence once more after a moment', async () => {
    const t = setup();
    const done = t.speaker.speak('Hallo.');
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].receive({
      stream_id: 'hai-1',
      error_code: 429,
      error_type: 'max_concurrent_streams_reached',
    });
    let settled = false;
    done.then(
      () => (settled = true),
      () => (settled = true)
    );
    await jest.advanceTimersByTimeAsync(LIMIT_RETRY_MS - 10);
    expect(settled).toBe(false);
    expect(t.sockets[0].json().filter(m => m.text)).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(20);
    // a new stream id, the same text
    const texts = t.sockets[0].json().filter(m => m.text);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toMatchObject({ text: 'Hallo.', stream_id: 'hai-2' });
    t.sockets[0].receive({
      audio: pcmBase64([1]),
      audio_end: true,
      stream_id: 'hai-2',
    });
    t.ctx.sources[0].end();
    await expect(done).resolves.toBeUndefined();
  });

  it('a second refusal by the limit rejects the piece, the chain then takes over', async () => {
    const t = setup();
    const done = t.speaker.speak('Hallo.');
    done.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].receive({ stream_id: 'hai-1', error_code: 429 });
    await jest.advanceTimersByTimeAsync(LIMIT_RETRY_MS + 10);
    t.sockets[0].receive({ stream_id: 'hai-2', error_code: 429 });
    await expect(done).rejects.toMatchObject({ message: 'tts-error-429' });
  });

  it('an error that is no limit is not retried', async () => {
    const t = setup();
    const done = t.speaker.speak('Hallo.');
    done.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].receive({ stream_id: 'hai-1', error_code: 400 });
    await expect(done).rejects.toMatchObject({ message: 'tts-error-400' });
  });

  it('a key that never comes is a time limit with the reason', async () => {
    const t = setup({ tokenHangs: true });
    const done = t.speaker.speak('Hallo.');
    done.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(CONNECT_MS + 10);
    await expect(done).rejects.toMatchObject({ message: 'token-timeout' });
  });

  it('the reason of a failed key reaches the rejected piece', async () => {
    const t = setup({
      tokenFails: true,
      tokenReason: 'token-503-upstream_refused',
    });
    const done = t.speaker.speak('Hallo.');
    done.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(0);
    await expect(done).rejects.toMatchObject({
      message: 'token-503-upstream_refused',
    });
  });
});

describe('the chain: retry before the fallback, the fallback is reported', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function make(
    options: Parameters<typeof makeDeps>[0],
    chain: Array<'soniox' | 'haus' | 'browser'>,
    retry?: number | null
  ) {
    const t = makeDeps(options);
    const b = baseEnv();
    const fallbacks: ProviderFallback[] = [];
    const env = createVoiceEnv({
      base: b.env,
      chain,
      deps: t.deps,
      onFallback: f => fallbacks.push(f),
      ...(retry !== undefined ? { retryDelayMs: retry } : {}),
    });
    return { t, b, env, fallbacks };
  }

  async function listen(r: ReturnType<typeof make>) {
    const rec = (await r.env.createRecognition())!.rec;
    const errors: string[] = [];
    rec.onerror = e => errors.push(e.error);
    let ended = 0;
    rec.onend = () => {
      ended += 1;
    };
    rec.start();
    await jest.advanceTimersByTimeAsync(0);
    return { rec, errors, ended: () => ended };
  }

  it('listening: a break of the connection gets one more try after 500 ms, then the browser takes over', async () => {
    const r = make({ tokenFails: true }, ['soniox', 'browser']);
    await listen(r);
    expect(r.t.calls.tokens).toEqual(['stt']);
    expect(r.b.recognitions).toHaveLength(0);
    expect(r.fallbacks).toEqual([]);
    await jest.advanceTimersByTimeAsync(499);
    expect(r.t.calls.tokens).toEqual(['stt']);
    await jest.advanceTimersByTimeAsync(2);
    expect(r.t.calls.tokens).toEqual(['stt', 'stt']);
    expect(r.b.recognitions).toHaveLength(1);
    expect(r.fallbacks).toEqual([
      {
        function: 'stt',
        from: 'soniox',
        to: 'browser',
        reason: 'unavailable',
        code: 'token-503',
      },
    ]);
  });

  it('listening: a refused key is not tried again, the reason is named', async () => {
    const r = make({ tokenFails: true, tokenReason: 'token-401' }, [
      'soniox',
      'browser',
    ]);
    await listen(r);
    expect(r.t.calls.tokens).toEqual(['stt']);
    expect(r.b.recognitions).toHaveLength(1);
    expect(r.fallbacks[0]).toMatchObject({
      reason: 'key-refused',
      to: 'browser',
    });
  });

  it.each([
    ['token-403', 'organization'],
    ['token-429', 'limit'],
    ['token-503-no_key', 'not-configured'],
    ['token-503-bad_region', 'region'],
    ['token-timeout', 'timeout'],
  ])('listening: %s is reported as %s', async (reason, category) => {
    const r = make(
      { tokenFails: true, tokenReason: reason },
      ['soniox', 'browser'],
      null
    );
    await listen(r);
    expect(r.fallbacks[0].reason).toBe(category);
  });

  it('listening: a hanging key gives the fallback after the time limit', async () => {
    const r = make({ tokenHangs: true }, ['soniox', 'browser'], null);
    await listen(r);
    expect(r.b.recognitions).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(CONNECT_MS + 10);
    expect(r.b.recognitions).toHaveLength(1);
    expect(r.fallbacks[0]).toMatchObject({
      reason: 'timeout',
      code: 'token-timeout',
    });
  });

  it('the retry is dropped by an abort', async () => {
    const r = make({ tokenFails: true }, ['soniox', 'browser']);
    const { rec } = await listen(r);
    rec.abort();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(r.t.calls.tokens).toEqual(['stt']);
    expect(r.b.recognitions).toHaveLength(0);
  });

  it('nothing left to listen: the fallback names no provider', async () => {
    const r = make({ tokenFails: true, tokenReason: 'token-401' }, ['soniox']);
    const { errors } = await listen(r);
    expect(errors).toEqual(['failed']);
    expect(r.fallbacks[0]).toMatchObject({ function: 'stt', to: null });
  });

  it('a live session that ran and broke ends the round: the loop starts the next one itself', async () => {
    const r = make({}, ['soniox', 'browser'], null);
    const made = (await r.env.createRecognition())!.rec;
    made.continuous = true;
    let ended = 0;
    made.onend = () => {
      ended += 1;
    };
    made.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(made.live).toBe(true);
    r.t.sockets[0].open();
    for (let i = 0; i < 4; i++) {
      r.t.sockets[i].drop();
      await jest.advanceTimersByTimeAsync(0);
    }
    expect(ended).toBe(1);
    // no browser recognition under the voice of the assistant
    expect(r.b.recognitions).toHaveLength(0);
    expect(r.fallbacks[0]).toMatchObject({
      function: 'stt',
      from: 'soniox',
      to: 'browser',
    });
  });

  it('only Soniox is asked to stay open: the browser keeps its rounds', async () => {
    const r = make({ tokenFails: true, tokenReason: 'token-401' }, [
      'soniox',
      'browser',
    ]);
    const rec = (await r.env.createRecognition())!.rec;
    rec.continuous = true;
    rec.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(r.b.recognitions[0].continuous).toBe(false);
    expect(rec.live).toBe(false);
  });

  it('the environment says it can stay open only with Soniox in the listening chain', () => {
    expect(make({}, ['soniox', 'browser']).env.live).toBe(true);
    expect(make({}, ['haus', 'browser']).env.live).toBe(false);
  });

  it('speaking: a break gets one more try after 500 ms with a new connection, then the browser speaks', async () => {
    const r = make({ tokenFails: true }, ['soniox', 'browser']);
    const speaker = r.env.createSpeaker!({ onDone: () => undefined })!;
    speaker.say('A.');
    speaker.end();
    await jest.advanceTimersByTimeAsync(0);
    expect(r.b.spoken).toHaveLength(0);
    expect(r.t.calls.tokens).toEqual(['tts']);
    await jest.advanceTimersByTimeAsync(501);
    expect(r.t.calls.tokens).toEqual(['tts', 'tts']);
    expect(r.b.spoken.map(u => u.text)).toEqual(['A.']);
    expect(r.fallbacks).toEqual([
      {
        function: 'tts',
        from: 'soniox',
        to: 'browser',
        reason: 'unavailable',
        code: 'token-503',
      },
    ]);
  });

  it('speaking: a retry that works keeps the answer on Soniox, nothing is said twice', async () => {
    const r = make({}, ['soniox', 'browser']);
    const speaker = r.env.createSpeaker!({ onDone: () => undefined })!;
    speaker.say('A.');
    await jest.advanceTimersByTimeAsync(0);
    r.t.sockets[0].open();
    await jest.advanceTimersByTimeAsync(0);
    // the connection breaks before anything was spoken
    r.t.sockets[0].drop();
    await jest.advanceTimersByTimeAsync(0);
    // a piece that comes during the pause is not lost and not doubled
    speaker.say('B.');
    await jest.advanceTimersByTimeAsync(600);
    expect(r.fallbacks).toEqual([]);
    expect(r.b.spoken).toHaveLength(0);
    const socket = r.t.sockets.at(-1)!;
    socket.open();
    await jest.advanceTimersByTimeAsync(0);
    const sent = socket.json().filter(m => m.text);
    expect(sent.map(m => m.text).sort()).toEqual(['A.', 'B.']);
  });

  it('speaking: a refused key is not tried again', async () => {
    const r = make({ tokenFails: true, tokenReason: 'token-401' }, [
      'soniox',
      'browser',
    ]);
    const speaker = r.env.createSpeaker!({ onDone: () => undefined })!;
    speaker.say('A.');
    await jest.advanceTimersByTimeAsync(0);
    expect(r.t.calls.tokens).toEqual(['tts']);
    expect(r.b.spoken.map(u => u.text)).toEqual(['A.']);
    expect(r.fallbacks[0]).toMatchObject({
      function: 'tts',
      reason: 'key-refused',
    });
  });

  it('warm reaches the speech output of Soniox and nothing else', async () => {
    const r = make({}, ['soniox', 'browser']);
    const speaker = r.env.createSpeaker!({ onDone: () => undefined })!;
    speaker.warm?.();
    await jest.advanceTimersByTimeAsync(0);
    expect(r.t.calls.tokens).toEqual(['tts']);
    const browserOnly = make({}, ['haus', 'browser']);
    const other = browserOnly.env.createSpeaker!({ onDone: () => undefined })!;
    expect(() => other.warm?.()).not.toThrow();
  });

  it('prefetch: keys for the head of the chain, the way to the server, nothing for a failed provider', async () => {
    const r = make({ tokenFails: true, tokenReason: 'token-401' }, [
      'soniox',
      'browser',
    ]);
    r.env.prefetch?.('stt');
    r.env.prefetch?.('stt-live');
    r.env.prefetch?.('tts');
    r.env.prefetch?.('server');
    expect(r.t.calls.prefetched).toEqual(['stt', 'stt-live', 'tts']);
    expect(r.t.calls.warmServer).toBe(1);
    // after the recognition failed there is no key to fetch for it, speaking still has one
    await listen(r);
    r.env.prefetch?.('stt');
    r.env.prefetch?.('tts');
    expect(r.t.calls.prefetched).toEqual(['stt', 'stt-live', 'tts', 'tts']);
    // browser alone: nothing to fetch
    const browser = make({}, ['haus', 'browser']);
    browser.env.prefetch?.('stt');
    expect(browser.t.calls.prefetched).toEqual([]);
  });
});

describe('the lead of the playback', () => {
  beforeEach(() => {
    resetLeadForTests();
    window.localStorage.removeItem(LEAD_STORAGE_KEY);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    window.localStorage.removeItem(LEAD_STORAGE_KEY);
    resetLeadForTests();
  });

  const buffer = (duration: number) => ({ duration, copyToChannel() {} });

  it('starts without a lead: the first sound is not delayed', () => {
    const ctx = new FakeAudioContext();
    ctx.currentTime = 5;
    const play = new OrderedPlayback(ctx);
    const slot = play.open();
    slot.push(buffer(1));
    expect(ctx.sources[0].startedAt).toBe(5);
    expect(currentLeadSeconds()).toBe(0);
  });

  it('chunks that follow without a gap are joined seamlessly', () => {
    const ctx = new FakeAudioContext();
    const play = new OrderedPlayback(ctx);
    const slot = play.open();
    slot.push(buffer(1));
    ctx.currentTime = 0.5;
    slot.push(buffer(1));
    expect(ctx.sources[1].startedAt).toBe(1);
  });

  it('an audible gap makes the next start wait: 100 ms, then twice that, never more than 250 ms', () => {
    const ctx = new FakeAudioContext();
    const play = new OrderedPlayback(ctx);
    const slot = play.open();
    slot.push(buffer(1));
    // the sound ran out at 1.0, the next chunk arrives at 1.5
    ctx.currentTime = 1.5;
    slot.push(buffer(1));
    expect(ctx.sources[1].startedAt).toBeCloseTo(1.6, 5);
    expect(currentLeadSeconds()).toBeCloseTo(0.1, 5);
    // runs out again at 2.6, arrives at 3.0
    ctx.currentTime = 3;
    slot.push(buffer(1));
    expect(ctx.sources[2].startedAt).toBeCloseTo(3.2, 5);
    ctx.currentTime = 5;
    slot.push(buffer(1));
    ctx.currentTime = 7;
    slot.push(buffer(1));
    expect(currentLeadSeconds()).toBe(LEAD_MAX_S);
  });

  it('the learned lead holds for the next answer too', () => {
    const ctx = new FakeAudioContext();
    const first = new OrderedPlayback(ctx).open();
    first.push(buffer(1));
    ctx.currentTime = 2;
    first.push(buffer(1));
    ctx.currentTime = 10;
    const next = new OrderedPlayback(ctx).open();
    next.push(buffer(1));
    expect(ctx.sources.at(-1)!.startedAt).toBeCloseTo(10.1, 5);
  });

  it('rounding errors of the clock are no gap', () => {
    const ctx = new FakeAudioContext();
    const slot = new OrderedPlayback(ctx).open();
    slot.push(buffer(1));
    ctx.currentTime = 1.01;
    slot.push(buffer(1));
    expect(currentLeadSeconds()).toBe(0);
  });

  it('a base lead can be set on the device, off keeps it at zero', () => {
    window.localStorage.setItem(LEAD_STORAGE_KEY, '150');
    expect(currentLeadSeconds()).toBeCloseTo(0.15, 5);
    const ctx = new FakeAudioContext();
    ctx.currentTime = 2;
    new OrderedPlayback(ctx).open().push(buffer(1));
    expect(ctx.sources[0].startedAt).toBeCloseTo(2.15, 5);
    window.localStorage.setItem(LEAD_STORAGE_KEY, '9999');
    expect(currentLeadSeconds()).toBe(LEAD_MAX_S);
    window.localStorage.setItem(LEAD_STORAGE_KEY, 'off');
    expect(currentLeadSeconds()).toBe(0);
  });
});
