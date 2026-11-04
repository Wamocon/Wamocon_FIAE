import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  Limiter,
  OrderedPlayback,
  VoiceActivity,
  pcm16ToFloat32,
  rmsOf,
} from '@/lib/hai/voice/client/audio';
import { HausRecognition, HausSpeaker } from '@/lib/hai/voice/client/haus';
import {
  NO_SPEECH_MS,
  SonioxRecognition,
  SonioxSpeaker,
  handshakeProtocols,
  readTranscriptMessage,
  readTtsMessage,
  recognitionEvent,
} from '@/lib/hai/voice/client/soniox';
import { createVoiceEnv } from '@/lib/hai/voice/client/engine';
import {
  ProviderUnavailableError,
  type RecognitionEventLike,
  type RecognitionLike,
  type UtteranceLike,
  type VoiceEnv,
} from '@/lib/hai/voice/client/types';
import {
  FakeAudioContext,
  flush,
  makeDeps,
  pcmBase64,
} from './voiceClient.helpers';

// The browser side of the voice providers: the Soniox protocol, Sokrates, the
// ordered playback and the chain that falls back from one provider to the next.
// No microphone, no network, no audio device: everything outside is a double.

describe('Soniox protocol', () => {
  it('puts the key in the handshake, not in the address', () => {
    expect(handshakeProtocols('k')).toEqual(['soniox-api-key', 'k']);
  });

  it('collects final and live tokens and leaves the control tokens out', () => {
    expect(
      readTranscriptMessage(
        JSON.stringify({
          tokens: [
            { text: 'Was', is_final: true },
            { text: ' ist', is_final: false },
          ],
        })
      )
    ).toMatchObject({ finalText: 'Was', liveText: ' ist', endpoint: false });
    expect(
      readTranscriptMessage(
        JSON.stringify({
          tokens: [
            { text: ' ein Join?', is_final: true },
            { text: '<end>', is_final: true },
            { text: '<fin>', is_final: true },
          ],
        })
      )
    ).toMatchObject({ finalText: ' ein Join?', liveText: '', endpoint: true });
  });

  it('reads the end of the stream and an error, and ignores garbage', () => {
    expect(
      readTranscriptMessage(JSON.stringify({ tokens: [], finished: true }))
    ).toMatchObject({ finished: true });
    expect(
      readTranscriptMessage(
        JSON.stringify({ error_code: 503, error_type: 'service_unavailable' })
      ).error
    ).toEqual({ code: 503, type: 'service_unavailable' });
    for (const raw of ['nope', '5', 'null', new Blob(['x']), undefined]) {
      expect(readTranscriptMessage(raw)).toEqual({
        finalText: '',
        liveText: '',
        endpoint: false,
        finalTokens: [],
        finished: false,
        error: null,
      });
    }
  });

  it('reads the answers of the speech output', () => {
    expect(
      readTtsMessage(
        JSON.stringify({ audio: 'AAAA', audio_end: true, stream_id: 's1' })
      )
    ).toEqual({ kind: 'audio', stream: 's1', audio: 'AAAA', end: true });
    expect(
      readTtsMessage(JSON.stringify({ terminated: true, stream_id: 's1' }))
    ).toEqual({ kind: 'terminated', stream: 's1' });
    expect(
      readTtsMessage(
        JSON.stringify({ stream_id: 's1', error_code: 400, error_message: 'x' })
      )
    ).toEqual({ kind: 'error', stream: 's1', code: 400, type: '' });
    expect(readTtsMessage('{"x":1}')).toEqual({ kind: 'unknown' });
    expect(readTtsMessage('garbage')).toEqual({ kind: 'unknown' });
  });

  it('turns text into the events the loop reads from the browser', () => {
    expect(recognitionEvent('', '')).toBeNull();
    const event = recognitionEvent('Hallo', ' Wel')!;
    expect(event.resultIndex).toBe(0);
    expect(event.results).toHaveLength(2);
    expect(event.results[0][0].transcript).toBe('Hallo');
    expect(event.results[0].isFinal).toBe(true);
    expect(event.results[1].isFinal).toBe(false);
  });
});

describe('audio helpers', () => {
  it('reads 16 bit samples and carries an odd byte over to the next chunk', () => {
    const first = pcm16ToFloat32(new Uint8Array([0x00, 0x40, 0x00]));
    expect(first.samples).toHaveLength(1);
    expect(first.samples[0]).toBeCloseTo(0.5, 3);
    expect(first.rest).toEqual(new Uint8Array([0x00]));
    const second = pcm16ToFloat32(new Uint8Array([0xc0]), first.rest);
    // 0xc000 is -16384 of 32768
    expect(second.samples[0]).toBeCloseTo(-0.5, 3);
    expect(second.rest).toBeNull();
  });

  it('measures loudness', () => {
    expect(rmsOf(new Float32Array(0))).toBe(0);
    expect(rmsOf(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it('plays the pieces in order, however late their audio arrives', async () => {
    const ctx = new FakeAudioContext();
    const playback = new OrderedPlayback(ctx);
    const a = playback.open();
    const b = playback.open();
    const spokenB = jest.fn();
    void b.done.then(spokenB);
    const buffer = { duration: 1, copyToChannel() {} };
    // the second piece is ready first: nothing plays yet
    b.push(buffer);
    b.finish();
    expect(ctx.sources).toHaveLength(0);
    a.push(buffer);
    a.finish();
    expect(ctx.sources).toHaveLength(2);
    // the second starts after the first, not at the same time
    expect(ctx.sources[1].startedAt).toBeGreaterThanOrEqual(1);
    ctx.sources[0].end();
    await flush();
    expect(spokenB).not.toHaveBeenCalled();
    ctx.sources[1].end();
    await flush();
    await expect(a.done).resolves.toBeUndefined();
    expect(spokenB).toHaveBeenCalled();
  });

  it('a failed piece reports its failure when its turn comes, what plays before is not cut off', async () => {
    const ctx = new FakeAudioContext();
    const playback = new OrderedPlayback(ctx);
    const a = playback.open();
    const b = playback.open();
    const failure = new Error('b failed');
    const caught = b.done.catch(e => e);
    a.push({ duration: 1, copyToChannel() {} });
    b.fail(failure);
    await flush();
    // a still plays, b has not reported yet
    expect(ctx.sources[0].stopped).toBe(false);
    a.finish();
    ctx.sources[0].end();
    await flush();
    expect(await caught).toBe(failure);
  });

  it('cancel stops the sound and settles nothing', async () => {
    const ctx = new FakeAudioContext();
    const playback = new OrderedPlayback(ctx);
    const slot = playback.open();
    const settled = jest.fn();
    void slot.done.then(settled, settled);
    slot.push({ duration: 1, copyToChannel() {} });
    playback.cancel();
    expect(ctx.sources[0].stopped).toBe(true);
    slot.push({ duration: 1, copyToChannel() {} });
    expect(ctx.sources).toHaveLength(1);
    await flush();
    expect(settled).not.toHaveBeenCalled();
  });

  it('the limiter runs at most the given number of tasks at once', async () => {
    const limiter = new Limiter(2);
    let running = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const task = () =>
      limiter.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>(resolve => releases.push(resolve));
        running -= 1;
      });
    const all = Promise.all([task(), task(), task(), task()]);
    await flush();
    expect(peak).toBe(2);
    while (releases.length) {
      releases.shift()!();
      await flush();
    }
    await all;
    expect(peak).toBe(2);
  });

  it('detects the end of speech after silence, and gives up on a silent round', () => {
    const quiet = new VoiceActivity();
    expect(quiet.feed(0, 0)).toBe('wait');
    expect(quiet.feed(0, 7_999)).toBe('wait');
    expect(quiet.feed(0, 8_000)).toBe('no-speech');

    const talk = new VoiceActivity();
    talk.feed(0.1, 0);
    expect(talk.feed(0.1, 400)).toBe('wait');
    expect(talk.heardSpeech).toBe(true);
    expect(talk.feed(0, 1_000)).toBe('wait');
    expect(talk.feed(0, 1_600)).toBe('speech-ended');

    // a click shorter than the minimum is not speech
    const click = new VoiceActivity();
    click.feed(0.1, 0);
    click.feed(0, 100);
    expect(click.heardSpeech).toBe(false);
  });
});

describe('SonioxRecognition', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const setup = (options = {}) => {
    const t = makeDeps(options);
    const rec = new SonioxRecognition(t.deps);
    const events: RecognitionEventLike[] = [];
    const errors: string[] = [];
    let ended = 0;
    rec.onresult = e => events.push(e);
    rec.onerror = e => errors.push(e.error);
    rec.onend = () => {
      ended += 1;
    };
    return { ...t, rec, events, errors, ended: () => ended };
  };
  const texts = (e: RecognitionEventLike) =>
    Array.from(e.results).map(r => [r[0].transcript, r.isFinal]);

  it('records while the connection opens, sends the config first, then the audio', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.calls.tokens).toEqual(['stt']);
    const socket = t.sockets[0];
    expect(socket.url).toBe('wss://stt-rt.eu.soniox.com/transcribe-websocket');
    expect(socket.protocols).toEqual(['soniox-api-key', 'temp-key']);
    // the microphone is already recording, the first chunk waits for the socket
    t.recorders[0].emit();
    expect(socket.sent).toHaveLength(0);
    socket.open();
    expect(socket.json()[0]).toMatchObject({ model: 'stt-rt-v5' });
    expect(socket.sent[1]).toBeInstanceOf(Blob);
    t.recorders[0].emit();
    expect(socket.sent).toHaveLength(3);
  });

  it('delivers interim and final text and ends the round at the endpoint', async () => {
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
    // the end of the audio is an empty text frame, the microphone is released
    expect(socket.sent.at(-1)).toBe('');
    expect(t.streams[0].stopped).toBeGreaterThan(0);
    expect(t.ended()).toBe(0);
    socket.receive({ tokens: [], finished: true });
    expect(t.ended()).toBe(1);
    expect(socket.closed).toBe(true);
    expect(t.errors).toEqual([]);
  });

  it('a refused microphone is not-allowed and no key is wasted on a fallback', async () => {
    const t = setup({ micDenied: true });
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.errors).toEqual(['not-allowed']);
    expect(t.sockets).toHaveLength(0);
  });

  it('no key from the server: provider-unavailable, the microphone is released', async () => {
    const t = setup({ tokenFails: true });
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.errors).toEqual(['provider-unavailable']);
    expect(t.streams[0].stopped).toBeGreaterThan(0);
    expect(t.recorders[0].stopped).toBe(true);
  });

  it('an error of Soniox before any word is provider-unavailable', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    t.sockets[0].receive({
      error_code: 503,
      error_type: 'service_unavailable',
    });
    expect(t.errors).toEqual(['provider-unavailable']);
    expect(t.ended()).toBe(0);
  });

  it('a connection that never opens is provider-unavailable', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(9_000);
    expect(t.errors).toEqual(['provider-unavailable']);
  });

  it('a connection that breaks after words keeps the words and ends the round', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    const socket = t.sockets[0];
    socket.open();
    socket.receive({ tokens: [{ text: 'Hallo', is_final: true }] });
    socket.drop();
    expect(t.errors).toEqual([]);
    expect(t.ended()).toBe(1);
  });

  it('silence ends the round without a result, the loop counts a silent round', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    await jest.advanceTimersByTimeAsync(NO_SPEECH_MS + 10);
    expect(t.sockets[0].sent.at(-1)).toBe('');
    t.sockets[0].receive({ tokens: [], finished: true });
    expect(t.events).toHaveLength(0);
    expect(t.ended()).toBe(1);
  });

  it('keeps the connection alive while it waits', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.sockets[0].open();
    await jest.advanceTimersByTimeAsync(5_100);
    expect(t.sockets[0].json().some(m => m.type === 'keepalive')).toBe(true);
  });

  it('abort closes everything and calls no handler', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    const socket = t.sockets[0];
    socket.open();
    t.rec.abort();
    expect(socket.closed).toBe(true);
    expect(t.streams[0].stopped).toBeGreaterThan(0);
    socket.receive({ tokens: [{ text: 'x', is_final: true }] });
    expect(t.events).toHaveLength(0);
    expect(t.errors).toEqual([]);
    expect(t.ended()).toBe(0);
  });
});

describe('SonioxSpeaker', () => {
  const setup = (options = {}) => {
    const t = makeDeps(options);
    const speaker = new SonioxSpeaker(t.deps);
    return { ...t, speaker };
  };

  it('opens one connection with the key in the handshake and one stream per piece', async () => {
    const t = setup();
    const first = t.speaker.speak('Erster Satz.');
    const second = t.speaker.speak('Zweiter Satz.');
    await flush();
    expect(t.calls.tokens).toEqual(['tts']);
    const socket = t.sockets[0];
    expect(socket.protocols).toEqual(['soniox-api-key', 'temp-key']);
    socket.open();
    await flush();
    const messages = socket.json();
    expect(messages[0]).toMatchObject({
      stream_id: 'hai-1',
      model: 'tts-rt-v2',
      voice: 'Lena',
      audio_format: 'pcm_s16le',
    });
    expect(messages[1]).toEqual({
      text: 'Erster Satz.',
      text_end: true,
      stream_id: 'hai-1',
    });
    expect(messages[2]).toMatchObject({ stream_id: 'hai-2' });

    // the audio of the second piece arrives first: it waits for its turn
    socket.receive({
      audio: pcmBase64([1000, -1000]),
      audio_end: true,
      stream_id: 'hai-2',
    });
    expect(t.ctx.sources).toHaveLength(0);
    socket.receive({
      audio: pcmBase64([500, 500]),
      audio_end: true,
      stream_id: 'hai-1',
    });
    expect(t.ctx.sources).toHaveLength(2);
    t.ctx.sources[0].end();
    t.ctx.sources[1].end();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('a stream of Soniox that ends with an error rejects its piece', async () => {
    const t = setup();
    const piece = t.speaker.speak('Hallo.');
    const caught = piece.catch(e => e);
    await flush();
    t.sockets[0].open();
    await flush();
    t.sockets[0].receive({
      stream_id: 'hai-1',
      error_code: 500,
      error_message: 'boom',
    });
    expect(await caught).toBeInstanceOf(ProviderUnavailableError);
  });

  it('a connection that breaks rejects what is not spoken yet', async () => {
    const t = setup();
    const caught = t.speaker.speak('Hallo.').catch(e => e);
    await flush();
    t.sockets[0].open();
    await flush();
    t.sockets[0].drop();
    expect(await caught).toBeInstanceOf(ProviderUnavailableError);
  });

  it('no key from the server rejects the piece', async () => {
    const t = setup({ tokenFails: true });
    const caught = t.speaker.speak('Hallo.').catch(e => e);
    expect(await caught).toBeInstanceOf(ProviderUnavailableError);
    expect(t.sockets).toHaveLength(0);
  });

  it('cancel stops the sound, cancels the streams and closes the connection', async () => {
    const t = setup();
    void t.speaker.speak('Hallo.');
    await flush();
    t.sockets[0].open();
    await flush();
    t.sockets[0].receive({
      audio: pcmBase64([100, 100]),
      audio_end: false,
      stream_id: 'hai-1',
    });
    const socket = t.sockets[0];
    t.speaker.cancel();
    await flush();
    expect(t.ctx.sources[0].stopped).toBe(true);
    expect(
      socket.json().some(m => m.cancel === true && m.stream_id === 'hai-1')
    ).toBe(true);
    expect(socket.closed).toBe(true);
    await expect(t.speaker.speak('Noch einmal.')).rejects.toBeInstanceOf(
      ProviderUnavailableError
    );
  });
});

describe('Sokrates in the browser', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const setup = (options = {}) => {
    const t = makeDeps(options);
    const rec = new HausRecognition(t.deps);
    const events: RecognitionEventLike[] = [];
    const errors: string[] = [];
    let ended = 0;
    rec.onresult = e => events.push(e);
    rec.onerror = e => errors.push(e.error);
    rec.onend = () => {
      ended += 1;
    };
    return { ...t, rec, events, errors, ended: () => ended };
  };

  it('records until the speaker is quiet, sends the recording and delivers the text', async () => {
    const t = setup({ transcript: 'Was ist ein Primärschlüssel?' });
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.ctx.analyser.level = 0.1;
    t.recorders[0].emit();
    await jest.advanceTimersByTimeAsync(500);
    t.ctx.analyser.level = 0;
    await jest.advanceTimersByTimeAsync(1_500);
    expect(t.recorders[0].stopped).toBe(true);
    expect(t.calls.transcribe).toBe(1);
    expect(t.events).toHaveLength(1);
    expect(t.events[0].results[0][0].transcript).toBe(
      'Was ist ein Primärschlüssel?'
    );
    expect(t.events[0].results[0].isFinal).toBe(true);
    expect(t.ended()).toBe(1);
    expect(t.streams[0].stopped).toBeGreaterThan(0);
  });

  it('a silent round ends without a call to the server', async () => {
    const t = setup();
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.ctx.analyser.level = 0;
    await jest.advanceTimersByTimeAsync(8_300);
    expect(t.calls.transcribe).toBe(0);
    expect(t.events).toHaveLength(0);
    expect(t.ended()).toBe(1);
  });

  it('Sokrates cannot transcribe: provider-unavailable', async () => {
    const t = setup({ transcribeFails: true });
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    t.ctx.analyser.level = 0.1;
    t.recorders[0].emit();
    await jest.advanceTimersByTimeAsync(500);
    t.ctx.analyser.level = 0;
    await jest.advanceTimersByTimeAsync(1_500);
    expect(t.errors).toEqual(['provider-unavailable']);
    expect(t.ended()).toBe(0);
  });

  it('a refused microphone is not-allowed', async () => {
    const t = setup({ micDenied: true });
    t.rec.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.errors).toEqual(['not-allowed']);
  });

  it('speaks sentence by sentence through the server, in order', async () => {
    const t = makeDeps();
    const speaker = new HausSpeaker(t.deps);
    const first = speaker.speak('Erster Satz.');
    const second = speaker.speak('Zweiter Satz.');
    await jest.advanceTimersByTimeAsync(0);
    expect(t.calls.speak).toEqual(['Erster Satz.', 'Zweiter Satz.']);
    expect(t.ctx.decoded).toBe(2);
    expect(t.ctx.sources).toHaveLength(2);
    t.ctx.sources[0].end();
    t.ctx.sources[1].end();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('a sentence that Sokrates cannot speak rejects its piece', async () => {
    const t = makeDeps({ speakFails: true });
    const speaker = new HausSpeaker(t.deps);
    const caught = speaker.speak('Hallo.').catch(e => e);
    await jest.advanceTimersByTimeAsync(0);
    expect(await caught).toBeInstanceOf(ProviderUnavailableError);
  });
});

// ============================================================================
// THE CHAIN
// ============================================================================

class BrowserRecognition implements RecognitionLike {
  lang = '';
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onresult: RecognitionLike['onresult'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null;
  started = 0;
  start() {
    this.started += 1;
  }
  stop() {}
  abort() {}
}

function baseEnv() {
  const recognitions: BrowserRecognition[] = [];
  const spoken: UtteranceLike[] = [];
  let cancelled = 0;
  const env: VoiceEnv = {
    createRecognition: async () => {
      const rec = new BrowserRecognition();
      recognitions.push(rec);
      return { rec, local: false };
    },
    synth: {
      speak: u => {
        spoken.push(u);
      },
      cancel: () => {
        cancelled += 1;
      },
      getVoices: () => [{ lang: 'de-DE', localService: true }],
    },
    makeUtterance: text => ({
      text,
      lang: '',
      voice: undefined,
      rate: 0,
      onend: null,
      onerror: null,
    }),
    storage: null,
    now: () => new Date(),
  };
  return { env, recognitions, spoken, cancelled: () => cancelled };
}

describe('the chain of providers', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('with the browser alone the environment of the browser is used unchanged', () => {
    const b = baseEnv();
    expect(
      createVoiceEnv({ base: b.env, chain: ['browser'], deps: null })
    ).toBe(b.env);
    // and so it is when the browser cannot use the cloud parts
    expect(
      createVoiceEnv({ base: b.env, chain: ['soniox', 'browser'], deps: null })
    ).toBe(b.env);
  });

  async function listen(
    options: Parameters<typeof makeDeps>[0],
    chain: Array<'soniox' | 'haus' | 'browser'>
  ) {
    const t = makeDeps(options);
    const b = baseEnv();
    const active: string[] = [];
    const env = createVoiceEnv({
      retryDelayMs: null,
      base: b.env,
      chain,
      deps: t.deps,
      onActiveProvider: id => active.push(id),
    });
    const made = await env.createRecognition();
    const rec = made!.rec;
    const errors: string[] = [];
    rec.onerror = e => errors.push(e.error);
    rec.lang = 'de-DE';
    rec.start();
    await jest.advanceTimersByTimeAsync(0);
    return { t, b, env, rec, errors, active };
  }

  it('Soniox listens first', async () => {
    const r = await listen({}, ['soniox', 'browser']);
    expect(r.active).toEqual(['soniox']);
    expect(r.t.sockets).toHaveLength(1);
    expect(r.b.recognitions).toHaveLength(0);
  });

  it('Soniox disturbed: the browser takes over, with the settings of the loop', async () => {
    const r = await listen({ tokenFails: true }, ['soniox', 'browser']);
    expect(r.active).toEqual(['soniox', 'browser']);
    expect(r.b.recognitions).toHaveLength(1);
    expect(r.b.recognitions[0].started).toBe(1);
    expect(r.b.recognitions[0].lang).toBe('de-DE');
    expect(r.errors).toEqual([]);
    // what the browser hears reaches the loop
    const heard: string[] = [];
    r.rec.onresult = e => heard.push(e.results[0][0].transcript);
    r.b.recognitions[0].onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: 'Hallo' }], { isFinal: true })],
    });
    expect(heard).toEqual(['Hallo']);
  });

  it('Soniox disturbed, Sokrates disturbed: browser last', async () => {
    const r = await listen({ tokenFails: true, transcribeFails: true }, [
      'soniox',
      'haus',
      'browser',
    ]);
    // Sokrates records (the second recorder, Soniox opened the first), hears
    // speech, cannot transcribe
    r.t.ctx.analyser.level = 0.1;
    r.t.recorders[1].emit();
    await jest.advanceTimersByTimeAsync(500);
    r.t.ctx.analyser.level = 0;
    await jest.advanceTimersByTimeAsync(1_500);
    expect(r.active).toEqual(['soniox', 'haus', 'browser']);
    expect(r.b.recognitions).toHaveLength(1);
    expect(r.errors).toEqual([]);
  });

  it('Sokrates cannot recognize (500) but speaks: the browser listens, the speech output stays on Sokrates', async () => {
    const r = await listen({ transcribeFails: true }, ['haus', 'browser']);
    // Sokrates records, hears speech, cannot transcribe
    r.t.ctx.analyser.level = 0.1;
    r.t.recorders[0].emit();
    await jest.advanceTimersByTimeAsync(500);
    r.t.ctx.analyser.level = 0;
    await jest.advanceTimersByTimeAsync(1_500);
    expect(r.active).toEqual(['haus', 'browser']);
    expect(r.b.recognitions).toHaveLength(1);
    expect(r.errors).toEqual([]);

    // the same conversation: the answer is still spoken by Sokrates, not by the browser
    const speaker = r.env.createSpeaker!({ onDone: () => undefined })!;
    speaker.say('Hallo.');
    speaker.end();
    await jest.advanceTimersByTimeAsync(0);
    expect(r.t.calls.speak).toEqual(['Hallo.']);
    expect(r.b.spoken).toHaveLength(0);
  });

  it('a refused microphone is no failure of the provider: no fallback, the error reaches the loop', async () => {
    const r = await listen({ micDenied: true }, ['soniox', 'haus', 'browser']);
    expect(r.errors).toEqual(['not-allowed']);
    expect(r.t.calls.getUserMedia).toBe(1);
    expect(r.b.recognitions).toHaveLength(0);
  });

  it('nothing in the chain can listen: the loop gets a failure', async () => {
    const t = makeDeps({ tokenFails: true });
    const b = baseEnv();
    b.env.createRecognition = async () => null;
    const env = createVoiceEnv({
      retryDelayMs: null,
      base: b.env,
      chain: ['soniox', 'browser'],
      deps: t.deps,
    });
    const rec = (await env.createRecognition())!.rec;
    const errors: string[] = [];
    rec.onerror = e => errors.push(e.error);
    rec.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(errors).toEqual(['failed']);
  });

  it('a provider that failed is skipped until the next conversation starts', async () => {
    const r = await listen({ tokenFails: true }, ['soniox', 'browser']);
    expect(r.t.calls.tokens).toEqual(['stt']);
    // the next round of the same conversation does not ask Soniox again
    const again = (await r.env.createRecognition())!.rec;
    again.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(r.t.calls.tokens).toEqual(['stt']);
    expect(r.b.recognitions).toHaveLength(2);
    // a new conversation tries the chain from the top
    r.env.resetFallback?.();
    const fresh = (await r.env.createRecognition())!.rec;
    fresh.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(r.t.calls.tokens).toEqual(['stt', 'stt']);
  });

  it('abort during the fallback leaves nothing running', async () => {
    const r = await listen({ tokenFails: true }, ['soniox', 'browser']);
    r.rec.abort();
    r.b.recognitions[0].onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: 'x' }], { isFinal: true })],
    });
    expect(r.errors).toEqual([]);
  });

  async function say(
    options: Parameters<typeof makeDeps>[0],
    chain: Array<'soniox' | 'haus' | 'browser'>
  ) {
    const t = makeDeps(options);
    const b = baseEnv();
    const env = createVoiceEnv({
      base: b.env,
      chain,
      deps: t.deps,
      retryDelayMs: null,
    });
    let done = 0;
    const speaker = env.createSpeaker!({
      onDone: () => {
        done += 1;
      },
    })!;
    return { t, b, env, speaker, done: () => done };
  }

  it('speaks with Soniox and reports done only after the end and the last sound', async () => {
    const s = await say({}, ['soniox', 'browser']);
    s.speaker.say('Erster Satz.');
    s.speaker.end();
    await jest.advanceTimersByTimeAsync(0);
    s.t.sockets[0].open();
    await jest.advanceTimersByTimeAsync(0);
    expect(s.done()).toBe(0);
    s.t.sockets[0].receive({
      audio: pcmBase64([1, 2]),
      audio_end: true,
      stream_id: 'hai-1',
    });
    s.t.ctx.sources[0].end();
    await jest.advanceTimersByTimeAsync(0);
    expect(s.done()).toBe(1);
    // the connection is released
    expect(s.t.sockets[0].closed).toBe(true);
    expect(s.b.spoken).toHaveLength(0);
  });

  it('Soniox fails in the middle: what is not spoken yet goes to the browser, in order', async () => {
    const s = await say({}, ['soniox', 'browser']);
    s.speaker.say('Erster Satz.');
    s.speaker.say('Zweiter Satz.');
    s.speaker.end();
    await jest.advanceTimersByTimeAsync(0);
    const socket = s.t.sockets[0];
    socket.open();
    await jest.advanceTimersByTimeAsync(0);
    // the first sentence is spoken, then the connection breaks
    socket.receive({
      audio: pcmBase64([1, 2]),
      audio_end: true,
      stream_id: 'hai-1',
    });
    s.t.ctx.sources[0].end();
    await jest.advanceTimersByTimeAsync(0);
    socket.drop();
    await jest.advanceTimersByTimeAsync(0);
    expect(s.b.spoken.map(u => u.text)).toEqual(['Zweiter Satz.']);
    expect(s.b.spoken[0].lang).toBe('de-DE');
    expect(s.done()).toBe(0);
    s.b.spoken[0].onend?.();
    await jest.advanceTimersByTimeAsync(0);
    expect(s.done()).toBe(1);
  });

  it('Soniox cannot even connect: the whole answer is spoken by the browser', async () => {
    const s = await say({ tokenFails: true }, ['soniox', 'browser']);
    s.speaker.say('A.');
    s.speaker.say('B.');
    s.speaker.end();
    await jest.advanceTimersByTimeAsync(0);
    expect(s.b.spoken.map(u => u.text)).toEqual(['A.', 'B.']);
    s.b.spoken.forEach(u => u.onend?.());
    await jest.advanceTimersByTimeAsync(0);
    expect(s.done()).toBe(1);
  });

  it('Soniox and Sokrates fail: the browser speaks, and the next answer does not retry them', async () => {
    const s = await say({ tokenFails: true, speakFails: true }, [
      'soniox',
      'haus',
      'browser',
    ]);
    s.speaker.say('A.');
    s.speaker.end();
    await jest.advanceTimersByTimeAsync(0);
    expect(s.b.spoken.map(u => u.text)).toEqual(['A.']);
    expect(s.t.calls.speak).toEqual(['A.']);
    s.b.spoken[0].onend?.();
    await jest.advanceTimersByTimeAsync(0);
    expect(s.done()).toBe(1);

    const next = s.env.createSpeaker!({ onDone: () => undefined })!;
    next.say('B.');
    await jest.advanceTimersByTimeAsync(0);
    expect(s.t.calls.tokens.filter(p => p === 'tts')).toHaveLength(1);
    expect(s.t.calls.speak).toEqual(['A.']);
    expect(s.b.spoken.map(u => u.text)).toEqual(['A.', 'B.']);
  });

  it('cancel is quiet at once and reports nothing', async () => {
    const s = await say({}, ['soniox', 'browser']);
    s.speaker.say('Erster Satz.');
    await jest.advanceTimersByTimeAsync(0);
    s.t.sockets[0].open();
    await jest.advanceTimersByTimeAsync(0);
    s.speaker.cancel();
    s.speaker.end();
    await jest.advanceTimersByTimeAsync(0);
    expect(s.done()).toBe(0);
    expect(s.t.sockets[0].closed).toBe(true);
  });

  it('an answer without speech output possible is done at once', async () => {
    const t = makeDeps({ tokenFails: true });
    const b = baseEnv();
    b.env.synth = null;
    const env = createVoiceEnv({
      retryDelayMs: null,
      base: b.env,
      chain: ['soniox'],
      deps: t.deps,
    });
    let done = 0;
    const speaker = env.createSpeaker!({
      onDone: () => {
        done += 1;
      },
    })!;
    speaker.say('Hallo.');
    speaker.end();
    await jest.advanceTimersByTimeAsync(0);
    expect(done).toBe(1);
  });

  it('unlocking the audio resumes the shared audio context', () => {
    const t = makeDeps();
    const env = createVoiceEnv({
      retryDelayMs: null,
      base: baseEnv().env,
      chain: ['soniox', 'browser'],
      deps: t.deps,
    });
    env.unlockAudio?.();
    expect(t.ctx.resumed).toBe(1);
  });
});

// The server sends one chain per function (GET /api/hai/voice/config: chains.stt
// and chains.tts). A provider that is disturbed in one function only is in the
// chain of the other. These tests build the environment from such chains.
describe('one chain per function', () => {
  type Id = 'soniox' | 'haus' | 'browser';
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function setup(
    chains: { stt: Id[]; tts: Id[] },
    options: Parameters<typeof makeDeps>[0] = {}
  ) {
    const t = makeDeps(options);
    const b = baseEnv();
    const active: string[] = [];
    const env = createVoiceEnv({
      retryDelayMs: null,
      base: b.env,
      chain: ['soniox', 'haus', 'browser'],
      chains,
      deps: t.deps,
      onActiveProvider: id => active.push(id),
    });
    return { t, b, env, active };
  }

  async function startListening(env: VoiceEnv) {
    const rec = (await env.createRecognition())!.rec;
    rec.lang = 'de-DE';
    rec.start();
    await jest.advanceTimersByTimeAsync(0);
    return rec;
  }

  function speak(env: VoiceEnv, ...pieces: string[]) {
    const speaker = env.createSpeaker!({ onDone: () => undefined })!;
    for (const piece of pieces) speaker.say(piece);
    speaker.end();
  }

  it('recognition of Sokrates is out, its speech output is in: the browser listens, Sokrates speaks', async () => {
    const r = await setup({ stt: ['browser'], tts: ['haus', 'browser'] });
    await startListening(r.env);
    expect(r.active).toEqual(['browser']);
    expect(r.b.recognitions).toHaveLength(1);
    // Sokrates was not asked to listen: no microphone and no recorder for it
    expect(r.t.calls.getUserMedia).toBe(0);
    speak(r.env, 'Hallo.');
    await jest.advanceTimersByTimeAsync(0);
    expect(r.t.calls.speak).toEqual(['Hallo.']);
    expect(r.b.spoken).toHaveLength(0);
  });

  it('speech output of Sokrates is out, its recognition is in: Sokrates listens, the browser speaks', async () => {
    const r = await setup({ stt: ['haus', 'browser'], tts: ['browser'] });
    await startListening(r.env);
    expect(r.active).toEqual(['haus']);
    expect(r.t.calls.getUserMedia).toBe(1);
    expect(r.b.recognitions).toHaveLength(0);
    speak(r.env, 'Hallo.');
    await jest.advanceTimersByTimeAsync(0);
    expect(r.t.calls.speak).toEqual([]);
    expect(r.b.spoken.map(u => u.text)).toEqual(['Hallo.']);
  });

  it('both are out for Sokrates: both functions use the browser', async () => {
    const r = await setup({ stt: ['browser'], tts: ['browser'] });
    // nothing of the cloud is in a chain: the environment of the browser is used
    expect(r.env.createSpeaker).toBe(r.b.env.createSpeaker);
    await startListening(r.env);
    expect(r.b.recognitions).toHaveLength(1);
    expect(r.t.calls.getUserMedia).toBe(0);
  });

  it('Soniox is in both chains: a failed token for listening does not take its speech output away', async () => {
    const r = await setup(
      { stt: ['soniox', 'browser'], tts: ['soniox', 'browser'] },
      { tokenFails: true }
    );
    await startListening(r.env);
    expect(r.active).toEqual(['soniox', 'browser']);
    // Soniox failed in listening; in this test the double fails the token of
    // speaking too, so the browser speaks. What counts: speaking asked for its own
    // token, it was not skipped because of the failed listening.
    speak(r.env, 'Hallo.');
    await jest.advanceTimersByTimeAsync(0);
    expect(r.t.calls.tokens).toEqual(['stt', 'tts']);
    expect(r.b.spoken.map(u => u.text)).toEqual(['Hallo.']);
  });

  it('Sokrates fails to speak in a conversation: listening stays on Sokrates (own failure sets per function)', async () => {
    const r = await setup(
      { stt: ['haus', 'browser'], tts: ['haus', 'browser'] },
      { speakFails: true }
    );
    speak(r.env, 'Hallo.');
    await jest.advanceTimersByTimeAsync(0);
    expect(r.b.spoken.map(u => u.text)).toEqual(['Hallo.']);
    await startListening(r.env);
    expect(r.active).toEqual(['haus']);
    expect(r.b.recognitions).toHaveLength(0);
  });

  it('one chain with a cloud provider is enough to build the chained environment', async () => {
    const r = await setup({ stt: ['browser'], tts: ['soniox', 'browser'] });
    expect(r.env).not.toBe(r.b.env);
  });

  it('without chains the single chain holds for both functions (older server)', async () => {
    const t = makeDeps();
    const b = baseEnv();
    const env = createVoiceEnv({
      retryDelayMs: null,
      base: b.env,
      chain: ['haus', 'browser'],
      deps: t.deps,
    });
    await startListening(env);
    speak(env, 'Hallo.');
    await jest.advanceTimersByTimeAsync(0);
    expect(t.calls.getUserMedia).toBe(1);
    expect(t.calls.speak).toEqual(['Hallo.']);
  });
});
