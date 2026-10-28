'use client';

import { Check, Lock, Play } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export type EnablerStateValue = 'locked' | 'open' | 'completed';
export type EnablerLockReasonValue = 'SEQUENCE' | 'MANUAL' | null | undefined;

type TranslateFn = (
  key: string,
  params?: Record<string, string | number>
) => string;

/**
 * The sentence that explains a lock: what to finish first, or that the trainer
 * locked the enabler. Shared by the badge, the banner and the disabled buttons.
 */
export function lockText(
  t: TranslateFn,
  reason: EnablerLockReasonValue,
  lockedByTitle?: string | null
): string {
  if (reason === 'MANUAL') return t('progression.lockedManual');
  return lockedByTitle
    ? t('progression.lockedAfter', { title: lockedByTitle })
    : t('progression.lockedAfterGeneric');
}

/**
 * The three states of an enabler for a trainee, always as symbol plus words
 * (never colour alone): locked with a padlock and the reason, open, completed.
 */
export function EnablerStateBadge({
  state,
  reason,
  lockedByTitle,
}: {
  state: EnablerStateValue;
  reason?: EnablerLockReasonValue;
  lockedByTitle?: string | null;
}) {
  const { t } = useLanguage();

  if (state === 'locked') {
    return (
      <span
        data-testid="enabler-state-locked"
        className="text-foreground inline-flex flex-wrap items-center gap-1.5 text-xs"
      >
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-600/60 bg-amber-500/15 px-2 py-0.5 font-medium">
          <Lock className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
          {t('progression.state.locked')}
        </span>
        <span>{lockText(t, reason, lockedByTitle)}</span>
      </span>
    );
  }

  if (state === 'completed') {
    return (
      <span
        data-testid="enabler-state-completed"
        className="text-foreground inline-flex items-center gap-1 rounded-full border border-green-600/60 bg-green-500/15 px-2 py-0.5 text-xs font-medium"
      >
        <Check className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
        {t('progression.state.completed')}
      </span>
    );
  }

  return (
    <span
      data-testid="enabler-state-open"
      className="text-foreground inline-flex items-center gap-1 rounded-full border border-blue-600/60 bg-blue-500/15 px-2 py-0.5 text-xs font-medium"
    >
      <Play className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
      {t('progression.state.open')}
    </span>
  );
}
