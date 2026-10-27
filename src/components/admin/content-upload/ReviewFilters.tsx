'use client';

import { useEffect, useId, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  BAND_FILTERS,
  STATUS_FILTERS,
  type ReviewCounts,
  type ReviewFacets,
  type ReviewFilter,
  type StatusFilter,
} from '@/lib/content-upload/review/types';
import type { ProposalBand } from '@/lib/content-upload/classify/types';
import {
  BAND_SYMBOL,
  typeLabel,
} from '@/components/admin/content-upload/labels';
import {
  BTN_SMALL,
  LABEL,
  SELECT_SMALL,
} from '@/components/admin/content-upload/styles';

const SEARCH_DELAY_MS = 300;

type Props = {
  filter: ReviewFilter;
  counts: ReviewCounts;
  facets: ReviewFacets;
  onChange: (next: ReviewFilter) => void;
};

/** Does the filter hold anything? (a page and a sort order are no filter) */
export function hasActiveFilter(filter: ReviewFilter): boolean {
  return Boolean(
    filter.band ||
    filter.docType ||
    filter.component ||
    (filter.status && filter.status !== 'all') ||
    filter.duplicates ||
    filter.query?.trim()
  );
}

/**
 * The counts of the whole run as buttons that set a filter (the band, the
 * duplicates, the problems), then the filters themselves. The counts never change
 * with the filter: they always describe the whole run.
 */
export function ReviewFilters({ filter, counts, facets, onChange }: Props) {
  const { t } = useLanguage();
  const id = useId();
  const [query, setQuery] = useState(filter.query ?? '');

  // the search waits for a pause in typing
  useEffect(() => {
    if ((filter.query ?? '') === query) return;
    const timer = setTimeout(
      () => onChange({ ...filter, query: query || undefined, page: 1 }),
      SEARCH_DELAY_MS
    );
    return () => clearTimeout(timer);
  }, [query, filter, onChange]);
  // a reset from outside empties the field
  useEffect(() => {
    setQuery(filter.query ?? '');
  }, [filter.query]);

  const set = (patch: Partial<ReviewFilter>) =>
    onChange({ ...filter, ...patch, page: 1 });

  const chip = (
    key: string,
    label: string,
    count: number,
    pressed: boolean,
    onClick: () => void,
    symbol?: string
  ) => (
    <button
      key={key}
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`${BTN_SMALL} ${pressed ? '!border-red-700 !bg-red-700/15' : ''}`}
    >
      {symbol && <span aria-hidden="true">{symbol}</span>}
      <span>{label}</span>
      <span className="font-bold">{count}</span>
    </button>
  );

  const toggleBand = (band: ProposalBand) =>
    set({ band: filter.band === band ? undefined : band });

  return (
    <section
      aria-label={t('contentUpload.filters.title')}
      className="space-y-3"
    >
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={t('contentUpload.filters.summary')}
      >
        {BAND_FILTERS.map(band =>
          chip(
            band,
            t(`contentUpload.band.${band}`),
            counts[band],
            filter.band === band,
            () => toggleBand(band),
            BAND_SYMBOL[band]
          )
        )}
        {chip(
          'duplicates',
          t('contentUpload.filters.duplicates'),
          counts.duplicates,
          filter.duplicates === true,
          () => set({ duplicates: filter.duplicates ? undefined : true })
        )}
        {chip(
          'problems',
          t('contentUpload.filters.problems'),
          counts.problems,
          filter.status === 'problems',
          () =>
            set({
              status: filter.status === 'problems' ? undefined : 'problems',
            })
        )}
      </div>

      <div role="search" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`${id}-status`} className={LABEL}>
            {t('contentUpload.filters.status')}
          </label>
          <select
            id={`${id}-status`}
            value={filter.status ?? 'all'}
            onChange={e =>
              set({
                status:
                  e.target.value === 'all'
                    ? undefined
                    : (e.target.value as StatusFilter),
              })
            }
            className={SELECT_SMALL}
          >
            {STATUS_FILTERS.map(status => (
              <option key={status} value={status}>
                {t(`contentUpload.filters.status.${status}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-type`} className={LABEL}>
            {t('contentUpload.field.type')}
          </label>
          <select
            id={`${id}-type`}
            value={filter.docType ?? ''}
            onChange={e => set({ docType: e.target.value || undefined })}
            className={SELECT_SMALL}
          >
            <option value="">{t('contentUpload.filters.all')}</option>
            {facets.docTypes.map(type => (
              <option key={type} value={type}>
                {typeLabel(t, type)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-component`} className={LABEL}>
            {t('contentUpload.field.component')}
          </label>
          <select
            id={`${id}-component`}
            value={filter.component ?? ''}
            onChange={e => set({ component: e.target.value || undefined })}
            className={SELECT_SMALL}
          >
            <option value="">{t('contentUpload.filters.all')}</option>
            {facets.components.map(code => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-search`} className={LABEL}>
            {t('contentUpload.filters.search')}
          </label>
          <input
            id={`${id}-search`}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            maxLength={100}
            placeholder={t('contentUpload.filters.searchPlaceholder')}
            className={`${SELECT_SMALL} w-56`}
          />
        </div>
        {hasActiveFilter(filter) && (
          <button
            type="button"
            className={BTN_SMALL}
            onClick={() => {
              setQuery('');
              onChange({
                sort: filter.sort,
                pageSize: filter.pageSize,
                page: 1,
              });
            }}
          >
            {t('contentUpload.filters.reset')}
          </button>
        )}
      </div>
    </section>
  );
}
