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
  rmsOf,
  type AudioContextLike,
} from './audio';
import type { PieceEngine } from './browserSpeech';
import { reasonCode } from './fallback';
import { mark } from './trace';
import {
  ProviderUnavailableError,
  type RecognitionEventLike,
  type RecognitionLike,
  type UtteranceInfo,
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

export interface MediaTrackLike {
  stop(): void;
  /** What the browser really delivers (it may differ from what was asked for). */
  getSettings?(): object;
  readonly muted?: boolean;
  readonly readyState?: string;
}

export interface MediaStreamLike {
  getTracks(): MediaTrackLike[];
}

export interface RecorderLike {
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
  readonly mimeType?: string;
  readonly state?: string;
}

/**
 * The treatment of the microphone signal: `raw` (nothing, like the official
 * web SDK), `live` (echo cancellation only, for the open microphone while the
 * assistant speaks), `processed` (echo cancellation and noise suppression).
 */
export type MicProfile = 'raw' | 'live' | 'processed';

export interface SonioxDeps {
  /** A short lived key for one websocket. Throws ProviderUnavailableError. */
  fetchToken(purpose: 'stt' | 'stt-live' | 'tts'): Promise<TokenGrant>;
  /** Fetches a key in advance, so the next fetchToken needs no way over the server. */
  prefetchToken?(purpose: 'stt' | 'stt-live' | 'tts'): void;
  /** Warms up the way from the server to Sokrates (a ping, no content). Never throws. */
  warmServer?(): void;
  createSocket(url: string, protocols: string[]): WebSocketLike;
  /**
   * The microphone. `raw` (the default of the recognition on Soniox) asks for
   * the recording the model was trained on, without echo cancellation and noise
   * suppression, like the official web SDK of Soniox. `processed` keeps the
   * browser's own processing (Sokrates).
   */
  getUserMedia(profile?: MicProfile): Promise<MediaStreamLike>;
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

/** What a final word piece tells beside its text (final pieces never change). */
export interface FinalToken {
  startMs?: number;
  endMs?: number;
  /** 0 to 1, how sure the recognition is of this piece. */
  confidence?: number;
}

export interface TranscriptUpdate {
  /** Tokens that became final with this answer (they never change again). */
  finalText: string;
  /** What the model hears right now and may still correct (replaces the last one). */
  liveText: string;
  /** The speaker finished: endpoint detection saw the end of the utterance. */
  endpoint: boolean;
  /** Time and confidence of the tokens that became final with this answer (never their text). */
  finalTokens: FinalToken[];
  /** The stream is complete. */
  finished: boolean;
  /** Soniox reported an error (the code is the HTTP status). */
  error: { code: number; type: string } | null;
}

const CONTROL_TOKENS = new Set(['<end>', '<fin>']);

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Reads one answer of the recognition websocket. Unknown shapes give an empty update. */
export function readTranscriptMessage(raw: unknown): TranscriptUpdate {
  const update: TranscriptUpdate = {
    finalText: '',
    liveText: '',
    endpoint: false,
    finalTokens: [],
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
      if (token?.is_final === true) {
        update.finalText += text;
        const info: FinalToken = {};
        if (isNumber(token.start_ms)) info.startMs = token.start_ms;
        if (isNumber(token.end_ms)) info.endMs = token.end_ms;
        if (isNumber(token.confidence)) info.confidence = token.confidence;
        update.finalTokens.push(info);
      } else update.liveText += text;
    }
  }
  if (message.finished === true) update.finished = true;
  return update;
}

export type TtsEvent =
  | { kind: 'audio'; stream: string; audio: string; end: boolean }
  | { kind: 'terminated'; stream: string }
  | { kind: 'error'; stream: string | null; code: number; type: string }
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
      type: typeof message.error_type === 'string' ? message.error_type : '',
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
/** The key and the websocket each get this long, then the provider counts as unreachable. */
export const CONNECT_MS = 8_000;
/** A live session that broke after it was open is restarted this often in a row. */
const MAX_LIVE_RESTARTS = 3;
/** A slice of the recording (the official web SDK uses 60 ms, damicon 100 ms). */
export const RECORDER_SLICE_MS = 100;
const LEVEL_MS = 100;
/** Speech has an RMS of about 0.02 to 0.2, the mascot wants 0 to 1. */
const LEVEL_GAIN = 5;

function isPermissionError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'NotAllowedError' || name === 'SecurityError';
}

/** The stable reason code of an error (ProviderUnavailableError carries one). */
function reasonOf(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.length > 0
    ? reasonCode(message)
    : fallback;
}

/** Settles like the promise, or rejects with the reason after `ms`. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  reason: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ProviderUnavailableError(reason)),
      ms
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Container and codec of a recording as short tokens, for the measuring points. */
export function mimeInfo(mime: string | undefined): Record<string, string> {
  if (!mime) return { container: 'none' };
  const [type, ...params] = mime.toLowerCase().split(';');
  const info: Record<string, string> = {
    container: type.replace(/^audio\//, '').replace(/[^a-z0-9]/g, '') || 'none',
  };
  const codecs = params.find(part => part.includes('codecs'));
  if (codecs)
    info.codec = codecs.split('=')[1]?.replace(/[^a-z0-9]/g, '') ?? '';
  return info;
}

/**
 * Speech recognition with Soniox, in the shape of SpeechRecognition. One
 * `start()` is one round: the microphone and the websocket open, the words come
 * in as results, the end of the utterance (endpoint detection) ends the round with
 * `onend`. A refused microphone is `not-allowed`, everything else that goes wrong
 * is `provider-unavailable` (with a reason code for the fallback notice).
 *
 * Live mode (`continuous = true`): the microphone and the websocket stay open
 * over the whole conversation. The end of an utterance (endpoint detection) is
 * reported with `onutterance(text)` and the recording goes on, so the person
 * can speak while the assistant answers (interrupting by voice). A session
 * that Soniox ends (limit of the key, a break) is opened anew with the same
 * microphone, a few times in a row. Silence never ends a live session: the
 * loop counts the silent time itself.
 */
export class SonioxRecognition implements RecognitionLike {
  lang = 'de-DE';
  continuous = false;
  interimResults = true;
  maxAlternatives = 1;
  onresult: RecognitionLike['onresult'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null;
  onaudiostart: RecognitionLike['onaudiostart'] = null;
  onlevel: RecognitionLike['onlevel'] = null;
  onutterance: RecognitionLike['onutterance'] = null;

  /** Live mode: the recognition stays open over several utterances. */
  get live(): boolean {
    return this.continuous;
  }

  private closed = false;
  private utterance = '';
  private opened = false;
  private restarts = 0;
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
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private levelSource: { disconnect?(): void } | null = null;
  private peak = 0;
  // what went to Soniox: the proof that the browser sends audio at all
  private sentChunks = 0;
  private sentBytes = 0;
  private seenInterim = false;
  private seenMessage = false;
  // when the recorder of the current session started (Date.now): the time of a word is
  // this plus its start_ms, so the loop can look up the loudness of that moment
  private audioOrigin = 0;
  // what the running utterance is made of: time window and confidence of its words
  private uttFirstMs: number | null = null;
  private uttLastMs: number | null = null;
  private uttFirstSeenAt: number | null = null;
  private uttConfSum = 0;
  private uttConfCount = 0;

  constructor(private readonly deps: SonioxDeps) {}

  start(): void {
    void this.run();
  }

  /** Ends the round the orderly way: the rest is transcribed, then onend. */
  stop(): void {
    this.finishRound('stop');
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
    error: 'not-allowed' | 'provider-unavailable' | 'audio-capture',
    reason?: string
  ) {
    if (this.closed) return;
    mark('stt.fail', { error, reason: reasonCode(reason) });
    const established = this.opened && this.continuous;
    this.cleanup();
    this.onerror?.({
      error,
      ...(reason ? { reason } : {}),
      ...(established ? { established } : {}),
    });
  }

  private async run(): Promise<void> {
    // the key is asked for while the microphone opens, so no speech is lost
    const tokenPromise = this.requestToken();
    try {
      this.stream = await this.deps.getUserMedia(
        this.continuous ? 'live' : 'raw'
      );
    } catch (error) {
      const name = (error as { name?: string } | null)?.name ?? 'unknown';
      mark('stt.mic.error', { name: reasonCode(name) });
      this.fail(
        isPermissionError(error) ? 'not-allowed' : 'audio-capture',
        reasonCode(name)
      );
      return;
    }
    if (this.closed) {
      this.releaseStream();
      return;
    }
    if (!this.startRecorder()) return;
    this.startLevel(this.stream);
    mark('stt.mic.ready', this.micInfo(this.stream));
    this.onaudiostart?.();
    await this.connectSession(tokenPromise);
  }

  private requestToken(): Promise<TokenGrant> {
    mark('stt.token.start');
    const tokenPromise = this.deps.fetchToken(
      this.continuous ? 'stt-live' : 'stt'
    );
    tokenPromise.then(
      () => mark('stt.token.end', { ok: true }),
      error => mark('stt.token.end', { ok: false, reason: reasonOf(error, '') })
    );
    return tokenPromise;
  }

  /** The recorder runs from now on, its chunks wait until the socket is open. */
  private startRecorder(): boolean {
    if (!this.stream) return false;
    try {
      const recorder = this.deps.createRecorder(this.stream);
      recorder.ondataavailable = event => this.onAudio(event.data);
      recorder.start(RECORDER_SLICE_MS);
      this.recorder = recorder;
      this.audioOrigin = Date.now();
      mark('stt.recorder.start', mimeInfo(recorder.mimeType));
      return true;
    } catch {
      this.fail('audio-capture', 'recorder');
      return false;
    }
  }

  private async connectSession(
    tokenPromise: Promise<TokenGrant>
  ): Promise<void> {
    let grant: TokenGrant;
    try {
      grant = await withTimeout(tokenPromise, CONNECT_MS, 'token-timeout');
    } catch (error) {
      this.fail('provider-unavailable', reasonOf(error, 'token-error'));
      return;
    }
    if (this.closed) return;
    this.openSocket(grant);
  }

  /** What the browser really delivers (it may differ from the wish) and the state of the audio. */
  private micInfo(stream: MediaStreamLike): Record<string, unknown> {
    const track = stream.getTracks()[0];
    let settings: Record<string, unknown> = {};
    try {
      settings = (track?.getSettings?.() ?? {}) as Record<string, unknown>;
    } catch {
      settings = {};
    }
    let ctxState = 'none';
    try {
      const ctx = this.deps.audioContext();
      // a context that is still suspended would measure silence: wake it up
      void Promise.resolve(ctx.resume()).catch(() => undefined);
      ctxState = ctx.state ?? 'unknown';
    } catch {
      ctxState = 'error';
    }
    return {
      sampleRate: settings.sampleRate,
      channelCount: settings.channelCount,
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
      muted: track?.muted,
      readyState: track?.readyState,
      ctx: ctxState,
    };
  }

  /** Measures the loudness of the recording and reports it, about ten times a second. */
  private startLevel(stream: MediaStreamLike): void {
    try {
      const ctx = this.deps.audioContext();
      if (!ctx.createMediaStreamSource || !ctx.createAnalyser) return;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const source = ctx.createMediaStreamSource(stream);
      // only into the analyser, never to the speakers (that would be an echo)
      source.connect(analyser);
      this.levelSource = source;
      const block = new Float32Array(analyser.fftSize);
      this.levelTimer = setInterval(() => {
        analyser.getFloatTimeDomainData(block);
        const rms = rmsOf(block);
        this.peak = Math.max(this.peak, rms);
        this.onlevel?.(Math.min(1, rms * LEVEL_GAIN));
      }, LEVEL_MS);
    } catch {
      // no level, the recognition itself does not depend on it
    }
  }

  private stopLevel(): void {
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    try {
      this.levelSource?.disconnect?.();
    } catch {
      // already disconnected
    }
    this.levelSource = null;
  }

  private openSocket(grant: TokenGrant): void {
    let socket: WebSocketLike;
    try {
      socket = this.deps.createSocket(
        grant.wsUrl,
        handshakeProtocols(grant.apiKey)
      );
    } catch {
      this.fail('provider-unavailable', 'stt-socket-create');
      return;
    }
    this.socket = socket;
    this.after(CONNECT_MS, () => {
      if (!this.socketReady) {
        this.fail('provider-unavailable', 'stt-connect-timeout');
      }
    });
    socket.onopen = () => {
      if (this.closed) return;
      this.socketReady = true;
      mark('stt.ws.open', { pendingChunks: this.pending.length });
      try {
        socket.send(JSON.stringify(grant.config));
        for (const chunk of this.pending) this.sendAudio(socket, chunk);
      } catch {
        this.fail('provider-unavailable', 'stt-send');
        return;
      }
      this.pending = [];
      this.keepalive = setInterval(() => {
        if (socket.readyState === SOCKET_OPEN) {
          socket.send(JSON.stringify({ type: 'keepalive' }));
        }
      }, KEEPALIVE_MS);
      this.opened = true;
      // a live session never ends by itself: the loop counts the silent time
      if (!this.continuous) {
        this.after(NO_SPEECH_MS, () => {
          if (!this.heard) this.finishRound('no-speech');
        });
        this.after(MAX_ROUND_MS, () => this.finishRound('max'));
      }
    };
    socket.onmessage = event => this.onMessage(event.data);
    socket.onerror = () => {
      if (this.finishing) return;
      if (this.restartSession('socket-error')) return;
      this.fail('provider-unavailable', 'stt-socket-error');
    };
    socket.onclose = () => {
      if (this.closed) return;
      if (this.restartSession('socket-closed')) return;
      if (this.finishing || this.heard) {
        // an orderly end, or the connection ended after words came: keep them
        this.endRound();
        return;
      }
      this.fail('provider-unavailable', 'stt-socket-closed');
    };
  }

  private sendAudio(socket: WebSocketLike, blob: Blob): void {
    socket.send(blob);
    if (this.sentChunks === 0) {
      mark('stt.audio.first', { bytes: blob.size, ...mimeInfo(blob.type) });
    }
    this.sentChunks += 1;
    this.sentBytes += blob.size;
  }

  private onAudio(blob: Blob): void {
    if (this.closed || this.finishing || blob.size === 0) return;
    if (this.socketReady && this.socket?.readyState === SOCKET_OPEN) {
      try {
        this.sendAudio(this.socket, blob);
      } catch {
        this.fail('provider-unavailable', 'stt-send');
      }
    } else {
      this.pending.push(blob);
    }
  }

  private onMessage(data: unknown): void {
    if (this.closed) return;
    if (!this.seenMessage) {
      this.seenMessage = true;
      mark('stt.msg.first');
    }
    const update = readTranscriptMessage(data);
    if (update.error) {
      const type = reasonCode(update.error.type);
      mark('stt.error', { code: update.error.code, type });
      // the limit of the session or a break: a live session goes on with a new one
      if (this.restartSession(`error-${update.error.code}`)) return;
      // words that came before the error are kept, otherwise the provider failed
      if (this.heard) this.endRound();
      else {
        this.fail(
          'provider-unavailable',
          `stt-error-${update.error.code}-${type}`
        );
      }
      return;
    }
    if (update.finalText || update.liveText) {
      this.heard = true;
      this.restarts = 0;
      this.utterance += update.finalText;
      this.noteTokens(update);
      if (!this.seenInterim) {
        this.seenInterim = true;
        mark('stt.interim.first');
      }
      this.armIdle();
      const event = recognitionEvent(update.finalText, update.liveText);
      if (event) this.onresult?.(event);
    }
    if (update.endpoint) {
      mark('stt.endpoint');
      if (this.continuous) {
        this.deliverUtterance();
        return;
      }
      this.finishRound('endpoint');
      return;
    }
    if (update.finished) this.endRound();
  }

  /** Keeps the time window and the confidence of the words of the running utterance. */
  private noteTokens(update: TranscriptUpdate): void {
    if (this.uttFirstSeenAt === null) this.uttFirstSeenAt = Date.now();
    for (const token of update.finalTokens) {
      if (token.startMs !== undefined) {
        this.uttFirstMs = Math.min(
          this.uttFirstMs ?? token.startMs,
          token.startMs
        );
      }
      if (token.endMs !== undefined) {
        this.uttLastMs = Math.max(this.uttLastMs ?? token.endMs, token.endMs);
      }
      if (token.confidence !== undefined) {
        this.uttConfSum += token.confidence;
        this.uttConfCount += 1;
      }
    }
  }

  /**
   * The time window (clock time) and the confidence of the utterance that just ended.
   * A window that does not fit the clock (a stream that restarted its time, words in
   * the future) is replaced by the time the words arrived in.
   */
  private takeUtteranceInfo(): UtteranceInfo {
    const now = Date.now();
    let startAt: number | undefined;
    let endAt: number | undefined;
    if (
      this.uttFirstMs !== null &&
      this.uttLastMs !== null &&
      this.audioOrigin > 0
    ) {
      startAt = this.audioOrigin + this.uttFirstMs;
      endAt = this.audioOrigin + this.uttLastMs;
      const fits =
        endAt <= now + 1_000 && startAt <= endAt && endAt - startAt <= 120_000;
      if (!fits) startAt = endAt = undefined;
    }
    if (startAt === undefined && this.uttFirstSeenAt !== null) {
      startAt = this.uttFirstSeenAt - 600;
      endAt = now;
    }
    const confidence =
      this.uttConfCount > 0 ? this.uttConfSum / this.uttConfCount : undefined;
    this.resetUtteranceInfo();
    return {
      ...(startAt !== undefined ? { startAt } : {}),
      ...(endAt !== undefined ? { endAt } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    };
  }

  private resetUtteranceInfo(): void {
    this.uttFirstMs = null;
    this.uttLastMs = null;
    this.uttFirstSeenAt = null;
    this.uttConfSum = 0;
    this.uttConfCount = 0;
  }

  /** No new word for a while although the speaker did not stop: end the round. */
  private armIdle(): void {
    if (this.continuous) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => this.finishRound('idle'),
      IDLE_AFTER_SPEECH_MS
    );
  }

  /** Live mode: the speaker finished an utterance, the recording goes on. */
  private deliverUtterance(): void {
    const text = this.utterance.trim();
    this.utterance = '';
    this.heard = false;
    this.seenInterim = false;
    mark('stt.utterance', { words: text ? text.split(/\s+/).length : 0 });
    const info = this.takeUtteranceInfo();
    if (text) this.onutterance?.(text, info);
  }

  /**
   * A live session that broke after it was open: close it and open a new one with
   * the same microphone. False when this is not a live session, when it never
   * opened (a refused key is no break) or when it broke too often in a row.
   */
  private restartSession(reason: string): boolean {
    if (!this.continuous || this.closed || this.finishing || !this.opened) {
      return false;
    }
    if (this.restarts >= MAX_LIVE_RESTARTS) return false;
    this.restarts += 1;
    mark('stt.restart', { reason: reasonCode(reason), n: this.restarts });
    this.closeSession();
    void this.restartRun();
    return true;
  }

  private async restartRun(): Promise<void> {
    if (!this.startRecorder()) return;
    await this.connectSession(this.requestToken());
  }

  /** Closes the recorder and the websocket of the session (the microphone stays). */
  private closeSession(): void {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      try {
        this.recorder.stop();
      } catch {
        // already stopped
      }
      this.recorder = null;
    }
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
    this.socketReady = false;
    this.pending = [];
    this.utterance = '';
    this.resetUtteranceInfo();
  }

  /** Tell Soniox that the audio ends (an empty text frame), then wait for its last answer. */
  private finishRound(why: string): void {
    if (this.closed || this.finishing) return;
    this.finishing = true;
    mark('stt.end', {
      why,
      heard: this.heard,
      sentChunks: this.sentChunks,
      sentBytes: this.sentBytes,
      pendingChunks: this.pending.length,
      peak: this.peak,
    });
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
    this.stopLevel();
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

/**
 * Streams that Soniox may generate at the same time. The limit of the account is
 * 3 and counts over ALL connections (other applications on the same account use
 * it too), a connection allows 5. One stream stays in reserve.
 */
const MAX_ACTIVE_STREAMS = 2;
/** A connection that was warmed up but got no piece closes after this long. */
export const WARM_IDLE_MS = 20_000;
/** A stream that the limit of the account refused is tried once more after this long. */
export const LIMIT_RETRY_MS = 400;

interface TtsPiece {
  streamId: string;
  text: string;
  slot: ReturnType<OrderedPlayback['open']>;
  carry: Uint8Array | null;
  finished: boolean;
  retried: boolean;
}

interface TtsConnection {
  socket: WebSocketLike;
  config: Record<string, unknown>;
  sampleRate: number;
}

/** Soniox says "too many streams" with the code 429 or a type that names the limit. */
function isLimitError(code: number, type: string): boolean {
  return code === 429 || /concurrent|limit/i.test(type);
}

/**
 * Speech output with Soniox. One websocket per answer, one stream per piece
 * (a sentence): the pieces are generated at the same time (up to two) and
 * played in order, so there is no gap between two sentences. `warm()` opens the
 * connection before the first piece is there, so the voice does not start cold.
 * A failed piece rejects its promise, the chain then speaks the rest with the
 * next provider.
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
  private warmTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimers = new Set<ReturnType<typeof setTimeout>>();
  private dead = false;
  private seenAudio = false;

  constructor(private readonly deps: SonioxDeps) {
    this.playback = new OrderedPlayback(deps.audioContext());
  }

  /**
   * Opens the connection (key and websocket) ahead of the first piece. No
   * stream is opened: Soniox ends a stream without text after a few seconds.
   * Unused for WARM_IDLE_MS the connection closes again (the next piece opens it
   * anew, this is no failure).
   */
  warm(): void {
    if (this.dead || this.connection || this.pieces.size > 0) return;
    mark('tts.warm');
    void this.connect().catch(() => undefined);
    this.clearWarmTimer();
    this.warmTimer = setTimeout(() => this.idleClose(), WARM_IDLE_MS);
  }

  speak(text: string): Promise<void> {
    if (this.dead) {
      return Promise.reject(new ProviderUnavailableError('speaker-closed'));
    }
    this.clearWarmTimer();
    this.counter += 1;
    const piece: TtsPiece = {
      streamId: `hai-${this.counter}`,
      text,
      slot: this.playback.open(),
      carry: null,
      finished: false,
      retried: false,
    };
    this.pieces.set(piece.streamId, piece);
    this.waiting.push(piece);
    this.drain();
    return piece.slot.done;
  }

  cancel(): void {
    this.dead = true;
    this.clearWarmTimer();
    this.clearRetryTimers();
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
    this.clearWarmTimer();
    this.clearRetryTimers();
    const connection = this.connection;
    this.connection = null;
    this.stopKeepalive();
    if (connection) {
      void connection
        .then(({ socket }) => this.closeSocket(socket))
        .catch(() => undefined);
    }
  }

  /** The warmed connection got no piece: release it, the speaker stays usable. */
  private idleClose(): void {
    this.warmTimer = null;
    if (this.dead || this.pieces.size > 0) return;
    mark('tts.warm.idle-close');
    const connection = this.connection;
    this.connection = null;
    this.stopKeepalive();
    if (connection) {
      void connection
        .then(({ socket }) => this.closeSocket(socket))
        .catch(() => undefined);
    }
  }

  private clearWarmTimer(): void {
    if (this.warmTimer) clearTimeout(this.warmTimer);
    this.warmTimer = null;
  }

  private clearRetryTimers(): void {
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear();
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
      mark('tts.stream.start', { retried: piece.retried });
      this.send(connection.socket, {
        stream_id: piece.streamId,
        ...connection.config,
      });
      this.send(connection.socket, {
        text: piece.text,
        text_end: true,
        stream_id: piece.streamId,
      });
    } catch (error) {
      this.failAll(
        new ProviderUnavailableError(reasonOf(error, 'tts-connection'))
      );
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
    try {
      mark('tts.token.start');
      const grant = await withTimeout(
        this.deps.fetchToken('tts'),
        CONNECT_MS,
        'token-timeout'
      );
      mark('tts.token.end', { ok: true });
      mark('tts.ws.start');
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
      mark('tts.ws.open');
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
    } catch (error) {
      mark('tts.connect.fail', { reason: reasonOf(error, 'tts-connection') });
      throw error;
    }
  }

  private onMessage(data: unknown, sampleRate: number): void {
    const event = readTtsMessage(data);
    if (event.kind === 'unknown') return;
    if (event.kind === 'error') {
      mark('tts.error', { code: event.code, type: reasonCode(event.type) });
      const piece = event.stream ? this.pieces.get(event.stream) : undefined;
      const reason = `tts-error-${event.code}`;
      if (piece) {
        if (
          !piece.retried &&
          !piece.finished &&
          isLimitError(event.code, event.type)
        ) {
          this.requeue(piece);
          return;
        }
        this.release(piece);
        piece.slot.fail(new ProviderUnavailableError(reason));
      } else {
        this.failAll(new ProviderUnavailableError(reason));
      }
      return;
    }
    const piece = this.pieces.get(event.stream);
    if (!piece || piece.finished) return;
    if (event.kind === 'audio') {
      if (event.audio) {
        if (!this.seenAudio) {
          this.seenAudio = true;
          mark('tts.audio.first');
        }
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

  /**
   * The account has too many streams open (other applications use it as well):
   * the sentence goes to the front of the line once more, under a new stream id,
   * before the chain gives up on Soniox.
   */
  private requeue(piece: TtsPiece): void {
    piece.retried = true;
    this.pieces.delete(piece.streamId);
    this.counter += 1;
    piece.streamId = `hai-${this.counter}`;
    this.pieces.set(piece.streamId, piece);
    this.active = Math.max(0, this.active - 1);
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      if (this.dead || piece.finished) return;
      this.waiting.unshift(piece);
      this.drain();
    }, LIMIT_RETRY_MS);
    this.retryTimers.add(timer);
    // other sentences may use the freed place meanwhile
    this.drain();
  }

  /** The stream of a piece no longer counts as active. */
  private release(piece: TtsPiece): void {
    if (piece.finished) return;
    piece.finished = true;
    this.active = Math.max(0, this.active - 1);
    this.drain();
  }

  private failAll(error: Error): void {
    this.clearRetryTimers();
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
