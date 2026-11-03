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
  AFTER_ANSWER_MS,
  BARGE_IN_LEVEL,
  ECHO_WINDOW_MS,
  LIVE_CONSENT,
  LIVE_SILENCE_MS,
  LIVE_STORAGE_KEY,
  WAIT_PHRASE_MS,
  useHaiVoice,
  type RecognitionLike,
  type SpeakerLike,
  type VoiceConfig,
  type VoiceEnv,
} from '@/components/hai/useHaiVoice';

// The live mode of the voice loop: the recognition stays open over the whole
// conversation, the person can interrupt by voice (barge-in), the assistant does
// not hear itself, the silent time is counted, the voice and the key are warmed
// up at the question, a waiting phrase fills a long wait.

type Msg = { id: string; role: string; content: string };

const CONSENT_V2 = 'hai-voice-consent-v2:u1';

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
  isLive = true;

  get live() {
    return this.isLive && this.continuous;
  }
  start() {
    this.started += 1;
  }
  stop() {}
  abort() {
    this.aborted += 1;
  }
  /** What the person says, not final yet. */
  hear(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal: false })],
    });
  }
  /** The person finished an utterance. */
  utter(text: string) {
    this.onutterance?.(text);
  }
}

function makeEnv(
  options: {
    live?: boolean;
    consent?: string;
    storage?: Record<string, string>;
  } = {}
) {
  const recognitions: LiveRecognition[] = [];
  const log: string[] = [];
  let onDone: (() => void) | null = null;
  const prefetched: string[] = [];
  let unlocked = 0;
  const store: Record<string, string> = {
    [CONSENT_V2]: options.consent ?? 'browser,live',
    'hai-voice-consent-v1:u1': 'yes',
    'hai-voice-day-start:u1': '2026-11-02',
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
    now: () => new Date('2026-11-02T07:30:00Z'),
    createSpeaker: handlers => {
      onDone = handlers.onDone;
      log.push('speaker');
      return speaker;
    },
    unlockAudio: () => {
      unlocked += 1;
    },
    prefetch: purpose => {
      prefetched.push(purpose);
    },
    ...(options.live === false ? {} : { live: true }),
    // like the cloud providers: the microphone is reported by the recognition itself
    micSignal: true,
  };
  return {
    env,
    recognitions,
    log,
    store,
    prefetched,
    unlocked: () => unlocked,
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

const question: Msg = { id: 'q1', role: 'user', content: 'Frage' };
const answer = (content: string, id = 'a1'): Msg => ({
  id,
  role: 'assistant',
  content,
});

/** The conversation is running: started, microphone open, the question was said. */
async function startAndAsk(
  t: ReturnType<typeof makeEnv>,
  s: ReturnType<typeof setup>
) {
  act(() => s.hook.result.current.start());
  await flush();
  const rec = t.recognitions[0];
  act(() => rec.onaudiostart?.());
  act(() => rec.utter('Was ist ein Primärschlüssel?'));
  return rec;
}

describe('useHaiVoice in live mode', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('asks the provider to stay open, and the browser alone does not get that wish', async () => {
    const live = makeEnv();
    const a = setup(live.env);
    act(() => a.hook.result.current.start());
    await flush();
    expect(live.recognitions[0].continuous).toBe(true);

    const plain = makeEnv({ live: false });
    const b = setup(plain.env);
    act(() => b.hook.result.current.start());
    await flush();
    expect(plain.recognitions[0].continuous).toBe(false);
  });

  it('the switch hai-voice-live = off brings the rounds back', async () => {
    const t = makeEnv({ storage: { [LIVE_STORAGE_KEY]: 'off' } });
    const s = setup(t.env);
    act(() => s.hook.result.current.start());
    await flush();
    expect(t.recognitions[0].continuous).toBe(false);
  });

  it('shows the microphone as open only when the provider says so', async () => {
    const t = makeEnv();
    const s = setup(t.env);
    expect(s.hook.result.current.micOpen).toBe(false);
    act(() => s.hook.result.current.start());
    await flush();
    expect(s.hook.result.current.phase).toBe('listening');
    expect(s.hook.result.current.micOpen).toBe(false);
    act(() => t.recognitions[0].onaudiostart?.());
    expect(s.hook.result.current.micOpen).toBe(true);
    expect(s.hook.result.current.live).toBe(true);
  });

  it('the microphone stays open while the assistant thinks and speaks, one recognition for the whole conversation', async () => {
    const t = makeEnv();
    const s = setup(t.env);
    const rec = await startAndAsk(t, s);
    expect(s.props.sendMessage).toHaveBeenCalledWith(
      'Was ist ein Primärschlüssel?',
      { voice: true }
    );
    expect(s.hook.result.current.phase).toBe('thinking');
    expect(s.hook.result.current.micOpen).toBe(true);
    expect(rec.aborted).toBe(0);

    s.update({
      messages: [
        question,
        answer('Ein Primärschlüssel ist eindeutig. Er ist nie leer.'),
      ],
      streamingMessageId: null,
    });
    expect(s.hook.result.current.phase).toBe('speaking');
    expect(s.hook.result.current.micOpen).toBe(true);
    act(() => t.finish());
    await flush();
    // listening again at once: no new recognition, no delay, the microphone was never closed
    expect(s.hook.result.current.phase).toBe('listening');
    expect(t.recognitions).toHaveLength(1);
    expect(rec.aborted).toBe(0);
  });

  it('warms the voice and fetches the keys when the question is asked', async () => {
    const t = makeEnv();
    const s = setup(t.env);
    act(() => s.hook.result.current.start());
    await flush();
    // at the start: the key for the long session, for the speech output, the way to the server
    expect(t.prefetched).toEqual(['stt-live', 'tts', 'server']);
    act(() => t.recognitions[0].onaudiostart?.());
    act(() => t.recognitions[0].utter('Hallo'));
    // the speaker exists at the question and is warmed up (no sentence yet)
    expect(t.log).toEqual(['speaker', 'warm']);
    // the live recognition needs no key for the next round
    expect(t.prefetched).toEqual(['stt-live', 'tts', 'server']);
  });

  it('a round (not live) fetches the key of the next round at the question and warms the server after the answer', async () => {
    const t = makeEnv({ live: false });
    const s = setup(t.env);
    act(() => s.hook.result.current.start());
    await flush();
    expect(t.prefetched).toEqual(['stt', 'tts', 'server']);
  });

  describe('interrupting by voice (barge-in)', () => {
    async function speaking() {
      const t = makeEnv();
      const s = setup(t.env);
      const rec = await startAndAsk(t, s);
      s.update({
        messages: [
          question,
          answer(
            'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig. Er ist nie leer.'
          ),
        ],
        streamingMessageId: 'a1',
      });
      expect(s.hook.result.current.phase).toBe('speaking');
      return { t, s, rec };
    }

    it('two words of the person stop the voice at once and abort the running answer', async () => {
      const { t, s, rec } = await speaking();
      act(() => rec.hear('Moment mal'));
      expect(t.log).toContain('cancel');
      expect(s.props.stopGeneration).toHaveBeenCalledTimes(1);
      expect(s.hook.result.current.phase).toBe('listening');
      expect(s.hook.result.current.interim).toBe('Moment mal');
      // the recognition was not touched
      expect(rec.aborted).toBe(0);
      expect(t.recognitions).toHaveLength(1);
    });

    it('what the aborted answer still adds is not read any more', async () => {
      const { t, s, rec } = await speaking();
      act(() => rec.hear('Moment mal'));
      const said = t.log.filter(l => l.startsWith('say:')).length;
      s.update({
        messages: [
          question,
          answer(
            'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig. Er ist nie leer. Mehr Text.'
          ),
        ],
        streamingMessageId: null,
      });
      expect(t.log.filter(l => l.startsWith('say:'))).toHaveLength(said);
      expect(t.log.filter(l => l === 'end')).toHaveLength(0);
    });

    it('the utterance that follows is the next question', async () => {
      const { s, rec } = await speaking();
      act(() => rec.hear('Moment mal'));
      act(() => rec.utter('Moment mal, was ist ein Fremdschlüssel?'));
      expect(s.props.sendMessage).toHaveBeenCalledTimes(2);
      expect(s.props.sendMessage).toHaveBeenLastCalledWith(
        'Moment mal, was ist ein Fremdschlüssel?',
        { voice: true }
      );
      expect(s.hook.result.current.heard).toBe(
        'Moment mal, was ist ein Fremdschlüssel?'
      );
      expect(s.hook.result.current.phase).toBe('thinking');
    });

    it('interrupting while the model still thinks (no text yet) works too, the late text is not read', async () => {
      const t = makeEnv();
      const s = setup(t.env);
      const rec = await startAndAsk(t, s);
      // the chat shows the question and an empty answer of the assistant
      s.update({
        messages: [question, answer('', 'a9')],
        streamingMessageId: 'a9',
      });
      act(() => rec.hear('Halt stopp doch'));
      expect(s.props.stopGeneration).toHaveBeenCalledTimes(1);
      s.update({
        messages: [
          question,
          answer('Ein Satz, der zu spät kommt. Noch einer.', 'a9'),
        ],
        streamingMessageId: null,
      });
      expect(t.log.filter(l => l.startsWith('say:'))).toEqual([]);
    });

    it('one word counts only with the minimum loudness', async () => {
      const { t, s, rec } = await speaking();
      act(() => rec.hear('Stopp'));
      expect(s.props.stopGeneration).not.toHaveBeenCalled();
      expect(t.log).not.toContain('cancel');
      act(() => rec.onlevel?.(BARGE_IN_LEVEL + 0.1));
      act(() => rec.hear('Stopp'));
      expect(s.props.stopGeneration).toHaveBeenCalledTimes(1);
      expect(t.log).toContain('cancel');
    });

    it('noise gives no word: nothing happens', async () => {
      const { t, s, rec } = await speaking();
      act(() => rec.onlevel?.(0.9));
      act(() => rec.hear(''));
      act(() => rec.hear(' . '));
      expect(s.props.stopGeneration).not.toHaveBeenCalled();
      expect(t.log).not.toContain('cancel');
      expect(s.hook.result.current.phase).toBe('speaking');
    });

    it('the own voice coming back in is no interruption', async () => {
      const { t, s, rec } = await speaking();
      act(() => rec.onlevel?.(0.9));
      act(() => rec.hear('kennzeichnet eine Zeile eindeutig'));
      expect(s.props.stopGeneration).not.toHaveBeenCalled();
      expect(t.log).not.toContain('cancel');
      // the interim text of the own voice is not shown as the question
      expect(s.hook.result.current.interim).toBe('');
      // and its end is not taken as a question
      act(() => rec.utter('kennzeichnet eine Zeile eindeutig'));
      expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('an utterance of too few words while the assistant answers is dropped', async () => {
      const { s, rec } = await speaking();
      act(() => rec.utter('Hm'));
      expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
      expect(s.hook.result.current.phase).toBe('speaking');
    });

    it('the voice that ended a moment ago is no question: its words in the listening phase are dropped', async () => {
      const t = makeEnv();
      const s = setup(t.env);
      const rec = await startAndAsk(t, s);
      s.update({
        messages: [question, answer('Ein Primärschlüssel ist eindeutig.')],
        streamingMessageId: null,
      });
      act(() => t.finish());
      await flush();
      expect(s.hook.result.current.phase).toBe('listening');
      act(() => rec.utter('Primärschlüssel ist eindeutig'));
      expect(s.props.sendMessage).toHaveBeenCalledTimes(1);
      // a real question right after is taken
      act(() => rec.utter('Und was ist ein Index?'));
      expect(s.props.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('later the same words are a question again', async () => {
      const t = makeEnv();
      const s = setup(t.env);
      const rec = await startAndAsk(t, s);
      s.update({
        messages: [question, answer('Ein Primärschlüssel ist eindeutig.')],
        streamingMessageId: null,
      });
      act(() => t.finish());
      await flush();
      await wait(ECHO_WINDOW_MS + 100);
      act(() => rec.utter('Primärschlüssel ist eindeutig'));
      expect(s.props.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('a tap interrupts as before and listens (the open microphone is kept)', async () => {
      const { t, s, rec } = await speaking();
      act(() => s.hook.result.current.interrupt());
      expect(t.log).toContain('cancel');
      expect(s.hook.result.current.phase).toBe('listening');
      expect(rec.aborted).toBe(0);
      expect(t.recognitions).toHaveLength(1);
    });
  });

  describe('the silent time and the end', () => {
    it('three silent windows in the listening phase switch the microphone off', async () => {
      const t = makeEnv();
      const s = setup(t.env);
      act(() => s.hook.result.current.start());
      await flush();
      const rec = t.recognitions[0];
      act(() => rec.onaudiostart?.());
      await wait(LIVE_SILENCE_MS * 2 + 100);
      expect(s.hook.result.current.phase).toBe('listening');
      expect(s.hook.result.current.error).toBeNull();
      await wait(LIVE_SILENCE_MS);
      expect(s.hook.result.current.phase).toBe('error');
      expect(s.hook.result.current.error).toBe('no-speech');
      expect(rec.aborted).toBe(1);
      expect(s.hook.result.current.micOpen).toBe(false);
    });

    it('a word restarts the count', async () => {
      const t = makeEnv();
      const s = setup(t.env);
      act(() => s.hook.result.current.start());
      await flush();
      const rec = t.recognitions[0];
      act(() => rec.onaudiostart?.());
      await wait(LIVE_SILENCE_MS * 2 + 100);
      act(() => rec.hear('Hallo'));
      await wait(LIVE_SILENCE_MS * 2 + 100);
      expect(s.hook.result.current.phase).toBe('listening');
      expect(s.hook.result.current.error).toBeNull();
    });

    it('while the assistant answers, silence is not counted', async () => {
      const t = makeEnv();
      const s = setup(t.env);
      await startAndAsk(t, s);
      await wait(LIVE_SILENCE_MS * 5);
      expect(s.hook.result.current.phase).toBe('thinking');
      expect(s.hook.result.current.error).toBeNull();
    });

    it('stop ends the open microphone at once', async () => {
      const t = makeEnv();
      const s = setup(t.env);
      const rec = await startAndAsk(t, s);
      act(() => s.hook.result.current.stop());
      expect(rec.aborted).toBe(1);
      expect(s.hook.result.current.micOpen).toBe(false);
      expect(s.hook.result.current.live).toBe(false);
      expect(s.hook.result.current.phase).toBe('idle');
      expect(t.log).toContain('cancel');
      // nothing starts again afterwards
      await wait(LIVE_SILENCE_MS * 4);
      expect(t.recognitions).toHaveLength(1);
    });

    it('leaving the page (unmount) ends the microphone', async () => {
      const t = makeEnv();
      const s = setup(t.env);
      const rec = await startAndAsk(t, s);
      s.hook.unmount();
      expect(rec.aborted).toBe(1);
    });

    it('the stop word ends the conversation and the microphone', async () => {
      const t = makeEnv();
      const s = setup(t.env);
      act(() => s.hook.result.current.start());
      await flush();
      const rec = t.recognitions[0];
      act(() => rec.onaudiostart?.());
      act(() => rec.utter('Sprachmodus beenden'));
      expect(rec.aborted).toBe(1);
      expect(s.hook.result.current.phase).toBe('idle');
      expect(s.props.sendMessage).not.toHaveBeenCalled();
    });

    it('a live session that ended during the answer: no recognition under the voice, a new one after it', async () => {
      const t = makeEnv();
      const s = setup(t.env);
      const rec = await startAndAsk(t, s);
      s.update({
        messages: [
          question,
          answer('Ein Primärschlüssel ist eindeutig. Er ist nie leer.'),
        ],
        streamingMessageId: null,
      });
      expect(s.hook.result.current.phase).toBe('speaking');
      act(() => rec.onend?.());
      await flush();
      expect(s.hook.result.current.micOpen).toBe(false);
      expect(t.recognitions).toHaveLength(1);
      expect(s.hook.result.current.phase).toBe('speaking');
      // after the answer the loop opens the next recognition itself
      act(() => t.finish());
      await wait(AFTER_ANSWER_MS + 50);
      expect(t.recognitions).toHaveLength(2);
      expect(s.hook.result.current.phase).toBe('listening');
    });
  });

  describe('rounds with the raw microphone (live mode off)', () => {
    async function answered() {
      const t = makeEnv({ storage: { [LIVE_STORAGE_KEY]: 'off' } });
      const s = setup(t.env);
      act(() => s.hook.result.current.start());
      await flush();
      act(() => t.recognitions[0].onaudiostart?.());
      act(() => t.recognitions[0].utter('x'));
      // a round ends with onend after the result, the loop sends it
      act(() => {
        t.recognitions[0].onresult?.({
          resultIndex: 0,
          results: [
            Object.assign([{ transcript: 'Was ist ein Join?' }], {
              isFinal: true,
            }),
          ],
        });
        t.recognitions[0].onend?.();
      });
      s.update({
        messages: [
          question,
          answer('Ein Join verbindet Tabellen. Mehr nicht.'),
        ],
        streamingMessageId: null,
      });
      act(() => t.finish());
      return { t, s };
    }

    it('the microphone opens a moment after the voice ended, the end of the voice must not come in', async () => {
      const { t, s } = await answered();
      expect(s.props.sendMessage).toHaveBeenCalledWith('Was ist ein Join?', {
        voice: true,
      });
      expect(t.recognitions).toHaveLength(1);
      await wait(AFTER_ANSWER_MS - 10);
      expect(t.recognitions).toHaveLength(1);
      await wait(20);
      expect(t.recognitions).toHaveLength(2);
    });

    it('a tap in that moment does not start a second recognition', async () => {
      const { t, s } = await answered();
      act(() => s.hook.result.current.interrupt());
      await flush();
      expect(t.recognitions).toHaveLength(2);
      await wait(AFTER_ANSWER_MS + 50);
      expect(t.recognitions).toHaveLength(2);
    });

    it('stop in that moment starts nothing', async () => {
      const { t, s } = await answered();
      act(() => s.hook.result.current.stop());
      await wait(AFTER_ANSWER_MS + 50);
      expect(t.recognitions).toHaveLength(1);
    });
  });

  describe('the waiting phrase', () => {
    it('says it once when no piece came for three seconds, and it is not a subtitle', async () => {
      const t = makeEnv();
      const s = setup(t.env, { waitPhrase: 'Einen Moment.' });
      await startAndAsk(t, s);
      await wait(WAIT_PHRASE_MS - 100);
      expect(t.log).not.toContain('say:Einen Moment.');
      await wait(200);
      expect(t.log.filter(l => l === 'say:Einen Moment.')).toHaveLength(1);
      await wait(WAIT_PHRASE_MS * 3);
      expect(t.log.filter(l => l === 'say:Einen Moment.')).toHaveLength(1);
      // not in the subtitles, the phase stays "thinking"
      expect(s.hook.result.current.spoken).toEqual([]);
      expect(s.hook.result.current.phase).toBe('thinking');
      // the answer follows after it, in order
      s.update({
        messages: [
          question,
          answer('Ein Primärschlüssel ist eindeutig. Er ist nie leer.'),
        ],
        streamingMessageId: null,
      });
      const says = t.log.filter(l => l.startsWith('say:'));
      expect(says[0]).toBe('say:Einen Moment.');
      expect(says[1]).toBe('say:Ein Primärschlüssel ist eindeutig.');
      expect(s.hook.result.current.spoken).toEqual([
        'Ein Primärschlüssel ist eindeutig.',
        'Er ist nie leer.',
      ]);
    });

    it('is not said when the answer starts in time', async () => {
      const t = makeEnv();
      const s = setup(t.env, { waitPhrase: 'Einen Moment.' });
      await startAndAsk(t, s);
      await wait(1_000);
      s.update({
        messages: [
          question,
          answer('Ein Primärschlüssel ist eindeutig. Er ist'),
        ],
        streamingMessageId: 'a1',
      });
      await wait(WAIT_PHRASE_MS * 2);
      expect(t.log).not.toContain('say:Einen Moment.');
    });

    it('is not said without the text, after an interruption, or after stop', async () => {
      const none = makeEnv();
      const a = setup(none.env);
      await startAndAsk(none, a);
      await wait(WAIT_PHRASE_MS * 2);
      expect(none.log.some(l => l.startsWith('say:'))).toBe(false);

      const t = makeEnv();
      const s = setup(t.env, { waitPhrase: 'Einen Moment.' });
      await startAndAsk(t, s);
      act(() => s.hook.result.current.interrupt());
      await wait(WAIT_PHRASE_MS * 2);
      expect(t.log).not.toContain('say:Einen Moment.');
    });

    it('the own words of the waiting phrase are no interruption', async () => {
      const t = makeEnv();
      const s = setup(t.env, { waitPhrase: 'Einen Moment.' });
      const rec = await startAndAsk(t, s);
      await wait(WAIT_PHRASE_MS + 100);
      act(() => rec.onlevel?.(0.9));
      act(() => rec.hear('einen Moment'));
      expect(s.props.stopGeneration).not.toHaveBeenCalled();
    });
  });

  describe('consent', () => {
    it('unlocks the audio inside the tap that gives the consent', () => {
      const t = makeEnv({ consent: '' });
      const s = setup(t.env);
      expect(t.unlocked()).toBe(0);
      act(() => s.hook.result.current.giveConsent());
      expect(t.unlocked()).toBe(1);
      expect(s.hook.result.current.consented).toBe(true);
    });

    it('exposes unlockAudio for the tap of the voice mode', () => {
      const t = makeEnv();
      const s = setup(t.env);
      act(() => s.hook.result.current.unlockAudio());
      expect(t.unlocked()).toBe(1);
    });

    it('starts with no notice of a fallback', () => {
      const t = makeEnv();
      const s = setup(t.env);
      expect(s.hook.result.current.fallback).toEqual({ stt: null, tts: null });
    });

    it('LIVE_CONSENT is the mark in the list of the consent', () => {
      expect(LIVE_CONSENT).toBe('live');
    });
  });
});
