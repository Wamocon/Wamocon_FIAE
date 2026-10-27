'use client';

import { useId, type ReactNode } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Modal } from '@/components/admin/content-upload/Modal';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
} from '@/components/admin/content-upload/styles';

type Props = {
  title: string;
  /** The text that says what happens and to how many files. */
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Every mass action asks first and names the number of files it concerns. The
 * focus starts on "Abbrechen", so a stray Enter does not confirm.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useLanguage();
  const titleId = useId();
  const descriptionId = useId();
  return (
    <Modal titleId={titleId} descriptionId={descriptionId} onClose={onCancel}>
      <h2 id={titleId} className="text-foreground text-xl font-bold">
        {title}
      </h2>
      <div id={descriptionId} className="text-foreground mt-3 text-sm">
        {children}
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          data-initial-focus
          onClick={onCancel}
          className={BTN_SECONDARY}
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={BTN_PRIMARY}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
