/**
 * Shapes shared by the browser side of the voice assistant (recognition, speech
 * output, the chain of providers). Types only, no code, so every part can be
 * replaced by a double in a test.
 *
 * Two small interfaces make a provider replaceable:
 *   - recognition: the shape of the browser's SpeechRecognition (RecognitionLike).
 *     Soniox and Sokrates implement the same shape, so the conversation loop in
 *     useHaiVoice does not know which one listens.
 *   - speech output: SpeakerLike. The loop says the pieces of an answer, says
 *     when the last piece was said, and is told when everything was spoken.
 *
 * @module lib/hai/voice/client/types
 */

import type { VoiceFunction, VoiceProviderId } from '../settings';
import type { SimpleStorage } from '../speech';

export type { VoiceFunction, VoiceProviderId };

/**
 * What a live recognition knows about one finished utterance, beside its text:
 * the clock time (Date.now) of its first and last word and how sure the
 * recognition is (mean confidence of its words, 0 to 1). The loop judges the
 * utterance by it (loudness gate, confidence). Never the text of anybody.
 */
export interface UtteranceInfo {
  startAt?: number;
  endAt?: number;
  confidence?: number;
}

export interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

/**
 * The shape of SpeechRecognition that the loop uses. A provider that is not
 * available reports the error `provider-unavailable` (not a refused microphone,
 * that stays `not-allowed`), which the chain answers with the next provider.
 */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror:
    | ((event: {
        error: string;
        reason?: string;
        /** A live session that was open and then broke (not a failure at the start). */
        established?: boolean;
      }) => void)
    | null;
  onend: (() => void) | null;
  /**
   * The microphone is open and recording (the name of the browser's own event).
   * The cloud providers call it after the recorder started.
   */
  onaudiostart?: (() => void) | null;
  /** Loudness of the recording, 0 to 1, about ten times a second (cloud providers). */
  onlevel?: ((value: number) => void) | null;
  /**
   * Live mode (`continuous` and `live`): the recognition stays open over several
   * utterances. Every time the speaker finishes one (endpoint detection) this is
   * called with its text, the microphone stays open and `onend` does NOT come.
   */
  onutterance?: ((text: string, info?: UtteranceInfo) => void) | null;
  /** True while this recognition works in live mode (the provider can, and `continuous` was set). */
  readonly live?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface UtteranceLike {
  text: string;
  lang: string;
  voice: unknown;
  rate: number;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export interface SynthLike {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  getVoices(): Array<{ lang: string; localService?: boolean; name?: string }>;
}

export interface SpeakerHandlers {
  /** Called once, after `end()` and after the last piece was spoken (or given up). */
  onDone(): void;
}

/** Speech output of one answer. */
export interface SpeakerLike {
  /** Speak one more piece, after the pieces said before. */
  say(piece: string): void;
  /**
   * An answer is coming: get ready (open the connection of the provider) so the
   * first piece does not start cold. Optional, safe to call more than once.
   */
  warm?(): void;
  /** No more pieces will follow. */
  end(): void;
  /** Be quiet at once. No `onDone` after this. */
  cancel(): void;
}

export interface VoiceEnv {
  /** A recognition object and whether it works on the device only; null if there is none. */
  createRecognition(): Promise<{ rec: RecognitionLike; local: boolean } | null>;
  synth: SynthLike | null;
  makeUtterance(text: string): UtteranceLike;
  storage: SimpleStorage | null;
  now(): Date;
  /**
   * Speech output of the providers. Without it the loop speaks with `synth` and
   * `makeUtterance` (the browser). Returns null if nothing can speak.
   */
  createSpeaker?(handlers: SpeakerHandlers): SpeakerLike | null;
  /** Called inside a tap: lets the audio of a provider play on iOS and Safari. */
  unlockAudio?(): void;
  /** Called when a conversation starts: forget which providers failed before. */
  resetFallback?(): void;
  /** Fetch the short lived key of a cloud provider in advance (never throws). */
  prefetch?(purpose: 'stt' | 'stt-live' | 'tts' | 'server'): void;
  /** The recognition of this environment can stay open over several utterances (live mode). */
  live?: boolean;
  /**
   * The recognitions of this environment report `onaudiostart` when the microphone is
   * really open (the cloud providers do). Without it the loop counts the microphone as
   * open as soon as the recognition started.
   */
  micSignal?: boolean;
}

/** What GET /api/hai/voice/config answers. */
export interface VoiceConfig {
  provider: VoiceProviderId;
  /** Every provider that is ready for at least one function (also what the consent covers). */
  chain: VoiceProviderId[];
  /**
   * The order of the providers per function: listening (stt) and speaking (tts).
   * A provider that is disturbed in one function only is missing there and stays
   * in the other. Left out by an older server: `chain` then holds for both.
   */
  chains?: Record<VoiceFunction, VoiceProviderId[]>;
  region: 'eu' | 'us' | null;
}

/** A provider is not there (not set up, refused, not reachable): take the next one. */
export class ProviderUnavailableError extends Error {
  /** `reason` is a stable code (see fallback.ts), never a text of the person. */
  constructor(reason: string) {
    super(reason);
    this.name = 'ProviderUnavailableError';
  }
}
