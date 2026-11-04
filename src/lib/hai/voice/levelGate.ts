/**
 * Loudness gate of the voice mode: only the voice of the person counts, not the
 * quiet talk in the room.
 *
 * Why: the recognition (Soniox) transcribes speech that is 40 dB under a normal
 * voice without any trouble (measured 04.11.2026, docs/hai-sprachmodus-recherche.md),
 * and it reports a high confidence for it. So nothing in the recognition tells a
 * far voice from the near one. What does: the loudness of the recording. The
 * person speaks into the microphone, the others are further away and quieter.
 *
 * How: the recognition reports the loudness of the recording about ten times a
 * second (0 to 1, the RMS times five, see SonioxRecognition). The gate keeps the
 * last half minute of that. For every finished utterance it takes the samples
 * of the time window of its words and asks two things:
 *   - the MEAN of the window must reach the threshold,
 *   - the PEAK of the window must reach the threshold times `peakFactor`
 *     (a short burst of a background laugh does not make a voice).
 * The threshold is ADAPTIVE:
 *   ambient    the quiet level of the room: the 20th percentile of the last half
 *              minute (pauses between words are most of the time)
 *   reference  the level of the person: the upper median of the means of the
 *              last utterances that were accepted (the person's own voice, near)
 *   threshold  ambient + share * (reference - ambient), at least ambient times a
 *              factor, then clamped to [min, max]. Before the first accepted
 *              utterance there is no reference: only the lower bound counts.
 * The clamp is the safety net in both directions: the lower bound keeps the room
 * out even when nothing was heard yet, the upper bound keeps a loud first
 * utterance (or a shout) from locking the person out.
 *
 * `strict` asks for a higher share of the person's own level ("only my voice,
 * loud and near"). It also needs a higher confidence of the recognition.
 *
 * Confidence: a mean confidence under `confidenceMin` discards an utterance
 * (words the recognition is not sure about). It does NOT separate near from far
 * voices (the confidence stays about 0.98 for a voice 40 dB down), it catches
 * mumbling and noise that came out as words.
 *
 * Nothing here knows the text. A discarded utterance leaves only its numbers.
 *
 * @module lib/hai/voice/levelGate
 */

export type Sensitivity = 'normal' | 'strict';

export interface GateProfile {
  /** Lower bound of the threshold (level 0 to 1: RMS times five). */
  min: number;
  /** Upper bound of the threshold. */
  max: number;
  /** The share of the way from the room level to the person's level. */
  share: number;
  /** The threshold is at least this many times the room level. */
  ambientFactor: number;
  /** The peak of an utterance must reach the threshold times this. */
  peakFactor: number;
  /**
   * A provisional text (an interruption, a signal word, the text on the display)
   * has no finished window yet: the peak of the last moment must reach the threshold
   * times this. Larger than `peakFactor` because the threshold is a MEAN over words
   * and pauses, and a speech peak is about two and a half times its mean (lab
   * measurement 04.11.2026: a voice 14 dB down interrupted with 1.5).
   */
  interimPeakFactor: number;
  /** Mean confidence of the recognition under this discards the utterance. */
  confidenceMin: number;
}

/**
 * The two settings. Levels are RMS times five (the unit of `onlevel`): 0.04 is an
 * RMS of 0.008 (about -42 dBFS), a person near a laptop microphone speaks with
 * 0.03 to 0.08 (level 0.15 to 0.4), the voices of a room at 3 to 5 m with a
 * tenth of that. `normal` = the share is 20 percent of the person's level (14
 * dB below), `strict` = 45 percent (7 dB below).
 */
export const GATE_PROFILES: Readonly<Record<Sensitivity, GateProfile>> =
  Object.freeze({
    normal: {
      min: 0.04,
      max: 0.2,
      share: 0.2,
      ambientFactor: 3,
      peakFactor: 1.5,
      interimPeakFactor: 2.5,
      confidenceMin: 0.6,
    },
    strict: {
      min: 0.08,
      max: 0.3,
      share: 0.45,
      ambientFactor: 4,
      peakFactor: 1.5,
      interimPeakFactor: 2.5,
      confidenceMin: 0.75,
    },
  });

/** How long the samples are kept. */
export const LEVEL_HISTORY_MS = 30_000;
/** Fewer samples than this: the room level is not known yet (counts as 0). */
export const MIN_AMBIENT_SAMPLES = 20;
/** The room level is this part of the samples from below (the pauses). */
export const AMBIENT_PERCENTILE = 0.2;
/** How many accepted utterances make the reference. */
export const REFERENCE_UTTERANCES = 7;
/** The reference is the upper median: this part of the sorted means. */
export const REFERENCE_QUANTILE = 0.6;
/** The window of an utterance gets this much room on both sides (clock skew). */
export const WINDOW_PADDING_MS = 150;
/** The window reaches this much past the last word (the recording lags the words). */
export const END_PADDING_MS = 450;
/** The window of an utterance is at least this long, counted from its first word. */
export const MIN_SPAN_MS = 1_200;
/** An utterance whose words span less than this is a single word: its peak decides. */
export const SHORT_WINDOW_MS = 800;
/** A single word counts when its peak reaches the threshold times this. */
export const SHORT_PEAK_FACTOR = 3;
/** An utterance without a time window is judged on this much of the recent past. */
export const FALLBACK_WINDOW_MS = 2_500;
/** A provisional text is judged on this much of the recent past. */
export const RECENT_WINDOW_MS = 1_200;

export interface UtteranceWindow {
  /** Clock time (ms) of the first word, if the provider knows it. */
  startAt?: number;
  /** Clock time (ms) of the last word, if the provider knows it. */
  endAt?: number;
  /** Mean confidence of the recognition for this utterance (0 to 1), if known. */
  confidence?: number;
}

export type GateVerdict =
  | {
      ok: true;
      /** No sample was in the window: the gate could not judge (the utterance counts). */
      judged: boolean;
      mean: number;
      peak: number;
      threshold: number;
      confidence: number | null;
    }
  | {
      ok: false;
      why: 'quiet' | 'confidence';
      mean: number;
      peak: number;
      threshold: number;
      confidence: number | null;
    };

interface Sample {
  at: number;
  level: number;
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

export class LevelGate {
  private samples: Sample[] = [];
  private accepted: number[] = [];

  constructor(public sensitivity: Sensitivity = 'normal') {}

  get profile(): GateProfile {
    return GATE_PROFILES[this.sensitivity];
  }

  setSensitivity(sensitivity: Sensitivity): void {
    this.sensitivity = sensitivity;
  }

  /** A new conversation: forget the levels and the person's reference. */
  reset(): void {
    this.samples = [];
    this.accepted = [];
  }

  /** A loudness sample of the recording (0 to 1) at the clock time `at`. */
  push(level: number, at: number): void {
    if (!Number.isFinite(level)) return;
    this.samples.push({ at, level: clamp(level, 0, 1) });
    const oldest = at - LEVEL_HISTORY_MS;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].at < oldest) {
      drop += 1;
    }
    if (drop > 0) this.samples.splice(0, drop);
  }

  /** The quiet level of the room (0 while it is not known). */
  ambient(): number {
    if (this.samples.length < MIN_AMBIENT_SAMPLES) return 0;
    const sorted = this.samples.map(s => s.level).sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * AMBIENT_PERCENTILE)];
  }

  /** The level of the person's own voice (null before the first accepted utterance). */
  reference(): number | null {
    if (this.accepted.length === 0) return null;
    const sorted = [...this.accepted].sort((a, b) => a - b);
    return sorted[Math.ceil((sorted.length - 1) * REFERENCE_QUANTILE)];
  }

  /** The mean level an utterance has to reach right now. */
  threshold(): number {
    const { min, max, share, ambientFactor } = this.profile;
    const ambient = this.ambient();
    const reference = this.reference();
    const floor = Math.max(min, ambient * ambientFactor);
    if (reference === null) return clamp(floor, min, max);
    const adaptive = ambient + share * Math.max(0, reference - ambient);
    return clamp(Math.max(floor, adaptive), min, max);
  }

  /** An utterance that counted: its mean level feeds the person's reference. */
  confirm(mean: number): void {
    if (!Number.isFinite(mean) || mean <= 0) return;
    this.accepted.push(mean);
    if (this.accepted.length > REFERENCE_UTTERANCES) this.accepted.shift();
  }

  /** Peak and mean of the samples in [from, to], or null when there are none. */
  window(from: number, to: number): { peak: number; mean: number } | null {
    let peak = 0;
    let sum = 0;
    let count = 0;
    for (const sample of this.samples) {
      if (sample.at < from || sample.at > to) continue;
      peak = Math.max(peak, sample.level);
      sum += sample.level;
      count += 1;
    }
    return count === 0 ? null : { peak, mean: sum / count };
  }

  /**
   * Is somebody speaking loud enough right now? Used for a provisional text
   * (an interruption, a signal word, the text shown): the peak of the last
   * moment must reach the threshold times the interim peak factor. True when nothing
   * was measured (no judgement possible).
   */
  passesNow(at: number): boolean {
    const recent = this.window(at - RECENT_WINDOW_MS, at);
    if (!recent) return true;
    const threshold = this.threshold();
    return (
      recent.mean >= threshold &&
      recent.peak >= threshold * this.profile.interimPeakFactor
    );
  }

  /** Judges a finished utterance by its time window and its confidence. */
  evaluate(utterance: UtteranceWindow, at: number): GateVerdict {
    const threshold = this.threshold();
    const confidence =
      typeof utterance.confidence === 'number' &&
      Number.isFinite(utterance.confidence)
        ? utterance.confidence
        : null;
    const endAt = utterance.endAt ?? at;
    const startAt = utterance.startAt ?? endAt - FALLBACK_WINDOW_MS;
    // Measured 04.11.2026 (docs/hai-sprachmodus-recherche.md, section 10): the time of the
    // words is a rough guide. The loud part of the recording starts 100 to 350 ms after
    // the claimed start, and a single word comes with a window of 60 to 120 ms. So the
    // window reaches further to the end (the recording lags the words) and is at least
    // MIN_SPAN_MS long.
    const short = endAt - startAt < SHORT_WINDOW_MS;
    const measured = this.window(
      startAt - WINDOW_PADDING_MS,
      Math.max(endAt, startAt + MIN_SPAN_MS) + END_PADDING_MS
    );
    if (measured) {
      const { mean, peak } = measured;
      // a single word has no stable mean (a word and a long pause): its peak decides
      const quiet = short
        ? peak < threshold * SHORT_PEAK_FACTOR
        : mean < threshold || peak < threshold * this.profile.peakFactor;
      if (quiet) {
        return { ok: false, why: 'quiet', mean, peak, threshold, confidence };
      }
    }
    if (confidence !== null && confidence < this.profile.confidenceMin) {
      return {
        ok: false,
        why: 'confidence',
        mean: measured?.mean ?? 0,
        peak: measured?.peak ?? 0,
        threshold,
        confidence,
      };
    }
    return {
      ok: true,
      judged: measured !== null,
      mean: measured?.mean ?? 0,
      peak: measured?.peak ?? 0,
      threshold,
      confidence,
    };
  }
}
