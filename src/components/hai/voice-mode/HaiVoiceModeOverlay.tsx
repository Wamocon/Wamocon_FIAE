'use client';

/**
 * Voice mode of the HAI: a conversation with the mascot.
 *
 * Large: a full screen dialog, the shark in the middle with its state, the
 * state as text, the subtitles below (what the person said, what the HAI says,
 * sentence by sentence as it is read aloud), a button for a page the HAI offered.
 * Esc, the close button and the spoken "Sprachmodus beenden" end it.
 *
 * Small: after the HAI opened a page ("ja" to "Soll ich sie öffnen?") the
 * mascot sits at the edge above the new page, keeps its state and keeps
 * listening. A tap brings the large view back, the cross ends the mode.
 *
 * Everything said is in the chat: the voice mode reads and writes the same
 * messages of the same session (HaiProvider), it has no path of its own. The
 * loop, the consent and the provider are those of useHaiVoice.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, Subtitles, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { consentParagraphs } from '@/lib/hai/voice/consentText';
import { HaiNavigationCard } from '../HaiNavigationCard';
import { useHai } from '../HaiProvider';
import type { VoiceError, VoicePhase } from '../useHaiVoice';
import { HaiMascot, type MascotState } from './HaiMascot';
import { providerStatement } from './providerStatement';
import { useFocusTrap } from './useFocusTrap';
import { useHaiVoiceSession } from './voiceSessionContext';

function mascotStateOf(phase: VoicePhase, error: VoiceError): MascotState {
  if (phase === 'listening') return 'listening';
  if (phase === 'thinking') return 'thinking';
  if (phase === 'speaking') return 'speaking';
  if (phase === 'error') return error === 'no-speech' ? 'paused' : 'error';
  return 'waiting';
}

const STATE_KEY: Record<MascotState, string> = {
  waiting: 'hai.voiceMode.state.waiting',
  listening: 'hai.voice.phase.listening',
  thinking: 'hai.voice.phase.thinking',
  speaking: 'hai.voice.phase.speaking',
  paused: 'hai.voiceMode.state.paused',
  error: 'hai.voiceMode.state.error',
};

const ERROR_KEY: Record<Exclude<VoiceError, null>, string> = {
  'not-allowed': 'hai.voice.error.notAllowed',
  'no-speech': 'hai.voiceMode.error.noSpeech',
  unsupported: 'hai.voice.error.unsupported',
  failed: 'hai.voice.error.failed',
};

/** True for a moment after the value changed (text arrives while the person talks). */
function useRecentChange(value: string, ms: number): boolean {
  const [recent, setRecent] = useState(false);
  useEffect(() => {
    if (!value) {
      setRecent(false);
      return;
    }
    setRecent(true);
    const timer = setTimeout(() => setRecent(false), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return recent;
}

export function HaiVoiceModeOverlay() {
  const session = useHaiVoiceSession();
  return session.view === 'mini' ? <MiniMascot /> : <FullVoiceMode />;
}

// ============================================================================
// SMALL: the mascot at the edge
// ============================================================================

function MiniMascot() {
  const { t } = useLanguage();
  const { viewMode } = useHai();
  const { voice, closeMode, restore } = useHaiVoiceSession();
  const state = mascotStateOf(voice.phase, voice.error);
  const activity = useRecentChange(voice.interim, 800);
  const status = t(STATE_KEY[state]);
  // the chat panel (md and up: right side, phone: whole width) must stay usable
  const chatPanel = viewMode === 'widget';

  const mini = (
    <div
      role="region"
      aria-label={t('hai.voiceMode.mini.label')}
      data-testid="hai-voice-mini"
      data-state={state}
      className={`fixed z-[60] flex items-center gap-2 rounded-full border border-cyan-400/30 bg-[#020b1c]/95 p-1.5 pr-2 text-white shadow-xl shadow-cyan-950/50 backdrop-blur ${
        chatPanel
          ? 'top-3 left-1/2 -translate-x-1/2 md:top-auto md:right-[27rem] md:bottom-28 md:left-auto md:translate-x-0'
          : 'bottom-28 left-1/2 -translate-x-1/2 md:right-6 md:left-auto md:translate-x-0'
      }`}
    >
      <button
        type="button"
        onClick={restore}
        aria-label={t('hai.voiceMode.mini.restore')}
        title={t('hai.voiceMode.mini.restore')}
        className="rounded-full focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none"
      >
        <HaiMascot
          state={state}
          activity={activity}
          level={voice.level}
          size="sm"
        />
      </button>
      <p
        role="status"
        aria-live="polite"
        className="max-w-[7rem] truncate text-xs text-cyan-100 md:max-w-[10rem] md:text-sm"
      >
        {status}
      </p>
      <button
        type="button"
        onClick={closeMode}
        aria-label={t('hai.voiceMode.close')}
        title={t('hai.voiceMode.close')}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-gray-100 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );

  return createPortal(mini, document.body);
}

// ============================================================================
// LARGE: the full screen conversation
// ============================================================================

function FullVoiceMode() {
  const { t } = useLanguage();
  const {
    voice,
    captions,
    setCaptions,
    offer,
    openNavigation,
    closeMode,
    acceptConsent,
  } = useHaiVoiceSession();

  const dialogRef = useRef<HTMLDivElement>(null);
  const mascotRef = useRef<HTMLButtonElement>(null);
  const captionsRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, true);

  // Esc ends the voice mode
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMode();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeMode]);

  const state = mascotStateOf(voice.phase, voice.error);
  const activity = useRecentChange(voice.interim, 800);
  const status = t(STATE_KEY[state]);
  const needsConsent = !voice.consented;

  // after the consent the focus goes to the mascot (the consent buttons go away)
  const hadConsent = useRef(voice.consented);
  useEffect(() => {
    if (voice.consented && !hadConsent.current) mascotRef.current?.focus();
    hadConsent.current = voice.consented;
  }, [voice.consented]);

  // what the person said stays above the answer until the next round
  const heard =
    voice.interim || (voice.phase === 'listening' ? '' : voice.heard);

  // the answer is hidden while the person talks again
  const showAnswer =
    voice.spoken.length > 0 && !(voice.phase === 'listening' && voice.interim);

  // keep the last sentence in view
  useEffect(() => {
    const box = captionsRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [voice.spoken, heard, captions]);

  const canListenAgain =
    !needsConsent && (voice.phase === 'idle' || voice.phase === 'error');
  const canInterrupt = voice.phase === 'speaking' || voice.phase === 'thinking';

  const onMascot = () => {
    if (canInterrupt) voice.interrupt();
    else if (canListenAgain) voice.start();
  };
  const mascotLabel = canInterrupt
    ? t('hai.voice.interrupt')
    : canListenAgain
      ? t('hai.voiceMode.listenAgain')
      : status;

  const errorText = voice.error ? t(ERROR_KEY[voice.error]) : '';

  const dialog = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('hai.voiceMode.dialogLabel')}
      tabIndex={-1}
      data-testid="hai-voice-mode"
      data-state={state}
      className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-gradient-to-b from-[#020b1c] via-[#06142e] to-[#0a1f3d] text-white"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-8 md:py-5">
        <div className="flex items-center gap-2 text-cyan-200">
          <AudioLines className="h-5 w-5" aria-hidden="true" />
          <h2 className="text-base font-semibold tracking-wide md:text-lg">
            {t('hai.voiceMode.title')}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={captions}
            onClick={() => setCaptions(!captions)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none ${
              captions
                ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-100'
                : 'border-white/20 bg-white/5 text-gray-300'
            }`}
          >
            <Subtitles className="h-4 w-4" aria-hidden="true" />
            {t('hai.voiceMode.captions')}
          </button>
          <button
            type="button"
            onClick={closeMode}
            aria-label={t('hai.voiceMode.close')}
            title={t('hai.voiceMode.close')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-gray-100 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Mascot and state */}
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 pb-4">
        <button
          ref={mascotRef}
          type="button"
          onClick={onMascot}
          aria-label={mascotLabel}
          aria-disabled={!canInterrupt && !canListenAgain}
          title={mascotLabel}
          data-autofocus={needsConsent ? undefined : ''}
          className="rounded-full focus-visible:ring-4 focus-visible:ring-cyan-300/70 focus-visible:outline-none"
        >
          <HaiMascot
            state={state}
            activity={activity}
            level={voice.level}
            size="lg"
          />
        </button>

        <p
          role="status"
          aria-live="polite"
          data-testid="hai-voice-status"
          className="text-xl font-medium text-cyan-100 md:text-2xl"
        >
          {status}
        </p>
        {errorText && (
          <p
            role="alert"
            className="max-w-xl text-center text-sm text-amber-300"
          >
            {errorText}
          </p>
        )}

        {needsConsent ? (
          <div
            role="group"
            aria-labelledby="hai-voice-mode-consent-title"
            data-testid="hai-voice-mode-consent"
            className="w-full max-w-xl rounded-2xl border border-cyan-500/30 bg-black/40 p-4"
          >
            <p
              id="hai-voice-mode-consent-title"
              className="mb-2 font-medium text-gray-100"
            >
              {t('hai.voice.consent.title')}
            </p>
            <div className="mb-4 space-y-2 text-sm leading-relaxed text-gray-300">
              {consentParagraphs(voice.chain, voice.region, t).map(
                (paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                )
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                data-autofocus=""
                onClick={acceptConsent}
                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:outline-none"
              >
                {t('hai.voice.consent.accept')}
              </button>
              <button
                type="button"
                onClick={closeMode}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm text-gray-200 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:outline-none"
              >
                {t('hai.voice.consent.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {captions && (
              <div
                ref={captionsRef}
                role="region"
                aria-label={t('hai.voiceMode.captionsLabel')}
                data-testid="hai-voice-captions"
                lang="de"
                className="max-h-[28vh] min-h-[3.5rem] w-full max-w-3xl space-y-2 overflow-y-auto text-center text-xl leading-snug md:text-2xl"
              >
                {heard && (
                  <p data-testid="hai-caption-heard" className="text-cyan-200">
                    <span className="sr-only">
                      {t('hai.voiceMode.heard')}:{' '}
                    </span>
                    {heard}
                  </p>
                )}
                {showAnswer && (
                  <p data-testid="hai-caption-answer">
                    <span className="sr-only">
                      {t('hai.voiceMode.answer')}:{' '}
                    </span>
                    {voice.spoken.map((piece, index) => (
                      <span
                        key={index}
                        className={
                          index === voice.spoken.length - 1
                            ? 'text-white'
                            : 'text-white/55'
                        }
                      >
                        {piece}{' '}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            )}

            {offer && (
              <div className="w-full max-w-md">
                <HaiNavigationCard
                  offer={offer.offer}
                  onOpen={() => openNavigation(offer.messageId)}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer: what to say, where the audio goes */}
      <div className="space-y-1 px-4 pb-5 text-center text-xs text-gray-400 md:text-sm">
        <p>{t('hai.voiceMode.hint')}</p>
        <p>{providerStatement(voice, t)}</p>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
