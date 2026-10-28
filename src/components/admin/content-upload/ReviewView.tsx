'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  UploadApiError,
  createUploadClient,
} from '@/lib/content-upload/staging/client';
import {
  createReviewClient,
  type ReviewClient,
  type ReviewListResponse,
} from '@/lib/content-upload/review/client';
import type { DecisionOutcome } from '@/lib/content-upload/review/decisions';
import {
  DEFAULT_PAGE_SIZE,
  type AssignmentDto,
  type DecisionAction,
  type ReviewFilter,
  type ReviewOptions,
  type ReviewRowDto,
} from '@/lib/content-upload/review/types';
import { DECIDABLE } from '@/lib/content-upload/review/states';
import { DISABLED_MESSAGE } from '@/lib/content-upload/staging/config';
import type {
  AssignmentInput,
  DecisionCommandInput,
} from '@/lib/content-upload/review/validate';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { AssignDialog } from '@/components/admin/content-upload/AssignDialog';
import { BulkBar } from '@/components/admin/content-upload/BulkBar';
import { ConfirmDialog } from '@/components/admin/content-upload/ConfirmDialog';
import { OriginalsPicker } from '@/components/admin/content-upload/OriginalsPicker';
import { DuplicateDialog } from '@/components/admin/content-upload/DuplicateDialog';
import { ProcessingPanel } from '@/components/admin/content-upload/ProcessingPanel';
import {
  ReviewFilters,
  hasActiveFilter,
} from '@/components/admin/content-upload/ReviewFilters';
import {
  ReviewTable,
  canAcceptAsProposed,
} from '@/components/admin/content-upload/ReviewTable';
import { RunUploader } from '@/components/admin/content-upload/RunUploader';
import {
  runStatusLabel,
  skipLabel,
} from '@/components/admin/content-upload/labels';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SMALL,
  CARD,
  NOTICE_ERROR,
  NOTICE_INFO,
  NOTICE_WARN,
  SELECT_SMALL,
} from '@/components/admin/content-upload/styles';

const BASE = '/trainer/admin/content-upload';

type Props = {
  runId: string;
  /** Replaced in the tests. */
  client?: ReviewClient;
  uploadClient?: ReturnType<typeof createUploadClient>;
};

type Load = 'loading' | 'error' | 'unavailable' | 'notfound' | 'ready';

type Notice = { kind: 'info' | 'warn' | 'error'; text: string };

type Dialog =
  | null
  | { kind: 'acceptHigh' }
  | { kind: 'bulk'; action: 'reject' | 'defer' }
  | { kind: 'assign' }
  | { kind: 'newest'; groups: number }
  | { kind: 'duplicate'; key: string }
  | { kind: 'discard' }
  | { kind: 'reopen' };

const STATE_TEXT_STATUSES = ['applying', 'applied', 'failed', 'discarded'];

/** What the answer of a decision call says about the files that were skipped. */
function skippedSummary(
  t: ReturnType<typeof useLanguage>['t'],
  skipped: DecisionOutcome['skipped']
): string {
  const counts = new Map<string, number>();
  for (const s of skipped) counts.set(s.code, (counts.get(s.code) ?? 0) + 1);
  return [...counts.entries()]
    .map(([code, n]) => `${n} × ${skipLabel(t, code)}`)
    .join('; ');
}

/**
 * Screen 3 of the concept: the review list of one run. It shows the files with
 * the proposal, the band and the decision, filters and pages them, takes the
 * decisions one by one and by mass action, opens the duplicate view and shows the
 * progress of the queue while the run is processed. Only metadata, the proposed
 * assignment and the reasons are shown, never the text of a document or a part of a
 * solution. The server checks the right and the state of the run on every call.
 */
export function ReviewView({
  runId,
  client: injected,
  uploadClient: injectedUpload,
}: Props) {
  const { t } = useLanguage();
  const router = useRouter();
  const client = useMemo(() => injected ?? createReviewClient(), [injected]);
  const uploadClient = useMemo(
    () => injectedUpload ?? createUploadClient(),
    [injectedUpload]
  );

  const [filter, setFilter] = useState<ReviewFilter>({});
  const [data, setData] = useState<ReviewListResponse | null>(null);
  const [load, setLoad] = useState<Load>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const [options, setOptions] = useState<ReviewOptions | null>(null);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [optionsTick, setOptionsTick] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // ids of the original PDFs that go with the transfer (publishOriginals of the dry run and the
  // apply, at most 25). It stays while the person pages through the list.
  const [originals, setOriginals] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusEditorOf, setFocusEditorOf] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const reload = useCallback(() => setTick(n => n + 1), []);

  // A change of the filter, the sort or the size of a page drops the selection: it
  // would otherwise hold files that are no longer on the page and that a mass
  // action would reach unseen. Paging alone keeps it.
  const applyFilter = (next: ReviewFilter) => {
    const strip = (f: ReviewFilter) => JSON.stringify({ ...f, page: undefined });
    if (strip(next) !== strip(filter)) setSelected(new Set());
    setFilter(next);
  };

  // the editor takes the focus once, not at every later render of the row
  useEffect(() => {
    if (focusEditorOf === null) return;
    const timer = setTimeout(() => setFocusEditorOf(null), 150);
    return () => clearTimeout(timer);
  }, [focusEditorOf]);

  // the list: on the first call, with every change of the filter and after a write
  useEffect(() => {
    const controller = new AbortController();
    setRefreshing(true);
    client
      .review(runId, filter, controller.signal)
      .then(answer => {
        if (controller.signal.aborted) return;
        setData(answer);
        setLoad('ready');
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        if (error instanceof UploadApiError && error.status === 404) {
          setLoad(
            error.message === DISABLED_MESSAGE
              ? 'unavailable'
              : 'notfound'
          );
        } else {
          setLoad('error');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRefreshing(false);
      });
    return () => controller.abort();
  }, [client, runId, filter, tick]);

  // the values of the selects: when the list is there, and again when the state of
  // the run changes (the plan of the folder tree grows while files are processed)
  const runStatus = data?.run.status ?? null;
  useEffect(() => {
    if (runStatus === null) return;
    const controller = new AbortController();
    client
      .options(runId, controller.signal)
      .then(answer => {
        setOptions(answer);
        setOptionsFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setOptionsFailed(true);
      });
    return () => controller.abort();
  }, [client, runId, runStatus, optionsTick]);

  const decidable = data?.run.status === 'review';
  const decidableIds = useMemo(
    () =>
      (data?.rows ?? [])
        .filter(r => decidable && DECIDABLE.includes(r.status))
        .map(r => r.id),
    [data, decidable]
  );

  // ---- writing decisions ---------------------------------------------------

  const send = useCallback(
    async (
      command: DecisionCommandInput,
      options: { clearSelection?: boolean } = {}
    ) => {
      if (!data) return;
      setBusy(true);
      setNotice(null);
      try {
        const outcome = await client.decide(runId, data.version, command);
        // the next decision starts from the version that was just written, also
        // before the list has been read again
        setData(d => (d ? { ...d, version: outcome.version } : d));
        const skipped = outcome.skipped.length;
        if (skipped > 0) {
          setNotice({
            kind: outcome.written > 0 ? 'warn' : 'error',
            text: `${t('contentUpload.notice.saved', {
              written: outcome.written,
              skipped,
            })} ${skippedSummary(t, outcome.skipped)}`,
          });
        } else {
          setNotice({
            kind: 'info',
            text: t('contentUpload.notice.savedAll', {
              written: outcome.written,
            }),
          });
        }
        if (options.clearSelection) setSelected(new Set());
      } catch (error) {
        if (error instanceof UploadApiError && error.status === 409) {
          setNotice({
            kind: 'error',
            text:
              error.code === 'RUN_STATE'
                ? t('contentUpload.notice.runState')
                : t('contentUpload.notice.conflict'),
          });
        } else if (error instanceof UploadApiError && error.status === 429) {
          setNotice({
            kind: 'error',
            text: t('contentUpload.notice.rateLimited'),
          });
        } else {
          setNotice({ kind: 'error', text: t('contentUpload.notice.error') });
        }
      } finally {
        setBusy(false);
        setDialog(null);
        reload();
      }
    },
    [client, data, reload, runId, t]
  );

  const onDecide = (row: ReviewRowDto, action: DecisionAction) => {
    if (action === 'accept') {
      if (row.duplicate) {
        setDialog({ kind: 'duplicate', key: row.duplicate.key });
        return;
      }
      if (!canAcceptAsProposed(row)) {
        // an unclear proposal is never taken as it stands: the editor opens
        setExpanded(s => new Set(s).add(row.id));
        setFocusEditorOf(row.id);
        setNotice({
          kind: 'info',
          text: t('contentUpload.notice.assignFirst', { name: row.fileName }),
        });
        return;
      }
    }
    void send({
      command: 'set',
      items: [{ fileId: row.id, action, assignment: null, note: null }],
    });
  };

  const onSaveAssignment = (row: ReviewRowDto, a: AssignmentDto) => {
    const assignment: AssignmentInput = {
      docType: a.docType,
      componentCode: a.componentCode,
      enablerCode: a.enablerCode,
      quizLevel: a.quizLevel,
    };
    void send({
      command: 'set',
      items: [{ fileId: row.id, action: 'accept', assignment, note: null }],
    });
  };

  const openNewest = async () => {
    setNotice(null);
    try {
      const { groups } = await client.duplicates(runId);
      const usable = groups.filter(
        g => !g.resolved && g.suggestedId && !g.ambiguous
      ).length;
      if (usable === 0) {
        setNotice({
          kind: 'info',
          text: t('contentUpload.notice.noSuggestion'),
        });
        return;
      }
      setDialog({ kind: 'newest', groups: usable });
    } catch {
      setNotice({ kind: 'error', text: t('contentUpload.notice.error') });
    }
  };

  const reopen = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await client.reopen(runId);
      setNotice({ kind: 'info', text: t('contentUpload.notice.reopened') });
    } catch (error) {
      setNotice({
        kind: 'error',
        text:
          error instanceof UploadApiError && error.code === 'RUN_STATE'
            ? t('contentUpload.notice.reopenState')
            : t('contentUpload.notice.error'),
      });
    } finally {
      setBusy(false);
      setDialog(null);
      reload();
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      await uploadClient.discardRun(runId);
      router.push(BASE);
    } catch {
      setBusy(false);
      setDialog(null);
      setNotice({ kind: 'error', text: t('contentUpload.notice.error') });
    }
  };

  // ---- selection and expansion --------------------------------------------

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };
  const onToggleAll = (on: boolean) =>
    setSelected(prev => {
      const next = new Set(prev);
      for (const id of decidableIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  // ---- render --------------------------------------------------------------

  if (load === 'loading' || (load === 'ready' && !data)) {
    return (
      <div className="flex items-center gap-3 p-10" aria-live="polite">
        <LoadingSpinner size="sm" />
        <span className="text-foreground">{t('contentUpload.loading')}</span>
      </div>
    );
  }
  if (load === 'error' && !data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <div role="alert" className={NOTICE_ERROR}>
          <p>{t('contentUpload.loadError')}</p>
          <button
            type="button"
            className={`${BTN_SECONDARY} mt-3`}
            onClick={() => {
              setLoad('loading');
              reload();
            }}
          >
            {t('contentUpload.retry')}
          </button>
        </div>
        <Link href={BASE} className="text-muted text-sm underline">
          {t('contentUpload.backToRuns')}
        </Link>
      </div>
    );
  }
  if (load === 'unavailable' || load === 'notfound' || !data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <p role="alert" className={NOTICE_INFO}>
          {load === 'notfound'
            ? t('contentUpload.review.notFound')
            : t('contentUpload.unavailable')}
        </p>
        <Link href={BASE} className="text-muted text-sm underline">
          {t('contentUpload.backToRuns')}
        </Link>
      </div>
    );
  }

  const { run, counts, facets } = data;
  const status = run.status;
  const filtered = hasActiveFilter(filter);
  const sort = filter.sort ?? 'path';
  const pageSize = filter.pageSize ?? data.pageSize ?? DEFAULT_PAGE_SIZE;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {data.counts.total > 0 && (
        <a
          href="#review-list"
          className="sr-only rounded bg-white px-3 py-2 text-black focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50"
        >
          {t('contentUpload.review.skipLink')}
        </a>
      )}
      <nav aria-label={t('contentUpload.breadcrumb')}>
        <Link href={BASE} className="text-muted text-sm underline">
          {t('contentUpload.backToRuns')}
        </Link>
      </nav>

      <header className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-foreground text-3xl font-bold">{run.label}</h1>
            <p className="text-muted mt-1 text-sm">
              {t('contentUpload.catalogName')} · {runStatusLabel(t, status)} ·{' '}
              {t('contentUpload.review.files', { count: counts.total })}
              {counts.accepted + counts.rejected + counts.deferred > 0 &&
                ` · ${t('contentUpload.review.decided', {
                  accepted: counts.accepted,
                  rejected: counts.rejected,
                  deferred: counts.deferred,
                })}`}
            </p>
            <p className="text-muted mt-1 text-sm">
              {t('contentUpload.review.protected')}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {(status === 'applied' || status === 'failed') && (
              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={() => setDialog({ kind: 'reopen' })}
              >
                {t('contentUpload.review.reopen')}
              </button>
            )}
            {status !== 'discarded' && status !== 'applying' && (
              <button
                type="button"
                className={BTN_SECONDARY}
                onClick={() => setDialog({ kind: 'discard' })}
              >
                {t('contentUpload.review.discard')}
              </button>
            )}
          </div>
        </div>
      </header>

      {optionsFailed && (
        <div className={NOTICE_WARN}>
          <p>{t('contentUpload.options.failed')}</p>
          <button
            type="button"
            className={`${BTN_SECONDARY} mt-3`}
            onClick={() => setOptionsTick(n => n + 1)}
          >
            {t('contentUpload.retry')}
          </button>
        </div>
      )}

      {load === 'error' && (
        <div role="alert" className={NOTICE_ERROR}>
          <p>{t('contentUpload.loadError')}</p>
          <button
            type="button"
            className={`${BTN_SECONDARY} mt-3`}
            onClick={reload}
          >
            {t('contentUpload.retry')}
          </button>
        </div>
      )}

      <div aria-live="polite" role="status">
        {notice && notice.kind !== 'error' && (
          <p className={notice.kind === 'warn' ? NOTICE_WARN : NOTICE_INFO}>
            {notice.text}
          </p>
        )}
      </div>
      {notice?.kind === 'error' && (
        <p role="alert" className={NOTICE_ERROR}>
          {notice.text}
        </p>
      )}

      {(status === 'draft' || status === 'uploading') && (
        <div className={CARD}>
          <p className="text-foreground mb-4 text-sm">
            {t('contentUpload.state.uploading')}
          </p>
          <RunUploader
            runId={runId}
            onFinished={reload}
            client={uploadClient}
          />
        </div>
      )}
      {status === 'processing' && (
        <ProcessingPanel
          runId={runId}
          autoStart
          onDone={reload}
          client={uploadClient}
        />
      )}
      {STATE_TEXT_STATUSES.includes(status) && (
        <p className={NOTICE_INFO}>{t(`contentUpload.state.${status}`)}</p>
      )}
      {status === 'review' && counts.total > 0 && (
        <p className="text-muted text-sm">{t('contentUpload.state.review')}</p>
      )}

      {counts.total === 0 && status !== 'draft' && status !== 'uploading' && (
        <p className="text-foreground border-border rounded-2xl border p-8 text-center">
          {t('contentUpload.review.empty')}
        </p>
      )}

      {counts.total > 0 && (
        <>
          <ReviewFilters
            filter={filter}
            counts={counts}
            facets={facets}
            onChange={applyFilter}
          />
          <BulkBar
            selectedCount={selected.size}
            acceptableHigh={counts.acceptableHigh}
            disabled={!decidable || busy}
            onAcceptHigh={() => setDialog({ kind: 'acceptHigh' })}
            onReject={() => setDialog({ kind: 'bulk', action: 'reject' })}
            onDefer={() => setDialog({ kind: 'bulk', action: 'defer' })}
            onAssign={() => setDialog({ kind: 'assign' })}
            onNewest={() => void openNewest()}
            onClearSelection={() => setSelected(new Set())}
          />

          <div
            id="review-list"
            tabIndex={-1}
            aria-busy={refreshing}
            className="space-y-3 focus:outline-none"
          >
            {data.matching === 0 ? (
              <div className="border-border rounded-2xl border p-8 text-center">
                <p className="text-foreground">
                  {t('contentUpload.review.noMatch')}
                </p>
                {filtered && (
                  <button
                    type="button"
                    className={`${BTN_SMALL} mt-3`}
                    onClick={() =>
                      applyFilter({
                        sort: filter.sort,
                        pageSize: filter.pageSize,
                      })
                    }
                  >
                    {t('contentUpload.filters.reset')}
                  </button>
                )}
              </div>
            ) : (
              <ReviewTable
                rows={data.rows}
                options={options}
                decidable={decidable}
                busy={busy}
                selected={selected}
                expanded={expanded}
                focusEditorOf={focusEditorOf}
                sort={sort}
                onSort={next => applyFilter({ ...filter, sort: next, page: 1 })}
                onToggleSelect={(id, on) => setSelected(s => toggle(s, id, on))}
                onToggleAll={onToggleAll}
                onToggleExpand={id => {
                  setFocusEditorOf(null);
                  setExpanded(s => toggle(s, id, !s.has(id)));
                }}
                onDecide={onDecide}
                onSaveAssignment={onSaveAssignment}
                onOpenDuplicate={key => setDialog({ kind: 'duplicate', key })}
              />
            )}

            <OriginalsPicker
              rows={data.rows}
              selected={originals}
              onChange={setOriginals}
              disabled={!decidable || busy}
            />

            <nav
              aria-label={t('contentUpload.paging.label')}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <p className="text-foreground text-sm">
                {t('contentUpload.paging.summary', {
                  page: data.page,
                  pages: data.pages,
                  count: data.matching,
                })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={BTN_SMALL}
                  disabled={data.page <= 1}
                  onClick={() => applyFilter({ ...filter, page: data.page - 1 })}
                >
                  {t('contentUpload.paging.prev')}
                </button>
                <button
                  type="button"
                  className={BTN_SMALL}
                  disabled={data.page >= data.pages}
                  onClick={() => applyFilter({ ...filter, page: data.page + 1 })}
                >
                  {t('contentUpload.paging.next')}
                </button>
                <label
                  className="text-foreground ml-2 text-sm"
                  htmlFor="page-size"
                >
                  {t('contentUpload.paging.size')}
                </label>
                <select
                  id="page-size"
                  className={SELECT_SMALL}
                  value={pageSize}
                  onChange={e =>
                    applyFilter({
                      ...filter,
                      pageSize: Number(e.target.value),
                      page: 1,
                    })
                  }
                >
                  {[25, 50, 100].map(n => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </nav>
          </div>
        </>
      )}

      {dialog?.kind === 'acceptHigh' && (
        <ConfirmDialog
          title={t('contentUpload.confirm.acceptHighTitle')}
          confirmLabel={t('contentUpload.confirm.accept')}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void send({ command: 'accept_high' })}
        >
          <p>
            {t('contentUpload.confirm.acceptHigh', {
              count: counts.acceptableHigh,
            })}
          </p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'bulk' && (
        <ConfirmDialog
          title={t(`contentUpload.confirm.${dialog.action}Title`)}
          confirmLabel={t(`contentUpload.confirm.${dialog.action}`)}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            void send(
              {
                command: 'bulk',
                action: dialog.action,
                fileIds: [...selected],
              },
              { clearSelection: true }
            )
          }
        >
          <p>
            {t(`contentUpload.confirm.${dialog.action}Text`, {
              count: selected.size,
            })}
          </p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'assign' && options && (
        <AssignDialog
          count={selected.size}
          options={options}
          busy={busy}
          onCancel={() => setDialog(null)}
          onApply={assignment =>
            void send(
              { command: 'assign', fileIds: [...selected], assignment },
              { clearSelection: true }
            )
          }
        />
      )}
      {dialog?.kind === 'newest' && (
        <ConfirmDialog
          title={t('contentUpload.confirm.newestTitle')}
          confirmLabel={t('contentUpload.confirm.newest')}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void send({ command: 'accept_newest' })}
        >
          <p>
            {t('contentUpload.confirm.newestText', { count: dialog.groups })}
          </p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'duplicate' && (
        <DuplicateDialog
          runId={runId}
          groupKey={dialog.key}
          client={client}
          decidable={decidable}
          busy={busy}
          onClose={() => setDialog(null)}
          onDecide={(key, keepFileId) =>
            void send({ command: 'duplicate', key, keepFileId })
          }
        />
      )}
      {dialog?.kind === 'reopen' && (
        <ConfirmDialog
          title={t('contentUpload.confirm.reopenTitle')}
          confirmLabel={t('contentUpload.confirm.reopen')}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void reopen()}
        >
          <p>{t('contentUpload.confirm.reopenText')}</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'discard' && (
        <ConfirmDialog
          title={t('contentUpload.confirm.discardTitle')}
          confirmLabel={t('contentUpload.confirm.discard')}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void discard()}
        >
          <p>
            {t('contentUpload.confirm.discardText', { count: counts.total })}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
