'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
} from '@/components/admin/content-upload/styles';

type Props = {
  selectedCount: number;
  /** What "accept all safe ones" would take. */
  acceptableHigh: number;
  /** Decisions cannot be written now (the run is not in review, or a call is running). */
  disabled: boolean;
  onAcceptHigh: () => void;
  onReject: () => void;
  onDefer: () => void;
  onAssign: () => void;
  onNewest: () => void;
  onClearSelection: () => void;
};

/**
 * The mass actions of the review list. Each one opens a dialog first that names
 * the number of files it concerns (docs/ki-upload-konzept.md 7.2). "Accept all
 * safe ones" takes the band high only, files without a decision and no version of
 * another file.
 */
export function BulkBar({
  selectedCount,
  acceptableHigh,
  disabled,
  onAcceptHigh,
  onReject,
  onDefer,
  onAssign,
  onNewest,
  onClearSelection,
}: Props) {
  const { t } = useLanguage();
  const none = selectedCount === 0;
  return (
    <section
      aria-label={t('contentUpload.bulk.title')}
      className="border-border flex flex-wrap items-center gap-3 rounded-2xl border p-3"
    >
      <button
        type="button"
        onClick={onAcceptHigh}
        disabled={disabled || acceptableHigh === 0}
        className={BTN_PRIMARY}
      >
        {t('contentUpload.bulk.acceptHigh', { count: acceptableHigh })}
      </button>
      <button
        type="button"
        onClick={onNewest}
        disabled={disabled}
        className={BTN_SECONDARY}
      >
        {t('contentUpload.bulk.newest')}
      </button>
      <span
        className="bg-border mx-1 hidden h-8 w-px sm:block"
        aria-hidden="true"
      />
      <span aria-live="polite" className="text-foreground text-sm font-medium">
        {t('contentUpload.bulk.selected', { count: selectedCount })}
      </span>
      <button
        type="button"
        onClick={onAssign}
        disabled={disabled || none}
        className={BTN_SECONDARY}
      >
        {t('contentUpload.bulk.assign')}
      </button>
      <button
        type="button"
        onClick={onReject}
        disabled={disabled || none}
        className={BTN_SECONDARY}
      >
        {t('contentUpload.bulk.reject')}
      </button>
      <button
        type="button"
        onClick={onDefer}
        disabled={disabled || none}
        className={BTN_SECONDARY}
      >
        {t('contentUpload.bulk.defer')}
      </button>
      {!none && (
        <button
          type="button"
          onClick={onClearSelection}
          className={BTN_SECONDARY}
        >
          {t('contentUpload.bulk.clear')}
        </button>
      )}
    </section>
  );
}
