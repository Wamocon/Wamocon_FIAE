'use client';

/**
 * HAI navigation card
 *
 * HAI offers a page, it never changes the page by itself in the text chat. The
 * card shows where it goes and why, the button "Open" (a tap, or Enter on the
 * focused button) takes the person there. Nothing is written by this card.
 */

import React from 'react';
import { ArrowRight, Compass } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { HaiNavigationOffer } from './HaiProvider';

interface HaiNavigationCardProps {
  offer: HaiNavigationOffer;
  onOpen: () => void;
}

export function HaiNavigationCard({ offer, onOpen }: HaiNavigationCardProps) {
  const { t } = useLanguage();
  const opened = offer.status === 'opened';

  return (
    <div
      role="group"
      aria-label={t('hai.navigation.card.title')}
      data-testid="hai-navigation-card"
      data-status={offer.status}
      className="mt-2 w-full rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm text-gray-200"
    >
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-cyan-400 uppercase">
        <Compass className="h-4 w-4" aria-hidden="true" />
        {t('hai.navigation.card.title')}
      </div>

      <p className="mt-2 font-medium text-white">{offer.label}</p>
      <p className="mt-1 text-xs text-gray-400">{offer.reason}</p>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${t('hai.navigation.card.open')}: ${offer.label}`}
          className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
        >
          {t('hai.navigation.card.open')}
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </button>
        {opened && (
          <p role="status" className="text-xs text-emerald-400">
            {t('hai.navigation.card.opened')}
          </p>
        )}
      </div>
    </div>
  );
}
