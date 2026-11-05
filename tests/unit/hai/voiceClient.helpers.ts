// Doubles for the browser side of the voice providers: websocket, microphone,
// recorder, audio context and the calls to the routes. No device, no network.

import type {
  AnalyserLike,
  AudioBufferLike,
  AudioContextLike,
  AudioSourceLike,
} from '@/lib/hai/voice/client/audio';
import type { VoiceClientDeps } from '@/lib/hai/voice/client/engine';
import type {
  MediaStreamLike,
  RecorderLike,
  TokenGrant,
  WebSocketLike,
} from '@/lib/hai/voice/client/soniox';
import { ProviderUnavailableError } from '@/lib/hai/voice/client/types';

export class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: Array<string | Blob | ArrayBuffer> = [];
  closed = false;
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onerror: WebSocketLike['onerror'] = null;
  onclose: WebSocketLike['onclose'] = null;

  constructor(
    readonly url: string,
    readonly protocols: string[]
  ) {}

  send(data: string | Blob | ArrayBuffer) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  /** The server accepted the connection. */
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
  /** The text messages that were sent, as objects (the audio frames are left out). */
  json(): Array<Record<string, unknown>> {
    return this.sent
      .filter((m): m is string => typeof m === 'string' && m.length > 0)
      .map(m => JSON.parse(m));
  }
}

export class FakeRecorder implements RecorderLike {
  ondataavailable: RecorderLike['ondataavailable'] = null;
  onstop: RecorderLike['onstop'] = null;
  started = false;
  stopped = false;
  /** The slice (ms) the recorder was started with. */
  slice: number | undefined;
  mimeType = 'audio/webm';
  start(timeslice?: number) {
    this.started = true;
    this.slice = timeslice;
  }
  stop() {
    this.stopped = true;
    this.onstop?.();
  }
  emit(size = 4) {
    this.ondataavailable?.({
      data: new Blob([new Uint8Array(size)], { type: this.mimeType }),
    });
  }
}

export class FakeStream implements MediaStreamLike {
  stopped = 0;
  getTracks() {
    return [
      {
        stop: () => {
          this.stopped += 1;
        },
        getSettings: () => ({
          sampleRate: 48_000,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        }),
        muted: false,
        readyState: 'live',
        label: 'Test-Mikrofon (Headset)',
      },
    ];
  }
}

export class FakeSource implements AudioSourceLike {
  buffer: AudioBufferLike | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  connect() {}
  start(when?: number) {
    this.startedAt = when ?? 0;
  }
  stop() {
    this.stopped = true;
  }
  /** The sound ran out. */
  end() {
    this.onended?.();
  }
}

export class FakeAnalyser implements AnalyserLike {
  fftSize = 0;
  /** Loudness the next read returns. */
  level = 0;
  getFloatTimeDomainData(array: Float32Array) {
    array.fill(this.level);
  }
}

export class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  destination = {};
  state = 'running';
  sources: FakeSource[] = [];
  analyser = new FakeAnalyser();
  decoded = 0;
  resumed = 0;
  async resume() {
    this.resumed += 1;
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate, copyToChannel() {} };
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  async decodeAudioData() {
    this.decoded += 1;
    return { duration: 1, copyToChannel() {} };
  }
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return this.analyser;
  }
}

export interface FakeDepsOptions {
  /** fetchToken fails (Soniox not available). */
  tokenFails?: boolean;
  /** The reason code of the failed token (default token-503). */
  tokenReason?: string;
  /** fetchToken never answers (the server hangs). */
  tokenHangs?: boolean;
  /** The microphone is refused. */
  micDenied?: boolean;
  /** The recognition on Sokrates fails. */
  transcribeFails?: boolean;
  /** The speech output on Sokrates fails. */
  speakFails?: boolean;
  transcript?: string;
}

export function makeDeps(options: FakeDepsOptions = {}) {
  const sockets: FakeSocket[] = [];
  const recorders: FakeRecorder[] = [];
  const streams: FakeStream[] = [];
  const ctx = new FakeAudioContext();
  const calls = {
    tokens: [] as string[],
    prefetched: [] as string[],
    profiles: [] as Array<string | undefined>,
    warmServer: 0,
    transcribe: 0,
    speak: [] as string[],
    getUserMedia: 0,
  };
  const deps: VoiceClientDeps = {
    async fetchToken(purpose): Promise<TokenGrant> {
      calls.tokens.push(purpose);
      if (options.tokenHangs) return new Promise<TokenGrant>(() => undefined);
      if (options.tokenFails) {
        throw new ProviderUnavailableError(options.tokenReason ?? 'token-503');
      }
      return {
        apiKey: 'temp-key',
        wsUrl:
          purpose !== 'tts'
            ? 'wss://stt-rt.eu.soniox.com/transcribe-websocket'
            : 'wss://tts-rt.eu.soniox.com/tts-websocket',
        expiresInSeconds: 90,
        config:
          purpose !== 'tts'
            ? { model: 'stt-rt-v5', audio_format: 'auto' }
            : {
                model: 'tts-rt-v2',
                language: 'de',
                voice: 'Lena',
                audio_format: 'pcm_s16le',
                sample_rate: 24_000,
              },
      };
    },
    createSocket(url, protocols) {
      const socket = new FakeSocket(url, protocols);
      sockets.push(socket);
      return socket;
    },
    prefetchToken(purpose) {
      calls.prefetched.push(purpose);
    },
    warmServer() {
      calls.warmServer += 1;
    },
    async getUserMedia(profile) {
      calls.getUserMedia += 1;
      calls.profiles.push(profile);
      if (options.micDenied) {
        throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      }
      const stream = new FakeStream();
      streams.push(stream);
      return stream;
    },
    createRecorder() {
      const recorder = new FakeRecorder();
      recorders.push(recorder);
      return recorder;
    },
    audioContext: () => ctx,
    async transcribe() {
      calls.transcribe += 1;
      if (options.transcribeFails) {
        throw new ProviderUnavailableError('transcribe-503');
      }
      return options.transcript ?? 'Hallo Welt';
    },
    async speak(text) {
      calls.speak.push(text);
      if (options.speakFails) throw new ProviderUnavailableError('speech-503');
      return new ArrayBuffer(8);
    },
  };
  return { deps, sockets, recorders, streams, ctx, calls };
}

/** Lets pending promises run. */
export const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

/** Base64 of 16 bit little endian samples (the audio of the speech output websocket). */
export function pcmBase64(samples: number[]): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((s, i) => view.setInt16(i * 2, s, true));
  return Buffer.from(bytes).toString('base64');
}
