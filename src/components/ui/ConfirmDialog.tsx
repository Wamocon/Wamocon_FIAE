'use client';

import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';

type Props = {
  /** The question, for example "Prüfung wirklich löschen?". */
  message: ReactNode;
  /** Label of the confirming button (default: "Löschen"). */
  confirmLabel?: string;
  /** A destructive action is red and starts with the focus on "Abbrechen". */
  destructive?: boolean;
  /** The action is running: the dialog stays open and the buttons wait. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The one confirmation of the platform, in its design instead of the dialog of
 * the browser. Escape and a click next to the dialog cancel, the focus starts
 * on "Abbrechen", so a stray Enter does not delete anything. It sits in a
 * portal under the body, so a transform of the page cannot shift it.
 */
export function ConfirmDialog({
  message,
  confirmLabel,
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useLanguage();
  const messageId = useId();
  useEscapeKey(onCancel, !busy);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-describedby={messageId}
        className="bg-card border-border w-full max-w-sm overflow-hidden rounded-2xl border p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          {destructive && (
            <div className="bg-destructive/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full">
              <AlertTriangle
                className="text-destructive h-5 w-5"
                aria-hidden="true"
              />
            </div>
          )}
          <p id={messageId} className="text-foreground pt-1.5 text-sm">
            {message}
          </p>
        </div>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            disabled={busy}
            className="glass-effect text-foreground flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition disabled:opacity-50 ${
              destructive ? 'bg-destructive' : 'bg-accent'
            }`}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              destructive && <Trash2 className="h-4 w-4" aria-hidden="true" />
            )}
            {confirmLabel ?? t('common.delete')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
