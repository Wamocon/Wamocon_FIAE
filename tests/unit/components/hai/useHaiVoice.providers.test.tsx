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
  useHaiVoice,
  type RecognitionLike,
  type SpeakerLike,
  type VoiceConfig,
  type VoiceEnv,
} from '@/components/hai/useHaiVoice';
import { parseVoiceConfig } from '@/lib/hai/voice/client/deps';

// The voice providers in the conversation loop: the consent names every provider of the
// chain, the chain follows what the browser can do, and the speaker (speech output of a
// provider) takes the pieces of an answer and tells when it is done.

type Msg = { id: string; role: string; content: string };

const win = window as unknown as Record<string, unknown>;
const nav = navigator as unknown as Record<string, unknown>;
const CONSENT_V1 = 'hai-voice-consent-v1:u1';
const CONSENT_V2 = 'hai-voice-consent-v2:u1';

function stubBrowser(options: { cloud: boolean; own: boolean }) {
  if (options.own) {
    win.webkitSpeechRecognition = function () {};
    win.speechSynthesis = {};
  }
  if (options.cloud) {
    nav.mediaDevices = { getUserMedia: async () => ({}) };
    win.MediaRecorder = function () {};
    win.AudioContext = function () {};
  }
}

function cleanBrowser() {
  delete win.webkitSpeechRecognition;
  delete win.speechSynthesis;
  delete win.MediaRecorder;
  delete win.AudioContext;
  delete nav.mediaDevices;
}

function setup(
  voiceConfig: VoiceConfig | null,
  extra: Record<string, unknown> = {}
) {
  const props = {
    userId: 'u1' as string | null,
    enabled: true,
    voiceConfig,
    messages: [] as Msg[],
    streamingMessageId: null as string | null,
    sendMessage: jest.fn(async () => undefined),
    stopGeneration: jest.fn(),
    placeholderText: 'Denkt nach...',
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

const config = (
  chain: VoiceConfig['chain'],
  region: VoiceConfig['region'] = 'eu'
): VoiceConfig => ({ provider: chain[0], chain, region });

describe('useHaiVoice with providers', () => {
  beforeEach(() => {
    window.localStorage.clear();
    cleanBrowser();
  });
  afterEach(() => cleanBrowser());

  it('walks the chain of the server, reduced to what the browser can do', async () => {
    stubBrowser({ cloud: true, own: true });
    const { hook } = setup(config(['soniox', 'haus', 'browser']));
    await flush();
    expect(hook.result.current.chain).toEqual(['soniox', 'haus', 'browser']);
    expect(hook.result.current.provider).toBe('soniox');
    expect(hook.result.current.region).toBe('eu');
    expect(hook.result.current.available).toBe(true);
  });

  it('a browser without the cloud parts keeps its own speech (Firefox has none: then nothing)', async () => {
    stubBrowser({ cloud: false, own: true });
    const own = setup(config(['soniox', 'browser']));
    await flush();
    expect(own.hook.result.current.chain).toEqual(['browser']);
    expect(own.hook.result.current.available).toBe(true);
    own.hook.unmount();

    cleanBrowser();
    const none = setup(config(['browser']));
    await flush();
    expect(none.hook.result.current.available).toBe(false);
  });

  it('a browser with the cloud parts but without own speech can use Soniox', async () => {
    stubBrowser({ cloud: true, own: false });
    const { hook } = setup(config(['soniox', 'browser']));
    await flush();
    expect(hook.result.current.chain).toEqual(['soniox']);
    expect(hook.result.current.available).toBe(true);
  });

  it('without a config from the server the browser alone is in charge', async () => {
    stubBrowser({ cloud: true, own: true });
    const { hook } = setup(null);
    await flush();
    expect(hook.result.current.chain).toEqual(['browser']);
    expect(hook.result.current.provider).toBe('browser');
    expect(hook.result.current.region).toBeNull();
  });

  it('the old consent to the browser does not cover Soniox', async () => {
    stubBrowser({ cloud: true, own: true });
    window.localStorage.setItem(CONSENT_V1, 'yes');
    const { hook } = setup(config(['soniox', 'browser']));
    await flush();
    expect(hook.result.current.consented).toBe(false);
  });

  it('the consent names every provider of the chain and holds for exactly that chain', async () => {
    stubBrowser({ cloud: true, own: true });
    const { hook, update } = setup(config(['soniox', 'browser']));
    await flush();
    act(() => hook.result.current.giveConsent());
    expect(hook.result.current.consented).toBe(true);
    // Soniox keeps the microphone open (live mode): that is part of the consent
    expect(window.localStorage.getItem(CONSENT_V2)).toBe('soniox,browser,live');
    expect(window.localStorage.getItem(CONSENT_V1)).toBe('yes');

    // the admin switches to Sokrates: a new recipient of the audio, new consent
    update({ voiceConfig: config(['haus', 'browser'], null) });
    await flush();
    expect(hook.result.current.consented).toBe(false);
    act(() => hook.result.current.giveConsent());
    expect(hook.result.current.consented).toBe(true);
    expect(window.localStorage.getItem(CONSENT_V2)).toBe(
      'soniox,browser,haus,live'
    );

    // back to Soniox: the earlier consent still counts
    update({ voiceConfig: config(['soniox', 'browser']) });
    await flush();
    expect(hook.result.current.consented).toBe(true);
  });

  it('a consent given for the browser alone stays what it was', async () => {
    stubBrowser({ cloud: false, own: true });
    const { hook } = setup(config(['browser'], null));
    await flush();
    act(() => hook.result.current.giveConsent());
    expect(window.localStorage.getItem(CONSENT_V1)).toBe('yes');
    expect(hook.result.current.consented).toBe(true);
  });

  it('the open microphone of the live mode has its own consent: an old consent for Soniox asks again', async () => {
    stubBrowser({ cloud: true, own: true });
    window.localStorage.setItem(CONSENT_V1, 'yes');
    window.localStorage.setItem(CONSENT_V2, 'soniox,browser');
    const { hook } = setup(config(['soniox', 'browser']));
    await flush();
    // given before the open microphone existed: the text names it now, the person is asked again
    expect(hook.result.current.consented).toBe(false);
    act(() => hook.result.current.giveConsent());
    expect(window.localStorage.getItem(CONSENT_V2)).toBe('soniox,browser,live');
    expect(hook.result.current.consented).toBe(true);
  });

  it('without the live mode (switched off) the old consent still holds', async () => {
    stubBrowser({ cloud: true, own: true });
    window.localStorage.setItem(CONSENT_V1, 'yes');
    window.localStorage.setItem(CONSENT_V2, 'soniox,browser');
    window.localStorage.setItem('hai-voice-live', 'off');
    const { hook } = setup(config(['soniox', 'browser']));
    await flush();
    expect(hook.result.current.consented).toBe(true);
  });

  it('a chain without Soniox never asks for the open microphone', async () => {
    stubBrowser({ cloud: true, own: true });
    window.localStorage.setItem(CONSENT_V1, 'yes');
    window.localStorage.setItem(CONSENT_V2, 'haus,browser');
    const { hook } = setup(config(['haus', 'browser']));
    await flush();
    expect(hook.result.current.consented).toBe(true);
  });

  it('withdrawing the consent withdraws it for every provider', async () => {
    stubBrowser({ cloud: true, own: true });
    const { hook } = setup(config(['soniox', 'browser']));
    await flush();
    act(() => hook.result.current.giveConsent());
    act(() => hook.result.current.revokeConsent());
    expect(hook.result.current.consented).toBe(false);
    expect(window.localStorage.getItem(CONSENT_V1)).toBe('no');
    expect(window.localStorage.getItem(CONSENT_V2)).toBe('');
  });
});

describe('useHaiVoice with the speaker of a provider', () => {
  class Recognition implements RecognitionLike {
    lang = '';
    continuous = true;
    interimResults = false;
    maxAlternatives = 0;
    onresult: RecognitionLike['onresult'] = null;
    onerror: RecognitionLike['onerror'] = null;
    onend: RecognitionLike['onend'] = null;
    start() {}
    stop() {}
    abort() {}
    say(text: string) {
      this.onresult?.({
        resultIndex: 0,
        results: [Object.assign([{ transcript: text }], { isFinal: true })],
      });
      this.onend?.();
    }
  }

  function makeEnv() {
    const recognitions: Recognition[] = [];
    const log: string[] = [];
    let onDone: (() => void) | null = null;
    let unlocked = 0;
    let resets = 0;
    const speaker: SpeakerLike = {
      say: piece => {
        log.push(`say:${piece}`);
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
        const rec = new Recognition();
        recognitions.push(rec);
        return { rec, local: false };
      },
      synth: null,
      makeUtterance: () => {
        throw new Error('the browser must not speak');
      },
      storage: {
        getItem: k =>
          k === CONSENT_V1
            ? 'yes'
            : k === 'hai-voice-day-start:u1'
              ? '2026-11-02'
              : null,
        setItem: () => undefined,
      },
      now: () => new Date('2026-11-02T07:30:00Z'),
      createSpeaker: handlers => {
        onDone = handlers.onDone;
        return speaker;
      },
      unlockAudio: () => {
        unlocked += 1;
      },
      resetFallback: () => {
        resets += 1;
      },
    };
    return {
      env,
      recognitions,
      log,
      finish: () => onDone?.(),
      unlocked: () => unlocked,
      resets: () => resets,
    };
  }

  const question: Msg = { id: 'u', role: 'user', content: 'Frage' };
  const answer = (content: string): Msg => ({
    id: 'a1',
    role: 'assistant',
    content,
  });

  function run(env: VoiceEnv) {
    const base = setup(null, { env });
    return base;
  }

  it('unlocks the audio and resets the fallback inside the tap that starts the conversation', async () => {
    const t = makeEnv();
    const { hook } = run(t.env);
    await flush();
    act(() => hook.result.current.start());
    await flush();
    expect(t.unlocked()).toBe(1);
    expect(t.resets()).toBe(1);
  });

  it('gives the pieces of the answer to the speaker, ends it, and listens again when it is done', async () => {
    const t = makeEnv();
    const { hook, update } = run(t.env);
    await flush();
    act(() => hook.result.current.start());
    await flush();
    act(() => t.recognitions[0].say('Frage'));

    update({
      messages: [
        question,
        answer(
          'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig. Er darf nie leer'
        ),
      ],
      streamingMessageId: 'a1',
    });
    expect(t.log).toEqual([
      'say:Ein Primärschlüssel kennzeichnet eine Zeile eindeutig.',
    ]);
    expect(hook.result.current.phase).toBe('speaking');

    update({
      messages: [
        question,
        answer(
          'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig. Er darf nie leer sein.'
        ),
      ],
      streamingMessageId: null,
    });
    expect(t.log).toEqual([
      'say:Ein Primärschlüssel kennzeichnet eine Zeile eindeutig.',
      'say:Er darf nie leer sein.',
      'end',
    ]);
    // not done yet: no new round
    expect(t.recognitions).toHaveLength(1);
    act(() => t.finish());
    await flush();
    expect(t.recognitions).toHaveLength(2);
    expect(hook.result.current.phase).toBe('listening');
    // a second report of the same speaker does not start another round
    act(() => t.finish());
    await flush();
    expect(t.recognitions).toHaveLength(2);
  });

  it('an answer with nothing to read is done at once', async () => {
    const t = makeEnv();
    const { hook, update } = run(t.env);
    await flush();
    act(() => hook.result.current.start());
    await flush();
    act(() => t.recognitions[0].say('Frage'));
    update({
      messages: [question, answer('```\ncode\n```')],
      streamingMessageId: null,
    });
    await flush();
    // the speaker exists from the request on (warmed up), nothing is said: it is told the
    // end and reports done at once (a real speaker with no piece does)
    expect(t.log).toEqual(['end']);
    act(() => t.finish());
    await flush();
    expect(t.recognitions).toHaveLength(2);
  });

  it('a tap while it speaks cancels the speaker and what comes later is not read', async () => {
    const t = makeEnv();
    const { hook, update } = run(t.env);
    await flush();
    act(() => hook.result.current.start());
    await flush();
    act(() => t.recognitions[0].say('Frage'));
    update({
      messages: [
        question,
        answer(
          'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig. Er darf nie leer'
        ),
      ],
      streamingMessageId: 'a1',
    });
    act(() => hook.result.current.interrupt());
    await flush();
    expect(t.log).toContain('cancel');
    expect(t.recognitions).toHaveLength(2);
    update({
      messages: [
        question,
        answer(
          'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig. Er darf nie leer sein.'
        ),
      ],
      streamingMessageId: null,
    });
    expect(t.log.filter(entry => entry.startsWith('say:'))).toEqual([
      'say:Ein Primärschlüssel kennzeichnet eine Zeile eindeutig.',
    ]);
    // the cancelled speaker is not asked to end and never reports
    act(() => t.finish());
    await flush();
    expect(t.recognitions).toHaveLength(2);
  });

  it('stopping the conversation cancels the speaker', async () => {
    const t = makeEnv();
    const { hook, update } = run(t.env);
    await flush();
    act(() => hook.result.current.start());
    await flush();
    act(() => t.recognitions[0].say('Frage'));
    update({
      messages: [
        question,
        answer(
          'Ein Primärschlüssel kennzeichnet eine Zeile eindeutig. Er darf nie leer'
        ),
      ],
      streamingMessageId: 'a1',
    });
    act(() => hook.result.current.stop());
    expect(t.log).toContain('cancel');
    expect(hook.result.current.phase).toBe('idle');
  });
});

describe('the answer of GET /api/hai/voice/config', () => {
  it('keeps the known providers in order, and the region', () => {
    expect(
      parseVoiceConfig({
        provider: 'soniox',
        chain: ['soniox', 'haus', 'browser'],
        region: 'eu',
      })
    ).toEqual({
      provider: 'soniox',
      chain: ['soniox', 'haus', 'browser'],
      region: 'eu',
    });
  });

  it('drops unknown providers and a region that is not eu or us', () => {
    expect(
      parseVoiceConfig({ chain: ['google', 'browser'], region: 'mars' })
    ).toEqual({ provider: 'browser', chain: ['browser'], region: null });
  });

  it('an answer of an older server has no chains: the single chain holds for both functions', () => {
    const parsed = parseVoiceConfig({
      provider: 'soniox',
      chain: ['soniox', 'browser'],
      region: 'eu',
    });
    expect(parsed?.chains).toBeUndefined();
  });

  it('reads the chain per function: listening and speaking apart', () => {
    expect(
      parseVoiceConfig({
        provider: 'soniox',
        chain: ['soniox', 'haus', 'browser'],
        chains: {
          stt: ['haus', 'browser'],
          tts: ['soniox', 'haus', 'browser'],
        },
        region: 'eu',
      })
    ).toEqual({
      provider: 'soniox',
      chain: ['soniox', 'haus', 'browser'],
      chains: {
        stt: ['haus', 'browser'],
        tts: ['soniox', 'haus', 'browser'],
      },
      region: 'eu',
    });
  });

  it('drops unknown providers in a chain per function, and ignores chains that are not usable', () => {
    const base = { chain: ['soniox', 'browser'], region: 'eu' };
    expect(
      parseVoiceConfig({
        ...base,
        chains: { stt: ['google', 'browser'], tts: ['soniox', 'browser'] },
      })?.chains
    ).toEqual({ stt: ['browser'], tts: ['soniox', 'browser'] });
    for (const chains of [
      null,
      'x',
      {},
      { stt: ['browser'] },
      { stt: ['browser'], tts: [] },
      { stt: ['browser'], tts: ['google'] },
      { stt: 'browser', tts: ['browser'] },
    ]) {
      const parsed = parseVoiceConfig({ ...base, chains });
      // the single chain is still read
      expect(parsed?.chain).toEqual(['soniox', 'browser']);
      expect(parsed?.chains).toBeUndefined();
    }
  });

  it('is nothing when the answer has no usable chain', () => {
    for (const data of [null, {}, { chain: [] }, { chain: ['google'] }, 'x']) {
      expect(parseVoiceConfig(data)).toBeNull();
    }
  });
});
