/**
 * Speech output with the browser (speechSynthesis), in the two forms the
 * conversation loop needs:
 *   - createBrowserSpeaker: the speaker of the loop when the browser is the
 *     only provider (synchronous, exactly the behavior before the providers),
 *   - browserPieceEngine: one step of the chain of speech output, used when
 *     the browser is the fallback of Soniox or Sokrates.
 *
 * @module lib/hai/voice/client/browserSpeech
 */

import type {
  SpeakerHandlers,
  SpeakerLike,
  SynthLike,
  VoiceEnv,
} from './types';

export const SPEECH_LANG = 'de-DE';

/** A German voice of the browser: a local one first, then any German one. */
export function pickGermanVoice(synth: SynthLike): unknown {
  const voices = synth.getVoices();
  return (
    voices.find(v => v.lang === SPEECH_LANG && v.localService) ??
    voices.find(v => v.lang === SPEECH_LANG) ??
    voices.find(v => v.lang.startsWith('de')) ??
    null
  );
}

/**
 * The speaker for the browser alone. Needs `env.synth`. `onDone` comes after
 * `end()` once every piece has ended or failed (a failed piece counts as spoken,
 * the answer stays readable in the chat).
 */
export function createBrowserSpeaker(
  env: VoiceEnv,
  handlers: SpeakerHandlers
): SpeakerLike | null {
  const synth = env.synth;
  if (!synth) return null;
  let pending = 0;
  let ended = false;
  let done = false;

  const check = () => {
    if (pending === 0 && ended && !done) {
      done = true;
      handlers.onDone();
    }
  };

  return {
    say(piece) {
      if (done) return;
      const utterance = env.makeUtterance(piece);
      utterance.lang = SPEECH_LANG;
      utterance.rate = 1;
      utterance.voice = pickGermanVoice(synth);
      const spoken = () => {
        pending = Math.max(0, pending - 1);
        check();
      };
      utterance.onend = spoken;
      utterance.onerror = spoken;
      pending += 1;
      synth.speak(utterance);
    },
    end() {
      ended = true;
      check();
    },
    cancel() {
      done = true;
      pending = 0;
      try {
        synth.cancel();
      } catch {
        // nothing is speaking
      }
    },
  };
}

/**
 * One step of the chain of speech output: speaks a piece and answers when it
 * is spoken. The browser never fails a piece (an error ends it like an end).
 */
export interface PieceEngine {
  readonly id: 'soniox' | 'haus' | 'browser';
  /** Speak the piece after the pieces before. Resolves when it was spoken, rejects when the provider failed. */
  speak(text: string): Promise<void>;
  /**
   * An answer is coming: open the connection already (optional). Must not start
   * anything audible and must be safe to call more than once.
   */
  warm?(): void;
  /** Stop everything at once. */
  cancel(): void;
  /** Everything was spoken: release connections. */
  close(): void;
}

export function browserPieceEngine(env: VoiceEnv): PieceEngine {
  return {
    id: 'browser',
    speak(text) {
      const synth = env.synth;
      if (!synth) return Promise.resolve();
      return new Promise<void>(resolve => {
        const utterance = env.makeUtterance(text);
        utterance.lang = SPEECH_LANG;
        utterance.rate = 1;
        utterance.voice = pickGermanVoice(synth);
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        synth.speak(utterance);
      });
    },
    cancel() {
      try {
        env.synth?.cancel();
      } catch {
        // nothing is speaking
      }
    },
    close() {
      // nothing to release
    },
  };
}
