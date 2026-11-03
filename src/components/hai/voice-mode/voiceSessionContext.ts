'use client';

/**
 * The shape and the context of the voice session (see HaiVoiceSession.tsx for
 * what the session is). Kept apart from the provider so the voice mode and the
 * buttons can read the session without importing the provider.
 */

import { createContext, useContext } from 'react';
import type { HaiNavigationOffer } from '../HaiProvider';
import type { useHaiVoice } from '../useHaiVoice';

export type VoiceModeView = 'closed' | 'open';

export interface OpenNavigationOffer {
  messageId: string;
  offer: HaiNavigationOffer;
}

export interface HaiVoiceSession {
  /** The voice loop (phase, interim text, consent, start, stop, interrupt, ...). */
  voice: ReturnType<typeof useHaiVoice>;
  /** The voice assistant is on for the organization and this browser can use it. */
  available: boolean;
  /** closed, or open: the HAI figure stands in its basin at the bottom right. */
  view: VoiceModeView;
  /** Subtitles shown in the voice mode (a choice of the person, kept in the browser). */
  captions: boolean;
  setCaptions: (on: boolean) => void;
  /** The page the HAI offered by voice and the person has not answered yet. */
  offer: OpenNavigationOffer | null;
  openNavigation: (messageId: string) => void;
  /** Open the voice mode (the figure rises) and start listening if the person consented. */
  openMode: () => void;
  /** End the conversation and the voice mode. */
  closeMode: () => void;
  /** The microphone is switched off by the person (the conversation waits). */
  muted: boolean;
  /** Switch the microphone off (the loop stops, the mode stays) or on again. */
  toggleMic: () => void;
  /** Consent to the provider(s) and start. */
  acceptConsent: () => void;
}

export const SessionContext = createContext<HaiVoiceSession | null>(null);

/** The session, or null where no provider is (the chat then shows no voice buttons). */
export function useOptionalHaiVoiceSession(): HaiVoiceSession | null {
  return useContext(SessionContext);
}

export function useHaiVoiceSession(): HaiVoiceSession {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error('useHaiVoiceSession must be used within a provider');
  }
  return session;
}
