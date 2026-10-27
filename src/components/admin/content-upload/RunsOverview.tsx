'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/contexts/LanguageContext';
import { UploadApiError } from '@/lib/content-upload/staging/client';
import {
  createReviewClient,
  type ReviewClient,
} from '@/lib/content-upload/review/client';
import type { RunOverviewItem } from '@/lib/content-upload/review/service';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  formatDate,
  runStatusLabel,
} from '@/components/admin/content-upload/labels';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  NOTICE_ERROR,
  NOTICE_INFO,
} from '@/components/admin/content-upload/styles';

const BASE = '/trainer/admin/content-upload';

type Props = {
  /** Replaced in the tests. */
  client?: ReviewClient;
};

type Load =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; runs: RunOverviewItem[] };

/** Screen 1 of the concept: the runs of the content upload. */
export function RunsOverview({ client: injected }: Props) {
  const { t, language } = useLanguage();
  const client = useMemo(() => injected ?? createReviewClient(), [injected]);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      setLoad({ kind: 'loading' });
      try {
        const { runs } = await client.overview(signal);
        if (!signal?.aborted) setLoad({ kind: 'ready', runs });
      } catch (error) {
        if (signal?.aborted) return;
        setLoad(
          error instanceof UploadApiError && error.status === 404
            ? { kind: 'unavailable' }
            : { kind: 'error' }
        );
      }
    },
    [client]
  );

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-foreground text-3xl font-bold">
            {t('contentUpload.title')}
          </h1>
          <p className="text-muted mt-1">{t('contentUpload.subtitle')}</p>
        </div>
        {load.kind !== 'unavailable' && (
          <Link href={`${BASE}/new`} className={BTN_PRIMARY}>
            {t('contentUpload.newRun')}
          </Link>
        )}
      </header>

      {load.kind === 'loading' && (
        <div className="flex items-center gap-3 py-10" aria-live="polite">
          <LoadingSpinner size="sm" />
          <span className="text-foreground">{t('contentUpload.loading')}</span>
        </div>
      )}

      {load.kind === 'unavailable' && (
        <p role="alert" className={NOTICE_INFO}>
          {t('contentUpload.unavailable')}
        </p>
      )}

      {load.kind === 'error' && (
        <div role="alert" className={NOTICE_ERROR}>
          <p>{t('contentUpload.loadError')}</p>
          <button
            type="button"
            className={`${BTN_SECONDARY} mt-3`}
            onClick={() => void reload()}
          >
            {t('contentUpload.retry')}
          </button>
        </div>
      )}

      {load.kind === 'ready' && load.runs.length === 0 && (
        <p className="text-foreground border-border rounded-2xl border p-8 text-center">
          {t('contentUpload.runs.empty')}
        </p>
      )}

      {load.kind === 'ready' && load.runs.length > 0 && (
        <div className="border-border overflow-x-auto rounded-2xl border">
          <table className="text-foreground w-full text-left text-sm">
            <caption className="sr-only">
              {t('contentUpload.runs.caption')}
            </caption>
            <thead>
              <tr className="border-border border-b">
                {[
                  'label',
                  'catalog',
                  'status',
                  'files',
                  'createdBy',
                  'date',
                ].map(col => (
                  <th key={col} scope="col" className="px-4 py-3 font-semibold">
                    {t(`contentUpload.col.${col}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {load.runs.map(run => (
                <tr
                  key={run.id}
                  className="border-border border-b last:border-0"
                >
                  <th scope="row" className="px-4 py-3 font-medium">
                    <Link
                      href={`${BASE}/${run.id}`}
                      className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                    >
                      {run.label}
                    </Link>
                  </th>
                  <td className="px-4 py-3">
                    {t('contentUpload.catalogName')}
                  </td>
                  <td className="px-4 py-3">{runStatusLabel(t, run.status)}</td>
                  <td className="px-4 py-3">
                    {run.fileCount}
                    {run.decidedCount > 0 && (
                      <span className="text-muted">
                        {' '}
                        (
                        {t('contentUpload.runs.decided', {
                          count: run.decidedCount,
                        })}
                        )
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{run.createdByName ?? '-'}</td>
                  <td className="px-4 py-3">
                    {formatDate(run.createdAt, language)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
