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
 * The conversation loop is built like the speech mode of damicon: a tap interrupts,
 * "Stopp" or "Sprachmodus beenden" ends the conversation, and once a day it opens
 * with the question for the day at a glance.
 *
 * Live mode (default, with Soniox): the recognition and the microphone stay open for
 * the whole conversation, so the person can speak while the assistant answers and
 * the answer stops at once (barge-in: the voice is cut, the running chat answer is
 * aborted, the new utterance is processed). The microphone then runs with the echo
 * cancellation of the browser, a words-or-loudness threshold and a filter for
 * what the assistant says itself guard against hearing itself. The open microphone
 * holds only while the voice mode runs and ends with stop, Esc, leaving the page or
 * three silent rounds. Off with localStorage['hai-voice-live'] = 'off': then the
 * microphone is off while the assistant speaks (a round per question), as before.
 *
 * Only the voice of the person counts (04.11.2026): an utterance is judged by the
 * loudness of the recording over its words (adaptive gate, lib/hai/voice/levelGate.ts)
 * and by the confidence of the recognition, and dropped (not sent, not stored, not
 * shown) when it is too quiet or too uncertain. Signal words at the start of an
 * utterance ("Stopp", "Warte", ...) stop the assistant at once, "Gespräch beenden"
 * ends the mode (lib/hai/voice/signalWords.ts). A signal word passes the same gate
 * and echo filter as any utterance. Push to talk (setting): the microphone records
 * only while a button or the space bar is held, nothing else is ever heard.
 *
 * The gate never locks the person out (05.11.2026): at the start of the live mode
 * the person says a short phrase ("Hallo HAI") that sets the reference of the voice
 * and the room level (calibration, no chat call), the threshold is relative to
 * that, a discarded utterance names its reason (quiet, not understood, overdriven,
 * other voice), two discarded utterances in a row that stand clearly above the room
 * offer a way out at once (calibrate again, push to talk, filter off), and every
 * decision leaves its numbers in the local diagnosis (client/diagnostics.ts).
 *
 * @module components/hai/useHaiVoice
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  berlinHour,
  dayStartDue,
  dayStartMessage,
  markDayStart,
  nextSpeechPieces,
  voiceSupport,
  type SimpleStorage,
} from '@/lib/hai/voice/speech';
import {
  PUSH_TO_TALK_KEY,
  SENSITIVITY_KEY,
  SIGNAL_HINT_KEY,
  SIGNAL_WORDS_KEY,
  readFilterSettings,
  signalHintSeen,
  writeFilterSetting,
} from '@/lib/hai/voice/filterSettings';
import {
  LevelGate,
  type GateVerdict,
  type Sensitivity,
} from '@/lib/hai/voice/levelGate';
import {
  classifySignal,
  haltAtStart,
  isCalibrationPhrase,
  speechWords,
  type SignalLanguage,
} from '@/lib/hai/voice/signalWords';
import { createBrowserSpeaker } from '@/lib/hai/voice/client/browserSpeech';
import type { ProviderFallback } from '@/lib/hai/voice/client/fallback';
import { mark } from '@/lib/hai/voice/client/trace';
import {
  buildDiagnosis,
  copyText,
  recordDiagnosis,
} from '@/lib/hai/voice/client/diagnostics';
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
  UtteranceInfo,
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
  UtteranceInfo,
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
   * Said once when no piece of the answer came for three seconds ("Einen Moment."):
   * never part of the subtitles or the chat. Left out: no waiting phrase.
   */
  waitPhrase?: string;
  /**
   * The providers in charge (GET /api/hai/voice/config). Null or left out: the
   * browser alone, as before the providers existed.
   */
  voiceConfig?: VoiceConfig | null;
  /** Replaces the browser and the chain of providers, for tests. */
  env?: VoiceEnv | null;
  /**
   * The person said "Mikrofon aus": switch the microphone off until the button
   * is pressed (the voice mode keeps its state). Left out: the loop just stops.
   */
  onMicOff?: () => void;
  /**
   * Calibrate the microphone at the start of the live mode ("Sag kurz: Hallo HAI").
   * Default true. Left out of the calibration: push to talk and the setting "off".
   */
  calibrate?: boolean;
}

// Consent of the person, in the browser only. v1 is the consent to the browser as
// the provider (value 'yes' or 'no', as it always was). v2 lists the providers the
// person agreed to (Soniox and Sokrates have another recipient of the audio than the
// browser): the consent counts only while every provider of the chain is on it.
const CONSENT_PREFIX = 'hai-voice-consent-v1:';
const CONSENT_PROVIDERS_PREFIX = 'hai-voice-consent-v2:';
const DAY_START_OFF_PREFIX = 'hai-voice-day-start-off:';
const MAX_SILENT_ROUNDS = 3;
/** localStorage: 'off' switches the live mode off (a round per question). */
export const LIVE_STORAGE_KEY = 'hai-voice-live';
/** No piece of the answer for this long: say the waiting phrase once. */
export const WAIT_PHRASE_MS = 3_000;
/** After the answer the raw microphone of a round (Soniox, live mode off) opens only after this (the end of the voice must not come in). */
export const AFTER_ANSWER_MS = 150;
/** Live mode: this long without a word in the listening phase counts as a silent round. */
export const LIVE_SILENCE_MS = 8_000;
/** Barge-in by one word needs at least this loudness of the recording (0 to 1). */
export const BARGE_IN_LEVEL = 0.2;
/** After the voice ended, an utterance made of the assistant's own words is an echo. */
export const ECHO_WINDOW_MS = 2_500;
/** The languages of the signal words that count (the recognition runs with German). */
const SIGNAL_LANGUAGES: readonly SignalLanguage[] = ['de'];
/** How long the note "only you" stays in the display. */
export const FILTER_NOTE_MS = 6_000;
/** This many quiet utterances in a row make the note "speak louder or closer". */
export const QUIET_STREAK = 2;
/** This many utterances in a row that stand above the room but under the threshold offer the way out. */
export const LOST_STREAK = 2;
/** The calibration waits this long for the phrase of the person. */
export const CALIBRATION_MS = 12_000;
/** The way out stays this long, then it goes away and does not come back for CHOICE_SNOOZE_MS. */
export const CHOICE_MS = 30_000;
export const CHOICE_SNOOZE_MS = 60_000;
/** How long the first hint ("Sag Stopp ...") stays in the display. */
export const SIGNAL_HINT_MS = 7_000;

/**
 * What the display says about utterances that were left out (never their text), one
 * text per reason:
 *   only-you   another voice, not the person (or a murmur that could not be told)
 *   too-quiet  real silence at the microphone: only here the hint to speak louder
 *   unclear    the words were not understood clearly
 *   loud       overdriven or shouting, it counted: please a little softer
 */
export type FilterNote = 'only-you' | 'too-quiet' | 'unclear' | 'loud' | null;

/** The calibration: not started, waiting for the phrase, done, failed, skipped. */
export type CalibrationState =
  | 'idle'
  | 'listening'
  | 'done'
  | 'failed'
  | 'skipped';
/** Why a calibration failed (nothing: no phrase came in time). */
export type CalibrationReason = 'quiet' | 'noisy' | 'nolevel' | 'nothing';
/**
 * What the display asks of the person next: say the phrase, the calibration failed
 * (guidance and choice), or the person may not have been heard (choice).
 */
export type FilterPrompt = 'calibrate' | 'calibration-failed' | 'lost' | null;

interface SpokenState {
  id: string | null;
  count: number;
  speaker: SpeakerLike | null;
  finished: boolean;
  done: boolean;
  /** The first text of the answer was seen (measuring point). */
  sawText: boolean;
  /** The waiting phrase was said for this answer. */
  waitSaid: boolean;
}

const freshSpoken = (): SpokenState => ({
  id: null,
  count: 0,
  speaker: null,
  finished: false,
  done: false,
  sawText: false,
  waitSaid: false,
});

/** Live mode is on unless the person switched it off (localStorage 'hai-voice-live' = 'off'). */
function liveEnabled(storage: SimpleStorage | null): boolean {
  try {
    return storage?.getItem(LIVE_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Words of a text that count for the barge-in: letters and digits, at least two. */
const wordsOf = speechWords;

/** Every word was just said by the assistant itself: it is its own voice coming back in. */
function isEcho(words: string[], spokenText: string): boolean {
  if (words.length === 0 || !spokenText) return false;
  const said = new Set(wordsOf(spokenText));
  return words.every(word => said.has(word));
}

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

/**
 * The consent to the open microphone of the live mode is a mark in the same list as
 * the providers. Whoever agreed to Soniox before the live mode existed is asked
 * again (the text names the open microphone now).
 */
export const LIVE_CONSENT = 'live';

/** Did the person agree to every provider of the chain (and to the open microphone, if it is used)? */
function consentCovers(
  storage: SimpleStorage,
  userId: string,
  chain: VoiceProviderId[],
  needLive: boolean
): boolean {
  const browserYes = storage.getItem(CONSENT_PREFIX + userId) === 'yes';
  const listed = listedProviders(storage, userId);
  if (
    needLive &&
    !(storage.getItem(CONSENT_PROVIDERS_PREFIX + userId) ?? '')
      .split(',')
      .includes(LIVE_CONSENT)
  ) {
    return false;
  }
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
    waitPhrase,
  } = options;

  const { voiceConfig, env: testEnv, onMicOff } = options;
  const onMicOffRef = useRef(onMicOff);
  onMicOffRef.current = onMicOff;

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
  const reduce = useCallback(
    (wanted: VoiceProviderId[]) =>
      wanted.filter(id => (id === 'browser' ? support.browser : support.cloud)),
    [support]
  );
  const chain = useMemo<VoiceProviderId[]>(() => {
    if (testEnv !== undefined) return ['browser'];
    return reduce(voiceConfig?.chain ?? ['browser']);
  }, [testEnv, voiceConfig, reduce]);
  // listening and speaking each have their own chain (a provider that is
  // disturbed in one function only stays in the other); undefined when the
  // server does not send them, then `chain` holds for both
  const chains = useMemo(() => {
    if (testEnv !== undefined || !voiceConfig?.chains) return undefined;
    return {
      stt: reduce(voiceConfig.chains.stt),
      tts: reduce(voiceConfig.chains.tts),
    };
  }, [testEnv, voiceConfig, reduce]);

  // a function that runs on another provider than planned, and why (never silent)
  const [fallback, setFallback] = useState<{
    stt: ProviderFallback | null;
    tts: ProviderFallback | null;
  }>({ stt: null, tts: null });
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
      chains,
      deps: chain.some(id => id !== 'browser') ? createCloudDeps() : null,
      onActiveProvider: setActiveProvider,
      onFallback: fallback =>
        setFallback(previous => ({
          ...previous,
          [fallback.function]: fallback,
        })),
    });
  }, [testEnv, chain, chains]);

  // the protection against background voices: settings of this device
  const [sensitivity, setSensitivityState] = useState<Sensitivity>('normal');
  const [pushToTalk, setPushToTalkState] = useState(false);
  const [signalWords, setSignalWordsState] = useState(true);
  useEffect(() => {
    if (!env) return;
    const saved = readFilterSettings(env.storage);
    setSensitivityState(saved.sensitivity);
    setPushToTalkState(saved.pushToTalk);
    setSignalWordsState(saved.signalWords);
  }, [env]);

  // the open microphone of the live mode is part of the consent (only Soniox does
  // it). With push to talk the microphone is open only while the button is held.
  const needLive =
    !!env?.live &&
    chain.includes('soniox') &&
    liveEnabled(env.storage) &&
    !pushToTalk;

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
  // the microphone is open and recording (also while the assistant speaks in live mode)
  const [micOpen, setMicOpen] = useState(false);
  // the recognition stays open over the whole conversation (live mode)
  const [live, setLive] = useState(false);
  // what the display says about utterances that were left out, and the first hint
  const [filterNote, setFilterNote] = useState<FilterNote>(null);
  const [signalHint, setSignalHint] = useState(false);
  // push to talk: the button or the space bar is held right now
  const [holding, setHolding] = useState(false);

  // the loudness gate: levels of the recording, the reference of the person's voice
  const gate = useMemo(() => new LevelGate(), []);
  gate.setSensitivity(sensitivity);
  const pttRef = useRef(false);
  pttRef.current = pushToTalk;
  const signalsRef = useRef(true);
  signalsRef.current = signalWords;
  const holdingRef = useRef(false);
  // pressToTalk asks the next listen() for a session that lasts as long as the button
  const holdRequestRef = useRef(false);
  // utterances said while the button is held, said together when it is released
  const holdBufferRef = useRef<string[]>([]);
  const quietStreakRef = useRef(0);
  const roomStreakRef = useRef(0);
  // the calibration and the way out
  const calibrateOption = options.calibrate !== false;
  const [calibration, setCalibrationState] = useState<CalibrationState>('idle');
  const [calibrationReason, setCalibrationReason] =
    useState<CalibrationReason | null>(null);
  const [filterPrompt, setFilterPromptState] = useState<FilterPrompt>(null);
  const calibrationRef = useRef<CalibrationState>('idle');
  const promptRef = useRef<FilterPrompt>(null);
  const calibNeededRef = useRef(false);
  const calibTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const choiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snoozeUntilRef = useRef(0);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const phaseRef = useRef<VoicePhase>('idle');
  const stoppedRef = useRef(true);
  const recRef = useRef<RecognitionLike | null>(null);
  const silentRoundsRef = useRef(0);
  const baselineIdRef = useRef<string | null>(null);
  const ignoreIdRef = useRef<string | null>(null);
  const spokenRef = useRef<SpokenState>(freshSpoken());
  const listenRef = useRef<() => void>(() => undefined);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const envRef = useRef(env);
  envRef.current = env;
  const levelRef = useRef(0);
  // the person started to speak while the assistant answered: the next utterance counts
  const bargedRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const afterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // what the assistant said in this answer (echo filter) and when its voice ended
  const spokenTextsRef = useRef<string[]>([]);
  const lastSpeechEndRef = useRef(0);

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
      setConsented(consentCovers(env.storage, userId, chain, needLive));
      setDayStartEnabledState(
        env.storage.getItem(DAY_START_OFF_PREFIX + userId) !== 'yes'
      );
    } catch {
      setConsented(false);
    }
  }, [userId, env, chain, needLive]);

  const giveConsent = useCallback(() => {
    if (!userId) return;
    // the consent is given inside a tap: the audio of a provider may start here (iOS,
    // Safari), not only in the start() that follows a tick later
    try {
      env?.unlockAudio?.();
    } catch {
      // audio stays locked, the chain then falls back at the first piece
    }
    try {
      const storage = env?.storage;
      if (storage) {
        // the consent names every provider of the chain it was given for
        const agreed = new Set<string>([
          ...listedProviders(storage, userId),
          ...chain,
        ]);
        // the mark of the open microphone stays once it was given
        const hadLive = (
          storage.getItem(CONSENT_PROVIDERS_PREFIX + userId) ?? ''
        )
          .split(',')
          .includes(LIVE_CONSENT);
        if (needLive || hadLive) agreed.add(LIVE_CONSENT);
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
  }, [userId, env, chain, needLive]);

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

  // ---- calibration and the way out of the gate (state only, the logic follows) ----
  const setCalibration = useCallback(
    (state: CalibrationState, reason: CalibrationReason | null = null) => {
      calibrationRef.current = state;
      setCalibrationState(state);
      setCalibrationReason(reason);
    },
    []
  );
  const setPrompt = useCallback((next: FilterPrompt) => {
    promptRef.current = next;
    setFilterPromptState(next);
  }, []);
  /** The calibration and the way out end (the setting off, push to talk, a new start). */
  const cancelCalibration = useCallback(() => {
    calibNeededRef.current = false;
    if (calibTimerRef.current) clearTimeout(calibTimerRef.current);
    calibTimerRef.current = null;
    if (choiceTimerRef.current) clearTimeout(choiceTimerRef.current);
    choiceTimerRef.current = null;
    roomStreakRef.current = 0;
    if (
      calibrationRef.current === 'listening' ||
      calibrationRef.current === 'failed'
    ) {
      setCalibration('idle');
    }
    setPrompt(null);
  }, [setCalibration, setPrompt]);

  const setSensitivity = useCallback(
    (value: Sensitivity) => {
      setSensitivityState(value);
      writeFilterSetting(env?.storage ?? null, SENSITIVITY_KEY, value);
      // no gate, nothing to calibrate and no way out to offer
      if (value === 'off') cancelCalibration();
    },
    [env, cancelCalibration]
  );
  const setSignalWords = useCallback(
    (on: boolean) => {
      setSignalWordsState(on);
      writeFilterSetting(
        env?.storage ?? null,
        SIGNAL_WORDS_KEY,
        on ? 'on' : 'off'
      );
    },
    [env]
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

  const clearSilence = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
  }, []);

  const dropRecognition = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    clearSilence();
    setMicOpen(false);
    setLive(false);
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    rec.onaudiostart = null;
    rec.onlevel = null;
    rec.onutterance = null;
    try {
      rec.abort();
    } catch {
      // already stopped
    }
  }, [clearSilence]);

  /** The button of push to talk is not held any more (the microphone is closed elsewhere). */
  const endHold = useCallback(() => {
    holdingRef.current = false;
    holdRequestRef.current = false;
    holdBufferRef.current = [];
    setHolding(false);
  }, []);

  const fail = useCallback(
    (reason: Exclude<VoiceError, null>) => {
      stoppedRef.current = true;
      endHold();
      dropRecognition();
      cancelSpeech();
      setError(reason);
      setInterim('');
      setPhase('error');
    },
    [cancelSpeech, dropRecognition, endHold, setPhase]
  );

  const stop = useCallback(() => {
    stoppedRef.current = true;
    endHold();
    dropRecognition();
    cancelSpeech();
    ignoreIdRef.current = spokenRef.current.id;
    setInterim('');
    setHeard('');
    setSpoken([]);
    setLevel(null);
    setError(null);
    setPhase('idle');
  }, [cancelSpeech, dropRecognition, endHold, setPhase]);

  // After the answer: listen again. Live mode: the microphone is still open, the
  // loop only gets the word back. A round: the microphone opens anew, a moment
  // after the voice ended (its last syllable must not come in).
  const afterAnswer = useCallback(() => {
    if (stoppedRef.current) return;
    // the way to the own server is warmed up for the next question (a ping, no content)
    envRef.current?.prefetch?.('server');
    // push to talk: nothing opens by itself, the loop only waits for the button
    if (pttRef.current && !recRef.current) {
      listenRef.current();
      return;
    }
    if (recRef.current?.live) {
      listenRef.current();
      return;
    }
    // only the recognition of the cloud providers records raw (no echo cancellation of
    // the browser): the end of the voice must not come in. The browser's own recognition
    // brings its own echo cancellation, it listens at once.
    if (!envRef.current?.live) {
      listenRef.current();
      return;
    }
    if (afterTimerRef.current) clearTimeout(afterTimerRef.current);
    afterTimerRef.current = setTimeout(() => {
      afterTimerRef.current = null;
      // a tap (interrupt) may have started listening in the meantime
      if (stoppedRef.current || recRef.current) return;
      listenRef.current();
    }, AFTER_ANSWER_MS);
  }, []);

  /** The speaker of this answer: created at the first need (submit warms it up). */
  const ensureSpeaker = useCallback(
    (state: SpokenState): SpeakerLike | null => {
      if (state.speaker) return state.speaker;
      if (!env) return null;
      const handlers = {
        onDone: () => {
          if (spokenRef.current !== state || state.done) return;
          state.done = true;
          lastSpeechEndRef.current = Date.now();
          mark('answer.done');
          afterAnswer();
        },
      };
      state.speaker = env.createSpeaker
        ? env.createSpeaker(handlers)
        : createBrowserSpeaker(env, handlers);
      return state.speaker;
    },
    [env, afterAnswer]
  );

  const submit = useCallback(
    (text: string) => {
      const lastAssistant = [...messages]
        .reverse()
        .find(m => m.role === 'assistant');
      baselineIdRef.current = lastAssistant?.id ?? null;
      // nothing of the last answer may still speak (a warmed up speaker of a
      // request without answer, for example)
      try {
        spokenRef.current.speaker?.cancel();
      } catch {
        // nothing is speaking
      }
      spokenRef.current = freshSpoken();
      spokenTextsRef.current = [];
      bargedRef.current = false;
      clearSilence();
      mark('submit');
      setInterim('');
      setSpoken([]);
      setLevel(null);
      setPhase('thinking');
      // the voice gets ready while the server still works: connection and key
      // of the speech output are there when the first sentence is
      if (env?.createSpeaker) ensureSpeaker(spokenRef.current)?.warm?.();
      // the next round (not needed when the recognition stays open) has its key
      if (!recRef.current?.live) {
        env?.prefetch?.(pttRef.current && env.live ? 'stt-live' : 'stt');
      }
      void sendMessage(text, { voice: true });
    },
    [messages, sendMessage, setPhase, clearSilence, env, ensureSpeaker]
  );

  /**
   * What the person said, in a finished form. A signal word does not go to the
   * chat as a question: "Gespräch beenden" ends the mode, "Mikrofon aus" switches
   * the microphone off, a bare halt word ("Stopp") only stops, there is nothing
   * to ask. Everything else is the next question.
   */
  const handleFinal = useCallback(
    (text: string) => {
      const signal = signalsRef.current
        ? classifySignal(text, SIGNAL_LANGUAGES)
        : null;
      if (signal?.kind === 'end') {
        mark('signal.end');
        stop();
        return;
      }
      if (signal?.kind === 'micOff') {
        mark('signal.micoff');
        if (onMicOffRef.current) onMicOffRef.current();
        else stop();
        return;
      }
      if (signal?.kind === 'halt' && signal.pure) {
        // a bare "Stopp": nothing to say to the chat, listen again
        mark('utterance.ignored', { why: 'signal' });
        setInterim('');
        if (!stoppedRef.current) setTimeout(() => listenRef.current(), 250);
        return;
      }
      silentRoundsRef.current = 0;
      setHeard(text);
      submit(text);
    },
    [stop, submit]
  );

  /**
   * Live mode: no word for a while in the listening phase counts as a silent
   * round. Three in a row end the conversation (the microphone switches off),
   * as with the rounds before.
   */
  const armSilence = useCallback(() => {
    clearSilence();
    // push to talk: waiting for the button is no silent round
    if (pttRef.current) return;
    if (!recRef.current?.live || phaseRef.current !== 'listening') return;
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null;
      if (stoppedRef.current || phaseRef.current !== 'listening') return;
      silentRoundsRef.current += 1;
      mark('listen.silent', { n: silentRoundsRef.current });
      if (silentRoundsRef.current >= MAX_SILENT_ROUNDS) {
        fail('no-speech');
        return;
      }
      armSilence();
    }, LIVE_SILENCE_MS);
  }, [clearSilence, fail]);

  /**
   * The person speaks while the assistant thinks or speaks (live mode): the voice
   * stops at once, the running chat answer is aborted (its stream is not read any
   * more) and the utterance that follows is processed as the next question.
   */
  const bargeIn = useCallback(
    (why: string) => {
      if (stoppedRef.current) return;
      bargedRef.current = true;
      mark('barge-in', { phase: phaseRef.current, why });
      cancelSpeech();
      const state = spokenRef.current;
      ignoreIdRef.current = state.id;
      state.finished = true;
      state.done = true;
      // what the chat shows so far (also a message still without text) is not read
      const lastAssistant = [...messagesRef.current]
        .reverse()
        .find(m => m.role === 'assistant');
      baselineIdRef.current = lastAssistant?.id ?? null;
      stopGeneration();
      setPhase('listening');
      armSilence();
    },
    [cancelSpeech, stopGeneration, setPhase, armSilence]
  );

  /** Is somebody speaking loud enough right now? (a provisional text, no push to talk) */
  const loudEnoughNow = useCallback(
    () => pttRef.current || gate.passesNow(Date.now()),
    [gate]
  );

  /**
   * Is this a person speaking, or the assistant hearing itself or the room? Words
   * that the assistant just said itself never count (its own voice coming back in),
   * and noise gives no word. It has to be loud enough (the gate: a quiet voice in
   * the room does not interrupt). Two words interrupt; one word only with a minimum
   * loudness, or when it is a signal word ("Stopp", "Warte", ...): a signal word
   * needs no second word and no minimum loudness of its own, but it never
   * bypasses the gate and the echo filter.
   */
  const considerBargeIn = useCallback(
    (text: string) => {
      const words = wordsOf(text);
      if (words.length === 0) return;
      if (isEcho(words, spokenTextsRef.current.join(' '))) return;
      if (!loudEnoughNow()) return;
      const signal = signalsRef.current
        ? haltAtStart(text, SIGNAL_LANGUAGES)
        : null;
      if (signal) {
        mark('signal.halt', { via: 'interim' });
        bargeIn('signal');
        return;
      }
      if (words.length >= 2 || levelRef.current >= BARGE_IN_LEVEL) {
        bargeIn('voice');
      }
    },
    [bargeIn, loudEnoughNow]
  );

  /** The display's short note for a while (one text per reason, never any text of a voice). */
  const showNote = useCallback((note: Exclude<FilterNote, null>) => {
    setFilterNote(note);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(() => {
      noteTimerRef.current = null;
      setFilterNote(null);
    }, FILTER_NOTE_MS);
  }, []);

  /**
   * The way out: the person may not have been heard. Two utterances in a row that
   * stand clearly above the room but under the threshold. No silent discarding: the
   * display offers to calibrate again, push to talk, or the filter off. It goes away
   * by itself after a while and does not come back at once.
   */
  const showLostPrompt = useCallback(() => {
    if (promptRef.current !== null) return;
    if (Date.now() < snoozeUntilRef.current) return;
    setPrompt('lost');
    mark('filter.choice');
    const snap = gate.snapshot();
    recordDiagnosis({
      kind: 'choice',
      why: 'lost',
      mean: 0,
      peak: 0,
      threshold: snap.threshold,
      ambient: snap.ambient,
      reference: snap.reference,
      confidence: null,
      setting: gate.sensitivity,
    });
    // the person needs time to choose: the silent rounds start anew
    silentRoundsRef.current = 0;
    if (choiceTimerRef.current) clearTimeout(choiceTimerRef.current);
    choiceTimerRef.current = setTimeout(() => {
      choiceTimerRef.current = null;
      snoozeUntilRef.current = Date.now() + CHOICE_SNOOZE_MS;
      if (promptRef.current === 'lost') setPrompt(null);
    }, CHOICE_MS);
  }, [gate, setPrompt]);

  /**
   * An utterance that the gate or the confidence left out. Only numbers go to the
   * measuring points and the local diagnosis, the text is gone: not stored, not
   * sent, not shown. The display names the reason: another voice, real silence (only
   * then "speak louder"), not understood. Two in a row that stand above the room
   * offer the way out.
   */
  const discard = useCallback(
    (verdict: Extract<GateVerdict, { ok: false }>) => {
      const snap = gate.snapshot();
      mark('utterance.discarded', {
        why: verdict.why,
        mean: verdict.mean,
        peak: verdict.peak,
        thr: verdict.threshold,
        conf: verdict.confidence ?? -1,
        amb: snap.ambient,
        ref: snap.reference ?? -1,
      });
      recordDiagnosis({
        kind: 'discarded',
        why: verdict.why,
        mean: verdict.mean,
        peak: verdict.peak,
        threshold: verdict.threshold,
        ambient: snap.ambient,
        reference: snap.reference,
        confidence: verdict.confidence,
        setting: gate.sensitivity,
      });
      setInterim('');
      quietStreakRef.current =
        verdict.why === 'quiet' ? quietStreakRef.current + 1 : 0;
      roomStreakRef.current =
        verdict.why === 'background' ? roomStreakRef.current + 1 : 0;
      showNote(
        verdict.why === 'confidence'
          ? 'unclear'
          : verdict.why === 'quiet' && quietStreakRef.current >= QUIET_STREAK
            ? 'too-quiet'
            : 'only-you'
      );
      if (roomStreakRef.current >= LOST_STREAK) showLostPrompt();
    },
    [gate, showLostPrompt, showNote]
  );

  const clearFilterNote = useCallback(() => {
    quietStreakRef.current = 0;
    roomStreakRef.current = 0;
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = null;
    setFilterNote(null);
    // the person was heard: the way out is not needed any more
    if (promptRef.current === 'lost') {
      if (choiceTimerRef.current) clearTimeout(choiceTimerRef.current);
      choiceTimerRef.current = null;
      setPrompt(null);
    }
  }, [setPrompt]);

  /** The calibration did not work: guidance and a choice, the gate stays tolerant (no reference). */
  const failCalibration = useCallback(
    (reason: CalibrationReason) => {
      if (calibTimerRef.current) clearTimeout(calibTimerRef.current);
      calibTimerRef.current = null;
      mark('calibration.failed', { why: reason });
      setCalibration('failed', reason);
      setPrompt('calibration-failed');
      silentRoundsRef.current = 0;
    },
    [setCalibration, setPrompt]
  );

  /**
   * The calibration starts when the microphone of the live mode is open and the loop
   * listens: the person says a short phrase, no chat call. The room level and the
   * level of the voice come from what the recording measured.
   */
  const maybeBeginCalibration = useCallback(() => {
    if (!calibNeededRef.current) return;
    if (stoppedRef.current || pttRef.current || holdingRef.current) return;
    if (!gate.enabled || !recRef.current?.live) return;
    if (phaseRef.current !== 'listening') return;
    calibNeededRef.current = false;
    mark('calibration.start');
    setCalibration('listening');
    setPrompt('calibrate');
    if (calibTimerRef.current) clearTimeout(calibTimerRef.current);
    calibTimerRef.current = setTimeout(() => {
      calibTimerRef.current = null;
      if (calibrationRef.current !== 'listening') return;
      const snap = gate.snapshot();
      recordDiagnosis({
        kind: 'calibration',
        why: 'nothing',
        mean: 0,
        peak: snap.maxLevel,
        threshold: snap.threshold,
        ambient: snap.ambient,
        reference: null,
        confidence: null,
        setting: gate.sensitivity,
      });
      failCalibration('nothing');
    }, CALIBRATION_MS);
  }, [failCalibration, gate, setCalibration, setPrompt]);

  /** The phrase of the calibration came: set the reference and the room level, or fail. */
  const finishCalibration = useCallback(
    (info?: UtteranceInfo) => {
      if (calibTimerRef.current) clearTimeout(calibTimerRef.current);
      calibTimerRef.current = null;
      const result = gate.calibrate(info ?? {}, Date.now());
      const snap = gate.snapshot();
      recordDiagnosis({
        kind: 'calibration',
        why: result.ok ? 'ok' : result.why,
        mean: result.mean,
        peak: result.peak,
        threshold: snap.threshold,
        ambient: result.ambient,
        reference: result.ok ? result.reference : snap.reference,
        confidence: info?.confidence ?? null,
        setting: gate.sensitivity,
      });
      if (result.ok) {
        mark('calibration.done', {
          mean: result.mean,
          peak: result.peak,
          amb: result.ambient,
          ref: result.reference,
        });
        setCalibration('done');
        setPrompt(null);
        silentRoundsRef.current = 0;
        return;
      }
      failCalibration(result.why);
    },
    [failCalibration, gate, setCalibration, setPrompt]
  );

  const skipCalibration = useCallback(() => {
    cancelCalibration();
    setCalibration('skipped');
    mark('calibration.skipped');
  }, [cancelCalibration, setCalibration]);

  /** Closes the prompt without a choice. The way out stays away for a while. */
  const dismissFilterPrompt = useCallback(() => {
    if (promptRef.current === 'lost') {
      snoozeUntilRef.current = Date.now() + CHOICE_SNOOZE_MS;
    }
    if (choiceTimerRef.current) clearTimeout(choiceTimerRef.current);
    choiceTimerRef.current = null;
    setPrompt(null);
  }, [setPrompt]);

  /**
   * Live mode: the speaker finished an utterance. Order: what is judged first is
   * the person's voice (gate, confidence), then what the utterance is (a signal
   * word, an echo of the assistant, a question). A signal word passes the same
   * gate and the same echo filter, so a background talk that says "stopp" stops
   * nobody.
   */
  const handleUtterance = useCallback(
    (text: string, info?: UtteranceInfo) => {
      if (stoppedRef.current) return;
      // the calibration: the phrase of the person sets the reference, nothing goes
      // to the chat (only "end" and "microphone off" keep their meaning). A long
      // sentence without a greeting is a conversation in the room: it is left out
      // and does not set the reference.
      if (calibrationRef.current === 'listening') {
        const control = signalsRef.current
          ? classifySignal(text, SIGNAL_LANGUAGES)
          : null;
        if (!control || (control.kind !== 'end' && control.kind !== 'micOff')) {
          setInterim('');
          if (isCalibrationPhrase(text)) {
            finishCalibration(info);
          } else {
            mark('calibration.ignored');
          }
          return;
        }
      }
      const answeringAtStart =
        phaseRef.current === 'thinking' || phaseRef.current === 'speaking';
      const words = wordsOf(text);
      const spokenText = spokenTextsRef.current.join(' ');
      const echoed = isEcho(words, spokenText);
      const echo =
        echoed &&
        (answeringAtStart ||
          Date.now() - lastSpeechEndRef.current < ECHO_WINDOW_MS);
      // push to talk: the person held the button, nothing to judge
      const verdict = pttRef.current
        ? null
        : gate.evaluate(info ?? {}, Date.now());
      const passes = !verdict || verdict.ok;

      const signal =
        signalsRef.current && passes && !echo
          ? classifySignal(text, SIGNAL_LANGUAGES)
          : null;
      if (signal) {
        if (signal.kind === 'end' || signal.kind === 'micOff') {
          bargedRef.current = false;
          setInterim('');
          handleFinal(text.trim());
          return;
        }
        // a halt word: the assistant stops (if it was not stopped by the
        // provisional text already)
        if (answeringAtStart) {
          mark('signal.halt', { via: 'final' });
          bargeIn('signal');
        }
        bargedRef.current = false;
        if (signal.pure) {
          mark('utterance.ignored', { why: 'signal' });
          setInterim('');
          return;
        }
        // "Moment mal, was ist ein JOIN?": the assistant stopped, the question goes on
      }

      if (
        (phaseRef.current === 'thinking' || phaseRef.current === 'speaking') &&
        !bargedRef.current
      ) {
        // too little to count as an interruption: noise or the own voice
        mark('utterance.ignored', { why: 'while-answering' });
        return;
      }
      if (Date.now() - lastSpeechEndRef.current < ECHO_WINDOW_MS && echoed) {
        mark('utterance.ignored', { why: 'echo' });
        setInterim('');
        return;
      }
      if (verdict && !verdict.ok) {
        bargedRef.current = false;
        discard(verdict);
        return;
      }
      bargedRef.current = false;
      if (words.length === 0) {
        setInterim('');
        return;
      }
      // it counted: the level of this voice is the reference of the person (an
      // overdriven or shouted one is not: it would lift the threshold)
      if (verdict && verdict.ok && verdict.judged && words.length >= 2) {
        if (!verdict.hint) gate.confirm(verdict.mean);
      }
      clearFilterNote();
      if (verdict && verdict.ok && verdict.hint) {
        // low confidence at a high level: it counts, the person is asked to speak softer
        const snap = gate.snapshot();
        mark('utterance.hint', {
          why: verdict.hint,
          mean: verdict.mean,
          peak: verdict.peak,
          thr: verdict.threshold,
          conf: verdict.confidence ?? -1,
        });
        recordDiagnosis({
          kind: 'hint',
          why: verdict.hint,
          mean: verdict.mean,
          peak: verdict.peak,
          threshold: verdict.threshold,
          ambient: snap.ambient,
          reference: snap.reference,
          confidence: verdict.confidence,
          setting: gate.sensitivity,
        });
        showNote('loud');
      }
      handleFinal(text.trim());
    },
    [
      bargeIn,
      clearFilterNote,
      discard,
      finishCalibration,
      gate,
      handleFinal,
      showNote,
    ]
  );

  const listen = useCallback(async () => {
    if (stoppedRef.current || !env) return;
    // push to talk: pressToTalk asks for a held session (the button is down)
    const hold = holdRequestRef.current;
    holdRequestRef.current = false;
    // push to talk: the microphone opens only while the button is held. Without
    // it the loop waits ("listening" without an open microphone).
    if (pttRef.current && !hold) {
      if (holdingRef.current && recRef.current) return;
      setError(null);
      setInterim('');
      setPhase('listening');
      return;
    }
    // live mode: the recognition is still open, the person only gets the word again
    if (recRef.current?.live) {
      setError(null);
      setInterim('');
      setPhase('listening');
      armSilence();
      maybeBeginCalibration();
      return;
    }
    dropRecognition();
    mark('listen.start');
    const made = await env.createRecognition();
    if (stoppedRef.current) return;
    if (!made) {
      fail('unsupported');
      return;
    }
    // the button was released while the recognition was made: nothing is recorded
    if (hold && !holdingRef.current) return;
    const { rec, local } = made;
    setLocalRecognition(local);
    rec.lang = LANG;
    // live: Soniox stays open over the conversation, the other providers do rounds.
    // Held to talk: one session that lasts as long as the button is held.
    rec.continuous = hold || (!!env.live && liveEnabled(env.storage));
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = event => {
      let heardNow = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const piece = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += piece;
        else heardNow += piece;
      }
      const text = (finalText + heardNow).trim();
      if (recRef.current?.live && phaseRef.current !== 'listening') {
        // the assistant is answering: does a person speak, or is it noise or itself?
        if (!bargedRef.current) considerBargeIn(text);
        if (!bargedRef.current) return;
      }
      // too quiet to be the person (the gate): not shown, not counted as speech.
      // The text of a voice in the room never reaches the display.
      if (
        recRef.current?.live &&
        calibrationRef.current !== 'listening' &&
        !loudEnoughNow()
      ) {
        return;
      }
      setInterim(text);
      if (text && recRef.current?.live) {
        silentRoundsRef.current = 0;
        armSilence();
      }
    };
    rec.onaudiostart = () => {
      if (recRef.current !== rec) return;
      setMicOpen(true);
      setLive(rec.live === true);
      armSilence();
      maybeBeginCalibration();
    };
    rec.onutterance = (text, info) => {
      if (recRef.current !== rec) return;
      finalText = '';
      if (hold) {
        // held to talk: what was said so far waits for the release
        holdBufferRef.current.push(text);
        return;
      }
      handleUtterance(text, info);
    };
    // Optional: a provider that measures the recording reports its loudness (0 to 1)
    rec.onlevel = value => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      const clamped = Math.min(1, Math.max(0, value));
      levelRef.current = clamped;
      gate.push(clamped, Date.now());
      // the measure is shown while the person is to speak (the voice mode draws it then)
      if (phaseRef.current === 'listening') setLevel(clamped);
    };
    rec.onerror = event => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      setMicOpen(false);
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
      clearSilence();
      setMicOpen(false);
      setLive(false);
      if (stoppedRef.current) return;
      const phase = phaseRef.current;
      // a live session that ended while the assistant answers: the next round
      // starts after the answer (afterAnswer), not under its voice
      if (phase === 'thinking' || phase === 'speaking') return;
      const heard = (hold ? [...holdBufferRef.current, finalText] : [finalText])
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (hold) {
        holdBufferRef.current = [];
        holdingRef.current = false;
        setHolding(false);
      }
      if (heard) {
        handleFinal(heard);
        return;
      }
      // held to talk and nothing said: wait for the next press, no silent round
      if (hold || pttRef.current) {
        setTimeout(() => listenRef.current(), 0);
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
      // a provider that does not report the microphone: open as soon as it runs
      if (!env.micSignal) setMicOpen(true);
    } catch {
      fail('failed');
    }
  }, [
    armSilence,
    clearSilence,
    considerBargeIn,
    dropRecognition,
    env,
    fail,
    gate,
    handleFinal,
    handleUtterance,
    loudEnoughNow,
    maybeBeginCalibration,
    setPhase,
  ]);

  useEffect(() => {
    listenRef.current = () => {
      void listen();
    };
  }, [listen]);

  const start = useCallback(() => {
    if (!enabled || !usable || !consented || !userId || !env) return;
    stoppedRef.current = false;
    silentRoundsRef.current = 0;
    setError(null);
    setFallback({ stt: null, tts: null });
    // a tap: let the audio of a provider play (iOS, Safari), and try the chain from the top
    env.unlockAudio?.();
    env.resetFallback?.();
    setActiveProvider(chain[0] ?? 'browser');
    // the keys of the cloud providers are fetched while the person starts to speak
    env.prefetch?.(
      env.live && (liveEnabled(env.storage) || pttRef.current)
        ? 'stt-live'
        : 'stt'
    );
    env.prefetch?.('tts');
    env.prefetch?.('server');
    // a new conversation: the levels of the room and the person's reference start anew
    gate.reset();
    clearFilterNote();
    cancelCalibration();
    setCalibration('idle');
    calibNeededRef.current = calibrateOption && gate.enabled && !pttRef.current;
    const now = env.now();
    if (dayStartEnabled && dayStartDue(env.storage, userId, now)) {
      markDayStart(env.storage, userId, now);
      submit(dayStartMessage(berlinHour(now)));
      return;
    }
    void listen();
  }, [
    calibrateOption,
    cancelCalibration,
    chain,
    clearFilterNote,
    consented,
    dayStartEnabled,
    enabled,
    env,
    gate,
    listen,
    setCalibration,
    submit,
    usable,
    userId,
  ]);

  /**
   * Push to talk, the button or the space bar went down: be quiet (a running
   * answer is stopped and aborted like an interruption) and record, as long as
   * the button is held. Nothing is recorded before and after, so nothing of the
   * room is ever heard.
   */
  const pressToTalk = useCallback(() => {
    if (stoppedRef.current || !pttRef.current || holdingRef.current) return;
    const phase = phaseRef.current;
    if (phase === 'speaking' || phase === 'thinking') {
      cancelSpeech();
      const state = spokenRef.current;
      ignoreIdRef.current = state.id;
      state.finished = true;
      state.done = true;
      const lastAssistant = [...messagesRef.current]
        .reverse()
        .find(m => m.role === 'assistant');
      baselineIdRef.current = lastAssistant?.id ?? null;
      stopGeneration();
    }
    mark('ptt.press', { phase });
    holdingRef.current = true;
    holdBufferRef.current = [];
    holdRequestRef.current = true;
    setHolding(true);
    void listen();
  }, [cancelSpeech, listen, stopGeneration]);

  /** The button was released: the microphone closes at once, what was said is sent. */
  const releaseToTalk = useCallback(() => {
    if (!holdingRef.current) return;
    mark('ptt.release');
    holdingRef.current = false;
    setHolding(false);
    // the next press has its key ready (one key per connection)
    envRef.current?.prefetch?.(envRef.current.live ? 'stt-live' : 'stt');
    const rec = recRef.current;
    if (!rec) return;
    try {
      // ends the recording at once and delivers what was said (onend)
      rec.stop();
    } catch {
      dropRecognition();
    }
  }, [dropRecognition]);

  /** Push to talk on or off, also in the middle of a conversation. */
  const setPushToTalk = useCallback(
    (on: boolean) => {
      setPushToTalkState(on);
      pttRef.current = on;
      // nobody is judged while the button is held: no calibration, no way out
      if (on) cancelCalibration();
      writeFilterSetting(
        env?.storage ?? null,
        PUSH_TO_TALK_KEY,
        on ? 'on' : 'off'
      );
      if (stoppedRef.current) return;
      // a microphone that was open for the live mode closes, or opens, with the choice
      endHold();
      dropRecognition();
      if (phaseRef.current === 'listening' || phaseRef.current === 'error') {
        void listenRef.current();
      }
    },
    [cancelCalibration, dropRecognition, endHold, env]
  );

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

  /**
   * "Mikrofon neu einmessen": the person says the phrase again (a running answer is
   * stopped first). Forgets the reference and the room level of the old calibration.
   */
  const recalibrate = useCallback(() => {
    if (stoppedRef.current || pttRef.current || !gate.enabled) return;
    gate.forgetCalibration();
    clearFilterNote();
    cancelCalibration();
    setCalibration('idle');
    calibNeededRef.current = true;
    const phase = phaseRef.current;
    if (phase === 'speaking' || phase === 'thinking') interrupt();
    maybeBeginCalibration();
  }, [
    cancelCalibration,
    clearFilterNote,
    gate,
    interrupt,
    maybeBeginCalibration,
    setCalibration,
  ]);

  /** The diagnosis (numbers and reasons, never any text) on the clipboard. True when it worked. */
  const copyDiagnosis = useCallback(
    () =>
      copyText(
        JSON.stringify(
          buildDiagnosis({
            gate: gate.snapshot(),
            pushToTalk,
            signalWords,
            calibration,
            calibrationReason,
            provider: activeProvider,
            live,
          }),
          null,
          2
        )
      ),
    [
      activeProvider,
      calibration,
      calibrationReason,
      gate,
      live,
      pushToTalk,
      signalWords,
    ]
  );

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
      if (state.id === null) {
        // the first message of this request: keep the speaker that was warmed up
        state.id = last.id;
      } else {
        state.speaker?.cancel();
        Object.assign(state, freshSpoken(), { id: last.id });
      }
    }
    if (state.done) return;
    if (!state.sawText) {
      state.sawText = true;
      mark('chat.first.text');
    }
    const final = streamingMessageId !== last.id;
    const pieces = nextSpeechPieces(text, state.count, final);
    if (pieces.length > 0) {
      if (state.count === 0) mark('piece.first');
      ensureSpeaker(state);
    }
    for (const piece of pieces) state.speaker?.say(piece);
    if (state.speaker) spokenTextsRef.current.push(...pieces);
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
        lastSpeechEndRef.current = Date.now();
        afterAnswer();
      }
    }
  }, [
    messages,
    streamingMessageId,
    env,
    placeholderText,
    afterAnswer,
    ensureSpeaker,
    setPhase,
  ]);

  // No piece of the answer for a few seconds: say the waiting phrase once, so the
  // wait is not silent. It is not part of the subtitles and not in the chat.
  useEffect(() => {
    if (phase !== 'thinking' || !waitPhrase || !env) return;
    const timer = setTimeout(() => {
      const state = spokenRef.current;
      if (stoppedRef.current || state.done || state.waitSaid) return;
      if (state.count > 0 || phaseRef.current !== 'thinking') return;
      state.waitSaid = true;
      mark('wait.phrase');
      spokenTextsRef.current.push(waitPhrase);
      ensureSpeaker(state)?.say(waitPhrase);
    }, WAIT_PHRASE_MS);
    return () => clearTimeout(timer);
  }, [phase, waitPhrase, env, ensureSpeaker]);

  // The first time the assistant speaks with an open microphone: a short hint that
  // a word stops it. Once per device, only where a word can be heard while it speaks.
  useEffect(() => {
    if (phase !== 'speaking' || !signalWords || pushToTalk) return;
    if (!recRef.current?.live) return;
    const storage = env?.storage ?? null;
    if (signalHintSeen(storage)) return;
    writeFilterSetting(storage, SIGNAL_HINT_KEY, 'yes');
    setSignalHint(true);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => {
      hintTimerRef.current = null;
      setSignalHint(false);
    }, SIGNAL_HINT_MS);
  }, [phase, signalWords, pushToTalk, env]);

  // timers of the display never outlive the hook
  useEffect(
    () => () => {
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      if (calibTimerRef.current) clearTimeout(calibTimerRef.current);
      if (choiceTimerRef.current) clearTimeout(choiceTimerRef.current);
    },
    []
  );

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
    /**
     * The microphone is open and recording right now. In live mode it stays true
     * while the assistant thinks and speaks (the voice mode shows it).
     */
    micOpen,
    /** The recognition stays open over the whole conversation (live mode). */
    live,
    /**
     * A function that runs on another provider than planned, and why (null: as
     * planned). Show it with HaiVoiceFallbackNotice, a silent fallback is a bug.
     */
    fallback,
    /** Lets the audio of a provider play. Call it synchronously inside a tap. */
    unlockAudio: useCallback(() => env?.unlockAudio?.(), [env]),
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
    /** How strictly only the person's own voice counts: 'normal' or 'strict'. */
    sensitivity,
    setSensitivity,
    /** Push to talk: the microphone records only while the button is held. */
    pushToTalk,
    setPushToTalk,
    /** The button (or the space bar) of push to talk is held right now. */
    holding,
    pressToTalk,
    releaseToTalk,
    /** Signal words ("Stopp", "Gespräch beenden", ...) are on. */
    signalWords,
    setSignalWords,
    /** The display's short note about utterances left out ("only you", "speak louder"). */
    filterNote,
    /** The first-time hint "Sag Stopp, wenn ich aufhören soll." is to be shown. */
    signalHint,
    /** The calibration at the start of the live mode: idle, listening, done, failed, skipped. */
    calibration,
    /** Why the calibration failed (null while it did not). */
    calibrationReason,
    /** What the display asks next: say the phrase, calibration failed, or the way out. */
    filterPrompt,
    /** "Mikrofon neu einmessen": the person says the phrase again. */
    recalibrate,
    /** Leave the calibration out (the gate stays tolerant until the next one). */
    skipCalibration,
    /** Close the prompt without a choice. */
    dismissFilterPrompt,
    /** Copy the diagnosis (JSON, numbers only) to the clipboard. */
    copyDiagnosis,
  };
}
