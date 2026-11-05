'use client';

/**
 * What the voice mode asks of the person about the level gate, so the gate never
 * locks the person out in silence:
 *
 *  - calibrate          "Sag kurz: Hallo HAI" (the calibration at the start, no chat call)
 *  - calibration-failed why it did not work and a choice (guidance first)
 *  - lost               "Ich habe dich eventuell nicht gehört": two utterances in a row
 *                       were left out although they stood above the room level
 *
 * The choice is always the same three ways: calibrate the microphone again, push to
 * talk (the microphone records only while a button is held), or the filter off.
 * Shown in the voice mode and in the chat bar. Never any text of a voice.
 */

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CalibrationReason, FilterNote } from '../useHaiVoice';
import type { HaiVoiceSession } from './voiceSessionContext';

type Voice = HaiVoiceSession['voice'];

const FAILED_KEY: Record<CalibrationReason, string> = {
  quiet: 'hai.voice.calibrate.failed.quiet',
  noisy: 'hai.voice.calibrate.failed.noisy',
  nolevel: 'hai.voice.calibrate.failed.nolevel',
  nothing: 'hai.voice.calibrate.failed.nothing',
};

/** One text for each reason an utterance was left out (or counted with a hint). */
export const FILTER_NOTE_KEY: Record<Exclude<FilterNote, null>, string> = {
  'only-you': 'hai.voice.filter.onlyYou',
  'too-quiet': 'hai.voice.filter.tooQuiet',
  unclear: 'hai.voice.filter.unclear',
  loud: 'hai.voice.filter.loud',
};

const BUTTON =
  'rounded-lg bg-cyan-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-cyan-500';
const BUTTON_QUIET =
  'rounded-lg bg-white/10 px-2.5 py-1 text-xs text-gray-100 hover:bg-white/20';

export function HaiVoiceFilterPrompt({
  voice,
  className,
}: {
  voice: Pick<
    Voice,
    | 'filterPrompt'
    | 'calibrationReason'
    | 'recalibrate'
    | 'skipCalibration'
    | 'dismissFilterPrompt'
    | 'setPushToTalk'
    | 'setSensitivity'
  >;
  className?: string;
}) {
  const { t } = useLanguage();
  const prompt = voice.filterPrompt;
  if (!prompt) return null;

  const choose = (action: () => void) => () => {
    action();
  };
  const title =
    prompt === 'calibrate'
      ? t('hai.voice.calibrate.prompt')
      : prompt === 'lost'
        ? t('hai.voice.lost.title')
        : t(FAILED_KEY[voice.calibrationReason ?? 'nothing']);
  const hint =
    prompt === 'calibrate'
      ? t('hai.voice.calibrate.hint')
      : prompt === 'lost'
        ? t('hai.voice.lost.hint')
        : null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="hai-voice-filter-prompt"
      data-prompt={prompt}
      className={
        className ??
        'pointer-events-auto max-w-full space-y-1.5 rounded-xl bg-[#06183a]/95 p-2.5 text-xs leading-snug text-cyan-100 shadow-lg'
      }
    >
      <p className={prompt === 'calibrate' ? 'text-sm font-medium' : ''}>
        {title}
      </p>
      {hint && <p className="text-cyan-100/80">{hint}</p>}
      <div className="flex flex-wrap gap-1.5">
        {prompt === 'calibrate' ? (
          <button
            type="button"
            data-testid="hai-voice-calibrate-skip"
            onClick={choose(voice.skipCalibration)}
            className={BUTTON_QUIET}
          >
            {t('hai.voice.calibrate.skip')}
          </button>
        ) : (
          <>
            <button
              type="button"
              data-testid="hai-voice-choice-recalibrate"
              onClick={choose(voice.recalibrate)}
              className={BUTTON}
            >
              {t('hai.voice.choice.recalibrate')}
            </button>
            <button
              type="button"
              data-testid="hai-voice-choice-ptt"
              onClick={choose(() => voice.setPushToTalk(true))}
              className={BUTTON}
            >
              {t('hai.voice.choice.ptt')}
            </button>
            <button
              type="button"
              data-testid="hai-voice-choice-off"
              onClick={choose(() => voice.setSensitivity('off'))}
              className={BUTTON}
            >
              {t('hai.voice.choice.off')}
            </button>
            <button
              type="button"
              data-testid="hai-voice-choice-dismiss"
              onClick={choose(voice.dismissFilterPrompt)}
              className={BUTTON_QUIET}
            >
              {t('hai.voice.choice.dismiss')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
