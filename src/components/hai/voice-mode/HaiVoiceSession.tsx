'use client';

/**
 * The voice session of the HAI: ONE voice loop (useHaiVoice) for the whole app,
 * shared by the microphone of the chat and the voice mode with the mascot.
 *
 * It sits inside the HaiProvider, above the pages, for two reasons:
 *  - the voice mode uses the SAME chat (same session, same messages): every
 *    spoken question is a user message, every answer an answer of the HAI, to
 *    read in the chat afterwards. There is no second path to the server.
 *  - the voice mode survives a change of page: when the HAI opens a page
 *    (the question "Soll ich sie öffnen?" and the answer "ja"), the loop keeps
 *    listening and the mascot moves to the edge as a small unit.
 *
 * The voice mode does not change what the voice assistant is: the organization
 * switch, the consent with the named provider and the order of the loop stay
 * those of useHaiVoice. Without consent nothing is recorded: the consent
 * question comes first, inside the voice mode.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { fetchVoiceConfig } from '@/lib/hai/voice/client/deps';
import { useHai } from '../HaiProvider';
import { useHaiQuizMode } from '../HaiQuizMode';
import { useHaiVoice, type VoiceConfig, type VoiceEnv } from '../useHaiVoice';
import { useVoiceEnabled } from './useVoiceEnabled';
import { HaiVoiceModeOverlay } from './HaiVoiceModeOverlay';
import {
  SessionContext,
  type HaiVoiceSession,
  type OpenNavigationOffer,
  type VoiceModeView,
} from './voiceSessionContext';

const CAPTIONS_KEY = 'hai-voice-mode-captions';

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function sameConfig(a: VoiceConfig | null, b: VoiceConfig): boolean {
  if (!a || a.region !== b.region || !sameList(a.chain, b.chain)) return false;
  if (!a.chains || !b.chains) return !a.chains && !b.chains;
  return (
    sameList(a.chains.stt, b.chains.stt) && sameList(a.chains.tts, b.chains.tts)
  );
}

interface ProviderProps {
  children: React.ReactNode;
  /** Replaces the browser and the providers of the voice loop, for tests. */
  env?: VoiceEnv | null;
}

export function HaiVoiceSessionProvider({ children, env }: ProviderProps) {
  const { t } = useLanguage();
  const { user } = useAuth() as { user?: { id?: string } | null };
  const {
    messages,
    streamingMessageId,
    sendMessage,
    stopGeneration,
    viewMode,
    setViewMode,
    openNavigation,
  } = useHai();

  const [view, setView] = useState<VoiceModeView>('closed');

  // ask the organization only once the chat was opened (or the mode is open)
  const [chatSeen, setChatSeen] = useState(false);
  useEffect(() => {
    if (viewMode !== 'hidden') setChatSeen(true);
  }, [viewMode]);
  const orgEnabled = useVoiceEnabled(chatSeen || view !== 'closed');

  // who listens and speaks: the providers in charge, read from the server
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);

  const voice = useHaiVoice({
    userId: user?.id,
    enabled: orgEnabled,
    voiceConfig,
    messages,
    streamingMessageId,
    sendMessage,
    stopGeneration,
    placeholderText: t('hai.loading.thinking') || 'Thinking...',
    env,
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  // Read the providers when the chat appears and after every conversation, so a
  // change of the platform admin (or a provider that failed) is picked up at the
  // next start. A failing call leaves the browser alone as the provider.
  const idle = voice.phase === 'idle';
  useEffect(() => {
    if (!orgEnabled || !idle) return;
    let cancelled = false;
    void fetchVoiceConfig().then(config => {
      if (cancelled || !config) return;
      setVoiceConfig(previous =>
        sameConfig(previous, config) ? previous : config
      );
    });
    return () => {
      cancelled = true;
    };
  }, [orgEnabled, idle]);

  // subtitles on or off
  const [captions, setCaptionsState] = useState(true);
  useEffect(() => {
    try {
      setCaptionsState(window.localStorage.getItem(CAPTIONS_KEY) !== 'off');
    } catch {
      // no storage: the subtitles stay on
    }
  }, []);
  const setCaptions = useCallback((on: boolean) => {
    setCaptionsState(on);
    try {
      window.localStorage.setItem(CAPTIONS_KEY, on ? 'on' : 'off');
    } catch {
      // the choice then holds for this visit only
    }
  }, []);

  const available = voice.available;

  const openMode = useCallback(() => {
    if (!available) return;
    setView('full');
    const current = voiceRef.current;
    // a tap: the audio of a provider may start (iOS, Safari). Without consent the
    // voice mode asks first, nothing is recorded before the answer.
    if (
      current.consented &&
      (current.phase === 'idle' || current.phase === 'error')
    ) {
      current.start();
    }
  }, [available]);

  const closeMode = useCallback(() => {
    voiceRef.current.stop();
    setView('closed');
  }, []);

  const restore = useCallback(() => setView('full'), []);

  const acceptConsent = useCallback(() => {
    voiceRef.current.giveConsent();
    // the consent was just stored: start on the next render
    setTimeout(() => voiceRef.current.start(), 0);
  }, []);

  // "Sprachmodus beenden" (or a stop word, or the stop button) ends the loop:
  // the voice mode closes with it. Idle before the first start is not an end.
  const wasActive = useRef(false);
  useEffect(() => {
    if (view === 'closed') {
      wasActive.current = false;
      return;
    }
    if (voice.phase !== 'idle') {
      wasActive.current = true;
      return;
    }
    if (wasActive.current) {
      wasActive.current = false;
      setView('closed');
    }
  }, [view, voice.phase]);

  // The quiz mode is a card in the chat and not part of the voice mode (next
  // step). When a spoken request starts it, the voice mode ends and the chat
  // shows the card, so the quiz does not run unseen behind the mascot.
  const quizActive = useHaiQuizMode().active;
  useEffect(() => {
    if (!quizActive || view === 'closed') return;
    voiceRef.current.stop();
    setView('closed');
    if (viewMode === 'hidden') setViewMode('widget');
  }, [quizActive, view, viewMode, setViewMode]);

  // The HAI opened a page while the large voice mode was up: the mascot moves
  // to the edge as a small unit and keeps listening above the new page. The
  // chat panel goes away so it does not cover it.
  const openedCount = messages.filter(
    m => m.navigationOffer?.status === 'opened'
  ).length;
  const previousOpened = useRef(openedCount);
  useEffect(() => {
    if (openedCount > previousOpened.current && view === 'full') {
      setView('mini');
      if (viewMode !== 'hidden') setViewMode('hidden');
    }
    previousOpened.current = openedCount;
  }, [openedCount, view, viewMode, setViewMode]);

  // the page of the last answer, as long as the person has not answered
  const offer = useMemo<OpenNavigationOffer | null>(() => {
    const last = [...messages].reverse().find(m => m.role === 'assistant');
    if (!last?.navigationOffer || last.navigationOffer.status !== 'open') {
      return null;
    }
    return { messageId: last.id, offer: last.navigationOffer };
  }, [messages]);

  const value = useMemo<HaiVoiceSession>(
    () => ({
      voice,
      available,
      view,
      captions,
      setCaptions,
      offer,
      openNavigation,
      openMode,
      closeMode,
      restore,
      acceptConsent,
    }),
    [
      voice,
      available,
      view,
      captions,
      setCaptions,
      offer,
      openNavigation,
      openMode,
      closeMode,
      restore,
      acceptConsent,
    ]
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {view !== 'closed' && <HaiVoiceModeOverlay />}
    </SessionContext.Provider>
  );
}
