/**
 * Loudness gate of the voice mode: only the voice of the person counts, not the
 * quiet talk in the room. And it never locks the person out.
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
 *
 * The threshold is RELATIVE to the person, not absolute (05.11.2026):
 *   ambient    the quiet level of the room: the 20th percentile of the last half
 *              minute (pauses between words are most of the time)
 *   reference  the level of the person: set by the calibration at the start
 *              ("Hallo HAI", `calibrate`) and then the upper median of the means
 *              of the last utterances that were accepted
 *   threshold  ambient + share * (reference - ambient), at least three times the
 *              room level (the protection in a loud room, as measured for the
 *              first gate), but at most `referenceCap` (75 percent) of the
 *              reference: the room factor can never put the threshold above the
 *              voice of the calibrated person, so a quiet microphone or a loud room
 *              alone never locks the person out. Then clamped to [min, max].
 *              After a calibration the reference never falls under 70 percent of the
 *              calibrated one (quiet fragments of a talk in the room that got
 *              through would otherwise pull it down).
 * Without a reference (the calibration was skipped or failed, nothing accepted
 * yet) only a very low safety limit counts (`min`, RMS 0.0024) and the room
 * level times a small factor. A microphone with a low gain (the automatic gain
 * is off since 04.11.2026) therefore does not lock the person out. What the gate
 * cannot tell without a reference is a quiet person from a far voice: that is
 * why the loop offers a way out after two discarded utterances (see
 * useHaiVoice) and why the setting "off" exists.
 *
 * `strict` asks for a higher share of the person's own level ("only my voice,
 * loud and near"). It also needs a higher confidence of the recognition. `off`
 * switches the level gate and the confidence limit off (signal words and the echo
 * filter of the loop stay).
 *
 * Confidence: a mean confidence under `confidenceMin` discards an utterance
 * (words the recognition is not sure about), UNLESS the recording is loud: a low
 * confidence at a high level is an overdriven microphone or shouting, not
 * mumbling. Then the utterance counts and the loop only shows the hint to speak
 * softer (`hint`). The confidence does NOT separate near from far voices (it
 * stays about 0.98 for a voice 40 dB down).
 *
 * Nothing here knows the text. A discarded utterance leaves only its numbers.
 *
 * @module lib/hai/voice/levelGate
 */

export type Sensitivity = 'off' | 'normal' | 'strict';

export interface GateProfile {
  /**
   * Safety limit of the threshold without a reference (level 0 to 1: RMS times
   * five). 0.012 is an RMS of 0.0024 (about -52 dBFS): under it nobody speaks at
   * the microphone.
   */
  min: number;
  /** The safety limit once a reference of the person is known (RMS 0.0012 is a noise floor). */
  minWithReference: number;
  /** Upper bound of the threshold. */
  max: number;
  /** The share of the way from the room level to the person's level. */
  share: number;
  /** Without a reference: the threshold is at least this many times the room level. */
  ambientFactor: number;
  /** With a reference: the threshold is at least this many times the room level. */
  roomFactor: number;
  /** With a reference: the threshold is at most this part of the reference. */
  referenceCap: number;
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
 * The settings. Levels are RMS times five (the unit of `onlevel`): a person near
 * a laptop microphone speaks with 0.03 to 0.08 (level 0.15 to 0.4), the voices of
 * a room at 3 to 5 m with a tenth of that. `normal` = the share is 20 percent of
 * the person's level (14 dB below), `strict` = 45 percent (7 dB below). `off`
 * keeps the numbers of `normal` (they are still measured for the diagnosis).
 */
export const GATE_PROFILES: Readonly<Record<Sensitivity, GateProfile>> =
  Object.freeze({
    off: {
      min: 0.012,
      minWithReference: 0.006,
      max: 0.2,
      share: 0.2,
      ambientFactor: 2,
      roomFactor: 3,
      referenceCap: 0.75,
      peakFactor: 1.5,
      interimPeakFactor: 2.5,
      confidenceMin: 0.6,
    },
    normal: {
      min: 0.012,
      minWithReference: 0.006,
      max: 0.2,
      share: 0.2,
      ambientFactor: 2,
      roomFactor: 3,
      referenceCap: 0.75,
      peakFactor: 1.5,
      interimPeakFactor: 2.5,
      confidenceMin: 0.6,
    },
    strict: {
      min: 0.03,
      minWithReference: 0.02,
      max: 0.3,
      share: 0.45,
      ambientFactor: 3,
      roomFactor: 4,
      referenceCap: 0.9,
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
/**
 * After a calibration the reference never falls under this part of the calibrated one.
 * Without it every quiet fragment that got through (a word of a conversation in the room
 * counts as accepted) pulls the reference down, the threshold follows, and the room
 * gets in more and more (measured 05.11.2026, docs/hai-sprachmodus-recherche.md,
 * section 11). It can still rise, and a new calibration resets it.
 */
export const REFERENCE_FLOOR = 0.7;
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
/** ... but never more than this part of the reference's peak range (a word is short). */
export const SHORT_PEAK_OF_REFERENCE = 1.6;
/** ... and never more than this level (a shout reaches it, a normal voice does too). */
export const PEAK_CEILING = 0.9;
/**
 * A room whose level reaches this part of the reference is "loud": the person is hardly
 * louder than the talk around. There a single word keeps the full requirement (three
 * times the threshold). The word of a talk in the room would pass the lower one (measured
 * 05.11.2026: up to 17 sentences of a talk 4 dB under the person reached the chat). The
 * person who is held back by it gets the way out after two utterances.
 */
export const LOUD_ROOM_SHARE = 0.25;
/** An utterance without a time window is judged on this much of the recent past. */
export const FALLBACK_WINDOW_MS = 2_500;
/** A provisional text is judged on this much of the recent past. */
export const RECENT_WINDOW_MS = 1_200;
/** A peak at or above this is an overdriven recording (clipping). */
export const CLIPPED_PEAK = 0.97;
/** A mean at or above this many times the threshold is loud (shouting). */
export const LOUD_FACTOR = 3;
/** The mean of an utterance counts as "somebody speaks" above the room by this factor. */
export const ROOM_RATIO = 2;
/** A peak at or above this is never "nobody speaks" (never the hint "louder"). */
export const QUIET_PEAK = 0.3;
/** All samples of the history under this level: the measurement delivers nothing. */
export const DEAD_LEVEL = 0.0005;
/** Calibration: the voice (its active part) must reach this level (RMS 0.0024). */
export const CALIBRATION_MIN_LEVEL = 0.012;
/** Calibration: the voice must be this many times louder than the room before it. */
export const CALIBRATION_RATIO = 1.8;
/** Calibration: samples of the words at or above this part of the peak are "speech". */
export const CALIBRATION_ACTIVE_PART = 0.35;
/**
 * Calibration: the reference is the mean of the speech frames of the short phrase
 * times this. The phrase is one loud word pair, a longer question has pauses and
 * the lag of the window in its mean. Measured 05.11.2026 (docs/hai-sprachmodus-
 * recherche.md, section 11): with 0.75 the reference came out about 1.3 times the
 * mean of the person's later questions (1.1 to 1.6) and a short question was
 * dropped in "strict". 0.6 puts it at about the mean of a question.
 */
export const CALIBRATION_REFERENCE_FACTOR = 0.6;

export interface UtteranceWindow {
  /** Clock time (ms) of the first word, if the provider knows it. */
  startAt?: number;
  /** Clock time (ms) of the last word, if the provider knows it. */
  endAt?: number;
  /** Mean confidence of the recognition for this utterance (0 to 1), if known. */
  confidence?: number;
}

/** Why an utterance was left out. */
export type GateWhy = 'quiet' | 'background' | 'confidence';
/** A note for an utterance that counted (the display only shows a hint). */
export type GateHint = 'clipped' | 'loud';

export type GateVerdict =
  | {
      ok: true;
      /** No sample was in the window: the gate could not judge (the utterance counts). */
      judged: boolean;
      mean: number;
      peak: number;
      threshold: number;
      confidence: number | null;
      /** Low confidence at a high level: it counts, the person is asked to speak softer. */
      hint?: GateHint;
    }
  | {
      ok: false;
      /**
       * quiet       nobody speaks at the microphone (only silence or a far murmur)
       * background  a voice clearly above the room, but under the threshold of the person
       * confidence  the words were not understood clearly (at a normal level)
       */
      why: GateWhy;
      mean: number;
      peak: number;
      threshold: number;
      confidence: number | null;
      /** The mean is clearly above the room level: it may be the person. */
      aboveRoom: boolean;
    };

export type CalibrationResult =
  | {
      ok: true;
      reference: number;
      ambient: number;
      mean: number;
      peak: number;
    }
  | {
      ok: false;
      /** quiet: too quiet, noisy: not louder than the room, nolevel: nothing measured */
      why: 'quiet' | 'noisy' | 'nolevel';
      mean: number;
      peak: number;
      ambient: number;
    };

/** The numbers of the gate for the diagnosis (never any text). */
export interface GateSnapshot {
  sensitivity: Sensitivity;
  samples: number;
  maxLevel: number;
  ambient: number;
  reference: number | null;
  threshold: number;
  calibrated: boolean;
}

interface Sample {
  at: number;
  level: number;
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

export class LevelGate {
  private samples: Sample[] = [];
  private accepted: number[] = [];
  private calibrated = false;
  private calibratedAmbient: number | null = null;
  private calibratedReference: number | null = null;

  constructor(public sensitivity: Sensitivity = 'normal') {}

  get profile(): GateProfile {
    return GATE_PROFILES[this.sensitivity];
  }

  /** `off`: no level gate and no confidence limit (the numbers are still measured). */
  get enabled(): boolean {
    return this.sensitivity !== 'off';
  }

  setSensitivity(sensitivity: Sensitivity): void {
    this.sensitivity = sensitivity;
  }

  /** A new conversation: forget the levels, the calibration and the person's reference. */
  reset(): void {
    this.samples = [];
    this.accepted = [];
    this.calibrated = false;
    this.calibratedAmbient = null;
    this.calibratedReference = null;
  }

  /** The reference and the room level of a calibration are forgotten (a new one follows). */
  forgetCalibration(): void {
    this.accepted = [];
    this.calibrated = false;
    this.calibratedAmbient = null;
    this.calibratedReference = null;
  }

  /** The reference of the person was set by a calibration (and nothing reset it since). */
  isCalibrated(): boolean {
    return this.calibrated;
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

  /** The quiet level of the room (the one of the calibration while samples are few). */
  ambient(): number {
    if (this.samples.length < MIN_AMBIENT_SAMPLES) {
      return this.calibratedAmbient ?? 0;
    }
    const sorted = this.samples.map(s => s.level).sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * AMBIENT_PERCENTILE)];
  }

  /** The level of the person's own voice (null before a calibration or an accepted utterance). */
  reference(): number | null {
    if (this.accepted.length === 0) return null;
    const sorted = [...this.accepted].sort((a, b) => a - b);
    const median = sorted[Math.ceil((sorted.length - 1) * REFERENCE_QUANTILE)];
    return Math.max(median, (this.calibratedReference ?? 0) * REFERENCE_FLOOR);
  }

  /**
   * The measurement delivers nothing: enough samples, all of them silent. A real
   * microphone always has a noise floor, so this is a suspended audio context or a
   * wrong stream. The gate then cannot judge (the utterance counts).
   */
  levelDead(): boolean {
    if (this.samples.length < MIN_AMBIENT_SAMPLES) return false;
    return this.samples.every(s => s.level < DEAD_LEVEL);
  }

  /** The mean level an utterance has to reach right now. */
  threshold(): number {
    const {
      min,
      minWithReference,
      max,
      share,
      ambientFactor,
      roomFactor,
      referenceCap,
    } = this.profile;
    const ambient = this.ambient();
    const reference = this.reference();
    if (reference === null) {
      return clamp(Math.max(min, ambient * ambientFactor), min, max);
    }
    const floor = Math.max(minWithReference, ambient * roomFactor);
    const adaptive = ambient + share * Math.max(0, reference - ambient);
    const cap = Math.max(minWithReference, reference * referenceCap);
    return clamp(
      Math.min(Math.max(floor, adaptive), cap),
      minWithReference,
      max
    );
  }

  /** The peak a single word has to reach (never out of reach of a voice). */
  private shortPeakNeed(threshold: number): number {
    const reference = this.reference();
    const loudRoom =
      reference !== null && this.ambient() >= reference * LOUD_ROOM_SHARE;
    const byReference =
      reference === null || loudRoom
        ? Infinity
        : reference * SHORT_PEAK_OF_REFERENCE;
    return Math.max(
      threshold * this.profile.peakFactor,
      Math.min(threshold * SHORT_PEAK_FACTOR, byReference, PEAK_CEILING)
    );
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

  /** The time window an utterance is judged on (see evaluate for the reasons). */
  private windowOf(
    utterance: UtteranceWindow,
    at: number
  ): { startAt: number; endAt: number; from: number; to: number } {
    const endAt = utterance.endAt ?? at;
    const startAt = utterance.startAt ?? endAt - FALLBACK_WINDOW_MS;
    return {
      startAt,
      endAt,
      from: startAt - WINDOW_PADDING_MS,
      to: Math.max(endAt, startAt + MIN_SPAN_MS) + END_PADDING_MS,
    };
  }

  /**
   * Is somebody speaking loud enough right now? Used for a provisional text
   * (an interruption, a signal word, the text shown): the peak of the last
   * moment must reach the threshold times the interim peak factor. True when nothing
   * was measured (no judgement possible) and when the gate is off.
   */
  passesNow(at: number): boolean {
    if (!this.enabled) return true;
    const recent = this.window(at - RECENT_WINDOW_MS, at);
    if (!recent || this.levelDead()) return true;
    const threshold = this.threshold();
    return (
      recent.mean >= threshold &&
      recent.peak >=
        Math.min(threshold * this.profile.interimPeakFactor, PEAK_CEILING)
    );
  }

  /**
   * The calibration: the person said a short phrase ("Hallo HAI"). Measures the
   * level of the voice and the level of the room before it, and sets the
   * reference of the person and the room level. Fails when the voice is too
   * quiet, not louder than the room, or when nothing was measured. A failed
   * calibration changes nothing (the gate stays tolerant: no reference).
   */
  calibrate(utterance: UtteranceWindow, at: number): CalibrationResult {
    const span = this.windowOf(utterance, at);
    const measured = this.window(span.from, span.to);
    // the room level BEFORE the words (the pauses of the last seconds), else all samples
    const before = this.samples
      .filter(s => s.at < span.from)
      .map(s => s.level)
      .sort((a, b) => a - b);
    const all = this.samples.map(s => s.level).sort((a, b) => a - b);
    const pool = before.length >= 8 ? before : all;
    const ambient =
      pool.length > 0
        ? pool[Math.floor((pool.length - 1) * AMBIENT_PERCENTILE)]
        : 0;
    if (!measured || this.levelDead()) {
      return {
        ok: false,
        why: 'nolevel',
        mean: 0,
        peak: 0,
        ambient,
      };
    }
    const inWindow = this.samples
      .filter(s => s.at >= span.from && s.at <= span.to)
      .map(s => s.level);
    const active = inWindow.filter(
      level => level >= measured.peak * CALIBRATION_ACTIVE_PART
    );
    const activeMean = active.reduce((sum, v) => sum + v, 0) / active.length;
    const result = { mean: measured.mean, peak: measured.peak, ambient };
    if (activeMean < CALIBRATION_MIN_LEVEL) {
      return { ok: false, why: 'quiet', ...result };
    }
    if (activeMean < ambient * CALIBRATION_RATIO) {
      return { ok: false, why: 'noisy', ...result };
    }
    const reference = activeMean * CALIBRATION_REFERENCE_FACTOR;
    this.accepted = [reference];
    this.calibrated = true;
    this.calibratedAmbient = ambient;
    this.calibratedReference = reference;
    return { ok: true, reference, ...result };
  }

  /** Judges a finished utterance by its time window and its confidence. */
  evaluate(utterance: UtteranceWindow, at: number): GateVerdict {
    const threshold = this.threshold();
    const confidence =
      typeof utterance.confidence === 'number' &&
      Number.isFinite(utterance.confidence)
        ? utterance.confidence
        : null;
    // Measured 04.11.2026 (docs/hai-sprachmodus-recherche.md, section 10): the time of the
    // words is a rough guide. The loud part of the recording starts 100 to 350 ms after
    // the claimed start, and a single word comes with a window of 60 to 120 ms. So the
    // window reaches further to the end (the recording lags the words) and is at least
    // MIN_SPAN_MS long.
    const span = this.windowOf(utterance, at);
    const short = span.endAt - span.startAt < SHORT_WINDOW_MS;
    const measured = this.window(span.from, span.to);
    const numbers = {
      mean: measured?.mean ?? 0,
      peak: measured?.peak ?? 0,
      threshold,
      confidence,
    };
    // off: nothing is left out, the numbers are only measured (diagnosis)
    if (!this.enabled) {
      return { ok: true, judged: measured !== null, ...numbers };
    }
    // a measurement that delivers nothing cannot say anything about the voice
    if (measured && this.levelDead()) {
      return { ok: true, judged: false, ...numbers };
    }
    if (measured) {
      const { mean, peak } = measured;
      // a single word has no stable mean (a word and a long pause): its peak decides
      const quiet = short
        ? peak < this.shortPeakNeed(threshold)
        : mean < threshold ||
          peak < Math.min(threshold * this.profile.peakFactor, PEAK_CEILING);
      if (quiet) {
        const aboveRoom =
          mean >= Math.max(this.profile.min, this.ambient() * ROOM_RATIO);
        // "quiet" (the hint to speak louder) only for real silence, never for a loud level
        const why: GateWhy =
          !aboveRoom && peak < QUIET_PEAK ? 'quiet' : 'background';
        return { ok: false, why, ...numbers, aboveRoom };
      }
    }
    if (confidence !== null && confidence < this.profile.confidenceMin) {
      // low confidence at a high level: overdriven or shouting, not mumbling
      const hint: GateHint | null =
        numbers.peak >= CLIPPED_PEAK
          ? 'clipped'
          : measured && numbers.mean >= threshold * LOUD_FACTOR
            ? 'loud'
            : null;
      if (hint) {
        return { ok: true, judged: true, ...numbers, hint };
      }
      return {
        ok: false,
        why: 'confidence',
        ...numbers,
        aboveRoom: measured !== null && numbers.mean >= threshold,
      };
    }
    return { ok: true, judged: measured !== null, ...numbers };
  }

  /** The numbers of the gate right now (the diagnosis, never any text). */
  snapshot(): GateSnapshot {
    let maxLevel = 0;
    for (const sample of this.samples)
      maxLevel = Math.max(maxLevel, sample.level);
    return {
      sensitivity: this.sensitivity,
      samples: this.samples.length,
      maxLevel,
      ambient: this.ambient(),
      reference: this.reference(),
      threshold: this.threshold(),
      calibrated: this.calibrated,
    };
  }
}
