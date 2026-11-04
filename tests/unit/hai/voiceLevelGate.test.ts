import { describe, it, expect } from '@jest/globals';
import {
  AMBIENT_PERCENTILE,
  GATE_PROFILES,
  LEVEL_HISTORY_MS,
  LevelGate,
  MIN_AMBIENT_SAMPLES,
  RECENT_WINDOW_MS,
  REFERENCE_UTTERANCES,
  type GateVerdict,
} from '@/lib/hai/voice/levelGate';
import {
  DEFAULT_FILTER_SETTINGS,
  PUSH_TO_TALK_KEY,
  SENSITIVITY_KEY,
  SIGNAL_HINT_KEY,
  SIGNAL_WORDS_KEY,
  readFilterSettings,
  signalHintSeen,
  writeFilterSetting,
} from '@/lib/hai/voice/filterSettings';

// The loudness gate with synthetic level curves. Levels are the unit of the recognition:
// RMS times five (0 to 1). The measured values of 04.11.2026 (docs/hai-sprachmodus-recherche.md):
// a voice at the microphone about 0.3 (RMS 0.066), a voice 17 dB down about 0.045, the room 0.003.

const T0 = 1_000_000;
const STEP = 100; // the recognition reports ten times a second

/** Feeds `ms` of a steady level, returns the clock time at its end. */
function feed(gate: LevelGate, from: number, ms: number, level: number) {
  let at = from;
  for (let i = 0; i < ms / STEP; i += 1) {
    gate.push(level, at);
    at += STEP;
  }
  return at;
}

/** A speech-like curve: loud words with small pauses (the mean sits under the peak). */
function speech(gate: LevelGate, from: number, ms: number, peak: number) {
  let at = from;
  for (let i = 0; i < ms / STEP; i += 1) {
    const pause = i % 5 === 4;
    gate.push(pause ? peak * 0.15 : peak * (0.55 + 0.45 * ((i % 3) / 2)), at);
    at += STEP;
  }
  return at;
}

const VOICE = 0.6; // peak of the person at the microphone
const FAR = 0.07; // peak of a voice across the room

function noQuiet(v: GateVerdict) {
  return v.ok;
}

describe('LevelGate: the room level', () => {
  it('is unknown (0) with few samples and the 20th percentile otherwise', () => {
    const gate = new LevelGate();
    expect(gate.ambient()).toBe(0);
    feed(gate, T0, (MIN_AMBIENT_SAMPLES - 1) * STEP, 0.01);
    expect(gate.ambient()).toBe(0);
    gate.reset();
    // 70 percent pauses at 0.004, 30 percent speech at 0.4
    let at = T0;
    for (let i = 0; i < 100; i += 1) {
      gate.push(i % 10 < 7 ? 0.004 : 0.4, at);
      at += STEP;
    }
    expect(AMBIENT_PERCENTILE).toBe(0.2);
    expect(gate.ambient()).toBeCloseTo(0.004, 5);
  });

  it('forgets samples older than half a minute', () => {
    const gate = new LevelGate();
    let at = feed(gate, T0, 5_000, 0.5);
    at = feed(gate, at + LEVEL_HISTORY_MS, 5_000, 0.01);
    expect(gate.window(T0, T0 + 5_000)).toBeNull();
    expect(gate.ambient()).toBeCloseTo(0.01, 5);
    // a level that is no number is ignored, a level above 1 counts as 1
    gate.push(Number.NaN, at);
    gate.push(7, at + 1);
    expect(gate.window(at, at + 1)).toEqual({ peak: 1, mean: 1 });
  });
});

describe('LevelGate: the threshold', () => {
  it('before any reference only the lower bound (and the room) count', () => {
    const gate = new LevelGate('normal');
    expect(gate.reference()).toBeNull();
    expect(gate.threshold()).toBe(GATE_PROFILES.normal.min);
    // a loud room raises it, up to the upper bound
    feed(gate, T0, 5_000, 0.05);
    expect(gate.threshold()).toBeCloseTo(0.15, 5);
    gate.reset();
    feed(gate, T0, 5_000, 0.5);
    expect(gate.threshold()).toBe(GATE_PROFILES.normal.max);
  });

  it('with a reference it is the room plus a share of the way to the person', () => {
    const gate = new LevelGate('normal');
    feed(gate, T0, 5_000, 0.004);
    gate.confirm(0.4);
    const expected = 0.004 + GATE_PROFILES.normal.share * (0.4 - 0.004);
    expect(gate.threshold()).toBeCloseTo(expected, 5);
    const strict = new LevelGate('strict');
    feed(strict, T0, 5_000, 0.004);
    strict.confirm(0.4);
    expect(strict.threshold()).toBeCloseTo(
      0.004 + GATE_PROFILES.strict.share * (0.4 - 0.004),
      5
    );
    expect(strict.threshold()).toBeGreaterThan(gate.threshold());
  });

  it('is clamped: a loud first utterance cannot lock the person out, a quiet one cannot open the door', () => {
    const loud = new LevelGate('normal');
    loud.confirm(1);
    expect(loud.threshold()).toBe(GATE_PROFILES.normal.max);
    const quiet = new LevelGate('normal');
    quiet.confirm(0.02);
    expect(quiet.threshold()).toBe(GATE_PROFILES.normal.min);
    const strictQuiet = new LevelGate('strict');
    strictQuiet.confirm(0.02);
    expect(strictQuiet.threshold()).toBe(GATE_PROFILES.strict.min);
    const strictLoud = new LevelGate('strict');
    strictLoud.confirm(1);
    expect(strictLoud.threshold()).toBe(GATE_PROFILES.strict.max);
  });

  it('the reference is the upper median of the last utterances, one loud outlier does not pin it', () => {
    const gate = new LevelGate();
    for (const mean of [0.3, 0.32, 0.28, 0.3, 0.31]) gate.confirm(mean);
    const before = gate.reference() as number;
    gate.confirm(0.95); // a shout
    expect(gate.reference() as number).toBeLessThan(0.4);
    expect(before).toBeGreaterThan(0.29);
    // only the last seven count: the room adapts to a person who moves away
    for (let i = 0; i < REFERENCE_UTTERANCES; i += 1) gate.confirm(0.1);
    expect(gate.reference()).toBeCloseTo(0.1, 5);
    // zero and nonsense are not a reference
    const other = new LevelGate();
    other.confirm(0);
    other.confirm(Number.NaN);
    expect(other.reference()).toBeNull();
  });

  it('a new conversation starts without reference and levels', () => {
    const gate = new LevelGate();
    feed(gate, T0, 5_000, 0.3);
    gate.confirm(0.3);
    gate.reset();
    expect(gate.reference()).toBeNull();
    expect(gate.ambient()).toBe(0);
    expect(gate.window(T0, T0 + 5_000)).toBeNull();
  });

  it('the sensitivity can change in the middle of a conversation', () => {
    const gate = new LevelGate('normal');
    gate.confirm(0.4);
    const normal = gate.threshold();
    gate.setSensitivity('strict');
    expect(gate.sensitivity).toBe('strict');
    expect(gate.threshold()).toBeGreaterThan(normal);
  });
});

describe('LevelGate: finished utterances (synthetic level curves)', () => {
  it('the person at the microphone passes, the voice across the room is dropped', () => {
    const gate = new LevelGate('normal');
    let at = feed(gate, T0, 3_000, 0.004); // the quiet room
    const start = at;
    at = speech(gate, at, 3_000, VOICE);
    const own = gate.evaluate({ startAt: start, endAt: at }, at);
    expect(own.ok).toBe(true);
    if (own.ok) gate.confirm(own.mean);

    at = feed(gate, at, 1_000, 0.004);
    const roomStart = at;
    at = speech(gate, at, 3_000, FAR);
    const room = gate.evaluate({ startAt: roomStart, endAt: at }, at);
    expect(room.ok).toBe(false);
    if (!room.ok) {
      expect(room.why).toBe('quiet');
      expect(room.peak).toBeLessThan(room.threshold * 1.5 + 1);
    }
  });

  it('the person speaking more quietly (one third) still passes in normal, not in strict', () => {
    const run = (sensitivity: 'normal' | 'strict') => {
      const gate = new LevelGate(sensitivity);
      let at = feed(gate, T0, 3_000, 0.004);
      let start = at;
      at = speech(gate, at, 3_000, VOICE);
      const first = gate.evaluate({ startAt: start, endAt: at }, at);
      if (first.ok) gate.confirm(first.mean);
      at = feed(gate, at, 1_000, 0.004);
      start = at;
      at = speech(gate, at, 3_000, VOICE / 3);
      return gate.evaluate({ startAt: start, endAt: at }, at);
    };
    expect(run('normal').ok).toBe(true);
    expect(run('strict').ok).toBe(false);
  });

  it('a short burst (a laugh in the background) with a quiet mean does not pass, a peak alone is not a voice', () => {
    const gate = new LevelGate('normal');
    gate.confirm(0.3);
    let at = feed(gate, T0, 2_500, 0.004);
    gate.push(0.5, at);
    at += STEP;
    at = feed(gate, at, 500, 0.004);
    const verdict = gate.evaluate({ startAt: T0, endAt: at }, at);
    expect(verdict.ok).toBe(false);
  });

  it('a window without samples cannot be judged: the utterance counts, marked as not judged', () => {
    const gate = new LevelGate();
    const verdict = gate.evaluate(
      { startAt: T0, endAt: T0 + 1_000 },
      T0 + 1_000
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.judged).toBe(false);
  });

  it('without a time window the last moments are judged', () => {
    const gate = new LevelGate();
    const end = feed(gate, T0, 2_000, 0.02);
    const verdict = gate.evaluate({}, end);
    expect(verdict.ok).toBe(false);
    const loud = new LevelGate();
    const end2 = feed(loud, T0, 2_000, 0.4);
    expect(loud.evaluate({}, end2).ok).toBe(true);
  });

  it('a single word: its window is tiny and early (lab values), so the peak in the longer window decides', () => {
    const run = (sensitivity: 'normal' | 'strict', wordLevel: number) => {
      const gate = new LevelGate(sensitivity);
      gate.confirm(0.33);
      let at = feed(gate, T0, 3_000, 0.003);
      // the recognition claims 60 ms, the loud word starts 250 ms later and lasts 450 ms
      const claimed = at;
      at = feed(gate, at, 250, 0.003);
      at = feed(gate, at, 450, wordLevel);
      at = feed(gate, at, 1_000, 0.003);
      return gate.evaluate({ startAt: claimed, endAt: claimed + 60 }, at);
    };
    // the person says "Stopp" at the microphone: counts in both settings
    expect(run('normal', 0.6).ok).toBe(true);
    expect(run('strict', 0.6).ok).toBe(true);
    // a quiet "stopp" in the room: dropped in both
    expect(run('normal', 0.07).ok).toBe(false);
    expect(run('strict', 0.07).ok).toBe(false);
    // a voice 10 dB under the person: strict drops it, normal lets it pass (the limit of the level)
    expect(run('strict', 0.28).ok).toBe(false);
  });

  it('the window reaches past the claimed end: a recording that lags the words is still found', () => {
    const gate = new LevelGate('normal');
    gate.confirm(0.33);
    let at = feed(gate, T0, 3_000, 0.003);
    const start = at;
    // the words are claimed for 1.5 s, the loud part comes 350 ms late and ends 350 ms late
    at = feed(gate, at, 350, 0.003);
    at = feed(gate, at, 1_500, 0.5);
    at = feed(gate, at, 1_000, 0.003);
    expect(gate.evaluate({ startAt: start, endAt: start + 1_500 }, at).ok).toBe(
      true
    );
  });

  it('the window has some room on both sides for the clock skew of the recognition', () => {
    const gate = new LevelGate();
    feed(gate, T0 + 1_000, 1_000, 0.5);
    // the words are reported 100 ms too early and 100 ms too late: still found
    expect(
      gate.evaluate({ startAt: T0 + 100, endAt: T0 + 1_100 }, T0 + 3_000).ok
    ).toBe(true);
  });

  it('a low confidence drops the utterance, strict asks for more than normal', () => {
    const gate = new LevelGate('normal');
    const end = feed(gate, T0, 2_000, 0.6);
    const win = { startAt: T0, endAt: end };
    expect(gate.evaluate({ ...win, confidence: 0.99 }, end).ok).toBe(true);
    expect(gate.evaluate({ ...win, confidence: 0.7 }, end).ok).toBe(true);
    const low = gate.evaluate({ ...win, confidence: 0.5 }, end);
    expect(low.ok).toBe(false);
    if (!low.ok) expect(low.why).toBe('confidence');
    gate.setSensitivity('strict');
    expect(gate.evaluate({ ...win, confidence: 0.7 }, end).ok).toBe(false);
    // no confidence given (another provider): nothing to judge
    expect(gate.evaluate(win, end).ok).toBe(true);
    expect(gate.evaluate({ ...win, confidence: Number.NaN }, end).ok).toBe(
      true
    );
  });

  it('loudness is judged before confidence', () => {
    const gate = new LevelGate();
    const end = feed(gate, T0, 2_000, 0.01);
    const verdict = gate.evaluate(
      { startAt: T0, endAt: end, confidence: 0.1 },
      end
    );
    expect(!verdict.ok && verdict.why).toBe('quiet');
  });

  it('measured values: a voice 17 dB under the near voice is dropped once the person was heard, in both settings', () => {
    for (const sensitivity of ['normal', 'strict'] as const) {
      const gate = new LevelGate(sensitivity);
      // near voice: RMS 0.066 -> level 0.33 (mean over the words), the room 0.003
      let at = feed(gate, T0, 3_000, 0.003);
      const start = at;
      at = feed(gate, at, 3_000, 0.33);
      const own = gate.evaluate({ startAt: start, endAt: at }, at);
      expect(noQuiet(own)).toBe(true);
      if (own.ok) gate.confirm(own.mean);
      at = feed(gate, at, 1_000, 0.003);
      const farStart = at;
      at = feed(gate, at, 3_000, 0.045); // RMS 0.009
      expect(gate.evaluate({ startAt: farStart, endAt: at }, at).ok).toBe(
        false
      );
    }
  });
});

describe('LevelGate: the provisional text (interruption, signal word, display)', () => {
  it('passes while a loud voice is speaking and not while only the room is', () => {
    const gate = new LevelGate('normal');
    gate.confirm(0.4);
    let at = feed(gate, T0, 3_000, 0.004);
    expect(gate.passesNow(at)).toBe(false);
    at = feed(gate, at, 600, 0.5);
    expect(gate.passesNow(at)).toBe(true);
    // the moment is over: after the window the room is all there is
    at = feed(gate, at, RECENT_WINDOW_MS + 500, 0.004);
    expect(gate.passesNow(at)).toBe(false);
  });

  it('a provisional text needs a higher peak than a finished utterance (lab case: a voice 14 dB down must not interrupt)', () => {
    const gate = new LevelGate('normal');
    gate.confirm(0.33);
    let at = feed(gate, T0, 3_000, 0.003);
    const threshold = gate.threshold();
    expect(GATE_PROFILES.normal.interimPeakFactor).toBeGreaterThan(
      GATE_PROFILES.normal.peakFactor
    );
    // a steady level of twice the threshold: the mean is enough, the peak is
    // not (a finished utterance would pass with it, the provisional text not)
    at = feed(gate, at, RECENT_WINDOW_MS, threshold * 2);
    expect(gate.passesNow(at)).toBe(false);
    // three times the threshold, sustained: a voice
    at = feed(gate, at, RECENT_WINDOW_MS, threshold * 3);
    expect(gate.passesNow(at)).toBe(true);
  });

  it('one loud burst in a quiet moment is no voice: the mean of the last moment has to reach the threshold too', () => {
    const gate = new LevelGate('normal');
    gate.confirm(0.33);
    let at = feed(gate, T0, 3_000, 0.003);
    const threshold = gate.threshold();
    at = feed(gate, at, RECENT_WINDOW_MS - STEP, 0.003);
    gate.push(threshold * 5, at);
    expect(gate.passesNow(at + 1)).toBe(false);
  });

  it('nothing measured: no judgement, it passes', () => {
    expect(new LevelGate().passesNow(T0)).toBe(true);
  });
});

describe('filter settings (localStorage of the device)', () => {
  const store = () => {
    const data: Record<string, string> = {};
    return {
      data,
      storage: {
        getItem: (k: string) => data[k] ?? null,
        setItem: (k: string, v: string) => {
          data[k] = v;
        },
      },
    };
  };

  it('the defaults: normal, no push to talk, signal words on', () => {
    expect(DEFAULT_FILTER_SETTINGS).toEqual({
      sensitivity: 'normal',
      pushToTalk: false,
      signalWords: true,
    });
    expect(readFilterSettings(store().storage)).toEqual(
      DEFAULT_FILTER_SETTINGS
    );
    expect(readFilterSettings(null)).toEqual(DEFAULT_FILTER_SETTINGS);
  });

  it('reads what was saved, unknown values are the default', () => {
    const s = store();
    writeFilterSetting(s.storage, SENSITIVITY_KEY, 'strict');
    writeFilterSetting(s.storage, PUSH_TO_TALK_KEY, 'on');
    writeFilterSetting(s.storage, SIGNAL_WORDS_KEY, 'off');
    expect(readFilterSettings(s.storage)).toEqual({
      sensitivity: 'strict',
      pushToTalk: true,
      signalWords: false,
    });
    s.data[SENSITIVITY_KEY] = 'banana';
    s.data[PUSH_TO_TALK_KEY] = 'maybe';
    s.data[SIGNAL_WORDS_KEY] = '';
    expect(readFilterSettings(s.storage)).toEqual(DEFAULT_FILTER_SETTINGS);
  });

  it('a storage that throws (private window) is the default and never breaks', () => {
    const broken = {
      getItem: () => {
        throw new Error('no');
      },
      setItem: () => {
        throw new Error('no');
      },
    };
    expect(readFilterSettings(broken)).toEqual(DEFAULT_FILTER_SETTINGS);
    expect(() =>
      writeFilterSetting(broken, SENSITIVITY_KEY, 'strict')
    ).not.toThrow();
    expect(signalHintSeen(broken)).toBe(false);
  });

  it('remembers that the first hint was shown', () => {
    const s = store();
    expect(signalHintSeen(s.storage)).toBe(false);
    writeFilterSetting(s.storage, SIGNAL_HINT_KEY, 'yes');
    expect(signalHintSeen(s.storage)).toBe(true);
    expect(signalHintSeen(null)).toBe(false);
  });
});
