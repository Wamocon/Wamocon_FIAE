'use client';

/**
 * Voice assistant of the HAI (day companion, WMCNL-2907): listen, send, think,
 * read the answer aloud, listen again.
 *
 * Speech stays in the browser. Recognition and reading aloud are the functions of
 * the browser (SpeechRecognition, speechSynthesis); the server gets the recognized
 * TEXT through the normal chat route, exactly as a typed question, and no audio is
 * recorded or stored by this application. Where the browser offers recognition on
 * the device (processLocally), it is used, then no audio leaves the device at all;
 * otherwise the browser itself may send the audio to its speech service (Chrome:
 * Google), which the consent text says.
 *
 * The conversation loop is built like the speech mode of damicon, without the live
 * transcription service: the microphone is off while the assistant speaks (no
 * echo), a tap interrupts, "Stopp" or "Sprachmodus beenden" ends the conversation,
 * and once a day it opens with the question for the day at a glance.
 *
 * @module components/hai/useHaiVoice
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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

export interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface UtteranceLike {
  text: string;
  lang: string;
  voice: unknown;
  rate: number;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export interface SynthLike {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  getVoices(): Array<{ lang: string; localService?: boolean; name?: string }>;
}

export interface VoiceEnv {
  /** A recognition object and whether it works on the device only; null if the browser has none. */
  createRecognition(): Promise<{ rec: RecognitionLike; local: boolean } | null>;
  synth: SynthLike | null;
  makeUtterance(text: string): UtteranceLike;
  storage: SimpleStorage | null;
  now(): Date;
}

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
  /** Replaces the browser, for tests. */
  env?: VoiceEnv | null;
}

const CONSENT_PREFIX = 'hai-voice-consent-v1:';
const DAY_START_OFF_PREFIX = 'hai-voice-day-start-off:';
const MAX_SILENT_ROUNDS = 3;

interface SpokenState {
  id: string | null;
  count: number;
  pending: number;
  finished: boolean;
  done: boolean;
}

const freshSpoken = (): SpokenState => ({
  id: null,
  count: 0,
  pending: 0,
  finished: false,
  done: false,
});

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

  const envRef = useRef<VoiceEnv | null | undefined>(options.env);
  if (envRef.current === undefined) envRef.current = browserVoiceEnv();
  const env = envRef.current;

  const [phase, setPhaseState] = useState<VoicePhase>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<VoiceError>(null);
  const [localRecognition, setLocalRecognition] = useState(false);
  const [consented, setConsented] = useState(false);
  const [dayStartEnabled, setDayStartEnabledState] = useState(true);

  const phaseRef = useRef<VoicePhase>('idle');
  const stoppedRef = useRef(true);
  const recRef = useRef<RecognitionLike | null>(null);
  const silentRoundsRef = useRef(0);
  const baselineIdRef = useRef<string | null>(null);
  const ignoreIdRef = useRef<string | null>(null);
  const spokenRef = useRef<SpokenState>(freshSpoken());
  const listenRef = useRef<() => void>(() => undefined);

  const browserSupport =
    typeof window !== 'undefined'
      ? voiceSupport(window as unknown as Window & Record<string, unknown>)
      : { recognition: false, synthesis: false };
  // the replaced environment of a test counts as supported
  const usable =
    !!env &&
    (options.env
      ? true
      : browserSupport.recognition && browserSupport.synthesis);

  const setPhase = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  // consent and the day start switch, per person, in the browser only
  useEffect(() => {
    if (!userId || !env?.storage) return;
    try {
      setConsented(env.storage.getItem(CONSENT_PREFIX + userId) === 'yes');
      setDayStartEnabledState(
        env.storage.getItem(DAY_START_OFF_PREFIX + userId) !== 'yes'
      );
    } catch {
      setConsented(false);
    }
  }, [userId, env]);

  const giveConsent = useCallback(() => {
    if (!userId) return;
    try {
      env?.storage?.setItem(CONSENT_PREFIX + userId, 'yes');
    } catch {
      // the consent then holds for this visit only
    }
    setConsented(true);
  }, [userId, env]);

  const revokeConsent = useCallback(() => {
    if (!userId) return;
    try {
      env?.storage?.setItem(CONSENT_PREFIX + userId, 'no');
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
    try {
      env?.synth?.cancel();
    } catch {
      // nothing is speaking
    }
    spokenRef.current.pending = 0;
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
    const now = env.now();
    if (dayStartEnabled && dayStartDue(env.storage, userId, now)) {
      markDayStart(env.storage, userId, now);
      submit(dayStartMessage(berlinHour(now)));
      return;
    }
    void listen();
  }, [
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
    if (!env?.synth) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (last.id === baselineIdRef.current || last.id === ignoreIdRef.current)
      return;
    const text = last.content;
    if (!text || (placeholderText && text === placeholderText)) return;

    const state = spokenRef.current;
    if (state.id !== last.id) {
      Object.assign(state, freshSpoken(), { id: last.id });
    }
    if (state.done) return;
    const final = streamingMessageId !== last.id;
    const pieces = nextSpeechPieces(text, state.count, final);
    const synth = env.synth;
    for (const piece of pieces) {
      const utterance = env.makeUtterance(piece);
      utterance.lang = LANG;
      utterance.rate = 1;
      const voices = synth.getVoices();
      utterance.voice =
        voices.find(v => v.lang === LANG && v.localService) ??
        voices.find(v => v.lang === LANG) ??
        voices.find(v => v.lang.startsWith('de')) ??
        null;
      const spoken = () => {
        state.pending = Math.max(0, state.pending - 1);
        if (state.pending === 0 && state.finished && !state.done) {
          state.done = true;
          afterAnswer();
        }
      };
      utterance.onend = spoken;
      utterance.onerror = spoken;
      state.pending += 1;
      synth.speak(utterance);
    }
    state.count += pieces.length;
    if (pieces.length > 0) setPhase('speaking');
    if (final) {
      state.finished = true;
      // nothing (more) to read: the answer is done
      if (state.pending === 0 && !state.done) {
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
