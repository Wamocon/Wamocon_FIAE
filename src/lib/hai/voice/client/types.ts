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

import type { VoiceProviderId } from '../settings';
import type { SimpleStorage } from '../speech';

export type { VoiceProviderId };

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
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
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
}

/** What GET /api/hai/voice/config answers. */
export interface VoiceConfig {
  provider: VoiceProviderId;
  chain: VoiceProviderId[];
  region: 'eu' | 'us' | null;
}

/** A provider is not there (not set up, refused, not reachable): take the next one. */
export class ProviderUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ProviderUnavailableError';
  }
}
