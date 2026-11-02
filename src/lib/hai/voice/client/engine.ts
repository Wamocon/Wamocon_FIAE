/**
 * The chain of speech providers in the browser.
 *
 * The server says which providers are in charge and in which order
 * (GET /api/hai/voice/config: for example soniox, then haus, then browser), for
 * listening and for speaking apart: a provider that is disturbed in one function
 * stays in the chain of the other. This module builds the environment of the
 * conversation loop (VoiceEnv) from the browser's own environment and those
 * chains:
 *
 *  - Recognition: a round starts with the first provider of the chain. If it is
 *    not available (no key, refused, not reachable, the websocket breaks) the
 *    round starts again with the next one, up to the browser. A refused
 *    microphone is NOT a failure of the provider and ends the round at once.
 *  - Speech output: the pieces of an answer go to the first provider. If it fails
 *    in the middle, every piece that was not spoken yet is said by the next
 *    provider, in the same order.
 *  - A provider that failed is skipped for the rest of the conversation, in the
 *    function in which it failed (a failed recognition does not silence its
 *    speech output). The next conversation tries the chain from the top again
 *    (resetFallback).
 *
 * The providers themselves sit behind two small interfaces (RecognitionLike and
 * PieceEngine), so a test replaces them with doubles.
 *
 * @module lib/hai/voice/client/engine
 */

import type { VoiceFunction, VoiceProviderId } from '../settings';
import { browserPieceEngine, type PieceEngine } from './browserSpeech';
import { HausRecognition, HausSpeaker, type HausDeps } from './haus';
import { SonioxRecognition, SonioxSpeaker, type SonioxDeps } from './soniox';
import type {
  RecognitionLike,
  SpeakerHandlers,
  SpeakerLike,
  VoiceEnv,
} from './types';

export type VoiceClientDeps = SonioxDeps & HausDeps;

export interface ChainOptions {
  /** The browser's own environment: recognition, synth, storage, clock. */
  base: VoiceEnv;
  /** Providers in the order they are tried (already reduced to what the browser can do). */
  chain: VoiceProviderId[];
  /**
   * The order per function (listening and speaking), already reduced to what the
   * browser can do. Left out: `chain` holds for both functions.
   */
  chains?: Record<VoiceFunction, VoiceProviderId[]>;
  /** The cloud parts; null when the browser cannot use them. */
  deps: VoiceClientDeps | null;
  /** The provider that listens now (for the text of the settings). */
  onActiveProvider?: (id: VoiceProviderId) => void;
}

type CreatedRecognition = { rec: RecognitionLike; local: boolean };

// ============================================================================
// RECOGNITION
// ============================================================================

class ChainedRecognition implements RecognitionLike {
  lang = 'de-DE';
  continuous = false;
  interimResults = true;
  maxAlternatives = 1;
  processLocally?: boolean;
  onresult: RecognitionLike['onresult'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null;

  private inner: RecognitionLike | null = null;
  private generation = 0;
  private stopped = false;

  constructor(
    private readonly create: (
      id: VoiceProviderId
    ) => Promise<CreatedRecognition | null>,
    private readonly next: () => VoiceProviderId | null,
    private readonly markFailed: (id: VoiceProviderId) => void,
    private readonly announce: (id: VoiceProviderId) => void
  ) {}

  start(): void {
    this.stopped = false;
    void this.begin();
  }

  stop(): void {
    this.inner?.stop();
  }

  abort(): void {
    this.stopped = true;
    this.generation += 1;
    this.detach();
  }

  private detach(): void {
    const inner = this.inner;
    this.inner = null;
    if (!inner) return;
    inner.onresult = null;
    inner.onerror = null;
    inner.onend = null;
    try {
      inner.abort();
    } catch {
      // already stopped
    }
  }

  /** Starts a round with the first provider that is left, or reports that none is. */
  private async begin(): Promise<void> {
    const generation = ++this.generation;
    this.detach();
    for (;;) {
      const id = this.next();
      if (!id) {
        this.onerror?.({ error: 'failed' });
        return;
      }
      let made: CreatedRecognition | null = null;
      try {
        made = await this.create(id);
      } catch {
        made = null;
      }
      if (generation !== this.generation || this.stopped) return;
      if (!made) {
        this.markFailed(id);
        continue;
      }
      const rec = made.rec;
      rec.lang = this.lang;
      rec.continuous = this.continuous;
      rec.interimResults = this.interimResults;
      rec.maxAlternatives = this.maxAlternatives;
      rec.onresult = event => {
        if (generation === this.generation) this.onresult?.(event);
      };
      rec.onerror = event => {
        if (generation !== this.generation) return;
        if (event.error === 'provider-unavailable') {
          this.markFailed(id);
          void this.begin();
          return;
        }
        this.onerror?.(event);
      };
      rec.onend = () => {
        if (generation === this.generation) this.onend?.();
      };
      this.inner = rec;
      this.announce(id);
      try {
        rec.start();
      } catch {
        this.markFailed(id);
        this.detach();
        continue;
      }
      return;
    }
  }
}

// ============================================================================
// SPEECH OUTPUT
// ============================================================================

interface Entry {
  text: string;
  done: boolean;
}

class ChainedSpeaker implements SpeakerLike {
  private entries: Entry[] = [];
  private engine: PieceEngine | null = null;
  private generation = 0;
  private ended = false;
  private finished = false;

  constructor(
    private readonly handlers: SpeakerHandlers,
    private readonly makeEngine: () => PieceEngine | null,
    private readonly markFailed: (id: VoiceProviderId) => void
  ) {}

  say(piece: string): void {
    if (this.finished) return;
    const entry: Entry = { text: piece, done: false };
    this.entries.push(entry);
    if (!this.engine) {
      this.engine = this.makeEngine();
      if (!this.engine) {
        // nothing can speak: the answer stays readable in the chat
        entry.done = true;
        this.check();
        return;
      }
    }
    this.dispatch(entry);
  }

  end(): void {
    this.ended = true;
    this.check();
  }

  cancel(): void {
    this.finished = true;
    this.generation += 1;
    try {
      this.engine?.cancel();
    } catch {
      // nothing is speaking
    }
    this.engine = null;
  }

  private dispatch(entry: Entry): void {
    const engine = this.engine;
    if (!engine) return;
    const generation = this.generation;
    engine.speak(entry.text).then(
      () => {
        if (generation !== this.generation) return;
        entry.done = true;
        this.check();
      },
      () => {
        if (generation !== this.generation) return;
        this.failOver(engine);
      }
    );
  }

  /** The provider failed: the pieces that are not spoken yet go to the next one. */
  private failOver(failed: PieceEngine): void {
    this.markFailed(failed.id);
    this.generation += 1;
    try {
      failed.cancel();
    } catch {
      // already stopped
    }
    this.engine = this.makeEngine();
    const open = this.entries.filter(entry => !entry.done);
    if (!this.engine) {
      for (const entry of open) entry.done = true;
      this.check();
      return;
    }
    for (const entry of open) this.dispatch(entry);
  }

  private check(): void {
    if (this.finished || !this.ended) return;
    if (!this.entries.every(entry => entry.done)) return;
    this.finished = true;
    try {
      this.engine?.close();
    } catch {
      // nothing to release
    }
    this.handlers.onDone();
  }
}

// ============================================================================
// THE ENVIRONMENT OF THE LOOP
// ============================================================================

/**
 * The environment of the conversation loop for a chain of providers. With the
 * browser as the only provider the environment of the browser is returned
 * unchanged (nothing is wrapped).
 */
export function createVoiceEnv(options: ChainOptions): VoiceEnv {
  const { base, chain, onActiveProvider } = options;
  const listenChain = options.chains?.stt ?? chain;
  const speakChain = options.chains?.tts ?? chain;
  const cloud = (ids: VoiceProviderId[]) => ids.some(id => id !== 'browser');
  if (!options.deps || !(cloud(listenChain) || cloud(speakChain))) {
    return base;
  }
  const deps = options.deps;

  const failedListening = new Set<VoiceProviderId>();
  const failedSpeaking = new Set<VoiceProviderId>();

  const nextOf = (ids: VoiceProviderId[], failed: Set<VoiceProviderId>) => () =>
    ids.find(id => !failed.has(id)) ?? null;

  const createRecognition = async (id: VoiceProviderId) => {
    if (id === 'soniox') {
      return { rec: new SonioxRecognition(deps), local: false };
    }
    if (id === 'haus') return { rec: new HausRecognition(deps), local: false };
    return base.createRecognition();
  };

  const makeEngine = (): PieceEngine | null => {
    const id = speakChain.find(candidate => !failedSpeaking.has(candidate));
    if (id === 'soniox') return new SonioxSpeaker(deps);
    if (id === 'haus') return new HausSpeaker(deps);
    if (id === 'browser' && base.synth) return browserPieceEngine(base);
    return null;
  };

  return {
    ...base,
    async createRecognition() {
      const rec = new ChainedRecognition(
        createRecognition,
        nextOf(listenChain, failedListening),
        id => failedListening.add(id),
        id => onActiveProvider?.(id)
      );
      return { rec, local: false };
    },
    createSpeaker(handlers) {
      return new ChainedSpeaker(handlers, makeEngine, id =>
        failedSpeaking.add(id)
      );
    },
    unlockAudio() {
      try {
        void deps.audioContext().resume();
      } catch {
        // audio stays locked, the chain then falls back at the first piece
      }
    },
    resetFallback() {
      failedListening.clear();
      failedSpeaking.clear();
    },
  };
}
