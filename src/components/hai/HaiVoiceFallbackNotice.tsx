'use client';

/**
 * The notice that makes a fallback of the voice assistant visible: when listening
 * or speaking runs on another provider than planned (for example "I am listening
 * through the browser" instead of Soniox), with the reason in a few words (key
 * refused, organization, limit, region, timeout ...). Without it a refused key
 * looks like "the HAI hears nothing".
 *
 * Standalone on purpose: the voice mode (voice-mode/) and the microphone of the
 * chat embed it with the `fallback` field of useHaiVoice, nothing else is needed.
 *
 *   <HaiVoiceFallbackNotice fallback={voice.fallback} />
 *
 * Renders nothing as long as everything runs as planned.
 */

import { useLanguage } from '@/contexts/LanguageContext';
import type { ProviderFallback } from '@/lib/hai/voice/client/fallback';

export interface VoiceFallbackState {
  stt: ProviderFallback | null;
  tts: ProviderFallback | null;
}

type Translate = (key: string) => string;

export interface FallbackLine {
  function: 'stt' | 'tts';
  /** What runs now ("I am listening through the browser."). */
  text: string;
  /** Why ("The service refused the key."). */
  reason: string;
}

/** The lines of the notice, one per function that fell back. Pure, for tests. */
export function fallbackLines(
  fallback: VoiceFallbackState | null | undefined,
  t: Translate
): FallbackLine[] {
  const lines: FallbackLine[] = [];
  for (const fn of ['stt', 'tts'] as const) {
    const item = fallback?.[fn];
    if (!item) continue;
    lines.push({
      function: fn,
      text: t(`hai.voice.fallback.${fn}.${item.to ?? 'none'}`),
      reason: t(`hai.voice.fallback.reason.${item.reason}`),
    });
  }
  return lines;
}

interface Props {
  fallback: VoiceFallbackState | null | undefined;
  className?: string;
}

export function HaiVoiceFallbackNotice({ fallback, className }: Props) {
  const { t } = useLanguage();
  const lines = fallbackLines(fallback, t);
  if (lines.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="hai-voice-fallback"
      className={className ?? 'text-xs text-amber-400'}
    >
      {lines.map(line => (
        <p key={line.function}>
          {line.text} <span className="opacity-80">{line.reason}</span>
        </p>
      ))}
    </div>
  );
}
