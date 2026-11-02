import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  useHaiVoice,
  type RecognitionLike,
  type SynthLike,
  type UtteranceLike,
  type VoiceEnv,
} from '@/components/hai/useHaiVoice';

// Voice assistant (WMCNL-2907): the loop listen, send, read aloud, listen again, tested with a
// pretend browser. No microphone and no audio: recognition and speech synthesis are replaced.

type Msg = { id: string; role: string; content: string };

class FakeRecognition implements RecognitionLike {
  lang = '';
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  processLocally?: boolean;
  onresult: RecognitionLike['onresult'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null;
  started = false;
  aborted = false;
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.aborted = true;
  }
  /** The person says something and the round ends. */
  say(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal: true })],
    });
    this.onend?.();
  }
  silence() {
    this.onend?.();
  }
}

function makeEnv(
  options: { local?: boolean; stored?: Record<string, string> } = {}
) {
  const store: Record<string, string> = { ...(options.stored ?? {}) };
  const recognitions: FakeRecognition[] = [];
  const spoken: UtteranceLike[] = [];
  let cancelled = 0;
  const synth: SynthLike = {
    speak: u => {
      spoken.push(u);
    },
    cancel: () => {
      cancelled += 1;
    },
    getVoices: () => [
      { lang: 'en-US' },
      { lang: 'de-DE', localService: false },
      { lang: 'de-DE', localService: true, name: 'lokal' },
    ],
  };
  const env: VoiceEnv = {
    createRecognition: async () => {
      const rec = new FakeRecognition();
      recognitions.push(rec);
      return { rec, local: options.local === true };
    },
    synth,
    makeUtterance: text => ({
      text,
      lang: '',
      voice: undefined,
      rate: 0,
      onend: null,
      onerror: null,
    }),
    storage: {
      getItem: k => store[k] ?? null,
      setItem: (k, v) => {
        store[k] = v;
      },
    },
    now: () => new Date('2026-11-02T07:30:00Z'),
  };
  return {
    env,
    store,
    recognitions,
    spoken,
    cancelled: () => cancelled,
  };
}

const CONSENT = 'hai-voice-consent-v1:u1';
const DAY_DONE = 'hai-voice-day-start:u1';
const TODAY = '2026-11-02';

function setup(
  env: VoiceEnv,
  initial: { messages?: Msg[]; enabled?: boolean } = {}
) {
  const sendMessage = jest.fn(
    async (_m: string, _o?: { voice?: boolean }) => undefined
  );
  const stopGeneration = jest.fn();
  const props = {
    userId: 'u1' as string | null,
    enabled: initial.enabled ?? true,
    messages: (initial.messages ?? []) as Msg[],
    streamingMessageId: null as string | null,
    sendMessage,
    stopGeneration,
    placeholderText: 'Denkt nach...',
    env,
  };
  const hook = renderHook((p: typeof props) => useHaiVoice(p), {
    initialProps: props,
  });
  const update = (next: Partial<typeof props>) =>
    hook.rerender({ ...props, ...next });
  return { hook, update, sendMessage, stopGeneration };
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const consented = { [CONSENT]: 'yes' };
const consentedAndStarted = { [CONSENT]: 'yes', [DAY_DONE]: TODAY };

describe('useHaiVoice', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is not available where the organization has it off', () => {
    const { env } = makeEnv();
    const { hook } = setup(env, { enabled: false });
    expect(hook.result.current.available).toBe(false);
  });

  it('does not start without consent and keeps the consent once given', async () => {
    const t = makeEnv();
    const { hook } = setup(t.env);
    await flush();
    expect(hook.result.current.consented).toBe(false);
    act(() => hook.result.current.start());
    await flush();
    expect(t.recognitions).toHaveLength(0);
    expect(hook.result.current.phase).toBe('idle');

    act(() => hook.result.current.giveConsent());
    expect(t.store[CONSENT]).toBe('yes');
    expect(hook.result.current.consented).toBe(true);
  });

  it('remembers the consent of the person and can withdraw it', async () => {
    const t = makeEnv({ stored: consented });
    const { hook } = setup(t.env);
    await flush();
    expect(hook.result.current.consented).toBe(true);
    act(() => hook.result.current.revokeConsent());
    expect(t.store[CONSENT]).toBe('no');
    expect(hook.result.current.consented).toBe(false);
  });

  it('opens the first conversation of the day with the question for the day at a glance', async () => {
    const t = makeEnv({ stored: consented });
    const { hook, sendMessage } = setup(t.env);
    await flush();
    act(() => hook.result.current.start());
    await flush();
    expect(sendMessage).toHaveBeenCalledWith(
      'Guten Morgen, was steht heute an?',
      { voice: true }
    );
    expect(hook.result.current.phase).toBe('thinking');
    // the day has started: the next conversation of the same day listens at once
    act(() => hook.result.current.stop());
    act(() => hook.result.current.start());
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(t.recognitions).toHaveLength(1);
    expect(hook.result.current.phase).toBe('listening');
  });

  it('can leave the day start out', async () => {
    const t = makeEnv({ stored: consented });
    const { hook, sendMessage } = setup(t.env);
    await flush();
    act(() => hook.result.current.setDayStartEnabled(false));
    act(() => hook.result.current.start());
    await flush();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(hook.result.current.phase).toBe('listening');
  });

  it('listens, sends the recognized text as a spoken question, reads the answer sentence by sentence and listens again', async () => {
    const t = makeEnv({ stored: consentedAndStarted });
    const { hook, update, sendMessage } = setup(t.env);
    await flush();
    act(() => hook.result.current.start());
    await flush();
    expect(hook.result.current.phase).toBe('listening');
    const first = t.recognitions[0];
    expect(first.lang).toBe('de-DE');
    expect(first.interimResults).toBe(true);

    act(() => first.say('Was ist ein Primärschlüssel?'));
    expect(sendMessage).toHaveBeenCalledWith('Was ist ein Primärschlüssel?', {
      voice: true,
    });
    expect(hook.result.current.phase).toBe('thinking');

    // the answer streams in: only finished sentences are read
    const question: Msg = {
      id: 'u',
      role: 'user',
      content: 'Was ist ein Primärschlüssel?',
    };
    update({
      messages: [
        question,
        {
          id: 'a1',
          role: 'assistant',
          content:
            'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig. Er darf nie leer',
        },
      ],
      streamingMessageId: 'a1',
    });
    expect(t.spoken.map(u => u.text)).toEqual([
      'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig.',
    ]);
    expect(hook.result.current.phase).toBe('speaking');
    expect(t.spoken[0].lang).toBe('de-DE');
    expect(t.spoken[0].voice).toEqual({
      lang: 'de-DE',
      localService: true,
      name: 'lokal',
    });

    // the answer is complete: the rest is read, the first sentence is not read twice
    update({
      messages: [
        question,
        {
          id: 'a1',
          role: 'assistant',
          content:
            'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig. Er darf nie leer sein.',
        },
      ],
      streamingMessageId: null,
    });
    expect(t.spoken.map(u => u.text)).toEqual([
      'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig.',
      'Er darf nie leer sein.',
    ]);

    // when the last piece is finished, the assistant listens again
    expect(t.recognitions).toHaveLength(1);
    act(() => t.spoken[0].onend?.());
    expect(t.recognitions).toHaveLength(1);
    act(() => t.spoken[1].onend?.());
    await flush();
    expect(t.recognitions).toHaveLength(2);
    expect(hook.result.current.phase).toBe('listening');
  });

  it('does not read the old answer, the placeholder or an empty text', async () => {
    const t = makeEnv({ stored: consentedAndStarted });
    const old: Msg[] = [
      { id: 'u0', role: 'user', content: 'Hallo' },
      {
        id: 'a0',
        role: 'assistant',
        content: 'Das ist die alte Antwort von vorhin. Sie wird nicht gelesen.',
      },
    ];
    const next: Msg = { id: 'u1', role: 'user', content: 'Neue Frage bitte' };
    const { hook, update } = setup(t.env, { messages: old });
    await flush();
    act(() => hook.result.current.start());
    await flush();
    act(() => t.recognitions[0].say('Neue Frage bitte'));
    update({
      messages: [...old, next, { id: 'a1', role: 'assistant', content: '' }],
    });
    update({
      messages: [
        ...old,
        next,
        { id: 'a1', role: 'assistant', content: 'Denkt nach...' },
      ],
    });
    expect(t.spoken).toHaveLength(0);
  });

  it('ends the conversation on Stopp and sends nothing', async () => {
    const t = makeEnv({ stored: consentedAndStarted });
    const { hook, sendMessage } = setup(t.env);
    await flush();
    act(() => hook.result.current.start());
    await flush();
    act(() => t.recognitions[0].say('Sprachmodus beenden'));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(hook.result.current.phase).toBe('idle');
  });

  it('interrupts the reading, stops a running answer and listens', async () => {
    const t = makeEnv({ stored: consentedAndStarted });
    const { hook, update, stopGeneration } = setup(t.env);
    await flush();
    act(() => hook.result.current.start());
    await flush();
    act(() => t.recognitions[0].say('Erkläre mir SQL'));
    const question: Msg = { id: 'u', role: 'user', content: 'Erkläre mir SQL' };
    update({
      messages: [
        question,
        {
          id: 'a1',
          role: 'assistant',
          content: 'SQL ist eine Abfragesprache für Datenbanken. Sie',
        },
      ],
      streamingMessageId: 'a1',
    });
    expect(hook.result.current.phase).toBe('speaking');
    act(() => hook.result.current.interrupt());
    await flush();
    expect(t.cancelled()).toBeGreaterThan(0);
    expect(stopGeneration).toHaveBeenCalled();
    expect(t.recognitions).toHaveLength(2);
    // what streams in afterwards is not read
    const spokenBefore = t.spoken.length;
    update({
      messages: [
        question,
        {
          id: 'a1',
          role: 'assistant',
          content:
            'SQL ist eine Abfragesprache für Datenbanken. Sie fragt Tabellen ab und ändert Daten.',
        },
      ],
      streamingMessageId: null,
    });
    expect(t.spoken.length).toBe(spokenBefore);
  });

  it('gives up after three silent rounds with a clear error, no endless microphone', async () => {
    jest.useFakeTimers();
    try {
      const t = makeEnv({ stored: consentedAndStarted });
      const { hook } = setup(t.env);
      await flush();
      act(() => hook.result.current.start());
      await flush();
      for (let i = 0; i < 3; i++) {
        act(() => t.recognitions[i].silence());
        await act(async () => {
          jest.advanceTimersByTime(300);
          await Promise.resolve();
        });
      }
      expect(hook.result.current.phase).toBe('error');
      expect(hook.result.current.error).toBe('no-speech');
      expect(t.recognitions).toHaveLength(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows a refused microphone as an error', async () => {
    const t = makeEnv({ stored: consentedAndStarted });
    const { hook } = setup(t.env);
    await flush();
    act(() => hook.result.current.start());
    await flush();
    act(() => t.recognitions[0].onerror?.({ error: 'not-allowed' }));
    expect(hook.result.current.phase).toBe('error');
    expect(hook.result.current.error).toBe('not-allowed');
  });

  it('tells whether the recognition runs on the device', async () => {
    const t = makeEnv({ local: true, stored: consentedAndStarted });
    const { hook } = setup(t.env);
    await flush();
    act(() => hook.result.current.start());
    await flush();
    expect(hook.result.current.localRecognition).toBe(true);
  });
});

describe('useHaiVoice for the voice mode (subtitles and loudness)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hands the pieces of the answer out as they are read, and forgets them with the next question', async () => {
    const t = makeEnv({ stored: consentedAndStarted });
    const { hook, update } = setup(t.env);
    await flush();
    expect(hook.result.current.spoken).toEqual([]);
    act(() => hook.result.current.start());
    await flush();
    act(() => t.recognitions[0].say('Was ist ein Primärschlüssel?'));
    const question: Msg = {
      id: 'u',
      role: 'user',
      content: 'Was ist ein Primärschlüssel?',
    };
    update({
      messages: [
        question,
        {
          id: 'a1',
          role: 'assistant',
          content:
            'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig. Er darf nie leer',
        },
      ],
      streamingMessageId: 'a1',
    });
    expect(hook.result.current.spoken).toEqual([
      'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig.',
    ]);
    update({
      messages: [
        question,
        {
          id: 'a1',
          role: 'assistant',
          content:
            'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig. Er darf nie leer sein.',
        },
      ],
      streamingMessageId: null,
    });
    expect(hook.result.current.spoken).toEqual([
      'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig.',
      'Er darf nie leer sein.',
    ]);

    // a new question starts a new answer: the old pieces are gone
    act(() => t.spoken[0].onend?.());
    act(() => t.spoken[1].onend?.());
    await flush();
    act(() => t.recognitions[1].say('Und ein Fremdschlüssel?'));
    expect(hook.result.current.spoken).toEqual([]);
  });

  it('keeps what was understood as the question until the conversation ends', async () => {
    const t = makeEnv({ stored: consentedAndStarted });
    const { hook } = setup(t.env);
    await flush();
    expect(hook.result.current.heard).toBe('');
    act(() => hook.result.current.start());
    await flush();
    act(() => t.recognitions[0].say('Erkläre mir SQL'));
    expect(hook.result.current.heard).toBe('Erkläre mir SQL');
    expect(hook.result.current.interim).toBe('');
    act(() => hook.result.current.stop());
    expect(hook.result.current.heard).toBe('');
  });

  it('does not take the stop command for a question', async () => {
    const t = makeEnv({ stored: consentedAndStarted });
    const { hook } = setup(t.env);
    await flush();
    act(() => hook.result.current.start());
    await flush();
    act(() => t.recognitions[0].say('Sprachmodus beenden'));
    expect(hook.result.current.heard).toBe('');
  });

  it('shows no pieces when the conversation ends', async () => {
    const t = makeEnv({ stored: consentedAndStarted });
    const { hook, update } = setup(t.env);
    await flush();
    act(() => hook.result.current.start());
    await flush();
    act(() => t.recognitions[0].say('Erkläre mir SQL'));
    update({
      messages: [
        { id: 'u', role: 'user', content: 'Erkläre mir SQL' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'SQL ist eine Abfragesprache für Datenbanken. Mehr gleich.',
        },
      ],
      streamingMessageId: 'a1',
    });
    expect(hook.result.current.spoken.length).toBeGreaterThan(0);
    act(() => hook.result.current.stop());
    expect(hook.result.current.spoken).toEqual([]);
  });

  it('reports the loudness of the recording when the provider gives one, kept between 0 and 1', async () => {
    const t = makeEnv({ stored: consentedAndStarted });
    const { hook } = setup(t.env);
    await flush();
    expect(hook.result.current.level).toBeNull();
    act(() => hook.result.current.start());
    await flush();
    const rec = t.recognitions[0] as unknown as {
      onlevel?: (value: number) => void;
    };
    expect(typeof rec.onlevel).toBe('function');
    act(() => rec.onlevel?.(0.4));
    expect(hook.result.current.level).toBe(0.4);
    act(() => rec.onlevel?.(7));
    expect(hook.result.current.level).toBe(1);
    act(() => rec.onlevel?.(-3));
    expect(hook.result.current.level).toBe(0);
    act(() => rec.onlevel?.(Number.NaN));
    expect(hook.result.current.level).toBe(0);
    // the end of the conversation drops the value
    act(() => hook.result.current.stop());
    expect(hook.result.current.level).toBeNull();
  });

  it('has no loudness for a provider that does not measure it', async () => {
    const t = makeEnv({ stored: consentedAndStarted });
    const { hook } = setup(t.env);
    await flush();
    act(() => hook.result.current.start());
    await flush();
    expect(hook.result.current.level).toBeNull();
  });
});
