'use client';

import { useId } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * The mark of a proposal that comes from the model, not from the rules: a word
 * with a symbol (never colour alone) and a hint that the person has to check it.
 * The hint is text on the page, not only a tooltip, so a keyboard and a screen
 * reader get it too.
 */
export function KiBadge() {
  const { t } = useLanguage();
  const hintId = useId();
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        aria-describedby={hintId}
        className="text-foreground inline-flex w-fit items-center gap-1.5 rounded-lg border border-violet-500 bg-violet-500/10 px-2 py-1 text-sm font-medium"
      >
        <span aria-hidden="true" className="w-4 text-center font-bold">
          ✦
        </span>
        <span>{t('contentUpload.ki.badge')}</span>
      </span>
      <span id={hintId} className="text-muted text-xs">
        {t('contentUpload.ki.badgeHint')}
      </span>
    </span>
  );
}
