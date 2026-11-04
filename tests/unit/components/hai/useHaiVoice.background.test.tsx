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
  FILTER_NOTE_MS,
  QUIET_STREAK,
  SIGNAL_HINT_MS,
  useHaiVoice,
  type RecognitionLike,
  type SpeakerLike,
  type UtteranceInfo,
  type VoiceEnv,
} from '@/components/hai/useHaiVoice';
import {
  PUSH_TO_TALK_KEY,
  SENSITIVITY_KEY,
  SIGNAL_HINT_KEY,
  SIGNAL_WORDS_KEY,
} from '@/lib/hai/voice/filterSettings';
import {
  TRACE_STORAGE_KEY,
  resetTraceForTests,
  traceEntries,
} from '@/lib/hai/voice/client/trace';

// Only the voice of the person counts: the loudness gate and the confidence in the loop,
// signal words (halt, end, microphone off), push to talk, the settings, the measuring points
// without text. The recognition is a double that reports levels and utterances like Soniox.

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

/** The person was heard once (the reference of the voice is set), the room is quiet. */
async function withReference(storage: Record<string, string> = {}) {
  const ctx = await started(storage);
  await level(ctx.rec, ROOM / 10, 3_000);
  await level(ctx.rec, OWN, 1_500);
  utter(ctx.rec, 'Erkläre mir bitte den Primärschlüssel');
  expect(ctx.s.props.sendMessage).toHaveBeenCalledTimes(1);
  // the answer is read and finished, the loop listens again
  ctx.s.update({
    messages: [question, answer(ANSWER)],
    streamingMessageId: null,
  });
  act(() => ctx.t.finish());
  await flush();
  await wait(3_000); // the echo window of the answer is over
  expect(ctx.s.hook.result.current.phase).toBe('listening');
  ctx.s.props.sendMessage.mockClear();
  return ctx;
}

/** The assistant is speaking, with the reference of the person set. */
async function speakingWithReference(storage: Record<string, string> = {}) {
  const ctx = await withReference(storage);
  await level(ctx.rec, ROOM / 10, 1_500);
  await level(ctx.rec, OWN, 1_500);
  utter(ctx.rec, 'Und was ist ein Fremdschlüssel');
  expect(ctx.s.props.sendMessage).toHaveBeenCalledTimes(1);
  ctx.s.update({
    messages: [
      question,
      answer(ANSWER),
      { id: 'q2', role: 'user', content: 'Frage 2' },
      answer(
        'Ein Fremdschlüssel verweist auf eine andere Tabelle. Er sichert die Beziehung.',
        'a2'
      ),
    ],
    streamingMessageId: 'a2',
  });
  expect(ctx.s.hook.result.current.phase).toBe('speaking');
  ctx.s.props.sendMessage.mockClear();
  // what the speaker did so far is history: a 'cancel' from here on is an interruption
  ctx.t.log.length = 0;
  return ctx;
}

describe('only the voice of the person counts: loudness gate and confidence', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-04T10:00:00Z'));
    window.localStorage.removeItem(TRACE_STORAGE_KEY);
    resetTraceForTests();
  });
  afterEach(() => {
    jest.useRealTimers();
    window.localStorage.removeItem(TRACE_STORAGE_KEY);
    resetTraceForTests();
  });

  it('the person at the microphone is heard: the question goes to the chat', async () => {
    const { s, rec } = await started();
    await level(rec, 0.003, 3_000);
    await level(rec, OWN, 1_500);
    utter(rec, 'Was ist ein Primärschlüssel?', 1_500, 0.99);
    expect(s.props.sendMessage).toHaveBeenCalledWith(
      'Was ist ein Primärschlüssel?',
      { voice: true }
    );
    expect(s.hook.result.current.heard).toBe('Was ist ein Primärschlüssel?');
    expect(s.hook.result.current.filterNote).toBeNull();
  });

  it('a quiet voice in the room is dropped once the person was heard: nothing is sent, shown or kept', async () => {
    const { s, rec } = await withReference();
    await level(rec, ROOM / 10, 1_500);
    // the room talks quietly: the provisional text is not shown either
    await level(rec, ROOM, 1_500);
    act(() => rec.hear('Hast du gestern den Bericht fertig gemacht'));
    expect(s.hook.result.current.interim).toBe('');
    utter(rec, 'Hast du gestern den Bericht fertig gemacht?', 1_500, 0.98);
    expect(s.props.sendMessage).not.toHaveBeenCalled();
    expect(s.hook.result.current.phase).toBe('listening');
    expect(s.hook.result.current.interim).toBe('');
    // the person still counts for what was heard
    expect(s.hook.result.current.heard).toBe(
      'Erkläre mir bitte den Primärschlüssel'
    );
    expect(s.hook.result.current.filterNote).toBe('only-you');
  });

  it('the dropped utterance leaves only numbers in the measuring points, never a text', async () => {
    window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const { rec } = await withReference();
    await level(rec, ROOM / 10, 1_000);
    await level(rec, ROOM, 1_500);
    utter(rec, 'Geheimes Hintergrundgespräch über den Chef', 1_500, 0.97);
    const marks = traceEntries().filter(e => e.name === 'utterance.discarded');
    expect(marks).toHaveLength(1);
    expect(marks[0].data.why).toBe('quiet');
    for (const key of ['mean', 'peak', 'thr', 'conf']) {
      expect(typeof marks[0].data[key]).toBe('number');
    }
    expect(marks[0].data.conf).toBeCloseTo(0.97, 2);
    const everything = JSON.stringify(traceEntries());
    expect(everything).not.toMatch(/Hintergrund|Chef|Geheim/);
    jest.restoreAllMocks();
  });

  it('after several quiet utterances in a row the note asks to speak louder or closer, the person being heard again clears it', async () => {
    const { s, rec } = await withReference();
    for (let i = 0; i < QUIET_STREAK; i += 1) {
      await level(rec, ROOM / 10, 500);
      await level(rec, ROOM, 1_000);
      utter(rec, `Gemurmel ${i}`, 1_000);
    }
    expect(s.hook.result.current.filterNote).toBe('too-quiet');
    expect(s.props.sendMessage).not.toHaveBeenCalled();
    await level(rec, OWN, 1_200);
    utter(rec, 'Ich spreche jetzt wieder laut genug', 1_200);
    expect(s.hook.result.current.filterNote).toBeNull();
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('the note disappears by itself', async () => {
    const { s, rec } = await withReference();
    await level(rec, ROOM / 10, 500);
    await level(rec, ROOM, 1_000);
    utter(rec, 'Gemurmel', 1_000);
    expect(s.hook.result.current.filterNote).toBe('only-you');
    await wait(FILTER_NOTE_MS + 100);
    expect(s.hook.result.current.filterNote).toBeNull();
  });

  it('an utterance the recognition is not sure about is dropped (low confidence)', async () => {
    window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const { s, rec } = await withReference();
    await level(rec, OWN, 1_500);
    utter(rec, 'Mmh hmm äh', 1_500, 0.4);
    expect(s.props.sendMessage).not.toHaveBeenCalled();
    const marks = traceEntries().filter(e => e.name === 'utterance.discarded');
    expect(marks[0].data.why).toBe('confidence');
    // not a quiet one: the "speak louder" note never comes from low confidence
    expect(s.hook.result.current.filterNote).toBe('only-you');
    await level(rec, OWN, 1_500);
    utter(rec, 'Was ist ein Join', 1_500, 0.95);
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('without a measurement (a provider without levels) nothing is judged, the utterance counts', async () => {
    const { s, rec } = await started();
    act(() => rec.utter('Was ist ein Primärschlüssel?'));
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('strict asks for a louder voice than normal, and the choice is kept on the device', async () => {
    const run = async (sensitivity: 'normal' | 'strict') => {
      const { t, s, rec } = await withReference();
      act(() => s.hook.result.current.setSensitivity(sensitivity));
      expect(t.store[SENSITIVITY_KEY]).toBe(sensitivity);
      await level(rec, ROOM / 10, 500);
      await level(rec, OWN / 3, 1_500);
      utter(rec, 'Ich spreche etwas leiser jetzt', 1_500);
      return s.props.sendMessage.mock.calls.length;
    };
    expect(await run('normal')).toBe(1);
    expect(await run('strict')).toBe(0);
  });

  it('a saved strict setting is read when the conversation starts', async () => {
    const { s } = await started({ [SENSITIVITY_KEY]: 'strict' });
    expect(s.hook.result.current.sensitivity).toBe('strict');
  });

  it('a quiet voice does not interrupt the assistant, the person does', async () => {
    const { t, s, rec } = await speakingWithReference();
    await level(rec, ROOM / 10, 1_000);
    await level(rec, ROOM, 1_500);
    act(() => rec.hear('Hast du schon den Bericht fertig gemacht'));
    expect(s.props.stopGeneration).not.toHaveBeenCalled();
    expect(t.log).not.toContain('cancel');
    await level(rec, OWN, 600);
    act(() => rec.hear('Hast du schon den Bericht fertig gemacht'));
    expect(s.props.stopGeneration).toHaveBeenCalledTimes(1);
    expect(t.log).toContain('cancel');
  });

  it('a dropped utterance of the room never reaches the chat, whatever the order of events', async () => {
    const { s, rec } = await withReference();
    const secret = 'Das ist nur ein Gespräch im Nebenraum';
    for (let i = 0; i < 3; i += 1) {
      await level(rec, ROOM / 10, 400);
      await level(rec, ROOM, 1_200);
      act(() => rec.hear(secret));
      utter(rec, secret, 1_200, 0.96);
    }
    const sent = s.props.sendMessage.mock.calls.map(call => String(call[0]));
    expect(sent.join(' ')).not.toContain('Nebenraum');
    expect(s.hook.result.current.heard).not.toContain('Nebenraum');
    expect(s.hook.result.current.spoken.join(' ')).not.toContain('Nebenraum');
    expect(s.hook.result.current.interim).toBe('');
  });
});

describe('signal words: halt, end, microphone off', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-04T10:00:00Z'));
    window.localStorage.removeItem(TRACE_STORAGE_KEY);
    resetTraceForTests();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    window.localStorage.removeItem(TRACE_STORAGE_KEY);
    resetTraceForTests();
  });

  it('"Stopp" at the start of the provisional text stops the voice and the running answer at once, the mode stays open', async () => {
    const { t, s, rec } = await speakingWithReference();
    await level(rec, OWN, 500);
    act(() => rec.hear('Stopp'));
    expect(t.log).toContain('cancel');
    expect(s.props.stopGeneration).toHaveBeenCalledTimes(1);
    expect(s.hook.result.current.phase).toBe('listening');
    expect(s.hook.result.current.micOpen).toBe(true);
    // the end of that utterance is no question for the chat
    utter(rec, 'Stopp', 600, 0.97);
    expect(s.props.sendMessage).not.toHaveBeenCalled();
    expect(s.hook.result.current.phase).toBe('listening');
    expect(s.hook.result.current.interim).toBe('');
    // and the conversation goes on: the next question is heard
    await level(rec, OWN, 1_500);
    utter(rec, 'Erkläre mir den Unterschied', 1_500);
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    'Warte',
    'Moment',
    'Halt',
    'Ruhe',
    'Hör auf',
    'Abbrechen',
    'Pause',
    'Stop',
  ])('every halt word stops the assistant: %s', async word => {
    const { t, s, rec } = await speakingWithReference();
    await level(rec, OWN, 500);
    act(() => rec.hear(word));
    expect(t.log).toContain('cancel');
    expect(s.hook.result.current.phase).toBe('listening');
  });

  it('a halt word needs no second word and no minimum loudness of its own, but it does need the gate: a quiet "stopp" in the room stops nobody', async () => {
    const { t, s, rec } = await speakingWithReference();
    await level(rec, ROOM / 10, 1_000);
    await level(rec, ROOM, 1_500);
    act(() => rec.hear('Stopp'));
    expect(t.log).not.toContain('cancel');
    expect(s.props.stopGeneration).not.toHaveBeenCalled();
    expect(s.hook.result.current.phase).toBe('speaking');
    // the end of that utterance does not stop it either (it is dropped as quiet)
    utter(rec, 'Stopp', 600, 0.97);
    expect(t.log).not.toContain('cancel');
    expect(s.hook.result.current.phase).toBe('speaking');
  });

  it('the own voice of the assistant is no signal: its wait phrase "Einen Moment" does not stop it', async () => {
    const t = makeEnv();
    const s = setup(t.env, { waitPhrase: 'Einen Moment.' });
    act(() => s.hook.result.current.start());
    await flush();
    const rec = t.recognitions[0];
    act(() => rec.onaudiostart?.());
    act(() => rec.utter('Erkläre mir den Primärschlüssel'));
    await wait(3_100); // the waiting phrase is said
    expect(t.log).toContain('say:Einen Moment.');
    await level(rec, OWN, 500);
    act(() => rec.hear('Moment'));
    expect(s.props.stopGeneration).not.toHaveBeenCalled();
    expect(t.log).not.toContain('cancel');
  });

  it('a signal word in the middle of a sentence does not stop and goes on as a question', async () => {
    const { s, rec } = await withReference();
    await level(rec, OWN, 1_500);
    utter(rec, 'Das war nicht der Stopp', 1_500);
    expect(s.props.sendMessage).toHaveBeenCalledWith(
      'Das war nicht der Stopp',
      {
        voice: true,
      }
    );
  });

  it('a bare halt word while the loop only listens is no question', async () => {
    const { s, rec } = await withReference();
    await level(rec, OWN, 800);
    utter(rec, 'Warte', 800);
    expect(s.props.sendMessage).not.toHaveBeenCalled();
    expect(s.hook.result.current.phase).toBe('listening');
  });

  it('a halt word with a question behind it stops the assistant and the whole utterance is the next question', async () => {
    const { t, s, rec } = await speakingWithReference();
    await level(rec, OWN, 1_800);
    act(() => rec.hear('Moment mal, was ist ein Index?'));
    expect(t.log).toContain('cancel');
    utter(rec, 'Moment mal, was ist ein Index?', 1_800);
    expect(s.props.sendMessage).toHaveBeenCalledWith(
      'Moment mal, was ist ein Index?',
      { voice: true }
    );
  });

  it('the final utterance halts too when the provisional text never showed it', async () => {
    const { t, s, rec } = await speakingWithReference();
    await level(rec, OWN, 800);
    utter(rec, 'Stopp', 800, 0.98);
    expect(t.log).toContain('cancel');
    expect(s.props.stopGeneration).toHaveBeenCalledTimes(1);
    expect(s.props.sendMessage).not.toHaveBeenCalled();
    expect(s.hook.result.current.phase).toBe('listening');
  });

  it('"Gespräch beenden" ends the mode and sends nothing, "Tschüss" too', async () => {
    for (const phrase of ['Gespräch beenden', 'Tschüss', 'Auf Wiedersehen']) {
      const { s, rec } = await withReference();
      await level(rec, OWN, 1_200);
      utter(rec, phrase, 1_200, 0.99);
      expect(s.props.sendMessage).not.toHaveBeenCalled();
      expect(s.hook.result.current.phase).toBe('idle');
      expect(rec.aborted).toBe(1);
    }
  });

  it('"Beenden wir das Kapitel?" is a question, it does not end anything', async () => {
    const { s, rec } = await withReference();
    await level(rec, OWN, 1_500);
    utter(rec, 'Beenden wir das Kapitel?', 1_500);
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
    expect(s.hook.result.current.phase).toBe('thinking');
  });

  it('an end word from the room does not end the conversation (same gate)', async () => {
    const { s, rec } = await withReference();
    await level(rec, ROOM / 10, 500);
    await level(rec, ROOM, 1_200);
    utter(rec, 'Tschüss', 1_200, 0.99);
    expect(s.hook.result.current.phase).toBe('listening');
    expect(s.props.sendMessage).not.toHaveBeenCalled();
  });

  it('"Mikrofon aus" calls the handler of the mode and sends nothing', async () => {
    const onMicOff = jest.fn();
    const t = makeEnv();
    const s = setup(t.env, { onMicOff });
    act(() => s.hook.result.current.start());
    await flush();
    const rec = t.recognitions[0];
    act(() => rec.onaudiostart?.());
    act(() => rec.utter('Mikrofon aus'));
    expect(onMicOff).toHaveBeenCalledTimes(1);
    expect(s.props.sendMessage).not.toHaveBeenCalled();
  });

  it('"Mikrofon aus" without a handler stops the loop', async () => {
    const { s, rec } = await started();
    act(() => rec.utter('Mikrofon aus'));
    expect(s.hook.result.current.phase).toBe('idle');
    expect(s.props.sendMessage).not.toHaveBeenCalled();
  });

  it('the setting "Signalwörter" off: no word is a command, everything is a question', async () => {
    const { t, s, rec } = await started({ [SIGNAL_WORDS_KEY]: 'off' });
    expect(s.hook.result.current.signalWords).toBe(false);
    act(() => rec.utter('Tschüss'));
    expect(s.props.sendMessage).toHaveBeenCalledWith('Tschüss', {
      voice: true,
    });
    expect(s.hook.result.current.phase).toBe('thinking');
    s.update({
      messages: [question, answer(ANSWER)],
      streamingMessageId: 'a1',
    });
    act(() => rec.hear('Stopp'));
    // one word, no loudness: no interruption (the old rule)
    expect(t.log).not.toContain('cancel');
    // and the switch itself is kept
    act(() => s.hook.result.current.setSignalWords(true));
    expect(t.store[SIGNAL_WORDS_KEY]).toBe('on');
    expect(s.hook.result.current.signalWords).toBe(true);
  });

  it('measuring points of a signal carry no text', async () => {
    window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const { rec } = await speakingWithReference();
    await level(rec, OWN, 500);
    act(() => rec.hear('Stopp'));
    const names = traceEntries().map(e => e.name);
    expect(names).toContain('signal.halt');
    expect(JSON.stringify(traceEntries())).not.toMatch(/Stopp/);
  });

  describe('the first hint', () => {
    it('is shown once when the assistant speaks with an open microphone, then never again on this device', async () => {
      const t = makeEnv();
      const s = setup(t.env);
      act(() => s.hook.result.current.start());
      await flush();
      const rec = t.recognitions[0];
      act(() => rec.onaudiostart?.());
      expect(s.hook.result.current.signalHint).toBe(false);
      act(() => rec.utter('Was ist ein Primärschlüssel'));
      s.update({
        messages: [question, answer(ANSWER)],
        streamingMessageId: null,
      });
      expect(s.hook.result.current.phase).toBe('speaking');
      expect(s.hook.result.current.signalHint).toBe(true);
      expect(t.store[SIGNAL_HINT_KEY]).toBe('yes');
      await wait(SIGNAL_HINT_MS + 100);
      expect(s.hook.result.current.signalHint).toBe(false);
      // a second conversation: not again
      act(() => t.finish());
      await flush();
      act(() => rec.utter('Und noch eine Frage'));
      s.update({
        messages: [
          question,
          answer(ANSWER),
          { id: 'q2', role: 'user', content: 'x' },
          answer('Eine zweite Antwort kommt hier. Sie hat zwei Sätze.', 'a2'),
        ],
      });
      expect(s.hook.result.current.signalHint).toBe(false);
    });

    it('does not come when the words are switched off or nobody could be heard speaking', async () => {
      const t = makeEnv({ storage: { [SIGNAL_WORDS_KEY]: 'off' } });
      const s = setup(t.env);
      act(() => s.hook.result.current.start());
      await flush();
      const rec = t.recognitions[0];
      act(() => rec.onaudiostart?.());
      act(() => rec.utter('Was ist ein Primärschlüssel'));
      s.update({
        messages: [question, answer(ANSWER)],
        streamingMessageId: null,
      });
      expect(s.hook.result.current.signalHint).toBe(false);
      expect(t.store[SIGNAL_HINT_KEY]).toBeUndefined();
    });
  });
});

describe('push to talk', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-04T10:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  async function ptt(storage: Record<string, string> = {}) {
    const t = makeEnv({ storage: { [PUSH_TO_TALK_KEY]: 'on', ...storage } });
    const s = setup(t.env);
    expect(s.hook.result.current.pushToTalk).toBe(true);
    act(() => s.hook.result.current.start());
    await flush();
    return { t, s };
  }

  it('nothing is recorded until the button is held: no recognition, no open microphone', async () => {
    const { t, s } = await ptt();
    expect(t.recognitions).toHaveLength(0);
    expect(s.hook.result.current.phase).toBe('listening');
    expect(s.hook.result.current.micOpen).toBe(false);
    // minutes of silence are no silent rounds and end nothing
    await wait(60_000);
    expect(s.hook.result.current.phase).toBe('listening');
    expect(s.hook.result.current.error).toBeNull();
    expect(t.recognitions).toHaveLength(0);
  });

  it('is no open microphone in the consent (only the holding is recorded)', async () => {
    const t = makeEnv({
      storage: { [PUSH_TO_TALK_KEY]: 'on', [CONSENT_V2]: 'browser' },
    });
    const s = setup(t.env);
    await flush();
    expect(s.hook.result.current.consented).toBe(true);
  });

  it('holding opens the microphone, releasing closes it and sends what was said', async () => {
    const { t, s } = await ptt();
    act(() => s.hook.result.current.pressToTalk());
    await flush();
    expect(s.hook.result.current.holding).toBe(true);
    const rec = t.recognitions[0];
    expect(rec.started).toBe(1);
    // held to talk: one session as long as the button is held
    expect(rec.continuous).toBe(true);
    act(() => rec.onaudiostart?.());
    expect(s.hook.result.current.micOpen).toBe(true);
    act(() => rec.final('Was ist ein Primärschlüssel?'));
    act(() => s.hook.result.current.releaseToTalk());
    expect(s.hook.result.current.holding).toBe(false);
    expect(rec.stopped).toBe(1);
    // the provider delivers the rest and ends: that is the question
    act(() => rec.onend?.());
    expect(s.props.sendMessage).toHaveBeenCalledWith(
      'Was ist ein Primärschlüssel?',
      { voice: true }
    );
    expect(s.hook.result.current.micOpen).toBe(false);
    expect(s.hook.result.current.phase).toBe('thinking');
  });

  it('what was said during a pause while holding is said together at the release', async () => {
    const { t, s } = await ptt();
    act(() => s.hook.result.current.pressToTalk());
    await flush();
    const rec = t.recognitions[0];
    act(() => rec.onaudiostart?.());
    act(() => rec.utter('Was ist ein Join'));
    expect(s.props.sendMessage).not.toHaveBeenCalled();
    act(() => rec.final('und wann nutze ich ihn?'));
    act(() => s.hook.result.current.releaseToTalk());
    act(() => rec.onend?.());
    expect(s.props.sendMessage).toHaveBeenCalledWith(
      'Was ist ein Join und wann nutze ich ihn?',
      { voice: true }
    );
  });

  it('no loudness gate while holding: the person decided, a quiet voice counts', async () => {
    const { t, s } = await ptt();
    act(() => s.hook.result.current.pressToTalk());
    await flush();
    const rec = t.recognitions[0];
    act(() => rec.onaudiostart?.());
    await level(rec, 0.02, 2_000);
    act(() => rec.final('Ich spreche leise'));
    act(() => s.hook.result.current.releaseToTalk());
    act(() => rec.onend?.());
    expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('released before the recognition was made: nothing is recorded at all', async () => {
    const { t, s } = await ptt();
    act(() => {
      s.hook.result.current.pressToTalk();
      s.hook.result.current.releaseToTalk();
    });
    await flush();
    const rec = t.recognitions[0];
    expect(rec?.started ?? 0).toBe(0);
    expect(s.hook.result.current.holding).toBe(false);
    expect(s.hook.result.current.micOpen).toBe(false);
  });

  it('a release without a word waits for the next press, no error however often', async () => {
    const { t, s } = await ptt();
    for (let i = 0; i < 5; i += 1) {
      act(() => s.hook.result.current.pressToTalk());
      await flush();
      const rec = t.recognitions[i];
      act(() => rec.onaudiostart?.());
      act(() => s.hook.result.current.releaseToTalk());
      act(() => rec.onend?.());
      await wait(300);
    }
    expect(s.hook.result.current.error).toBeNull();
    expect(s.hook.result.current.phase).toBe('listening');
    expect(s.props.sendMessage).not.toHaveBeenCalled();
  });

  it('pressing while the assistant speaks or thinks stops it like an interruption, then records', async () => {
    const { t, s } = await ptt();
    act(() => s.hook.result.current.pressToTalk());
    await flush();
    const rec = t.recognitions[0];
    act(() => rec.onaudiostart?.());
    act(() => rec.final('Was ist ein Primärschlüssel?'));
    act(() => s.hook.result.current.releaseToTalk());
    act(() => rec.onend?.());
    s.update({
      messages: [question, answer(ANSWER)],
      streamingMessageId: 'a1',
    });
    expect(s.hook.result.current.phase).toBe('speaking');
    act(() => s.hook.result.current.pressToTalk());
    await flush();
    expect(t.log).toContain('cancel');
    expect(s.props.stopGeneration).toHaveBeenCalledTimes(1);
    expect(t.recognitions).toHaveLength(2);
    expect(s.hook.result.current.phase).toBe('listening');
    expect(s.hook.result.current.holding).toBe(true);
  });

  it('after the answer the loop only waits for the button, nothing opens by itself', async () => {
    const { t, s } = await ptt();
    act(() => s.hook.result.current.pressToTalk());
    await flush();
    const rec = t.recognitions[0];
    act(() => rec.onaudiostart?.());
    act(() => rec.final('Hallo'));
    act(() => s.hook.result.current.releaseToTalk());
    act(() => rec.onend?.());
    s.update({
      messages: [question, answer(ANSWER)],
      streamingMessageId: null,
    });
    act(() => t.finish());
    await flush();
    await wait(1_000);
    expect(t.recognitions).toHaveLength(1);
    expect(s.hook.result.current.phase).toBe('listening');
    expect(s.hook.result.current.micOpen).toBe(false);
  });

  it('a press without push to talk does nothing', async () => {
    const t = makeEnv();
    const s = setup(t.env);
    act(() => s.hook.result.current.start());
    await flush();
    act(() => s.hook.result.current.pressToTalk());
    await flush();
    expect(s.hook.result.current.holding).toBe(false);
    expect(t.recognitions).toHaveLength(1);
  });

  it('switching push to talk on in a conversation closes the open microphone, off opens it again', async () => {
    const t = makeEnv();
    const s = setup(t.env);
    act(() => s.hook.result.current.start());
    await flush();
    const rec = t.recognitions[0];
    act(() => rec.onaudiostart?.());
    expect(s.hook.result.current.micOpen).toBe(true);
    act(() => s.hook.result.current.setPushToTalk(true));
    expect(t.store[PUSH_TO_TALK_KEY]).toBe('on');
    expect(rec.aborted).toBe(1);
    expect(s.hook.result.current.micOpen).toBe(false);
    expect(s.hook.result.current.phase).toBe('listening');
    await flush();
    expect(t.recognitions).toHaveLength(1);
    act(() => s.hook.result.current.setPushToTalk(false));
    expect(t.store[PUSH_TO_TALK_KEY]).toBe('off');
    await flush();
    expect(t.recognitions).toHaveLength(2);
  });

  it('stopping the conversation while holding closes the microphone at once', async () => {
    const { t, s } = await ptt();
    act(() => s.hook.result.current.pressToTalk());
    await flush();
    const rec = t.recognitions[0];
    act(() => s.hook.result.current.stop());
    expect(rec.aborted).toBe(1);
    expect(s.hook.result.current.holding).toBe(false);
  });

  it('signal words work on what was said while holding ("Gespräch beenden")', async () => {
    const { t, s } = await ptt();
    act(() => s.hook.result.current.pressToTalk());
    await flush();
    const rec = t.recognitions[0];
    act(() => rec.onaudiostart?.());
    act(() => rec.final('Gespräch beenden'));
    act(() => s.hook.result.current.releaseToTalk());
    act(() => rec.onend?.());
    expect(s.props.sendMessage).not.toHaveBeenCalled();
    expect(s.hook.result.current.phase).toBe('idle');
  });
});
