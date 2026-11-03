'use client';

/**
 * Voice mode of the HAI: a conversation with the HAI figure.
 *
 * No full screen and no dark layer: the HAI is a figure that rises out of a
 * round basin of water at the bottom left of the page, stands in it with its
 * legs while the voice mode runs, speaks with a moving mouth and dives back in
 * when the mode ends (HaiCharacter.tsx). The page behind stays usable: only the
 * figure and its controls take clicks, there is no focus trap and no modal.
 *
 * Next to the figure: a speech bubble with the subtitles (what the person said,
 * what the HAI says, sentence by sentence as it is read aloud, switchable), a
 * small card for a page the HAI offered, and the controls (microphone off/on,
 * interrupt, subtitles, notes, end). Esc and the spoken "Sprachmodus beenden"
 * end the mode as well. Before the microphone is used a small consent card
 * names the recipient of the audio, next to the basin.
 *
 * The figure lives in a portal outside of the page content and in the voice
 * session above the pages, so it stays standing when the HAI opens another page.
 * Everything said is in the chat: the voice mode reads and writes the same
 * messages of the same session (HaiProvider). The loop, the consent and the
 * provider are those of useHaiVoice.
 *
 * Accessibility: the figure is decoration (aria-hidden), the state is written
 * as text (aria-live, small), the controls have names and are reached by Tab.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Hand, Info, Mic, MicOff, Subtitles, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { consentParagraphs } from '@/lib/hai/voice/consentText';
import { HaiNavigationCard } from '../HaiNavigationCard';
import { HaiVoiceFallbackNotice } from '../HaiVoiceFallbackNotice';
import type { VoiceError, VoicePhase } from '../useHaiVoice';
import { DIVE_MS, HaiCharacter, type CharacterState } from './HaiCharacter';
import { providerStatement } from './providerStatement';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { useHaiVoiceSession } from './voiceSessionContext';

function stateOf(
  phase: VoicePhase,
  error: VoiceError,
  muted: boolean
): CharacterState {
  if (muted) return 'paused';
  if (phase === 'listening') return 'listening';
  if (phase === 'thinking') return 'thinking';
  if (phase === 'speaking') return 'speaking';
  if (phase === 'error') return error === 'no-speech' ? 'paused' : 'error';
  return 'waiting';
}

const STATE_KEY: Record<CharacterState, string> = {
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

// bottom left (fixed bottom-4 left-4), plus the safe area of a phone (notch, home bar)
const PLACE =
  'fixed bottom-4 left-4 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]';

// size of the figure: about 160 px high on a phone, 280 px from sm up
const FIGURE_SIZE = 'h-40 sm:h-[17.5rem]';

const BUTTON =
  'pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-cyan-400/50 text-cyan-100 shadow-md transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#06183a] focus-visible:outline-none';
const BUTTON_OFF = 'bg-[#06183a] hover:bg-[#0b2a5a]';
const BUTTON_ON = 'bg-cyan-400 text-[#06183a] hover:bg-cyan-300';

export function HaiVoiceModeOverlay() {
  const { view } = useHaiVoiceSession();
  const reduced = usePrefersReducedMotion();
  const open = view !== 'closed';

  // after the end the figure dives into the water before it is gone
  const [diving, setDiving] = useState(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setDiving(false);
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (reduced) return;
    setDiving(true);
    const timer = setTimeout(() => setDiving(false), DIVE_MS + 150);
    return () => clearTimeout(timer);
  }, [open, reduced]);

  if (open) return <LiveFigure />;
  if (diving) return <DivingFigure />;
  return null;
}

/** Only the figure, on its way into the water. No controls, no text. */
function DivingFigure() {
  return createPortal(
    <div
      data-testid="hai-voice-figure"
      data-phase="diving"
      className={`pointer-events-none z-40 ${PLACE}`}
    >
      <HaiCharacter
        state="waiting"
        leaving
        className={`${FIGURE_SIZE} aspect-[26/30]`}
      />
    </div>,
    document.body
  );
}

function LiveFigure() {
  const { t } = useLanguage();
  const {
    voice,
    captions,
    setCaptions,
    offer,
    openNavigation,
    closeMode,
    acceptConsent,
    muted,
    toggleMic,
  } = useHaiVoiceSession();

  const rootRef = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState(false);

  // Esc ends the voice mode (unless something else on the page already used it)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        closeMode();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeMode]);

  // The focus goes to the consent (or to the microphone button) when the mode
  // opens, and back to the button that opened it when the mode ends. There is
  // no focus trap: the page behind stays reachable by Tab.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener && opener !== document.body && document.contains(opener)) {
        opener.focus();
      }
    };
  }, []);
  const needsConsent = !voice.consented;
  useEffect(() => {
    rootRef.current
      ?.querySelector<HTMLElement>('[data-autofocus]')
      ?.focus({ preventScroll: true });
  }, [needsConsent]);

  const state = stateOf(voice.phase, voice.error, muted);
  const activity = useRecentChange(voice.interim, 800);
  // listening is only announced when the microphone is really open
  const preparing = !muted && state === 'listening' && !voice.micOpen;
  const status = muted
    ? t('hai.voiceMode.state.muted')
    : preparing
      ? t('hai.voice.phase.preparing')
      : t(STATE_KEY[state]);
  // live mode: the microphone stays open while the HAI thinks and speaks (interrupting by voice)
  const micOpenWhileAnswering =
    !muted && voice.micOpen && (state === 'thinking' || state === 'speaking');

  // what the person said stays above the answer until the next round
  const heard =
    voice.interim || (voice.phase === 'listening' ? '' : voice.heard);
  // the answer is hidden while the person talks again
  const showAnswer =
    voice.spoken.length > 0 && !(voice.phase === 'listening' && voice.interim);
  const bubble = captions && !needsConsent && (!!heard || showAnswer);

  // keep the last sentence in view
  const bubbleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = bubbleRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [voice.spoken, heard, captions]);

  const canListenAgain =
    !needsConsent &&
    !muted &&
    (voice.phase === 'idle' || voice.phase === 'error');
  const canInterrupt = voice.phase === 'speaking' || voice.phase === 'thinking';

  // a tap on the figure itself: be quiet and listen (the buttons do the same by keyboard)
  const onFigure = () => {
    if (canInterrupt) voice.interrupt();
    else if (canListenAgain) voice.start();
  };

  const errorText = !muted && voice.error ? t(ERROR_KEY[voice.error]) : '';

  const live = (
    <div
      ref={rootRef}
      role="region"
      aria-label={t('hai.voiceMode.dialogLabel')}
      data-testid="hai-voice-figure"
      data-state={state}
      data-phase="live"
      className={`pointer-events-none z-40 flex flex-col items-start gap-2 ${PLACE}`}
    >
      {needsConsent && (
        <div
          role="group"
          aria-labelledby="hai-voice-mode-consent-title"
          data-testid="hai-voice-mode-consent"
          className="pointer-events-auto max-h-[55vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-cyan-400/40 bg-[#06183a]/95 p-4 text-white shadow-xl"
        >
          <p
            id="hai-voice-mode-consent-title"
            className="mb-2 font-medium text-cyan-100"
          >
            {t('hai.voice.consent.title')}
          </p>
          <div className="mb-4 space-y-2 text-sm leading-relaxed text-gray-200">
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
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-[#06183a] hover:bg-cyan-400 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              {t('hai.voice.consent.accept')}
            </button>
            <button
              type="button"
              onClick={closeMode}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm text-gray-100 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              {t('hai.voice.consent.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* the figure in its basin: the person can tap it to interrupt */}
        <div
          data-testid="hai-voice-figure-body"
          onClick={onFigure}
          className={`${FIGURE_SIZE} pointer-events-none aspect-[26/30] shrink-0`}
        >
          <HaiCharacter
            state={state}
            activity={activity}
            level={voice.level}
            className="h-full w-full"
          />
        </div>

        <div className="flex max-w-[calc(100vw-11.5rem)] min-w-0 flex-col gap-2 self-stretch sm:max-w-[18rem]">
          {/* speech bubble with the subtitles */}
          {bubble && (
            <div className="pointer-events-auto relative">
              {/* the tail of the bubble points at the head */}
              <span
                aria-hidden="true"
                className="absolute top-8 -left-[7px] h-3.5 w-3.5 rotate-45 border-b-2 border-l-2 border-[#06183a] bg-white"
              />
              <div
                ref={bubbleRef}
                role="region"
                aria-label={t('hai.voiceMode.captionsLabel')}
                data-testid="hai-voice-captions"
                lang="de"
                className="relative max-h-32 overflow-y-auto rounded-2xl border-2 border-[#06183a] bg-white p-3 text-sm leading-snug text-[#06183a] shadow-lg sm:max-h-44 sm:text-base"
              >
                {heard && (
                  <p data-testid="hai-caption-heard" className="text-cyan-800">
                    <span className="sr-only">
                      {t('hai.voiceMode.heard')}:{' '}
                    </span>
                    {heard}
                  </p>
                )}
                {showAnswer && (
                  <p
                    data-testid="hai-caption-answer"
                    className={heard ? 'mt-1' : ''}
                  >
                    <span className="sr-only">
                      {t('hai.voiceMode.answer')}:{' '}
                    </span>
                    {voice.spoken.map((piece, index) => (
                      <span
                        key={index}
                        className={
                          index === voice.spoken.length - 1
                            ? 'font-medium'
                            : 'text-[#06183a]/60'
                        }
                      >
                        {piece}{' '}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
          )}

          {offer && !needsConsent && (
            <div className="pointer-events-auto rounded-xl bg-[#06183a]/95 p-1 shadow-lg">
              <HaiNavigationCard
                offer={offer.offer}
                onOpen={() => openNavigation(offer.messageId)}
              />
            </div>
          )}

          {info && (
            <div
              role="group"
              aria-label={t('hai.voiceMode.info')}
              data-testid="hai-voice-info"
              className="pointer-events-auto space-y-1 rounded-xl bg-[#06183a]/95 p-3 text-xs leading-snug text-gray-200 shadow-lg"
            >
              <p>{t('hai.voiceMode.hint')}</p>
              {voice.live && <p>{t('hai.voice.liveHint')}</p>}
              <p>{providerStatement(voice, t)}</p>
            </div>
          )}

          <div className="mt-auto flex flex-col items-start gap-1.5">
            <p
              role="status"
              aria-live="polite"
              data-testid="hai-voice-status"
              className="rounded-full bg-[#06183a]/90 px-2.5 py-1 text-xs font-medium text-cyan-100 shadow"
            >
              {status}
            </p>
            {micOpenWhileAnswering && (
              <p
                data-testid="hai-voice-mic-open"
                className="rounded-full bg-[#06183a]/90 px-2.5 py-1 text-xs text-cyan-100 shadow"
              >
                {t('hai.voice.micOpen')}
              </p>
            )}
            {/* a function that runs on another provider than planned, and why */}
            <HaiVoiceFallbackNotice
              fallback={voice.fallback}
              className="pointer-events-auto max-w-full rounded-lg bg-[#06183a]/95 px-2.5 py-1.5 text-xs text-amber-300 shadow"
            />
            {errorText && (
              <p
                role="alert"
                className="pointer-events-auto max-w-full rounded-lg bg-[#06183a]/95 px-2.5 py-1.5 text-xs text-amber-300 shadow"
              >
                {errorText}
              </p>
            )}

            {/* controls */}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={toggleMic}
                aria-label={
                  muted
                    ? t('hai.voiceMode.mic.unmute')
                    : t('hai.voiceMode.mic.mute')
                }
                title={
                  muted
                    ? t('hai.voiceMode.mic.unmute')
                    : t('hai.voiceMode.mic.mute')
                }
                data-testid="hai-voice-mic"
                data-muted={muted ? 'true' : 'false'}
                data-mic-open={voice.micOpen && !muted ? 'true' : 'false'}
                data-autofocus={needsConsent ? undefined : ''}
                disabled={needsConsent}
                className={`${BUTTON} ${muted ? BUTTON_OFF : BUTTON_ON} ${voice.micOpen && !muted ? 'animate-pulse' : ''} disabled:opacity-50`}
              >
                {muted ? (
                  <MicOff className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Mic className="h-5 w-5" aria-hidden="true" />
                )}
              </button>
              {canInterrupt && (
                <button
                  type="button"
                  onClick={() => voice.interrupt()}
                  aria-label={t('hai.voice.interrupt')}
                  title={t('hai.voice.interrupt')}
                  className={`${BUTTON} ${BUTTON_OFF}`}
                >
                  <Hand className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
              {canListenAgain && (
                <button
                  type="button"
                  onClick={() => voice.start()}
                  aria-label={t('hai.voiceMode.listenAgain')}
                  title={t('hai.voiceMode.listenAgain')}
                  className={`${BUTTON} ${BUTTON_OFF}`}
                >
                  <Mic className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={captions}
                onClick={() => setCaptions(!captions)}
                aria-label={t('hai.voiceMode.captions')}
                title={t('hai.voiceMode.captions')}
                className={`${BUTTON} ${captions ? BUTTON_ON : BUTTON_OFF}`}
              >
                <Subtitles className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setInfo(value => !value)}
                aria-expanded={info}
                aria-label={t('hai.voiceMode.info')}
                title={t('hai.voiceMode.info')}
                className={`${BUTTON} ${info ? BUTTON_ON : BUTTON_OFF}`}
              >
                <Info className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={closeMode}
                aria-label={t('hai.voiceMode.close')}
                title={t('hai.voiceMode.close')}
                data-testid="hai-voice-close"
                className={`${BUTTON} ${BUTTON_OFF}`}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(live, document.body);
}
