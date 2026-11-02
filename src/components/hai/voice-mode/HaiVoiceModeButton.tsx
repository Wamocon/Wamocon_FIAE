'use client';

/**
 * The button "Gespräch" that opens the voice mode with the mascot. It appears
 * only where the voice assistant is on for the organization and the browser can
 * use a provider (the same check as the microphone), and nowhere without the
 * voice session. A real button: reachable by Tab, Enter and Space open it.
 */

import React from 'react';
import { AudioLines } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOptionalHaiVoiceSession } from './voiceSessionContext';

interface HaiVoiceModeButtonProps {
  className?: string;
}

export function HaiVoiceModeButton({
  className = 'inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-medium text-cyan-400 transition-colors hover:bg-cyan-500/20',
}: HaiVoiceModeButtonProps) {
  const { t } = useLanguage();
  const session = useOptionalHaiVoiceSession();
  if (!session || !session.available) return null;

  return (
    <button
      type="button"
      onClick={session.openMode}
      aria-label={t('hai.voiceMode.openLabel')}
      title={t('hai.voiceMode.openLabel')}
      data-testid="hai-voice-mode-button"
      className={className}
    >
      <AudioLines className="h-4 w-4" aria-hidden="true" />
      <span>{t('hai.voiceMode.open')}</span>
    </button>
  );
}

export default HaiVoiceModeButton;
