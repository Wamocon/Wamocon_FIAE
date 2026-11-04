'use client';

/**
 * Bar of the UI tools of the HAI: "Die HAI hat N Felder ausgefüllt, bitte
 * prüfen" with the buttons "Rückgängig" and "Schließen". In a spoken turn the
 * bar shows what the HAI would enter and waits for "Eintragen" or "Verwerfen".
 *
 * The bar sits outside the chat panel (the panel can be closed or docked) and
 * carries `data-hai-ignore`, so the page context never reads it. It writes
 * nothing: saving the form is the job of the person.
 */

import React, { useSyncExternalStore } from 'react';
import { Check, Sparkles, Undo2, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  confirmPendingUiAction,
  discardPendingUiAction,
  dismissUiBar,
  getUiBarState,
  subscribeUiBar,
  undoUiAction,
} from './uiActionExecutor';

export function HaiUiActionBar() {
  const { t } = useLanguage();
  const state = useSyncExternalStore(subscribeUiBar, getUiBarState, () => null);
  if (!state) return null;

  const base =
    'fixed bottom-4 left-1/2 z-[60] w-[min(92vw,34rem)] -translate-x-1/2 rounded-xl border border-violet-500/40 bg-card p-3 text-sm text-foreground shadow-lg';

  if (state.kind === 'pending') {
    return (
      <div
        role="group"
        aria-label={t('hai.uiAction.bar.title')}
        data-testid="hai-ui-action-bar"
        data-status="pending"
        data-hai-ignore=""
        className={base}
      >
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-violet-500 uppercase">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {t('hai.uiAction.bar.title')}
        </div>
        <p className="mt-2">{t('hai.uiAction.bar.pending')}</p>
        <ul className="mt-1 space-y-1 text-xs">
          {state.preview.map(item => (
            <li key={item.label}>
              <span className="font-medium">{item.label}:</span>{' '}
              <span className="text-muted-foreground break-words whitespace-pre-line">
                {item.value}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => confirmPendingUiAction()}
            className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
          >
            <Check className="h-3 w-3" aria-hidden="true" />
            {t('hai.uiAction.bar.confirm')}
          </button>
          <button
            type="button"
            onClick={() => discardPendingUiAction()}
            className="border-border hover:bg-muted inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium"
          >
            {t('hai.uiAction.bar.discard')}
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === 'notice') {
    return (
      <div
        role="status"
        data-testid="hai-ui-action-bar"
        data-status="notice"
        data-hai-ignore=""
        className={base}
      >
        <div className="flex items-start justify-between gap-2">
          <p>{t(state.key)}</p>
          <button
            type="button"
            onClick={() => dismissUiBar()}
            aria-label={t('hai.uiAction.bar.close')}
            className="hover:bg-muted rounded p-1"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  const text = state.undone
    ? t('hai.uiAction.bar.undone')
    : (state.count === 1
        ? t('hai.uiAction.bar.appliedOne')
        : t('hai.uiAction.bar.appliedMany').replace(
            '{count}',
            String(state.count)
          )) +
      (state.skipped > 0
        ? ` ${t('hai.uiAction.bar.skipped').replace('{count}', String(state.skipped))}`
        : '');

  return (
    <div
      role="status"
      data-testid="hai-ui-action-bar"
      data-status={state.undone ? 'undone' : 'applied'}
      data-hai-ignore=""
      className={base}
    >
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-violet-500 uppercase">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        {t('hai.uiAction.bar.title')}
      </div>
      <p className="mt-2">{text}</p>
      {!state.undone && (
        <p className="text-muted-foreground mt-1 text-xs">
          {state.labels.join(', ')}
        </p>
      )}
      {state.undone && state.kept > 0 && (
        <p className="text-muted-foreground mt-1 text-xs">
          {t('hai.uiAction.bar.kept').replace('{count}', String(state.kept))}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {!state.undone && (
          <button
            type="button"
            onClick={() => undoUiAction()}
            className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
          >
            <Undo2 className="h-3 w-3" aria-hidden="true" />
            {t('hai.uiAction.bar.undo')}
          </button>
        )}
        <button
          type="button"
          onClick={() => dismissUiBar()}
          className="border-border hover:bg-muted inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium"
        >
          {t('hai.uiAction.bar.close')}
        </button>
      </div>
    </div>
  );
}
