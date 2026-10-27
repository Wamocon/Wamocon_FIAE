'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import type { ProposalBand } from '@/lib/content-upload/classify/types';
import {
  BAND_SYMBOL,
  bandLabel,
} from '@/components/admin/content-upload/labels';

const STYLE: Record<ProposalBand, string> = {
  high: 'border-green-600 bg-green-600/10',
  medium: 'border-amber-500 bg-amber-500/10',
  low: 'border-orange-500 bg-orange-500/10',
  conflict: 'border-red-500 bg-red-500/10',
};

/**
 * The confidence band of a proposal as a word with a symbol, never colour alone
 * (the text keeps the colour of the page, so the contrast is the one of the page).
 */
export function BandBadge({
  band,
  confidence,
}: {
  band: ProposalBand;
  confidence?: number;
}) {
  const { t } = useLanguage();
  return (
    <span
      className={`text-foreground inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-sm font-medium ${STYLE[band]}`}
    >
      <span aria-hidden="true" className="w-4 text-center font-bold">
        {BAND_SYMBOL[band]}
      </span>
      <span>{bandLabel(t, band)}</span>
      {confidence !== undefined && (
        <span className="text-muted text-xs font-normal">
          ({Math.round(confidence * 100)} %)
        </span>
      )}
    </span>
  );
}
