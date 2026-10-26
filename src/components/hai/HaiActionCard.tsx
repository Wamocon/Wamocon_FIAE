'use client';

/**
 * HAI action confirmation card
 *
 * HAI never executes a write by itself. When it proposes one, this card shows
 * what would happen and waits. Only "Confirm" sends the explicit call to
 * /api/hai/action (done by the provider), "Cancel" drops the proposal.
 */

import React from 'react';
import { Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { HaiPendingAction } from './HaiProvider';

interface HaiActionCardProps {
  action: HaiPendingAction;
  onConfirm: () => void;
  onCancel: () => void;
}

export function HaiActionCard({
  action,
  onConfirm,
  onCancel,
}: HaiActionCardProps) {
  const { t } = useLanguage();
  const { status } = action;
  const isOpen = status === 'pending';

  return (
    <div
      role="group"
      aria-label={t('hai.action.card.title')}
      data-testid="hai-action-card"
      data-status={status}
      className="mt-2 w-full rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm text-gray-200"
    >
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-cyan-400 uppercase">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        {t('hai.action.card.title')}
      </div>

      <p className="mt-2 font-medium text-white">{action.description}</p>

      {isOpen && (
        <>
          <p className="mt-1 text-xs text-gray-400">
            {t('hai.action.card.hint')}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              {t('hai.action.card.confirm')}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              {t('hai.action.card.cancel')}
            </button>
          </div>
        </>
      )}

      {status === 'running' && (
        <p
          role="status"
          className="mt-3 inline-flex items-center gap-2 text-xs text-gray-300"
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          {t('hai.action.card.running')}
        </p>
      )}

      {status === 'done' && (
        <div role="status" className="mt-3 text-xs text-emerald-400">
          <p className="font-semibold">{t('hai.action.card.done')}</p>
          {action.resultMessage && (
            <p className="mt-1 whitespace-pre-line text-gray-300">
              {action.resultMessage.replace(/\*\*/g, '')}
            </p>
          )}
        </div>
      )}

      {status === 'cancelled' && (
        <p role="status" className="mt-3 text-xs text-gray-400">
          {t('hai.action.card.cancelled')}
        </p>
      )}

      {status === 'error' && (
        <p role="alert" className="mt-3 text-xs text-red-400">
          {t(`hai.action.card.error.${action.errorKey ?? 'generic'}`)}
        </p>
      )}
    </div>
  );
}
