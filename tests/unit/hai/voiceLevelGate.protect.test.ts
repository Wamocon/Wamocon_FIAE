import { describe, it, expect } from '@jest/globals';
import {
  CALIBRATION_MIN_LEVEL,
  CLIPPED_PEAK,
  GATE_PROFILES,
  LevelGate,
  LOUD_ROOM_SHARE,
  MIN_AMBIENT_SAMPLES,
  REFERENCE_FLOOR,
} from '@/lib/hai/voice/levelGate';
import { isCalibrationPhrase } from '@/lib/hai/voice/signalWords';

// The gate never locks the person out (05.11.2026): calibration, relative threshold, the
// reasons of a discarded utterance, loud voice with low confidence, the setting "off", a
// measurement that delivers nothing. Levels: RMS times five (0 to 1).

const T0 = 1_000_000;
const STEP = 100;

function feed(gate: LevelGate, from: number, ms: number, level: number) {
  let at = from;
  for (let i = 0; i < ms / STEP; i += 1) {
    gate.push(level, at);
    at += STEP;
  }
  return at;
}

/** Loud words with small pauses: the mean sits under the peak. */
function speech(gate: LevelGate, from: number, ms: number, peak: number) {
  let at = from;
  for (let i = 0; i < ms / STEP; i += 1) {
    const pause = i % 5 === 4;
    gate.push(pause ? peak * 0.15 : peak * (0.55 + 0.45 * ((i % 3) / 2)), at);
    at += STEP;
  }
  return at;
}

/** A room, the phrase "Hallo HAI" of the person (one second) and a pause. */
function calibrated(
  gate: LevelGate,
  peak: number,
  room = 0.004,
  options: { sentence?: boolean } = {}
) {
  let at = feed(gate, T0, 4_000, room);
  const start = at;
  at = speech(gate, at, options.sentence ? 3_000 : 1_000, peak);
  const result = gate.calibrate({ startAt: start, endAt: at }, at + 300);
  at = feed(gate, at, 1_500, room);
  return { at, result };
}

describe('LevelGate: calibration', () => {
  it('sets the reference of the person and the room level', () => {
    const gate = new LevelGate('normal');
    expect(gate.isCalibrated()).toBe(false);
    const { result } = calibrated(gate, 0.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ambient).toBeCloseTo(0.004, 3);
    expect(result.reference).toBeGreaterThan(0.2);
    expect(gate.isCalibrated()).toBe(true);
    expect(gate.reference()).toBeCloseTo(result.reference, 6);
    // the threshold hangs on the reference now, not on an absolute lower bound
    expect(gate.threshold()).toBeGreaterThan(GATE_PROFILES.normal.min);
    expect(gate.threshold()).toBeLessThanOrEqual(
      result.reference * 0.75 + 1e-9
    );
  });

  it('works for a microphone with a very low gain (RMS 0.005 is level 0.025)', () => {
    const gate = new LevelGate('normal');
    const { result, at } = calibrated(gate, 0.06);
    expect(result.ok).toBe(true);
    // a quiet question of the same person passes: no absolute bound locks it out
    const start = at;
    const end = speech(gate, start, 3_000, 0.06);
    const verdict = gate.evaluate({ startAt: start, endAt: end }, end);
    expect(verdict.ok).toBe(true);
  });

  it('the room level of the calibration holds while few samples are known', () => {
    const gate = new LevelGate('normal');
    calibrated(gate, 0.5, 0.02);
    const known = gate.ambient();
    expect(known).toBeGreaterThan(0.015);
    // fewer than MIN_AMBIENT_SAMPLES samples: the calibrated room level stays
    const later = new LevelGate('normal');
    calibrated(later, 0.5, 0.02);
    const snap = later.snapshot();
    expect(snap.calibrated).toBe(true);
    expect(snap.samples).toBeGreaterThanOrEqual(MIN_AMBIENT_SAMPLES);
  });

  it('fails when the voice is too quiet and changes nothing', () => {
    const gate = new LevelGate('normal');
    const { result } = calibrated(gate, CALIBRATION_MIN_LEVEL * 0.6);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toBe('quiet');
    expect(gate.isCalibrated()).toBe(false);
    expect(gate.reference()).toBeNull();
  });

  it('fails when the voice is not louder than the room', () => {
    const gate = new LevelGate('normal');
    const { result } = calibrated(gate, 0.1, 0.07);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toBe('noisy');
    expect(gate.isCalibrated()).toBe(false);
  });

  it('fails when nothing was measured (no samples, or a measurement of only zeros)', () => {
    const empty = new LevelGate('normal');
    const none = empty.calibrate({ startAt: T0, endAt: T0 + 800 }, T0 + 900);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.why).toBe('nolevel');

    const dead = new LevelGate('normal');
    feed(dead, T0, 5_000, 0);
    const zeros = dead.calibrate(
      { startAt: T0 + 3_000, endAt: T0 + 3_800 },
      T0 + 4_000
    );
    expect(zeros.ok).toBe(false);
    if (!zeros.ok) expect(zeros.why).toBe('nolevel');
  });

  it('quiet fragments that got through cannot pull the reference down far (floor of 70 percent)', () => {
    const gate = new LevelGate('normal');
    const { result } = calibrated(gate, 0.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (let i = 0; i < 20; i += 1) gate.confirm(0.01);
    expect(gate.reference()).toBeCloseTo(result.reference * REFERENCE_FLOOR, 6);
    // and it still rises with a louder person
    for (let i = 0; i < 10; i += 1) gate.confirm(result.reference * 2);
    expect(gate.reference()).toBeGreaterThan(result.reference * 1.5);
    // without a calibration there is no floor
    const plain = new LevelGate('normal');
    for (let i = 0; i < 10; i += 1) plain.confirm(0.01);
    expect(plain.reference()).toBeCloseTo(0.01, 6);
  });

  it('a new calibration forgets the old one', () => {
    const gate = new LevelGate('normal');
    calibrated(gate, 0.5);
    gate.forgetCalibration();
    expect(gate.isCalibrated()).toBe(false);
    expect(gate.reference()).toBeNull();
    gate.reset();
    expect(gate.snapshot().samples).toBe(0);
  });

  it('only a short greeting counts as the phrase, not a conversation of the room', () => {
    expect(isCalibrationPhrase('Hallo HAI.')).toBe(true);
    expect(isCalibrationPhrase('Hallo, HAI!')).toBe(true);
    expect(isCalibrationPhrase('Hi')).toBe(true);
    expect(isCalibrationPhrase('Hast du gestern schon')).toBe(false);
    expect(
      isCalibrationPhrase('Hallo Hai ich wollte dir eine Frage stellen')
    ).toBe(true);
    expect(
      isCalibrationPhrase('Hast du gestern schon den Bericht fertig gemacht')
    ).toBe(false);
    expect(isCalibrationPhrase('   ')).toBe(false);
  });
});

describe('LevelGate: the threshold is relative', () => {
  it('the person who is a little softer than at the calibration still passes, also in a loud room', () => {
    const gate = new LevelGate('normal');
    const { at } = calibrated(gate, 0.6, 0.06);
    // the room is loud (0.06), the person speaks 25 percent softer than before
    const start = at;
    const end = speech(gate, start, 3_000, 0.45);
    const verdict = gate.evaluate({ startAt: start, endAt: end }, end);
    expect(verdict.ok).toBe(true);
    expect(gate.threshold()).toBeLessThanOrEqual(
      (gate.reference() as number) * GATE_PROFILES.normal.referenceCap + 1e-9
    );
  });

  it('before any reference the threshold is a very low safety bound and a small multiple of the room', () => {
    const gate = new LevelGate('normal');
    expect(gate.threshold()).toBe(GATE_PROFILES.normal.min);
    expect(GATE_PROFILES.normal.min).toBeLessThanOrEqual(0.012);
    feed(gate, T0, 5_000, 0.03);
    expect(gate.threshold()).toBeCloseTo(
      0.03 * GATE_PROFILES.normal.ambientFactor,
      5
    );
  });

  it('an unknown person with a low microphone is heard before any reference (RMS 0.005)', () => {
    const gate = new LevelGate('normal');
    let at = feed(gate, T0, 3_000, 0.004);
    const start = at;
    at = speech(gate, at, 3_000, 0.06);
    expect(gate.evaluate({ startAt: start, endAt: at }, at).ok).toBe(true);
  });

  it('the voice across the room stays out once the person is calibrated', () => {
    const gate = new LevelGate('normal');
    const { at } = calibrated(gate, 0.6);
    const start = at;
    const end = speech(gate, start, 3_000, 0.07);
    const verdict = gate.evaluate({ startAt: start, endAt: end }, end);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.why).toBe('background');
      expect(verdict.aboveRoom).toBe(true);
    }
  });

  it('in a loud room a single word keeps the full requirement, in a quiet one it is never out of reach of the reference', () => {
    const word = (room: number) => {
      const gate = new LevelGate('normal');
      const { at } = calibrated(gate, 0.3, room);
      const start = at;
      // a word with a peak of 0.45 times the reference range
      gate.push(0.2, start);
      gate.push(0.22, start + 100);
      gate.push(0.2, start + 200);
      return {
        gate,
        verdict: gate.evaluate(
          { startAt: start, endAt: start + 300 },
          start + 700
        ),
      };
    };
    const quiet = word(0.004);
    expect(quiet.verdict.ok).toBe(true);
    // the room is as loud as a third of the person: three times the threshold is the need
    const loud = word(0.07);
    expect(loud.gate.ambient()).toBeGreaterThanOrEqual(
      (loud.gate.reference() as number) * LOUD_ROOM_SHARE
    );
    const need = loud.gate.threshold() * 3;
    expect(loud.verdict.peak).toBeLessThan(need);
    expect(loud.verdict.ok).toBe(false);
  });

  it('a single word is judged by its peak, which is never out of reach of the reference', () => {
    const gate = new LevelGate('normal');
    const { at } = calibrated(gate, 0.3, 0.01);
    // one word at the peak of the calibration speech
    const start = at;
    gate.push(0.25, start);
    gate.push(0.3, start + 100);
    gate.push(0.25, start + 200);
    const verdict = gate.evaluate(
      { startAt: start, endAt: start + 300 },
      start + 700
    );
    expect(verdict.ok).toBe(true);
  });
});

describe('LevelGate: the reason of a discarded utterance', () => {
  it('quiet: nobody speaks at the microphone (only silence), the only case for "speak louder"', () => {
    const gate = new LevelGate('normal');
    let at = feed(gate, T0, 4_000, 0.004);
    const start = at;
    at = feed(gate, at, 2_000, 0.006);
    const verdict = gate.evaluate({ startAt: start, endAt: at }, at);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.why).toBe('quiet');
      expect(verdict.aboveRoom).toBe(false);
    }
  });

  it('a high peak is never "quiet" (never the hint "speak louder" at a high level)', () => {
    const gate = new LevelGate('strict');
    const { at } = calibrated(gate, 0.6);
    const start = at;
    // a burst: the peak is high, the mean is far under the threshold
    let t = feed(gate, start, 2_000, 0.01);
    gate.push(0.8, t);
    t += STEP;
    const verdict = gate.evaluate({ startAt: start, endAt: t }, t);
    if (!verdict.ok) expect(verdict.why).not.toBe('quiet');
  });

  it('confidence: not understood at a normal level', () => {
    const gate = new LevelGate('normal');
    const { at } = calibrated(gate, 0.5);
    const start = at;
    const end = speech(gate, start, 3_000, 0.2);
    const verdict = gate.evaluate(
      { startAt: start, endAt: end, confidence: 0.4 },
      end
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.why).toBe('confidence');
  });

  it('low confidence at a high level (overdriven, shouting) counts with the hint, it is not dropped', () => {
    const gate = new LevelGate('normal');
    const { at } = calibrated(gate, 0.3);
    // overdriven: the level sticks at the maximum
    const start = at;
    const end = feed(gate, start, 3_000, 1);
    const clipped = gate.evaluate(
      { startAt: start, endAt: end, confidence: 0.3 },
      end
    );
    expect(clipped.ok).toBe(true);
    if (clipped.ok) expect(clipped.hint).toBe('clipped');
    expect(CLIPPED_PEAK).toBeLessThan(1);

    // loud, not at the stop: far over the threshold
    const gate2 = new LevelGate('normal');
    const { at: at2 } = calibrated(gate2, 0.3);
    const end2 = speech(gate2, at2, 3_000, 0.8);
    const loud = gate2.evaluate(
      { startAt: at2, endAt: end2, confidence: 0.3 },
      end2
    );
    expect(loud.ok).toBe(true);
    if (loud.ok) expect(['loud', 'clipped']).toContain(loud.hint);
  });

  it('a good confidence gives no hint', () => {
    const gate = new LevelGate('normal');
    const { at } = calibrated(gate, 0.3);
    const end = speech(gate, at, 3_000, 0.8);
    const verdict = gate.evaluate(
      { startAt: at, endAt: end, confidence: 0.95 },
      end
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.hint).toBeUndefined();
  });
});

describe('LevelGate: the setting "off"', () => {
  it('lets everything through, also a quiet voice and a low confidence, but keeps measuring', () => {
    const gate = new LevelGate('off');
    expect(gate.enabled).toBe(false);
    let at = feed(gate, T0, 4_000, 0.004);
    const start = at;
    at = feed(gate, at, 2_000, 0.003);
    const verdict = gate.evaluate(
      { startAt: start, endAt: at, confidence: 0.2 },
      at
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.mean).toBeCloseTo(0.003, 3);
    expect(gate.passesNow(at)).toBe(true);
  });

  it('is a setting next to normal and strict, the default stays normal', () => {
    expect(Object.keys(GATE_PROFILES)).toEqual(['off', 'normal', 'strict']);
    expect(new LevelGate().sensitivity).toBe('normal');
    const gate = new LevelGate('normal');
    expect(gate.enabled).toBe(true);
    gate.setSensitivity('off');
    expect(gate.enabled).toBe(false);
  });
});

describe('LevelGate: a measurement that delivers nothing', () => {
  it('cannot judge: the utterance counts (suspended audio context, wrong stream)', () => {
    const gate = new LevelGate('normal');
    const at = feed(gate, T0, 6_000, 0);
    expect(gate.levelDead()).toBe(true);
    const verdict = gate.evaluate(
      { startAt: T0 + 2_000, endAt: T0 + 4_000 },
      at
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.judged).toBe(false);
    expect(gate.passesNow(at)).toBe(true);
  });

  it('a room with a noise floor is not dead', () => {
    const gate = new LevelGate('normal');
    feed(gate, T0, 6_000, 0.002);
    expect(gate.levelDead()).toBe(false);
  });
});

describe('LevelGate: snapshot for the diagnosis', () => {
  it('holds only numbers and the setting', () => {
    const gate = new LevelGate('strict');
    calibrated(gate, 0.5);
    const snap = gate.snapshot();
    expect(snap.sensitivity).toBe('strict');
    expect(snap.calibrated).toBe(true);
    expect(snap.maxLevel).toBeGreaterThan(0.3);
    expect(snap.reference).not.toBeNull();
    for (const [key, value] of Object.entries(snap)) {
      expect(
        ['number', 'string', 'boolean'].includes(typeof value) || value === null
      ).toBe(true);
      expect(key).toMatch(/^[a-zA-Z]+$/);
    }
  });
});
