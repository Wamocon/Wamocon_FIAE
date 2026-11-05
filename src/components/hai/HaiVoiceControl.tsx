'use client';

/**
 * Microphone of the HAI chat (voice assistant, day companion, WMCNL-2907).
 *
 * Shown only where the organization has the voice assistant on (GET
 * /api/hai/voice) and the browser can use one provider of the chain (Soniox,
 * Sokrates or the browser itself, read from GET /api/hai/voice/config). The first
 * use asks for consent and says plainly where the audio goes: the text names the
 * effective provider and the one that takes over. The HAI gets the recognized
 * text and records no audio.
 *
 * The voice loop is the one of the voice session (voice-mode/HaiVoiceSession.tsx),
 * shared with the voice mode: next to the microphone sits the button "Gespräch"
 * that opens the voice mode with the mascot.
 */

import { useState } from 'react';
import { Loader2, Mic, Square, Volume2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { HaiVoiceFallbackNotice } from './HaiVoiceFallbackNotice';
import { type VoiceError } from './useHaiVoice';
import { consentParagraphs } from '@/lib/hai/voice/consentText';
import { HaiVoiceFilterPrompt } from './voice-mode/HaiVoiceFilterPrompt';
import { HaiVoiceModeButton } from './voice-mode/HaiVoiceModeButton';
import { usePushToTalkKeys } from './voice-mode/usePushToTalkKeys';
import { providerStatement } from './voice-mode/providerStatement';
import { useOptionalHaiVoiceSession } from './voice-mode/voiceSessionContext';

const ERROR_KEY: Record<Exclude<VoiceError, null>, string> = {
  'not-allowed': 'hai.voice.error.notAllowed',
  'no-speech': 'hai.voice.error.noSpeech',
  unsupported: 'hai.voice.error.unsupported',
  failed: 'hai.voice.error.failed',
};

export function HaiVoiceControl() {
  const { t } = useLanguage();
  const session = useOptionalHaiVoiceSession();
  const [askConsent, setAskConsent] = useState(false);
  // what "Diagnose kopieren" did: nothing yet, copied, or not possible
  const [diagnosis, setDiagnosis] = useState<'copied' | 'failed' | null>(null);

  const voiceOrNull = session?.voice ?? null;
  const pttActive =
    !!session &&
    !!voiceOrNull?.available &&
    voiceOrNull.pushToTalk &&
    session.view === 'closed' &&
    voiceOrNull.phase !== 'idle' &&
    voiceOrNull.phase !== 'error';
  // the space bar records here only while the voice mode (which has its own) is closed
  usePushToTalkKeys({
    enabled: pttActive,
    onDown: () => voiceOrNull?.pressToTalk(),
    onUp: () => voiceOrNull?.releaseToTalk(),
  });

  if (!session || !session.voice.available) return null;
  const voice = session.voice;
  const active = voice.phase !== 'idle' && voice.phase !== 'error';

  const onMain = () => {
    if (voice.phase === 'speaking' || voice.phase === 'thinking') {
      voice.interrupt();
      return;
    }
    if (active) {
      voice.stop();
      return;
    }
    if (!voice.consented) {
      setAskConsent(true);
      return;
    }
    voice.start();
  };

  const accept = () => {
    // stores the consent and starts on the next render
    session.acceptConsent();
    setAskConsent(false);
  };

  // listening is only announced when the microphone is really open
  const statusKey =
    voice.phase === 'listening'
      ? voice.micOpen
        ? 'hai.voice.phase.listening'
        : 'hai.voice.phase.preparing'
      : voice.phase === 'thinking'
        ? 'hai.voice.phase.thinking'
        : voice.phase === 'speaking'
          ? 'hai.voice.phase.speaking'
          : 'hai.voice.phase.idle';

  const Icon =
    voice.phase === 'thinking'
      ? Loader2
      : voice.phase === 'speaking'
        ? Volume2
        : Mic;

  const mainLabel =
    voice.phase === 'speaking' || voice.phase === 'thinking'
      ? t('hai.voice.interrupt')
      : active
        ? t('hai.voice.stop')
        : t('hai.voice.start');

  return (
    <div className="mb-2 rounded-xl border border-white/10 bg-[#0d1117]/70 p-2 text-sm text-gray-300">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMain}
          aria-pressed={active}
          aria-label={mainLabel}
          title={mainLabel}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all ${
            voice.phase === 'listening'
              ? 'animate-pulse bg-cyan-500 text-white'
              : active
                ? 'bg-cyan-700 text-white'
                : 'bg-white/10 text-gray-200 hover:bg-white/20'
          }`}
        >
          <Icon
            className={`h-4 w-4 ${voice.phase === 'thinking' ? 'animate-spin' : ''}`}
          />
        </button>
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate">{t(statusKey)}</p>
          {voice.interim && (
            <p className="truncate text-xs text-gray-400">{voice.interim}</p>
          )}
          {voice.error && (
            <p className="text-xs text-amber-400">
              {t(ERROR_KEY[voice.error])}
            </p>
          )}
          <HaiVoiceFallbackNotice fallback={voice.fallback} />
        </div>
        {pttActive && (
          <button
            type="button"
            data-ptt-button=""
            data-testid="hai-voice-control-ptt"
            data-holding={voice.holding ? 'true' : 'false'}
            aria-pressed={voice.holding}
            aria-label={t('hai.voiceMode.ptt.hold')}
            title={t('hai.voiceMode.ptt.hold')}
            onPointerDown={event => {
              event.preventDefault();
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // no capture: the release still comes from pointerup
              }
              voice.pressToTalk();
            }}
            onPointerUp={() => voice.releaseToTalk()}
            onPointerCancel={() => voice.releaseToTalk()}
            onLostPointerCapture={() => voice.releaseToTalk()}
            onContextMenu={event => event.preventDefault()}
            style={{ touchAction: 'none' }}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium select-none ${voice.holding ? 'animate-pulse bg-cyan-500 text-white' : 'bg-white/10 text-gray-200 hover:bg-white/20'}`}
          >
            <Mic className="h-4 w-4" aria-hidden="true" />
            {t('hai.voiceMode.ptt.hold')}
          </button>
        )}
        <HaiVoiceModeButton className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-medium text-cyan-400 transition-colors hover:bg-cyan-500/20" />
        {active && (
          <button
            type="button"
            onClick={voice.stop}
            aria-label={t('hai.voice.stop')}
            title={t('hai.voice.stop')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/80 text-white hover:bg-red-500"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* the calibration, or the way out when the person may not have been heard */}
      {active && (
        <HaiVoiceFilterPrompt
          voice={voice}
          className="mt-2 space-y-1.5 rounded-lg border border-cyan-500/30 bg-black/40 p-2.5 text-xs leading-snug text-cyan-100"
        />
      )}

      {askConsent && (
        <div
          role="dialog"
          aria-label={t('hai.voice.consent.title')}
          className="mt-2 rounded-lg border border-cyan-500/30 bg-black/40 p-3"
        >
          <p className="mb-1 font-medium text-gray-100">
            {t('hai.voice.consent.title')}
          </p>
          <div className="mb-3 space-y-2 text-xs leading-relaxed text-gray-300">
            {consentParagraphs(voice.chain, voice.region, t).map(
              (paragraph, index) => (
                <p key={index}>{paragraph}</p>
              )
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={accept}
              className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500"
            >
              {t('hai.voice.consent.accept')}
            </button>
            <button
              type="button"
              onClick={() => setAskConsent(false)}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/20"
            >
              {t('hai.voice.consent.cancel')}
            </button>
          </div>
        </div>
      )}

      <details className="mt-1 text-xs text-gray-400">
        <summary className="cursor-pointer select-none">
          {t('hai.voice.settings')}
        </summary>
        <div className="mt-2 space-y-2">
          <p>{providerStatement(voice, t)}</p>
          <p>{t('hai.voice.hint')}</p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={voice.dayStartEnabled}
              onChange={e => voice.setDayStartEnabled(e.target.checked)}
            />
            {t('hai.voice.dayStart')}
          </label>
          {/* protection against background voices (settings of this device) */}
          <fieldset
            className="space-y-1"
            data-testid="hai-voice-sensitivity"
            disabled={voice.pushToTalk}
          >
            <legend className="mb-1 text-gray-300">
              {t('hai.voice.settings.sensitivity')}
            </legend>
            {(['normal', 'strict', 'off'] as const).map(value => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="hai-voice-sensitivity"
                  value={value}
                  checked={voice.sensitivity === value}
                  onChange={() => voice.setSensitivity(value)}
                />
                {t(`hai.voice.settings.sensitivity.${value}`)}
              </label>
            ))}
            <p className="text-gray-500">
              {t('hai.voice.settings.sensitivity.hint')}
            </p>
          </fieldset>
          {voice.live && voice.sensitivity !== 'off' && !voice.pushToTalk && (
            <button
              type="button"
              data-testid="hai-voice-recalibrate"
              onClick={() => voice.recalibrate()}
              className="underline hover:text-gray-200"
            >
              {t('hai.voice.choice.recalibrate')}
            </button>
          )}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              data-testid="hai-voice-ptt-setting"
              checked={voice.pushToTalk}
              onChange={e => voice.setPushToTalk(e.target.checked)}
            />
            {t('hai.voice.settings.ptt')}
          </label>
          <p className="text-gray-500">{t('hai.voice.settings.ptt.hint')}</p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              data-testid="hai-voice-signals-setting"
              checked={voice.signalWords}
              onChange={e => voice.setSignalWords(e.target.checked)}
            />
            {t('hai.voice.settings.signals')}
          </label>
          <p className="text-gray-500">
            {t('hai.voice.settings.signals.hint')}
          </p>
          <p>{t('hai.voice.settings.headset')}</p>
          {/* the diagnosis for the test team: levels and reasons, never any text */}
          <div className="space-y-1" data-testid="hai-voice-diagnosis">
            <button
              type="button"
              data-testid="hai-voice-diagnosis-copy"
              onClick={async () => {
                const done = await voice.copyDiagnosis();
                setDiagnosis(done ? 'copied' : 'failed');
              }}
              className="rounded-lg bg-white/10 px-2.5 py-1 text-gray-100 hover:bg-white/20"
            >
              {t('hai.voice.diagnosis.copy')}
            </button>
            <p className="text-gray-500">{t('hai.voice.diagnosis.hint')}</p>
            <p role="status" aria-live="polite" className="text-gray-300">
              {diagnosis === 'copied'
                ? t('hai.voice.diagnosis.copied')
                : diagnosis === 'failed'
                  ? t('hai.voice.diagnosis.failed')
                  : ''}
            </p>
          </div>
          {voice.consented && (
            <button
              type="button"
              onClick={() => {
                voice.stop();
                voice.revokeConsent();
              }}
              className="underline hover:text-gray-200"
            >
              {t('hai.voice.revoke')}
            </button>
          )}
        </div>
      </details>
    </div>
  );
}
