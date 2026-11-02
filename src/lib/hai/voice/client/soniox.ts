/**
 * Soniox in the browser: speech recognition and speech output over websockets.
 *
 * The browser talks to Soniox directly. The server only hands out a short lived
 * key (POST /api/hai/voice/soniox-token), the real key never reaches the
 * browser. Protocol (https://docs.soniox.com, checked 02.11.2026):
 *
 *  Recognition, wss://stt-rt[.eu].soniox.com/transcribe-websocket
 *   - the key goes in the handshake: protocols ['soniox-api-key', <key>]
 *   - first text message: the config (model, audio_format auto, language hints,
 *     endpoint detection), then audio as binary frames (what MediaRecorder gives),
 *     the end of the stream is an EMPTY TEXT frame
 *   - answers: { tokens: [{ text, is_final }], finished? } or { error_code, ... };
 *     final tokens never change, non final ones are replaced by the next answer;
 *     the control token "<end>" says the speaker finished (endpoint detection)
 *   - { "type": "keepalive" } at least every 40 seconds
 *
 *  Speech output, wss://tts-rt[.eu].soniox.com/tts-websocket
 *   - the key goes in the handshake the same way
 *   - per stream: a config message with stream_id, then
 *     { text, text_end, stream_id }; several streams share one connection
 *   - answers: { audio: <base64 pcm>, audio_end, stream_id }, then
 *     { terminated: true, stream_id }, or { stream_id, error_code, error_message }
 *   - { "keep_alive": true } keeps the connection open
 *
 * Everything the browser needs from outside (token, websocket, microphone,
 * recorder, audio) comes in through SonioxDeps, so tests replace it.
 *
 * @module lib/hai/voice/client/soniox
 */

import {
  OrderedPlayback,
  base64ToBytes,
  pcm16ToFloat32,
  type AudioContextLike,
} from './audio';
import type { PieceEngine } from './browserSpeech';
import {
  ProviderUnavailableError,
  type RecognitionEventLike,
  type RecognitionLike,
} from './types';

// ============================================================================
// WHAT COMES IN FROM OUTSIDE
// ============================================================================

export interface WebSocketLike {
  readyState: number;
  send(data: string | Blob | ArrayBuffer): void;
  close(code?: number): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
}

export const SOCKET_OPEN = 1;

export interface TokenGrant {
  apiKey: string;
  wsUrl: string;
  expiresInSeconds: number;
  /** What is sent first on the websocket (without a key). */
  config: Record<string, unknown>;
}

export interface MediaStreamLike {
  getTracks(): Array<{ stop(): void }>;
}

export interface RecorderLike {
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
  readonly mimeType?: string;
  readonly state?: string;
}

export interface SonioxDeps {
  /** A short lived key for one websocket. Throws ProviderUnavailableError. */
  fetchToken(purpose: 'stt' | 'tts'): Promise<TokenGrant>;
  createSocket(url: string, protocols: string[]): WebSocketLike;
  getUserMedia(): Promise<MediaStreamLike>;
  createRecorder(stream: MediaStreamLike): RecorderLike;
  audioContext(): AudioContextLike;
}

// ============================================================================
// PURE PROTOCOL PARTS
// ============================================================================

/** The subprotocols of the handshake: the name and then the key. */
export function handshakeProtocols(apiKey: string): string[] {
  return ['soniox-api-key', apiKey];
}

export interface TranscriptUpdate {
  /** Tokens that became final with this answer (they never change again). */
  finalText: string;
  /** What the model hears right now and may still correct (replaces the last one). */
  liveText: string;
  /** The speaker finished: endpoint detection saw the end of the utterance. */
  endpoint: boolean;
  /** The stream is complete. */
  finished: boolean;
  /** Soniox reported an error (the code is the HTTP status). */
  error: { code: number; type: string } | null;
}

const CONTROL_TOKENS = new Set(['<end>', '<fin>']);

/** Reads one answer of the recognition websocket. Unknown shapes give an empty update. */
export function readTranscriptMessage(raw: unknown): TranscriptUpdate {
  const update: TranscriptUpdate = {
    finalText: '',
    liveText: '',
    endpoint: false,
    finished: false,
    error: null,
  };
  if (typeof raw !== 'string') return update;
  let message: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return update;
    message = parsed as Record<string, unknown>;
  } catch {
    return update;
  }
  if (message.error_code !== undefined || message.error_type !== undefined) {
    update.error = {
      code: typeof message.error_code === 'number' ? message.error_code : 0,
      type: typeof message.error_type === 'string' ? message.error_type : '',
    };
    return update;
  }
  if (Array.isArray(message.tokens)) {
    for (const token of message.tokens as Array<Record<string, unknown>>) {
      const text = typeof token?.text === 'string' ? token.text : '';
      if (CONTROL_TOKENS.has(text)) {
        if (text === '<end>') update.endpoint = true;
        continue;
      }
      if (token?.is_final === true) update.finalText += text;
      else update.liveText += text;
    }
  }
  if (message.finished === true) update.finished = true;
  return update;
}

export type TtsEvent =
  | { kind: 'audio'; stream: string; audio: string; end: boolean }
  | { kind: 'terminated'; stream: string }
  | { kind: 'error'; stream: string | null; code: number }
  | { kind: 'unknown' };

/** Reads one answer of the speech output websocket. */
export function readTtsMessage(raw: unknown): TtsEvent {
  if (typeof raw !== 'string') return { kind: 'unknown' };
  let message: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { kind: 'unknown' };
    message = parsed as Record<string, unknown>;
  } catch {
    return { kind: 'unknown' };
  }
  const stream =
    typeof message.stream_id === 'string' ? message.stream_id : null;
  if (message.error_code !== undefined || message.error_type !== undefined) {
    return {
      kind: 'error',
      stream,
      code: typeof message.error_code === 'number' ? message.error_code : 0,
    };
  }
  if (stream === null) return { kind: 'unknown' };
  if (typeof message.audio === 'string' && message.audio.length > 0) {
    return {
      kind: 'audio',
      stream,
      audio: message.audio,
      end: message.audio_end === true,
    };
  }
  if (message.terminated === true) return { kind: 'terminated', stream };
  if (message.audio_end === true) {
    return { kind: 'audio', stream, audio: '', end: true };
  }
  return { kind: 'unknown' };
}

/** A recognition event in the shape of the browser's SpeechRecognition. */
export function recognitionEvent(
  finalText: string,
  liveText: string
): RecognitionEventLike | null {
  const results: Array<
    ArrayLike<{ transcript: string }> & { isFinal: boolean }
  > = [];
  if (finalText) {
    results.push(Object.assign([{ transcript: finalText }], { isFinal: true }));
  }
  if (liveText) {
    results.push(Object.assign([{ transcript: liveText }], { isFinal: false }));
  }
  return results.length > 0 ? { resultIndex: 0, results } : null;
}

// ============================================================================
// RECOGNITION
// ============================================================================

const KEEPALIVE_MS = 5_000;
/** Nobody says anything after the microphone opened: end the round. */
export const NO_SPEECH_MS = 8_000;
/** Words came, then nothing new for this long and no endpoint: end the round. */
export const IDLE_AFTER_SPEECH_MS = 4_000;
/** The longest utterance of a round. */
export const MAX_ROUND_MS = 60_000;
/** After the end of the stream was sent, wait this long for the closing answer. */
const CLOSE_WAIT_MS = 3_000;
const CONNECT_MS = 8_000;

function isPermissionError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'NotAllowedError' || name === 'SecurityError';
}

/**
 * Speech recognition with Soniox, in the shape of SpeechRecognition. One
 * `start()` is one round: the microphone and the websocket open, the words come
 * in as results, the end of the utterance (endpoint detection) ends the round with
 * `onend`. A refused microphone is `not-allowed`, everything else that goes wrong
 * is `provider-unavailable`.
 */
export class SonioxRecognition implements RecognitionLike {
  lang = 'de-DE';
  continuous = false;
  interimResults = true;
  maxAlternatives = 1;
  onresult: RecognitionLike['onresult'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null;

  private closed = false;
  private finishing = false;
  private socket: WebSocketLike | null = null;
  private stream: MediaStreamLike | null = null;
  private recorder: RecorderLike | null = null;
  private heard = false;
  private pending: Blob[] = [];
  private socketReady = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: SonioxDeps) {}

  start(): void {
    void this.run();
  }

  /** Ends the round the orderly way: the rest is transcribed, then onend. */
  stop(): void {
    this.finishRound();
  }

  /** Closes everything at once, no handler is called. */
  abort(): void {
    this.cleanup();
  }

  private after(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  private fail(
    error: 'not-allowed' | 'provider-unavailable' | 'audio-capture'
  ) {
    if (this.closed) return;
    this.cleanup();
    this.onerror?.({ error });
  }

  private async run(): Promise<void> {
    // the key is asked for while the microphone opens, so no speech is lost
    const tokenPromise = this.deps.fetchToken('stt');
    tokenPromise.catch(() => undefined);
    try {
      this.stream = await this.deps.getUserMedia();
    } catch (error) {
      this.fail(isPermissionError(error) ? 'not-allowed' : 'audio-capture');
      return;
    }
    if (this.closed) {
      this.releaseStream();
      return;
    }
    // the recorder runs from now on, its chunks wait until the socket is open
    try {
      const recorder = this.deps.createRecorder(this.stream);
      recorder.ondataavailable = event => this.onAudio(event.data);
      recorder.start(250);
      this.recorder = recorder;
    } catch {
      this.fail('audio-capture');
      return;
    }
    let grant: TokenGrant;
    try {
      grant = await tokenPromise;
    } catch {
      this.fail('provider-unavailable');
      return;
    }
    if (this.closed) return;
    this.openSocket(grant);
  }

  private openSocket(grant: TokenGrant): void {
    let socket: WebSocketLike;
    try {
      socket = this.deps.createSocket(
        grant.wsUrl,
        handshakeProtocols(grant.apiKey)
      );
    } catch {
      this.fail('provider-unavailable');
      return;
    }
    this.socket = socket;
    this.after(CONNECT_MS, () => {
      if (!this.socketReady) this.fail('provider-unavailable');
    });
    socket.onopen = () => {
      if (this.closed) return;
      this.socketReady = true;
      try {
        socket.send(JSON.stringify(grant.config));
        for (const chunk of this.pending) socket.send(chunk);
      } catch {
        this.fail('provider-unavailable');
        return;
      }
      this.pending = [];
      this.keepalive = setInterval(() => {
        if (socket.readyState === SOCKET_OPEN) {
          socket.send(JSON.stringify({ type: 'keepalive' }));
        }
      }, KEEPALIVE_MS);
      this.after(NO_SPEECH_MS, () => {
        if (!this.heard) this.finishRound();
      });
      this.after(MAX_ROUND_MS, () => this.finishRound());
    };
    socket.onmessage = event => this.onMessage(event.data);
    socket.onerror = () => {
      if (!this.finishing) this.fail('provider-unavailable');
    };
    socket.onclose = () => {
      if (this.closed) return;
      if (this.finishing || this.heard) {
        // an orderly end, or the connection ended after words came: keep them
        this.endRound();
        return;
      }
      this.fail('provider-unavailable');
    };
  }

  private onAudio(blob: Blob): void {
    if (this.closed || this.finishing || blob.size === 0) return;
    if (this.socketReady && this.socket?.readyState === SOCKET_OPEN) {
      try {
        this.socket.send(blob);
      } catch {
        this.fail('provider-unavailable');
      }
    } else {
      this.pending.push(blob);
    }
  }

  private onMessage(data: unknown): void {
    if (this.closed) return;
    const update = readTranscriptMessage(data);
    if (update.error) {
      // words that came before the error are kept, otherwise the provider failed
      if (this.heard) this.endRound();
      else this.fail('provider-unavailable');
      return;
    }
    if (update.finalText || update.liveText) {
      this.heard = true;
      this.armIdle();
      const event = recognitionEvent(update.finalText, update.liveText);
      if (event) this.onresult?.(event);
    }
    if (update.endpoint) {
      this.finishRound();
      return;
    }
    if (update.finished) this.endRound();
  }

  /** No new word for a while although the speaker did not stop: end the round. */
  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.finishRound(), IDLE_AFTER_SPEECH_MS);
  }

  /** Tell Soniox that the audio ends (an empty text frame), then wait for its last answer. */
  private finishRound(): void {
    if (this.closed || this.finishing) return;
    this.finishing = true;
    this.stopCapture();
    const socket = this.socket;
    if (socket && socket.readyState === SOCKET_OPEN) {
      try {
        socket.send('');
      } catch {
        this.endRound();
        return;
      }
      this.after(CLOSE_WAIT_MS, () => this.endRound());
    } else {
      this.endRound();
    }
  }

  private endRound(): void {
    if (this.closed) return;
    this.cleanup();
    this.onend?.();
  }

  private stopCapture(): void {
    try {
      this.recorder?.stop();
    } catch {
      // already stopped
    }
    this.recorder = null;
    this.releaseStream();
  }

  private releaseStream(): void {
    for (const track of this.stream?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        // already stopped
      }
    }
    this.stream = null;
  }

  private cleanup(): void {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.keepalive) clearInterval(this.keepalive);
    this.idleTimer = null;
    this.keepalive = null;
    if (this.recorder) {
      this.recorder.ondataavailable = null;
    }
    this.stopCapture();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
    this.pending = [];
  }
}

// ============================================================================
// SPEECH OUTPUT
// ============================================================================

/** Streams that Soniox may generate at the same time (the limit of Soniox is 5). */
const MAX_ACTIVE_STREAMS = 3;

interface TtsPiece {
  streamId: string;
  text: string;
  slot: ReturnType<OrderedPlayback['open']>;
  carry: Uint8Array | null;
  finished: boolean;
}

interface TtsConnection {
  socket: WebSocketLike;
  config: Record<string, unknown>;
  sampleRate: number;
}

/**
 * Speech output with Soniox. One websocket per answer, one stream per piece
 * (a sentence): the pieces are generated at the same time (up to three) and
 * played in order, so there is no gap between two sentences. A failed piece
 * rejects its promise, the chain then speaks the rest with the next provider.
 */
export class SonioxSpeaker implements PieceEngine {
  readonly id = 'soniox' as const;
  private connection: Promise<TtsConnection> | null = null;
  private playback: OrderedPlayback;
  private pieces = new Map<string, TtsPiece>();
  private waiting: TtsPiece[] = [];
  private active = 0;
  private counter = 0;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private dead = false;

  constructor(private readonly deps: SonioxDeps) {
    this.playback = new OrderedPlayback(deps.audioContext());
  }

  speak(text: string): Promise<void> {
    if (this.dead) {
      return Promise.reject(new ProviderUnavailableError('speaker-closed'));
    }
    this.counter += 1;
    const piece: TtsPiece = {
      streamId: `hai-${this.counter}`,
      text,
      slot: this.playback.open(),
      carry: null,
      finished: false,
    };
    this.pieces.set(piece.streamId, piece);
    this.waiting.push(piece);
    this.drain();
    return piece.slot.done;
  }

  cancel(): void {
    this.dead = true;
    this.playback.cancel();
    const connection = this.connection;
    this.connection = null;
    this.waiting = [];
    const running = [...this.pieces.values()].filter(piece => !piece.finished);
    if (connection) {
      void connection
        .then(({ socket }) => {
          for (const piece of running) {
            this.send(socket, { stream_id: piece.streamId, cancel: true });
          }
          this.closeSocket(socket);
        })
        .catch(() => undefined);
    }
    this.pieces.clear();
    this.stopKeepalive();
  }

  close(): void {
    this.dead = true;
    const connection = this.connection;
    this.connection = null;
    this.stopKeepalive();
    if (connection) {
      void connection
        .then(({ socket }) => this.closeSocket(socket))
        .catch(() => undefined);
    }
  }

  private drain(): void {
    while (this.active < MAX_ACTIVE_STREAMS && this.waiting.length > 0) {
      const piece = this.waiting.shift()!;
      this.active += 1;
      void this.start(piece);
    }
  }

  private async start(piece: TtsPiece): Promise<void> {
    try {
      const connection = await this.connect();
      if (this.dead || piece.finished) return;
      this.send(connection.socket, {
        stream_id: piece.streamId,
        ...connection.config,
      });
      this.send(connection.socket, {
        text: piece.text,
        text_end: true,
        stream_id: piece.streamId,
      });
    } catch {
      this.failAll(new ProviderUnavailableError('tts-connection'));
    }
  }

  private connect(): Promise<TtsConnection> {
    if (!this.connection) {
      this.connection = this.open();
      this.connection.catch(() => {
        this.connection = null;
      });
    }
    return this.connection;
  }

  private async open(): Promise<TtsConnection> {
    const grant = await this.deps.fetchToken('tts');
    const socket = this.deps.createSocket(
      grant.wsUrl,
      handshakeProtocols(grant.apiKey)
    );
    const sampleRate =
      typeof grant.config.sample_rate === 'number'
        ? grant.config.sample_rate
        : 24_000;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new ProviderUnavailableError('tts-connect-timeout')),
        CONNECT_MS
      );
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new ProviderUnavailableError('tts-socket-error'));
      };
      socket.onclose = () => {
        clearTimeout(timer);
        reject(new ProviderUnavailableError('tts-socket-closed'));
      };
    });
    socket.onerror = () =>
      this.failAll(new ProviderUnavailableError('tts-error'));
    socket.onclose = () =>
      this.failAll(new ProviderUnavailableError('tts-closed'));
    socket.onmessage = event => this.onMessage(event.data, sampleRate);
    this.keepalive = setInterval(() => {
      if (socket.readyState === SOCKET_OPEN) {
        this.send(socket, { keep_alive: true });
      }
    }, KEEPALIVE_MS);
    return { socket, config: grant.config, sampleRate };
  }

  private onMessage(data: unknown, sampleRate: number): void {
    const event = readTtsMessage(data);
    if (event.kind === 'unknown') return;
    if (event.kind === 'error') {
      const piece = event.stream ? this.pieces.get(event.stream) : undefined;
      if (piece) {
        this.release(piece);
        piece.slot.fail(
          new ProviderUnavailableError(`tts-error-${event.code}`)
        );
      } else {
        this.failAll(new ProviderUnavailableError(`tts-error-${event.code}`));
      }
      return;
    }
    const piece = this.pieces.get(event.stream);
    if (!piece || piece.finished) return;
    if (event.kind === 'audio') {
      if (event.audio) {
        const { samples, rest } = pcm16ToFloat32(
          base64ToBytes(event.audio),
          piece.carry
        );
        piece.carry = rest;
        if (samples.length > 0) {
          const ctx = this.deps.audioContext();
          const buffer = ctx.createBuffer(1, samples.length, sampleRate);
          buffer.copyToChannel(samples, 0);
          piece.slot.push(buffer);
        }
      }
      if (event.end) {
        this.release(piece);
        piece.slot.finish();
      }
      return;
    }
    // terminated: the stream is over, whatever audio it had was delivered
    this.release(piece);
    piece.slot.finish();
  }

  /** The stream of a piece no longer counts as active. */
  private release(piece: TtsPiece): void {
    if (piece.finished) return;
    piece.finished = true;
    this.active = Math.max(0, this.active - 1);
    this.drain();
  }

  private failAll(error: Error): void {
    for (const piece of this.pieces.values()) {
      if (piece.finished) continue;
      piece.finished = true;
      piece.slot.fail(error);
    }
    this.waiting = [];
    this.active = 0;
    this.connection = null;
    this.stopKeepalive();
  }

  private send(socket: WebSocketLike, message: Record<string, unknown>): void {
    if (socket.readyState === SOCKET_OPEN) socket.send(JSON.stringify(message));
  }

  private closeSocket(socket: WebSocketLike): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // already closed
    }
  }

  private stopKeepalive(): void {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
  }
}

/** A speech output step for the chain (a new connection per answer). */
export function sonioxSpeakerEngine(deps: SonioxDeps): PieceEngine {
  return new SonioxSpeaker(deps);
}
