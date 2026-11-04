import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  DIAG_MAX_ENTRIES,
  DIAG_STORAGE_KEY,
  buildDiagnosis,
  copyText,
  diagnosisEntries,
  noteMicrophone,
  recordDiagnosis,
  resetDiagnosticsForTests,
  sanitizeEntry,
} from '@/lib/hai/voice/client/diagnostics';
import { LevelGate } from '@/lib/hai/voice/levelGate';
import { readFilterSettings } from '@/lib/hai/voice/filterSettings';

// The diagnosis of the voice mode: always on, only numbers and short tokens, a ring buffer of
// 50 entries in memory and in the sessionStorage, never any text, never sent anywhere.

const entry = (n: number, why = 'background') => ({
  kind: 'discarded',
  why,
  mean: 0.03 + n / 1000,
  peak: 0.06,
  threshold: 0.09,
  ambient: 0.004,
  reference: 0.4,
  confidence: 0.98,
  setting: 'normal' as const,
});

describe('diagnosis buffer', () => {
  beforeEach(() => {
    let clock = 1_000;
    resetDiagnosticsForTests(() => (clock += 10));
  });

  it('keeps the entries in order with the time of the decision', () => {
    recordDiagnosis(entry(1));
    recordDiagnosis(entry(2, 'quiet'));
    const entries = diagnosisEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].t).toBeLessThan(entries[1].t);
    expect(entries[1].why).toBe('quiet');
    expect(entries[0].reference).toBe(0.4);
  });

  it('is a ring buffer of the last 50', () => {
    for (let i = 0; i < DIAG_MAX_ENTRIES + 25; i += 1) {
      recordDiagnosis(entry(i));
    }
    const entries = diagnosisEntries();
    expect(entries).toHaveLength(50);
    // the oldest are gone, the newest is there
    expect(entries[entries.length - 1].mean).toBeCloseTo(
      0.03 + (DIAG_MAX_ENTRIES + 24) / 1000,
      4
    );
    expect(
      JSON.parse(window.sessionStorage.getItem(DIAG_STORAGE_KEY) as string)
    ).toHaveLength(50);
  });

  it('is kept in the sessionStorage of the tab and read back after a reload', () => {
    recordDiagnosis(entry(1));
    recordDiagnosis(entry(2));
    let reloaded: typeof import('@/lib/hai/voice/client/diagnostics');
    jest.isolateModules(() => {
      reloaded = require('@/lib/hai/voice/client/diagnostics');
    });
    expect(reloaded!.diagnosisEntries()).toHaveLength(2);
  });

  it('takes only numbers and short tokens: a sentence in a field is dropped', () => {
    const clean = sanitizeEntry({
      t: 5,
      kind: 'discarded',
      why: 'Das ist ein geheimer Satz über den Chef',
      mean: 0.1234567,
      peak: Number.NaN,
      threshold: 0.2,
      ambient: 0.01,
      reference: null,
      confidence: null,
      setting: 'normal',
      // @ts-expect-error a slip of a caller: a field that is not part of an entry
      text: 'Geheimer Text',
    });
    expect(clean).not.toBeNull();
    expect(clean?.why).toBe('unknown');
    expect(clean?.mean).toBe(0.1235);
    expect(clean?.peak).toBe(0);
    expect(JSON.stringify(clean)).not.toMatch(/geheim|Chef|Text/i);
    expect(sanitizeEntry({ kind: 'x' })).toBeNull();
  });

  it('an entry with an unknown setting counts as normal', () => {
    const clean = sanitizeEntry({
      ...entry(1),
      t: 1,
      setting: 'weird' as never,
    });
    expect(clean?.setting).toBe('normal');
  });

  it('survives a broken sessionStorage and a storage that refuses', () => {
    window.sessionStorage.setItem(DIAG_STORAGE_KEY, '{kaputt');
    resetDiagnosticsForTests();
    window.sessionStorage.setItem(DIAG_STORAGE_KEY, '{kaputt');
    expect(diagnosisEntries()).toEqual([]);
    const spy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('full');
      });
    expect(() => recordDiagnosis(entry(1))).not.toThrow();
    expect(diagnosisEntries()).toHaveLength(1);
    spy.mockRestore();
  });
});

describe('diagnosis document', () => {
  beforeEach(() => resetDiagnosticsForTests(() => 1_700_000_000_000));

  const context = (gate: LevelGate) => ({
    gate: gate.snapshot(),
    pushToTalk: false,
    signalWords: true,
    calibration: 'done',
    calibrationReason: null,
    provider: 'soniox',
    live: true,
  });

  it('holds the setting, the microphone as the browser delivers it, the device name and the numbers', () => {
    noteMicrophone(
      {
        profile: 'live',
        sampleRate: 48_000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
        muted: false,
        readyState: 'live',
        ctx: 'running',
      },
      'Mikrofon (USB Headset)'
    );
    recordDiagnosis(entry(1));
    const gate = new LevelGate('strict');
    gate.push(0.2, 1);
    const doc = buildDiagnosis(context(gate));
    expect(doc.type).toBe('hai-voice-diagnosis');
    expect(doc.setting).toBe('strict');
    expect(doc.createdAt).toBe('2023-11-14T22:13:20.000Z');
    expect(doc.microphone.profile).toBe('live');
    expect(doc.microphone.device).toBe('Mikrofon (USB Headset)');
    expect(doc.microphone.delivered.autoGainControl).toBe(false);
    expect(doc.microphone.delivered.ctx).toBe('running');
    expect(doc.browser).toContain('jsdom');
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toMatchObject({
      why: 'background',
      threshold: 0.09,
      ambient: 0.004,
      reference: 0.4,
      confidence: 0.98,
    });
    expect(doc.gate.maxLevel).toBe(0.2);
  });

  it('works without a device name and without any entry', () => {
    const doc = buildDiagnosis(context(new LevelGate()));
    expect(doc.microphone.device).toBeNull();
    expect(doc.microphone.profile).toBe('unknown');
    expect(doc.entries).toEqual([]);
    expect(doc.gate.reference).toBeNull();
  });

  it('drops microphone fields that are no numbers, flags or short tokens', () => {
    noteMicrophone({
      profile: 'live',
      weird: 'ein ganzer Satz mit Leerzeichen und Umlauten ä',
      'bad key': 1,
      nan: Number.NaN,
    });
    const doc = buildDiagnosis(context(new LevelGate()));
    expect(doc.microphone.delivered).toEqual({ profile: 'live' });
  });
});

describe('copyText', () => {
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).clipboard;
    delete (document as unknown as Record<string, unknown>).execCommand;
  });

  it('uses the clipboard of the browser', async () => {
    const writeText = jest.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    expect(await copyText('abc')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
  });

  it('falls back to the old copy command when the clipboard refuses', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
      configurable: true,
    });
    const exec = jest.fn(() => true);
    (document as unknown as Record<string, unknown>).execCommand = exec;
    expect(await copyText('abc')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('is false when nothing can copy', async () => {
    expect(await copyText('abc')).toBe(false);
    (document as unknown as Record<string, unknown>).execCommand = () => {
      throw new Error('no');
    };
    expect(await copyText('abc')).toBe(false);
  });
});

describe('the setting "off" on the device', () => {
  it('is read, unknown values are normal', () => {
    const storage = (value: string | null) => ({
      getItem: () => value,
      setItem: () => undefined,
    });
    expect(readFilterSettings(storage('off')).sensitivity).toBe('off');
    expect(readFilterSettings(storage('strict')).sensitivity).toBe('strict');
    expect(readFilterSettings(storage('quatsch')).sensitivity).toBe('normal');
    expect(readFilterSettings(storage(null)).sensitivity).toBe('normal');
  });
});
