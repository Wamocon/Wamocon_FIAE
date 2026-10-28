'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import {
  MAX_ORIGINALS,
  originalCandidates,
  toggleOriginal,
} from '@/lib/content-upload/review/originals';
import type { ReviewRowDto } from '@/lib/content-upload/review/types';
import { BTN_SMALL, CARD } from '@/components/admin/content-upload/styles';

type Props = {
  /** The rows of the page that is shown. */
  rows: readonly ReviewRowDto[];
  /** The ids that are marked (they stay marked while the person pages through the list). */
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  disabled?: boolean;
};

/**
 * "Originale für die Azubis bereitstellen": the person marks the original PDFs of enabler texts
 * that go with the next transfer to the document bucket and appear in the reader of the trainees
 * after the activation. Only accepted PDF originals are offered, at most 25. The transfer checks
 * every file again.
 */
export function OriginalsPicker({
  rows,
  selected,
  onChange,
  disabled = false,
}: Props) {
  const { t } = useLanguage();
  const candidates = originalCandidates(rows);
  if (candidates.length === 0 && selected.size === 0) return null;
  const full = selected.size >= MAX_ORIGINALS;
  return (
    <fieldset className={CARD} aria-describedby="originals-hint">
      <legend className="text-foreground px-2 text-lg font-semibold">
        {t('contentUpload.originals.title')}
      </legend>
      <p id="originals-hint" className="text-foreground mb-3 text-sm">
        {t('contentUpload.originals.hint', { max: MAX_ORIGINALS })}
      </p>
      <p className="text-foreground mb-3 text-sm font-medium" role="status">
        {t('contentUpload.originals.count', {
          count: selected.size,
          max: MAX_ORIGINALS,
        })}
      </p>
      {full && (
        <p className="text-foreground mb-3 text-sm">
          {t('contentUpload.originals.limit', { max: MAX_ORIGINALS })}
        </p>
      )}
      {selected.size > 0 && (
        <button
          type="button"
          className={`${BTN_SMALL} mb-3`}
          disabled={disabled}
          onClick={() => onChange(new Set())}
        >
          {t('contentUpload.originals.clear')}
        </button>
      )}
      <ul className="space-y-1">
        {candidates.map(row => {
          const checked = selected.has(row.id);
          return (
            <li key={row.id}>
              <label className="text-foreground flex min-h-[32px] items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={checked}
                  disabled={disabled || (!checked && full)}
                  onChange={event =>
                    onChange(
                      toggleOriginal(selected, row.id, event.target.checked)
                    )
                  }
                />
                <span>
                  {row.fileName}{' '}
                  <span className="text-muted-foreground">
                    ({row.effective.enablerCode})
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
