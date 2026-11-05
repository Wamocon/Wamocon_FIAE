import { act, renderHook } from '@testing-library/react';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  CALIBRATION_MS,
  CHOICE_MS,
  CHOICE_SNOOZE_MS,
  FILTER_NOTE_MS,
  useHaiVoice,
  type RecognitionLike,
  type SpeakerLike,
  type UtteranceInfo,
  type VoiceEnv,
} from '@/components/hai/useHaiVoice';
import {
  PUSH_TO_TALK_KEY,
  SENSITIVITY_KEY,
} from '@/lib/hai/voice/filterSettings';
import {
  DIAG_MAX_ENTRIES,
  diagnosisEntries,
  resetDiagnosticsForTests,
} from '@/lib/hai/voice/client/diagnostics';

// The gate never locks the person out: calibration at the start, the way out after two
// utterances that were left out although they stand above the room, the setting off, the
// hint for a loud voice with low confidence, the local diagnosis. The recognition is a
// double that reports levels and utterances like Soniox.

type Msg = { id: string; role: string; content: string };

const CONSENT_V2 = 'hai-voice-consent-v2:u1';
const STEP = 100;
/** Level of the person at the microphone and of a voice across the room (RMS times five). */
const OWN = 0.55;
const ROOM = 0.03;

class LiveRecognition implements RecognitionLike {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: RecognitionLike['onresult'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null;
  onaudiostart: RecognitionLike['onaudiostart'] = null;
  onlevel: RecognitionLike['onlevel'] = null;
  onutterance: RecognitionLike['onutterance'] = null;
  started = 0;
  aborted = 0;
  stopped = 0;

  get live() {
    return this.continuous;
  }
  start() {
    this.started += 1;
  }
  stop() {
    this.stopped += 1;
  }
  abort() {
    this.aborted += 1;
  }
  /** What is understood so far, not final yet. */
  hear(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal: false })],
    });
  }
  /** A word that became final (it counts for the end of a round). */
  final(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal: true })],
    });
  }
  utter(text: string, info?: UtteranceInfo) {
    this.onutterance?.(text, info);
  }
}

function makeEnv(
  options: { storage?: Record<string, string>; live?: boolean } = {}
) {
  const recognitions: LiveRecognition[] = [];
  const log: string[] = [];
  const prefetched: string[] = [];
  let onDone: (() => void) | null = null;
  const store: Record<string, string> = {
    [CONSENT_V2]: 'browser,live',
    'hai-voice-consent-v1:u1': 'yes',
    'hai-voice-day-start:u1': '2026-11-04',
    ...options.storage,
  };
  const speaker: SpeakerLike = {
    say: piece => {
      log.push(`say:${piece}`);
    },
    warm: () => {
      log.push('warm');
    },
    end: () => {
      log.push('end');
    },
    cancel: () => {
      log.push('cancel');
    },
  };
  const env: VoiceEnv = {
    createRecognition: async () => {
      const rec = new LiveRecognition();
      recognitions.push(rec);
      return { rec, local: false };
    },
    synth: null,
    makeUtterance: () => {
      throw new Error('the browser must not speak');
    },
    storage: {
      getItem: k => store[k] ?? null,
      setItem: (k, v) => {
        store[k] = v;
      },
    },
    now: () => new Date('2026-11-04T07:30:00Z'),
    createSpeaker: handlers => {
      onDone = handlers.onDone;
      log.push('speaker');
      return speaker;
    },
    unlockAudio: () => undefined,
    prefetch: purpose => {
      prefetched.push(purpose);
    },
    ...(options.live === false ? {} : { live: true }),
    micSignal: true,
  };
  return {
    env,
    recognitions,
    log,
    store,
    prefetched,
    finish: () => onDone?.(),
  };
}

function setup(env: VoiceEnv, extra: Record<string, unknown> = {}) {
  const props = {
    userId: 'u1' as string | null,
    enabled: true,
    messages: [] as Msg[],
    streamingMessageId: null as string | null,
    sendMessage: jest.fn(async () => undefined),
    stopGeneration: jest.fn(),
    placeholderText: 'Denkt nach...',
    env,
    ...extra,
  };
  const hook = renderHook((p: typeof props) => useHaiVoice(p as never), {
    initialProps: props,
  });
  const update = (next: Partial<typeof props>) =>
    hook.rerender({ ...props, ...next });
  return { hook, update, props };
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
const wait = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

/** The recording shows `level` for `ms` (ten samples a second), like the recognition does. */
async function level(rec: LiveRecognition, value: number, ms: number) {
  for (let i = 0; i < ms / STEP; i += 1) {
    act(() => rec.onlevel?.(value));
    await wait(STEP);
  }
}

/** A finished utterance with the time window of the last `ms` and a confidence. */
function utter(
  rec: LiveRecognition,
  text: string,
  ms = 1_500,
  confidence?: number
) {
  const endAt = Date.now();
  act(() =>
    rec.utter(text, {
      startAt: endAt - ms,
      endAt,
      ...(confidence !== undefined ? { confidence } : {}),
    })
  );
}

const question: Msg = { id: 'q1', role: 'user', content: 'Frage' };
const answer = (content: string, id = 'a1'): Msg => ({
  id,
  role: 'assistant',
  content,
});
const ANSWER =
  'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig. Er ist nie leer.';

async function started(storage: Record<string, string> = {}) {
  const t = makeEnv({ storage });
  const s = setup(t.env);
  act(() => s.hook.result.current.start());
  await flush();
  const rec = t.recognitions[0];
  act(() => rec.onaudiostart?.());
  return { t, s, rec };
}

/** The conversation is started and the microphone is open: the calibration waits for the phrase. */
async function calibrating(storage: Record<string, string> = {}) {
  const ctx = await started(storage);
  await level(ctx.rec, 0.003, 3_000);
  return ctx;
}

/** The person says "Hallo HAI" at `loudness`. */
async function sayHello(rec: LiveRecognition, loudness = OWN) {
  await level(rec, loudness, 800);
  utter(rec, 'Hallo HAI.', 800, 0.95);
  await level(rec, 0.003, 600);
}

/** Calibrated with a normal voice. */
async function calibrated(storage: Record<string, string> = {}) {
  const ctx = await calibrating(storage);
  await sayHello(ctx.rec);
  expect(ctx.s.hook.result.current.calibration).toBe('done');
  return ctx;
}

/** An utterance of the room: above the room level, under the person (another voice). */
async function roomTalk(rec: LiveRecognition, text = 'Gemurmel im Raum') {
  await level(rec, ROOM, 1_500);
  utter(rec, text, 1_500, 0.98);
  await level(rec, 0.003, 500);
}

function fakeTimers() {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    resetDiagnosticsForTests();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    resetDiagnosticsForTests();
  });
}

describe('calibration at the start', () => {
  fakeTimers();

  it('asks for the phrase when the microphone opens, the phrase goes to no chat and sets the reference', async () => {
    const { s, rec } = await calibrating();
    const voice = () => s.hook.result.current;
    expect(voice().calibration).toBe('listening');
    expect(voice().filterPrompt).toBe('calibrate');
    await sayHello(rec);
    expect(voice().calibration).toBe('done');
    expect(voice().filterPrompt).toBeNull();
    expect(s.props.sendMessage).not.toHaveBeenCalled();
    expect(voice().phase).toBe('listening');
    // the first question afterwards is a question
    await level(rec, OWN, 1_500);
    utter(rec, 'Was ist ein Primärschlüssel?', 1_500, 0.98);
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
    const entry = diagnosisEntries().find(e => e.kind === 'calibration');
    expect(entry?.why).toBe('ok');
    expect(entry?.reference).toBeGreaterThan(0.1);
  });

  it('shows no provisional text during the calibration (it could be a voice of the room)', async () => {
    const { s, rec } = await calibrating();
    await level(rec, OWN, 500);
    act(() => rec.hear('Hast du gestern den Bericht'));
    expect(s.hook.result.current.interim).toBe('');
  });

  it('a microphone with a low gain (voice at level 0.05) is calibrated and heard afterwards', async () => {
    const { s, rec } = await calibrating();
    await sayHello(rec, 0.05);
    expect(s.hook.result.current.calibration).toBe('done');
    await level(rec, 0.05, 1_800);
    utter(rec, 'Erkläre mir bitte den Fremdschlüssel', 1_800, 0.99);
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
    expect(s.hook.result.current.filterNote).toBeNull();
  });

  it('a conversation of the room does not set the reference: a long sentence without a greeting is left out', async () => {
    const { s, rec } = await calibrating();
    await level(rec, ROOM, 1_800);
    utter(rec, 'Hast du gestern schon den Bericht fertig gemacht', 1_800, 0.98);
    const voice = s.hook.result.current;
    expect(voice.calibration).toBe('listening');
    expect(voice.filterPrompt).toBe('calibrate');
    expect(s.props.sendMessage).not.toHaveBeenCalled();
    // the person then says the phrase
    await sayHello(rec);
    expect(s.hook.result.current.calibration).toBe('done');
  });

  it('fails when the voice is too quiet: guidance and the choice, and the person is still heard (no lock out)', async () => {
    const { s, rec } = await calibrating();
    await sayHello(rec, 0.008);
    const voice = () => s.hook.result.current;
    expect(voice().calibration).toBe('failed');
    expect(voice().calibrationReason).toBe('quiet');
    expect(voice().filterPrompt).toBe('calibration-failed');
    expect(s.props.sendMessage).not.toHaveBeenCalled();
    // no reference, but only the very low safety bound: a quiet question counts
    await level(rec, 0.06, 1_800);
    utter(rec, 'Was ist ein Index?', 1_800, 0.99);
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
    expect(
      diagnosisEntries().some(
        e => e.why === 'quiet' && e.kind === 'calibration'
      )
    ).toBe(true);
  });

  it('fails when no phrase comes in time', async () => {
    const { s } = await calibrating();
    await wait(CALIBRATION_MS);
    expect(s.hook.result.current.calibration).toBe('failed');
    expect(s.hook.result.current.calibrationReason).toBe('nothing');
    expect(s.hook.result.current.filterPrompt).toBe('calibration-failed');
  });

  it('can be skipped, then the gate stays tolerant', async () => {
    const { s, rec } = await calibrating();
    act(() => s.hook.result.current.skipCalibration());
    expect(s.hook.result.current.calibration).toBe('skipped');
    expect(s.hook.result.current.filterPrompt).toBeNull();
    await level(rec, 0.06, 1_800);
    utter(rec, 'Was ist ein Index?', 1_800, 0.99);
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('"Mikrofon neu einmessen" asks for the phrase again, also while the assistant speaks', async () => {
    const { t, s, rec } = await calibrated();
    await level(rec, OWN, 1_500);
    utter(rec, 'Und was ist ein Fremdschlüssel', 1_500);
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
    s.update({
      messages: [
        question,
        answer(
          'Ein Fremdschlüssel verweist auf eine andere Tabelle. Er sichert die Beziehung.'
        ),
      ],
      streamingMessageId: 'a1',
    });
    expect(s.hook.result.current.phase).toBe('speaking');
    t.log.length = 0;
    act(() => s.hook.result.current.recalibrate());
    expect(t.log).toContain('cancel');
    expect(s.hook.result.current.calibration).toBe('listening');
    expect(s.hook.result.current.filterPrompt).toBe('calibrate');
    s.props.sendMessage.mockClear();
    await sayHello(rec);
    expect(s.hook.result.current.calibration).toBe('done');
    expect(s.props.sendMessage).not.toHaveBeenCalled();
  });

  it('"Gespräch beenden" during the calibration still ends the mode', async () => {
    const { s, rec } = await calibrating();
    await level(rec, OWN, 1_000);
    utter(rec, 'Gespräch beenden', 1_000, 0.95);
    expect(s.hook.result.current.phase).toBe('idle');
  });

  it('there is none with the setting off, with push to talk, and none when the hook is told not to', async () => {
    const off = await started({ [SENSITIVITY_KEY]: 'off' });
    expect(off.s.hook.result.current.calibration).toBe('idle');
    expect(off.s.hook.result.current.filterPrompt).toBeNull();

    const ptt = makeEnv({ storage: { [PUSH_TO_TALK_KEY]: 'on' } });
    const p = setup(ptt.env);
    act(() => p.hook.result.current.start());
    await flush();
    expect(p.hook.result.current.calibration).toBe('idle');

    const plain = makeEnv();
    const q = setup(plain.env, { calibrate: false });
    act(() => q.hook.result.current.start());
    await flush();
    act(() => plain.recognitions[0].onaudiostart?.());
    expect(q.hook.result.current.calibration).toBe('idle');
  });

  it('ending the conversation takes every open question away', async () => {
    const { s } = await calibrating();
    expect(s.hook.result.current.filterPrompt).toBe('calibrate');
    act(() => s.hook.result.current.stop());
    expect(s.hook.result.current.filterPrompt).toBeNull();
    expect(s.hook.result.current.calibration).toBe('idle');
  });

  it('a failed calibration does not end the conversation while its question is open, and goes away after a while', async () => {
    const { s } = await calibrating();
    await wait(CALIBRATION_MS);
    expect(s.hook.result.current.filterPrompt).toBe('calibration-failed');
    // longer than three silent rounds: the question is open, so nothing ended
    await wait(20_000);
    expect(s.hook.result.current.phase).toBe('listening');
    expect(s.hook.result.current.filterPrompt).toBe('calibration-failed');
    await wait(CHOICE_MS);
    expect(s.hook.result.current.filterPrompt).toBeNull();
  });

  it('push to talk switched on in the middle of the calibration ends it', async () => {
    const { s } = await calibrating();
    act(() => s.hook.result.current.setPushToTalk(true));
    expect(s.hook.result.current.filterPrompt).toBeNull();
    expect(s.hook.result.current.calibration).toBe('idle');
  });
});

describe('the way out after two utterances in a row that stand above the room', () => {
  fakeTimers();

  it('offers the choice at once, nothing is sent, nothing is dropped silently', async () => {
    const { s, rec } = await calibrated();
    await roomTalk(rec);
    expect(s.hook.result.current.filterPrompt).toBeNull();
    expect(s.hook.result.current.filterNote).toBe('only-you');
    await roomTalk(rec);
    expect(s.hook.result.current.filterPrompt).toBe('lost');
    expect(s.props.sendMessage).not.toHaveBeenCalled();
    expect(
      diagnosisEntries().some(e => e.kind === 'choice' && e.why === 'lost')
    ).toBe(true);
  });

  it('goes away when the person is heard again', async () => {
    const { s, rec } = await calibrated();
    await roomTalk(rec);
    await roomTalk(rec);
    expect(s.hook.result.current.filterPrompt).toBe('lost');
    await level(rec, OWN, 1_500);
    utter(rec, 'Ich bin wieder laut genug', 1_500);
    expect(s.hook.result.current.filterPrompt).toBeNull();
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('one voice and then the person is no way out', async () => {
    const { s, rec } = await calibrated();
    await roomTalk(rec);
    await level(rec, OWN, 1_500);
    utter(rec, 'Ich bin es', 1_500);
    await roomTalk(rec);
    expect(s.hook.result.current.filterPrompt).toBeNull();
  });

  it('choice "Filter aus": the prompt closes, the next voice counts', async () => {
    const { t, s, rec } = await calibrated();
    await roomTalk(rec);
    await roomTalk(rec);
    act(() => s.hook.result.current.setSensitivity('off'));
    expect(s.hook.result.current.filterPrompt).toBeNull();
    expect(t.store[SENSITIVITY_KEY]).toBe('off');
    await roomTalk(rec, 'Jetzt zählt auch das');
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('choice "Drücken zum Sprechen": the prompt closes and the microphone waits for the button', async () => {
    const { t, s, rec } = await calibrated();
    await roomTalk(rec);
    await roomTalk(rec);
    act(() => s.hook.result.current.setPushToTalk(true));
    expect(s.hook.result.current.filterPrompt).toBeNull();
    expect(t.store[PUSH_TO_TALK_KEY]).toBe('on');
  });

  it('choice "Mikrofon neu einmessen": the phrase is asked for again', async () => {
    const { s, rec } = await calibrated();
    await roomTalk(rec);
    await roomTalk(rec);
    act(() => s.hook.result.current.recalibrate());
    expect(s.hook.result.current.filterPrompt).toBe('calibrate');
    await sayHello(rec);
    expect(s.hook.result.current.calibration).toBe('done');
    expect(s.hook.result.current.filterPrompt).toBeNull();
  });

  it('goes away by itself and does not come back at once; closing it does the same', async () => {
    const { s, rec } = await calibrated();
    await roomTalk(rec);
    await roomTalk(rec);
    expect(s.hook.result.current.filterPrompt).toBe('lost');
    await wait(CHOICE_MS + 100);
    expect(s.hook.result.current.filterPrompt).toBeNull();
    await roomTalk(rec);
    await roomTalk(rec);
    expect(s.hook.result.current.filterPrompt).toBeNull();
    // the clock moves on (no timers: the silent rounds would end the mode)
    jest.setSystemTime(Date.now() + CHOICE_SNOOZE_MS);
    await level(rec, 0.003, 3_000);
    await roomTalk(rec);
    await roomTalk(rec);
    expect(s.hook.result.current.filterPrompt).toBe('lost');
    act(() => s.hook.result.current.dismissFilterPrompt());
    expect(s.hook.result.current.filterPrompt).toBeNull();
  });
});

describe('one text per reason, loud voice, setting off', () => {
  fakeTimers();

  it('another voice, not understood and real silence are three different notes', async () => {
    const { s, rec } = await calibrated();
    // another voice
    await roomTalk(rec);
    expect(s.hook.result.current.filterNote).toBe('only-you');
    // not understood: a normal level, low confidence
    await level(rec, OWN / 3, 1_500);
    utter(rec, 'Mmh hmm äh', 1_500, 0.4);
    expect(s.hook.result.current.filterNote).toBe('unclear');
    await wait(FILTER_NOTE_MS + 100);
    // real silence: only a murmur far under the room, twice
    for (let i = 0; i < 2; i += 1) {
      await level(rec, 0.003, 500);
      await level(rec, 0.006, 1_000);
      utter(rec, `Gemurmel ${i}`, 1_000, 0.9);
    }
    expect(s.hook.result.current.filterNote).toBe('too-quiet');
  });

  it('a loud voice with a low confidence is not dropped: it counts, the note asks to speak softer', async () => {
    const { s, rec } = await calibrated();
    await level(rec, 1, 1_500);
    utter(rec, 'Ich schreie in das Mikrofon', 1_500, 0.3);
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
    expect(s.hook.result.current.filterNote).toBe('loud');
    const hint = diagnosisEntries().find(e => e.kind === 'hint');
    expect(hint?.why).toBe('clipped');
    await wait(FILTER_NOTE_MS + 100);
    expect(s.hook.result.current.filterNote).toBeNull();
  });

  it('the note "speak louder" never comes at a high level', async () => {
    const { s, rec } = await calibrated();
    for (let i = 0; i < 4; i += 1) {
      await level(rec, 0.35, 1_500);
      utter(rec, `Etwas Leises ${i}`, 1_500, 0.4);
      expect(s.hook.result.current.filterNote).not.toBe('too-quiet');
    }
  });

  it('off: a quiet voice and a low confidence are questions, signal words still work', async () => {
    const { s, rec } = await started({ [SENSITIVITY_KEY]: 'off' });
    await level(rec, 0.003, 3_000);
    await level(rec, 0.01, 1_500);
    utter(rec, 'Eine ganz leise Frage', 1_500, 0.3);
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
    expect(s.hook.result.current.filterNote).toBeNull();
    expect(s.hook.result.current.sensitivity).toBe('off');
    await level(rec, OWN, 800);
    utter(rec, 'Gespräch beenden', 800, 0.95);
    expect(s.hook.result.current.phase).toBe('idle');
  });

  it('the default stays normal', async () => {
    const { s } = await started();
    expect(s.hook.result.current.sensitivity).toBe('normal');
  });
});

describe('the local diagnosis', () => {
  fakeTimers();

  it('runs without the measuring switch and keeps only numbers and reasons, never the text', async () => {
    window.localStorage.removeItem('hai-voice-trace');
    const { s, rec } = await calibrated();
    await roomTalk(rec, 'Geheimes Hintergrundgespräch über den Chef');
    const entries = diagnosisEntries();
    const discarded = entries.find(e => e.kind === 'discarded');
    expect(discarded).toBeDefined();
    expect(discarded?.why).toBe('background');
    for (const key of ['mean', 'peak', 'threshold', 'ambient'] as const) {
      expect(typeof discarded?.[key]).toBe('number');
    }
    expect(typeof discarded?.reference).toBe('number');
    expect(discarded?.confidence).toBeCloseTo(0.98, 2);
    expect(discarded?.setting).toBe('normal');
    expect(JSON.stringify(entries)).not.toMatch(/Hintergrund|Chef|Geheim/);
    expect(window.sessionStorage.getItem('hai-voice-diag') ?? '').not.toMatch(
      /Hintergrund|Chef|Geheim/
    );
    expect(s.props.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps the last 50 entries', async () => {
    const { rec } = await calibrated();
    for (let i = 0; i < DIAG_MAX_ENTRIES + 10; i += 1) {
      await level(rec, ROOM, 300);
      utter(rec, `Rauschen ${i}`, 300, 0.9);
    }
    expect(diagnosisEntries().length).toBe(DIAG_MAX_ENTRIES);
  });

  it('"Diagnose kopieren" puts the numbers on the clipboard: setting, microphone, no text', async () => {
    const write = jest.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write },
      configurable: true,
    });
    const { s, rec } = await calibrated();
    await roomTalk(rec, 'Privates Gespräch');
    let done = false;
    await act(async () => {
      done = await s.hook.result.current.copyDiagnosis();
    });
    expect(done).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    const text = write.mock.calls[0][0];
    expect(text).not.toMatch(/Privates|Gespräch/);
    const json = JSON.parse(text);
    expect(json.type).toBe('hai-voice-diagnosis');
    expect(json.setting).toBe('normal');
    expect(json.calibration.state).toBe('done');
    expect(json.gate.reference).toBeGreaterThan(0);
    expect(json.gate.calibrated).toBe(true);
    expect(json.microphone).toHaveProperty('profile');
    expect(
      json.entries.some((e: { why: string }) => e.why === 'background')
    ).toBe(true);
    delete (navigator as unknown as Record<string, unknown>).clipboard;
  });
});
