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
import {
  categorizeReason,
  isPermanentReason,
  reasonCode,
  type ProviderFallback,
} from './fallback';
import { HausRecognition, HausSpeaker, type HausDeps } from './haus';
import { SonioxRecognition, SonioxSpeaker, type SonioxDeps } from './soniox';
import { mark } from './trace';
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
  /**
   * A function (listening or speaking) was taken over by another provider, with
   * the reason. The loop shows it, so a silent fallback is never invisible.
   */
  onFallback?: (fallback: ProviderFallback) => void;
  /**
   * Wait before the one retry of a provider that failed (default 500 ms). `null`
   * switches the retry off (the provider is given up at the first failure).
   */
  retryDelayMs?: number | null;
}

/** A provider that failed gets one more try after this long, before the next one takes over. */
export const RETRY_DELAY_MS = 500;

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
  onaudiostart: RecognitionLike['onaudiostart'] = null;
  onlevel: RecognitionLike['onlevel'] = null;
  onutterance: RecognitionLike['onutterance'] = null;

  /** The inner recognition works in live mode (the head of the chain can, and it was asked to). */
  get live(): boolean {
    return this.inner?.live === true;
  }

  private inner: RecognitionLike | null = null;
  private generation = 0;
  private stopped = false;
  // a provider gets one more try per round before the next one takes over
  private retried = new Set<VoiceProviderId>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly create: (
      id: VoiceProviderId
    ) => Promise<CreatedRecognition | null>,
    private readonly next: () => VoiceProviderId | null,
    private readonly markFailed: (id: VoiceProviderId, reason: string) => void,
    private readonly announce: (id: VoiceProviderId) => void,
    private readonly retryDelayMs: number | null = RETRY_DELAY_MS
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
    this.clearRetry();
    this.detach();
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private detach(): void {
    const inner = this.inner;
    this.inner = null;
    if (!inner) return;
    inner.onresult = null;
    inner.onerror = null;
    inner.onend = null;
    inner.onaudiostart = null;
    inner.onlevel = null;
    inner.onutterance = null;
    try {
      inner.abort();
    } catch {
      // already stopped
    }
  }

  /** Starts a round with the first provider that is left, or reports that none is. */
  private async begin(): Promise<void> {
    const generation = ++this.generation;
    this.clearRetry();
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
        this.markFailed(id, 'not-available');
        continue;
      }
      const rec = made.rec;
      rec.lang = this.lang;
      // only Soniox can stay open over several utterances (live mode)
      rec.continuous = this.continuous && id === 'soniox';
      rec.interimResults = this.interimResults;
      rec.maxAlternatives = this.maxAlternatives;
      rec.onresult = event => {
        if (generation === this.generation) this.onresult?.(event);
      };
      rec.onaudiostart = () => {
        if (generation === this.generation) this.onaudiostart?.();
      };
      rec.onlevel = value => {
        if (generation === this.generation) this.onlevel?.(value);
      };
      rec.onutterance = text => {
        if (generation === this.generation) this.onutterance?.(text);
      };
      rec.onerror = event => {
        if (generation !== this.generation) return;
        if (event.error === 'provider-unavailable') {
          if (
            this.retryDelayMs !== null &&
            !this.retried.has(id) &&
            !isPermanentReason(event.reason)
          ) {
            // a short break of the connection: one more try, then the next provider
            this.retried.add(id);
            mark('stt.retry', {
              provider: id,
              reason: reasonCode(event.reason),
            });
            this.detach();
            this.retryTimer = setTimeout(() => {
              this.retryTimer = null;
              if (!this.stopped && generation === this.generation) {
                void this.begin();
              }
            }, this.retryDelayMs);
            return;
          }
          this.markFailed(id, event.reason ?? 'provider-unavailable');
          if (event.established) {
            // a live session that ran and broke: the loop starts the next round itself
            // (it may be speaking now, the microphone must not open under its voice)
            this.detach();
            this.onend?.();
            return;
          }
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
        this.markFailed(id, 'start-failed');
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
  /** The generation of the engine the piece was handed to (-1: not yet). */
  sent: number;
}

class ChainedSpeaker implements SpeakerLike {
  private entries: Entry[] = [];
  private engine: PieceEngine | null = null;
  private generation = 0;
  private ended = false;
  private finished = false;
  // a provider gets one more try per answer before the next one takes over
  private retried = new Set<VoiceProviderId>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly handlers: SpeakerHandlers,
    private readonly makeEngine: () => PieceEngine | null,
    private readonly markFailed: (id: VoiceProviderId) => void,
    private readonly report: (
      from: VoiceProviderId,
      to: VoiceProviderId | null,
      reason: string
    ) => void,
    private readonly retryDelayMs: number | null = RETRY_DELAY_MS
  ) {}

  /** An answer is coming: let the provider open its connection already. */
  warm(): void {
    if (this.finished) return;
    if (!this.engine) this.engine = this.makeEngine();
    try {
      this.engine?.warm?.();
    } catch {
      // warming up is optional
    }
  }

  say(piece: string): void {
    if (this.finished) return;
    const entry: Entry = { text: piece, done: false, sent: -1 };
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
    this.clearRetry();
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
    entry.sent = generation;
    engine.speak(entry.text).then(
      () => {
        if (generation !== this.generation) return;
        entry.done = true;
        this.check();
      },
      error => {
        if (generation !== this.generation) return;
        this.failOver(engine, (error as { message?: string } | null)?.message);
      }
    );
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /**
   * The provider failed. A short break gets one more try with the same
   * provider (after a moment, with a new connection); only the second failure,
   * or one that will not go away, hands the pieces that are not spoken yet to
   * the next provider.
   */
  private failOver(failed: PieceEngine, reason?: string): void {
    this.generation += 1;
    try {
      failed.cancel();
    } catch {
      // already stopped
    }
    if (
      this.retryDelayMs !== null &&
      failed.id !== 'browser' &&
      !this.retried.has(failed.id) &&
      !isPermanentReason(reason)
    ) {
      this.retried.add(failed.id);
      mark('tts.retry', { provider: failed.id, reason: reasonCode(reason) });
      this.engine = null;
      this.clearRetry();
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (this.finished) return;
        if (!this.engine) this.engine = this.makeEngine();
        this.handOver(false);
      }, this.retryDelayMs);
      return;
    }
    this.markFailed(failed.id);
    this.engine = this.makeEngine();
    this.report(failed.id, this.engine?.id ?? null, reason ?? 'unknown');
    this.handOver(true);
  }

  /** Gives the pieces that are not spoken yet to the engine (or gives up on speaking). */
  private handOver(all: boolean): void {
    const open = this.entries.filter(
      entry => !entry.done && (all || entry.sent !== this.generation)
    );
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
    this.clearRetry();
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
  const retryDelayMs =
    options.retryDelayMs === undefined ? RETRY_DELAY_MS : options.retryDelayMs;

  const nextOf = (ids: VoiceProviderId[], failed: Set<VoiceProviderId>) => () =>
    ids.find(id => !failed.has(id)) ?? null;

  // a function runs on another provider now: to the measuring points and the loop
  const reportFallback = (
    fn: VoiceFunction,
    from: VoiceProviderId,
    to: VoiceProviderId | null,
    reason: string
  ) => {
    const fallback: ProviderFallback = {
      function: fn,
      from,
      to,
      reason: categorizeReason(reason),
      code: reasonCode(reason),
    };
    mark('fallback', {
      function: fn,
      from,
      to: to ?? 'none',
      reason: fallback.reason,
      code: fallback.code,
    });
    options.onFallback?.(fallback);
  };

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
    live: listenChain.includes('soniox'),
    async createRecognition() {
      const nextListening = nextOf(listenChain, failedListening);
      const rec = new ChainedRecognition(
        createRecognition,
        nextListening,
        (id, reason) => {
          failedListening.add(id);
          reportFallback('stt', id, nextListening(), reason);
        },
        id => {
          mark('stt.provider', { provider: id });
          onActiveProvider?.(id);
        },
        retryDelayMs
      );
      return { rec, local: false };
    },
    createSpeaker(handlers) {
      return new ChainedSpeaker(
        handlers,
        makeEngine,
        id => failedSpeaking.add(id),
        (from, to, reason) => reportFallback('tts', from, to, reason),
        retryDelayMs
      );
    },
    prefetch(purpose) {
      if (purpose === 'server') {
        // the chat and the search run on the own server: warm the way there
        try {
          deps.warmServer?.();
        } catch {
          // the chat call asks itself
        }
        return;
      }
      const listening = purpose !== 'tts';
      const ids = listening ? listenChain : speakChain;
      const failed = listening ? failedListening : failedSpeaking;
      if (nextOf(ids, failed)() !== 'soniox') return;
      try {
        deps.prefetchToken?.(purpose);
      } catch {
        // the real call asks again
      }
    },
    unlockAudio() {
      try {
        const ctx = deps.audioContext();
        void Promise.resolve(ctx.resume()).then(
          () => mark('audio.unlock', { ctx: ctx.state ?? 'unknown' }),
          () => mark('audio.unlock', { ctx: 'error' })
        );
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
