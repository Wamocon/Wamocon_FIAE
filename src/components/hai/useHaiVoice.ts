'use client';

/**
 * Voice assistant of the HAI (day companion, WMCNL-2907): listen, send, think,
 * read the answer aloud, listen again.
 *
 * Who listens and speaks is a provider (src/lib/hai/voice/client/engine.ts): Soniox
 * (the browser talks to the service over a websocket with a short lived key from
 * the server), Sokrates (the own server, the audio passes this application) or the
 * browser itself (SpeechRecognition, speechSynthesis). The platform admin chooses a
 * main provider and a fallback, the server answers with the chain (GET
 * /api/hai/voice/config) and the loop walks it: when a provider is not available
 * the next one takes over, up to the browser. The loop itself does not know which
 * provider is behind recognition and speech output.
 *
 * The server of this application gets the recognized TEXT through the normal chat
 * route, exactly as a typed question, and records or stores no audio. Where the
 * audio goes depends on the provider, and the consent text says it: Soniox (external
 * service, region EU or US), Sokrates (stays in the house) or the browser (where it
 * offers recognition on the device (processLocally) no audio leaves the device,
 * otherwise the browser may send it to its speech service, Chrome: Google).
 *
 * The conversation loop is built like the speech mode of damicon, without the live
 * transcription service: the microphone is off while the assistant speaks (no
 * echo), a tap interrupts, "Stopp" or "Sprachmodus beenden" ends the conversation,
 * and once a day it opens with the question for the day at a glance.
 *
 * @module components/hai/useHaiVoice
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  berlinHour,
  dayStartDue,
  dayStartMessage,
  isStopCommand,
  markDayStart,
  nextSpeechPieces,
  voiceSupport,
  type SimpleStorage,
} from '@/lib/hai/voice/speech';
import { createBrowserSpeaker } from '@/lib/hai/voice/client/browserSpeech';
import {
  cloudVoiceSupport,
  createCloudDeps,
} from '@/lib/hai/voice/client/deps';
import { createVoiceEnv } from '@/lib/hai/voice/client/engine';
import type {
  RecognitionEventLike,
  RecognitionLike,
  SpeakerLike,
  SynthLike,
  UtteranceLike,
  VoiceConfig,
  VoiceEnv,
  VoiceProviderId,
} from '@/lib/hai/voice/client/types';

// the shapes the environment of the loop is made of (tests replace them)
export type {
  RecognitionEventLike,
  RecognitionLike,
  SpeakerLike,
  SynthLike,
  UtteranceLike,
  VoiceConfig,
  VoiceEnv,
  VoiceProviderId,
};

export type VoicePhase =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';
export type VoiceError =
  | 'not-allowed'
  | 'no-speech'
  | 'unsupported'
  | 'failed'
  | null;

// ============================================================================
// THE BROWSER, REPLACEABLE FOR TESTS
// ============================================================================

const LANG = 'de-DE';

type BrowserRecognitionCtor = {
  new (): RecognitionLike;
  available?: (options: {
    langs: string[];
    processLocally: boolean;
  }) => Promise<string>;
};

export function browserVoiceEnv(): VoiceEnv | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as Record<string, unknown>;
  const Ctor = (win.SpeechRecognition || win.webkitSpeechRecognition) as
    | BrowserRecognitionCtor
    | undefined;
  const synth =
    'speechSynthesis' in window
      ? (window.speechSynthesis as unknown as SynthLike)
      : null;
  let storage: SimpleStorage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    async createRecognition() {
      if (!Ctor) return null;
      const rec = new Ctor();
      let local = false;
      // Recognition on the device: no audio leaves it (Chrome 139 and later, language pack)
      try {
        if (typeof Ctor.available === 'function') {
          const state = await Ctor.available({
            langs: [LANG],
            processLocally: true,
          });
          if (state === 'available') {
            rec.processLocally = true;
            local = true;
          }
        }
      } catch {
        local = false;
      }
      return { rec, local };
    },
    synth,
    makeUtterance(text) {
      return new SpeechSynthesisUtterance(text) as unknown as UtteranceLike;
    },
    storage,
    now: () => new Date(),
  };
}

// ============================================================================
// THE HOOK
// ============================================================================

interface MessageLike {
  id: string;
  role: string;
  content: string;
}

export interface UseHaiVoiceOptions {
  userId: string | null | undefined;
  /** The organization allows the voice assistant (GET /api/hai/voice). */
  enabled: boolean;
  messages: MessageLike[];
  streamingMessageId: string | null;
  sendMessage: (
    message: string,
    options?: { voice?: boolean }
  ) => Promise<void>;
  stopGeneration: () => void;
  /** Text shown in the message before the first chunk arrives: never read aloud. */
  placeholderText?: string;
  /**
   * The providers in charge (GET /api/hai/voice/config). Null or left out: the
   * browser alone, as before the providers existed.
   */
  voiceConfig?: VoiceConfig | null;
  /** Replaces the browser and the chain of providers, for tests. */
  env?: VoiceEnv | null;
}

// Consent of the person, in the browser only. v1 is the consent to the browser as
// the provider (value 'yes' or 'no', as it always was). v2 lists the providers the
// person agreed to (Soniox and Sokrates have another recipient of the audio than the
// browser): the consent counts only while every provider of the chain is on it.
const CONSENT_PREFIX = 'hai-voice-consent-v1:';
const CONSENT_PROVIDERS_PREFIX = 'hai-voice-consent-v2:';
const DAY_START_OFF_PREFIX = 'hai-voice-day-start-off:';
const MAX_SILENT_ROUNDS = 3;

interface SpokenState {
  id: string | null;
  count: number;
  speaker: SpeakerLike | null;
  finished: boolean;
  done: boolean;
}

const freshSpoken = (): SpokenState => ({
  id: null,
  count: 0,
  speaker: null,
  finished: false,
  done: false,
});

function listedProviders(
  storage: SimpleStorage,
  userId: string
): VoiceProviderId[] {
  const raw = storage.getItem(CONSENT_PROVIDERS_PREFIX + userId) ?? '';
  return raw
    .split(',')
    .filter(
      (id): id is VoiceProviderId =>
        id === 'soniox' || id === 'haus' || id === 'browser'
    );
}

/** Did the person agree to every provider of the chain? */
function consentCovers(
  storage: SimpleStorage,
  userId: string,
  chain: VoiceProviderId[]
): boolean {
  const browserYes = storage.getItem(CONSENT_PREFIX + userId) === 'yes';
  const listed = listedProviders(storage, userId);
  if (chain.length === 0) return browserYes;
  return chain.every(id =>
    id === 'browser'
      ? browserYes || listed.includes('browser')
      : listed.includes(id)
  );
}

export function useHaiVoice(options: UseHaiVoiceOptions) {
  const {
    userId,
    enabled,
    messages,
    streamingMessageId,
    sendMessage,
    stopGeneration,
    placeholderText,
  } = options;

  const { voiceConfig, env: testEnv } = options;

  // what this browser can do: the browser's own speech, and the cloud parts
  const support = useMemo(() => {
    if (typeof window === 'undefined') return { browser: false, cloud: false };
    const win = window as unknown as Window & Record<string, unknown>;
    const own = voiceSupport(win);
    return {
      browser: own.recognition && own.synthesis,
      cloud: cloudVoiceSupport(win),
    };
  }, []);

  // the providers to walk, reduced to what this browser can do (a replaced
  // environment of a test is the browser alone)
  const chain = useMemo<VoiceProviderId[]>(() => {
    if (testEnv !== undefined) return ['browser'];
    const wanted = voiceConfig?.chain ?? ['browser'];
    return wanted.filter(id =>
      id === 'browser' ? support.browser : support.cloud
    );
  }, [testEnv, voiceConfig, support]);

  const [activeProvider, setActiveProvider] = useState<VoiceProviderId>(
    chain[0] ?? 'browser'
  );
  useEffect(() => {
    setActiveProvider(chain[0] ?? 'browser');
  }, [chain]);

  const env = useMemo<VoiceEnv | null>(() => {
    if (testEnv !== undefined) return testEnv;
    const base = browserVoiceEnv();
    if (!base) return null;
    return createVoiceEnv({
      base,
      chain,
      deps: chain.some(id => id !== 'browser') ? createCloudDeps() : null,
      onActiveProvider: setActiveProvider,
    });
  }, [testEnv, chain]);

  const [phase, setPhaseState] = useState<VoicePhase>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<VoiceError>(null);
  const [localRecognition, setLocalRecognition] = useState(false);
  const [consented, setConsented] = useState(false);
  const [dayStartEnabled, setDayStartEnabledState] = useState(true);
  // what the voice mode shows: what was understood last, the pieces of the answer
  // handed to the speaker, and the loudness of the recording when the provider
  // reports one (0 to 1)
  const [heard, setHeard] = useState('');
  const [spoken, setSpoken] = useState<string[]>([]);
  const [level, setLevel] = useState<number | null>(null);

  const phaseRef = useRef<VoicePhase>('idle');
  const stoppedRef = useRef(true);
  const recRef = useRef<RecognitionLike | null>(null);
  const silentRoundsRef = useRef(0);
  const baselineIdRef = useRef<string | null>(null);
  const ignoreIdRef = useRef<string | null>(null);
  const spokenRef = useRef<SpokenState>(freshSpoken());
  const listenRef = useRef<() => void>(() => undefined);

  // the replaced environment of a test counts as supported
  const usable = !!env && (testEnv ? true : chain.length > 0);

  const setPhase = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  // consent and the day start switch, per person, in the browser only
  useEffect(() => {
    if (!userId || !env?.storage) return;
    try {
      setConsented(consentCovers(env.storage, userId, chain));
      setDayStartEnabledState(
        env.storage.getItem(DAY_START_OFF_PREFIX + userId) !== 'yes'
      );
    } catch {
      setConsented(false);
    }
  }, [userId, env, chain]);

  const giveConsent = useCallback(() => {
    if (!userId) return;
    try {
      const storage = env?.storage;
      if (storage) {
        // the consent names every provider of the chain it was given for
        const agreed = new Set([...listedProviders(storage, userId), ...chain]);
        storage.setItem(
          CONSENT_PROVIDERS_PREFIX + userId,
          [...agreed].join(',')
        );
        if (chain.includes('browser')) {
          storage.setItem(CONSENT_PREFIX + userId, 'yes');
        }
      }
    } catch {
      // the consent then holds for this visit only
    }
    setConsented(true);
  }, [userId, env, chain]);

  const revokeConsent = useCallback(() => {
    if (!userId) return;
    try {
      env?.storage?.setItem(CONSENT_PREFIX + userId, 'no');
      env?.storage?.setItem(CONSENT_PROVIDERS_PREFIX + userId, '');
    } catch {
      // nothing to remove
    }
    setConsented(false);
  }, [userId, env]);

  const setDayStartEnabled = useCallback(
    (on: boolean) => {
      setDayStartEnabledState(on);
      if (!userId) return;
      try {
        env?.storage?.setItem(DAY_START_OFF_PREFIX + userId, on ? 'no' : 'yes');
      } catch {
        // the choice then holds for this visit only
      }
    },
    [userId, env]
  );

  const cancelSpeech = useCallback(() => {
    const state = spokenRef.current;
    try {
      state.speaker?.cancel();
    } catch {
      // nothing is speaking
    }
    state.speaker = null;
    if (!env?.createSpeaker) {
      try {
        env?.synth?.cancel();
      } catch {
        // nothing is speaking
      }
    }
  }, [env]);

  const dropRecognition = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      // already stopped
    }
  }, []);

  const fail = useCallback(
    (reason: Exclude<VoiceError, null>) => {
      stoppedRef.current = true;
      dropRecognition();
      cancelSpeech();
      setError(reason);
      setInterim('');
      setPhase('error');
    },
    [cancelSpeech, dropRecognition, setPhase]
  );

  const stop = useCallback(() => {
    stoppedRef.current = true;
    dropRecognition();
    cancelSpeech();
    ignoreIdRef.current = spokenRef.current.id;
    setInterim('');
    setHeard('');
    setSpoken([]);
    setLevel(null);
    setError(null);
    setPhase('idle');
  }, [cancelSpeech, dropRecognition, setPhase]);

  const submit = useCallback(
    (text: string) => {
      const lastAssistant = [...messages]
        .reverse()
        .find(m => m.role === 'assistant');
      baselineIdRef.current = lastAssistant?.id ?? null;
      spokenRef.current = freshSpoken();
      setInterim('');
      setSpoken([]);
      setLevel(null);
      setPhase('thinking');
      void sendMessage(text, { voice: true });
    },
    [messages, sendMessage, setPhase]
  );

  const handleFinal = useCallback(
    (text: string) => {
      if (isStopCommand(text)) {
        stop();
        return;
      }
      silentRoundsRef.current = 0;
      setHeard(text);
      submit(text);
    },
    [stop, submit]
  );

  const listen = useCallback(async () => {
    if (stoppedRef.current || !env) return;
    dropRecognition();
    const made = await env.createRecognition();
    if (stoppedRef.current) return;
    if (!made) {
      fail('unsupported');
      return;
    }
    const { rec, local } = made;
    setLocalRecognition(local);
    rec.lang = LANG;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = event => {
      let live = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const piece = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += piece;
        else live += piece;
      }
      setInterim((finalText + live).trim());
    };
    // Optional: a provider that measures the recording reports its loudness (0 to 1)
    (
      rec as RecognitionLike & { onlevel?: ((value: number) => void) | null }
    ).onlevel = value => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        setLevel(Math.min(1, Math.max(0, value)));
      }
    };
    rec.onerror = event => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      if (
        event.error === 'not-allowed' ||
        event.error === 'service-not-allowed'
      ) {
        fail('not-allowed');
        return;
      }
      fail('failed');
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      recRef.current = null;
      if (stoppedRef.current) return;
      const heard = finalText.trim();
      if (heard) {
        handleFinal(heard);
        return;
      }
      // silence: the browser ends the round after a while, listen again a few times
      silentRoundsRef.current += 1;
      if (silentRoundsRef.current >= MAX_SILENT_ROUNDS) {
        fail('no-speech');
        return;
      }
      setTimeout(() => listenRef.current(), 250);
    };
    recRef.current = rec;
    setError(null);
    setPhase('listening');
    try {
      rec.start();
    } catch {
      fail('failed');
    }
  }, [dropRecognition, env, fail, handleFinal, setPhase]);

  useEffect(() => {
    listenRef.current = () => {
      void listen();
    };
  }, [listen]);

  const afterAnswer = useCallback(() => {
    if (stoppedRef.current) return;
    void listen();
  }, [listen]);

  const start = useCallback(() => {
    if (!enabled || !usable || !consented || !userId || !env) return;
    stoppedRef.current = false;
    silentRoundsRef.current = 0;
    setError(null);
    // a tap: let the audio of a provider play (iOS, Safari), and try the chain from the top
    env.unlockAudio?.();
    env.resetFallback?.();
    setActiveProvider(chain[0] ?? 'browser');
    const now = env.now();
    if (dayStartEnabled && dayStartDue(env.storage, userId, now)) {
      markDayStart(env.storage, userId, now);
      submit(dayStartMessage(berlinHour(now)));
      return;
    }
    void listen();
  }, [
    chain,
    consented,
    dayStartEnabled,
    enabled,
    env,
    listen,
    submit,
    usable,
    userId,
  ]);

  /** A tap while the assistant speaks or thinks: be quiet and listen. */
  const interrupt = useCallback(() => {
    if (stoppedRef.current) return;
    cancelSpeech();
    ignoreIdRef.current = spokenRef.current.id;
    spokenRef.current.finished = true;
    spokenRef.current.done = true;
    if (streamingMessageId) stopGeneration();
    void listen();
  }, [cancelSpeech, listen, stopGeneration, streamingMessageId]);

  // read the answer aloud while it streams
  useEffect(() => {
    if (phaseRef.current !== 'thinking' && phaseRef.current !== 'speaking')
      return;
    if (!env || (!env.createSpeaker && !env.synth)) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (last.id === baselineIdRef.current || last.id === ignoreIdRef.current)
      return;
    const text = last.content;
    if (!text || (placeholderText && text === placeholderText)) return;

    const state = spokenRef.current;
    if (state.id !== last.id) {
      state.speaker?.cancel();
      Object.assign(state, freshSpoken(), { id: last.id });
    }
    if (state.done) return;
    const final = streamingMessageId !== last.id;
    const pieces = nextSpeechPieces(text, state.count, final);
    if (pieces.length > 0 && !state.speaker) {
      const handlers = {
        onDone: () => {
          if (spokenRef.current !== state || state.done) return;
          state.done = true;
          afterAnswer();
        },
      };
      state.speaker = env.createSpeaker
        ? env.createSpeaker(handlers)
        : createBrowserSpeaker(env, handlers);
    }
    for (const piece of pieces) state.speaker?.say(piece);
    state.count += pieces.length;
    if (pieces.length > 0 && state.speaker) {
      // the first pieces of an answer replace what the last answer showed
      const first = state.count === pieces.length;
      setSpoken(previous => (first ? pieces : [...previous, ...pieces]));
    }
    if (pieces.length > 0 && state.speaker) setPhase('speaking');
    if (final) {
      state.finished = true;
      if (state.speaker) {
        // the speaker tells when the last piece is spoken
        state.speaker.end();
      } else if (!state.done) {
        // nothing (more) to read: the answer is done
        state.done = true;
        afterAnswer();
      }
    }
  }, [
    messages,
    streamingMessageId,
    env,
    placeholderText,
    afterAnswer,
    setPhase,
  ]);

  // leaving the page ends everything
  useEffect(() => stop, [stop]);

  return {
    supported: usable,
    available: enabled && usable,
    phase,
    interim,
    error,
    localRecognition,
    /** What was understood in the last round, the question that went to the HAI. */
    heard,
    /** The pieces of the answer handed to the speaker so far (subtitles of the voice mode). */
    spoken,
    /** Loudness of the recording (0 to 1) if the provider reports one, else null. */
    level,
    /** The provider that listens and speaks now (the head of the chain at the start). */
    provider: activeProvider,
    /** The providers in the order they are tried. */
    chain,
    /** Region of Soniox ('eu' or 'us') when it is in the chain, for the consent text. */
    region: voiceConfig?.region ?? null,
    consented,
    giveConsent,
    revokeConsent,
    dayStartEnabled,
    setDayStartEnabled,
    start,
    stop,
    interrupt,
  };
}
