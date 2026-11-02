/**
 * Sokrates ("Haus") in the browser: speech recognition and speech output through
 * the routes of this application (/api/hai/voice/haus/transcribe and /speech),
 * which pass the audio and the text on to the own server.
 *
 * Recognition: Sokrates transcribes a whole utterance after it ended, so the
 * browser records until the speaker is quiet (a simple detector for the end of
 * speech, see audio.ts), sends the recording and gets the text. There are no
 * interim results. Speech output: one sentence per call, the audio comes back as
 * WAV, is decoded and played in order.
 *
 * What comes in from outside (microphone, recorder, audio, the two calls) is
 * passed in through HausDeps, so tests replace it.
 *
 * @module lib/hai/voice/client/haus
 */

import {
  DEFAULT_VOICE_ACTIVITY,
  Limiter,
  OrderedPlayback,
  VoiceActivity,
  rmsOf,
  type AudioContextLike,
  type VoiceActivityOptions,
} from './audio';
import type { PieceEngine } from './browserSpeech';
import type { MediaStreamLike, RecorderLike } from './soniox';
import { ProviderUnavailableError, type RecognitionLike } from './types';
import { recognitionEvent } from './soniox';

export interface HausDeps {
  /** The recognized text of one utterance. Throws ProviderUnavailableError. */
  transcribe(audio: Blob): Promise<string>;
  /** The audio (WAV) of one sentence. Throws ProviderUnavailableError. */
  speak(text: string): Promise<ArrayBuffer>;
  getUserMedia(): Promise<MediaStreamLike>;
  createRecorder(stream: MediaStreamLike): RecorderLike;
  audioContext(): AudioContextLike;
}

const POLL_MS = 80;

function isPermissionError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'NotAllowedError' || name === 'SecurityError';
}

/**
 * Speech recognition on Sokrates, in the shape of SpeechRecognition. One
 * `start()` is one round: record until the speaker is quiet, transcribe, deliver
 * the text as a final result, then `onend`. Silence gives `onend` without a
 * result (the loop counts a silent round).
 */
export class HausRecognition implements RecognitionLike {
  lang = 'de-DE';
  continuous = false;
  interimResults = true;
  maxAlternatives = 1;
  onresult: RecognitionLike['onresult'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null;

  private closed = false;
  private stream: MediaStreamLike | null = null;
  private recorder: RecorderLike | null = null;
  private chunks: Blob[] = [];
  private poll: ReturnType<typeof setInterval> | null = null;
  private source: { disconnect?(): void } | null = null;
  private mimeType = 'audio/webm';

  constructor(
    private readonly deps: HausDeps,
    private readonly activity: VoiceActivityOptions = DEFAULT_VOICE_ACTIVITY,
    private readonly now: () => number = () => Date.now()
  ) {}

  start(): void {
    void this.run();
  }

  /** Ends the recording now and transcribes what there is. */
  stop(): void {
    this.finishRecording(true);
  }

  abort(): void {
    this.cleanup();
  }

  private fail(
    error: 'not-allowed' | 'provider-unavailable' | 'audio-capture'
  ) {
    if (this.closed) return;
    this.cleanup();
    this.onerror?.({ error });
  }

  private async run(): Promise<void> {
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
    let analyser: ReturnType<NonNullable<AudioContextLike['createAnalyser']>>;
    try {
      const ctx = this.deps.audioContext();
      if (!ctx.createMediaStreamSource || !ctx.createAnalyser) {
        throw new Error('no analyser');
      }
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      this.source = ctx.createMediaStreamSource(this.stream);
      (this.source as { connect(node: unknown): void }).connect(analyser);
      const recorder = this.deps.createRecorder(this.stream);
      if (recorder.mimeType) this.mimeType = recorder.mimeType;
      recorder.ondataavailable = event => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.start(250);
      this.recorder = recorder;
    } catch {
      this.fail('audio-capture');
      return;
    }
    const detector = new VoiceActivity(this.activity);
    const block = new Float32Array(analyser.fftSize);
    this.poll = setInterval(() => {
      analyser.getFloatTimeDomainData(block);
      const verdict = detector.feed(rmsOf(block), this.now());
      if (verdict === 'speech-ended') this.finishRecording(true);
      else if (verdict === 'no-speech') this.finishRecording(false);
    }, POLL_MS);
  }

  /** Stops the recording. With speech: send it. Without: end the round silently. */
  private finishRecording(withSpeech: boolean): void {
    if (this.closed) return;
    const recorder = this.recorder;
    this.recorder = null;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    if (!recorder) {
      this.cleanup();
      this.onend?.();
      return;
    }
    const complete = () => {
      if (this.closed) return;
      const chunks = this.chunks;
      this.releaseStream();
      if (!withSpeech || chunks.length === 0) {
        this.cleanup();
        this.onend?.();
        return;
      }
      void this.send(new Blob(chunks, { type: this.mimeType }));
    };
    recorder.ondataavailable = event => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onstop = complete;
    try {
      recorder.stop();
    } catch {
      complete();
    }
  }

  private async send(audio: Blob): Promise<void> {
    let text: string;
    try {
      text = (await this.deps.transcribe(audio)).trim();
    } catch {
      this.fail('provider-unavailable');
      return;
    }
    if (this.closed) return;
    const event = recognitionEvent(text, '');
    if (event) this.onresult?.(event);
    this.cleanup();
    this.onend?.();
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
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      try {
        this.recorder.stop();
      } catch {
        // already stopped
      }
    }
    this.recorder = null;
    try {
      this.source?.disconnect?.();
    } catch {
      // already disconnected
    }
    this.source = null;
    this.releaseStream();
    this.chunks = [];
  }
}

/** Sentences generated at the same time on Sokrates (it is one server for everybody). */
const MAX_PARALLEL_SENTENCES = 2;

/**
 * Speech output on Sokrates: the sentences are fetched at the same time (two at
 * once) and played in order. A failed sentence rejects its promise, the chain
 * then speaks the rest with the next provider.
 */
export class HausSpeaker implements PieceEngine {
  readonly id = 'haus' as const;
  private playback: OrderedPlayback;
  private limiter = new Limiter(MAX_PARALLEL_SENTENCES);
  private dead = false;

  constructor(private readonly deps: HausDeps) {
    this.playback = new OrderedPlayback(deps.audioContext());
  }

  speak(text: string): Promise<void> {
    if (this.dead) {
      return Promise.reject(new ProviderUnavailableError('speaker-closed'));
    }
    const slot = this.playback.open();
    void this.limiter
      .run(async () => {
        if (this.dead) return;
        const wav = await this.deps.speak(text);
        if (this.dead) return;
        const buffer = await this.deps.audioContext().decodeAudioData(wav);
        slot.push(buffer);
        slot.finish();
      })
      .catch(error => {
        slot.fail(
          error instanceof Error
            ? error
            : new ProviderUnavailableError('haus-speech')
        );
      });
    return slot.done;
  }

  cancel(): void {
    this.dead = true;
    this.playback.cancel();
  }

  close(): void {
    this.dead = true;
  }
}
