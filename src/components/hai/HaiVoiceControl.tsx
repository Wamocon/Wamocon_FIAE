'use client';

/**
 * Microphone of the HAI chat (voice assistant, day companion, WMCNL-2907).
 *
 * Shown only where the organization has the voice assistant on (GET
 * /api/hai/voice) and the browser can recognize and read speech. The first use
 * asks for consent and says plainly where the audio goes. Speech stays in the
 * browser, the HAI gets the recognized text and records no audio.
 */

import { useEffect, useState } from 'react';
import { Loader2, Mic, Square, Volume2 } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useHai } from './HaiProvider';
import { useHaiVoice, type VoiceError } from './useHaiVoice';

let enabledCache: boolean | null = null;

function useVoiceEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(enabledCache === true);
  useEffect(() => {
    if (enabledCache !== null) return;
    let cancelled = false;
    authFetch('/api/hai/voice')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        enabledCache = data?.enabled === true;
        if (!cancelled) setEnabled(enabledCache);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}

const ERROR_KEY: Record<Exclude<VoiceError, null>, string> = {
  'not-allowed': 'hai.voice.error.notAllowed',
  'no-speech': 'hai.voice.error.noSpeech',
  unsupported: 'hai.voice.error.unsupported',
  failed: 'hai.voice.error.failed',
};

export function HaiVoiceControl() {
  const { t } = useLanguage();
  const { user } = useAuth() as { user?: { id?: string } | null };
  const { messages, streamingMessageId, sendMessage, stopGeneration } =
    useHai();
  const orgEnabled = useVoiceEnabled();
  const [askConsent, setAskConsent] = useState(false);

  const voice = useHaiVoice({
    userId: user?.id,
    enabled: orgEnabled,
    messages,
    streamingMessageId,
    sendMessage,
    stopGeneration,
    placeholderText: t('hai.loading.thinking') || 'Thinking...',
  });

  if (!voice.available) return null;

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
    voice.giveConsent();
    setAskConsent(false);
    // the consent was just stored; start on the next render
    setTimeout(() => voice.start(), 0);
  };

  const statusKey =
    voice.phase === 'listening'
      ? 'hai.voice.phase.listening'
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
        </div>
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

      {askConsent && (
        <div
          role="dialog"
          aria-label={t('hai.voice.consent.title')}
          className="mt-2 rounded-lg border border-cyan-500/30 bg-black/40 p-3"
        >
          <p className="mb-1 font-medium text-gray-100">
            {t('hai.voice.consent.title')}
          </p>
          <p className="mb-3 text-xs leading-relaxed text-gray-300">
            {t('hai.voice.consent.text')}
          </p>
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
          <p>
            {voice.localRecognition
              ? t('hai.voice.local')
              : t('hai.voice.cloud')}
          </p>
          <p>{t('hai.voice.hint')}</p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={voice.dayStartEnabled}
              onChange={e => voice.setDayStartEnabled(e.target.checked)}
            />
            {t('hai.voice.dayStart')}
          </label>
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
