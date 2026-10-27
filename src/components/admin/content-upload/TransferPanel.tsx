'use client';

import { useId, useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { UploadApiError } from '@/lib/content-upload/staging/client';
import { UPLOAD_CATALOG_CODE } from '@/lib/content-upload/staging/config';
import type { ReviewClient } from '@/lib/content-upload/review/client';
import type { RollbackAnswer } from '@/lib/content-upload/transfer/rollback';
import { STOCK_STATUSES } from '@/lib/content-upload/transfer/stock';
import type { TransferReport } from '@/lib/content-upload/transfer/types';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/admin/content-upload/Modal';
import {
  STOCK_SYMBOL,
  codeText,
  stockLabel,
} from '@/components/admin/content-upload/labels';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SMALL,
  CARD,
  FIELD,
  LABEL,
  NOTICE_ERROR,
  NOTICE_INFO,
  NOTICE_WARN,
} from '@/components/admin/content-upload/styles';

type Props = {
  runId: string;
  /** Status of the run: the dry run and the apply need review, the rollback needs applied. */
  status: string;
  /** decisions_version of the list the page shows. */
  version: number;
  /** Files with a decision to accept. */
  accepted: number;
  client: ReviewClient;
  /** Something changed on the server: read the list again. */
  onChanged: () => void;
};

type Translate = ReturnType<typeof useLanguage>['t'];

interface DryRun {
  report: TransferReport;
  /** The decisions version the dry run was made for. */
  version: number;
  /** The choice of files to replace the dry run was made for. */
  replaceKey: string;
}

/** The text for the error of a transfer call: by code, else by status, else a general one. */
export function transferErrorText(t: Translate, error: unknown): string {
  if (error instanceof UploadApiError) {
    const byCode = error.code ? `contentUpload.transfer.error.${error.code}` : '';
    if (byCode && t(byCode) !== byCode) return t(byCode);
    const byStatus = `contentUpload.transfer.error.status${error.status}`;
    if (t(byStatus) !== byStatus) return t(byStatus);
  }
  return t('contentUpload.transfer.error.other');
}

const sum = (report: TransferReport, key: 'insert' | 'update' | 'unchanged') =>
  Object.values(report.tables).reduce((n, c) => n + c[key], 0);

function groupByCode<T extends { code: string }>(items: readonly T[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.code, (counts.get(item.code) ?? 0) + 1);
  return [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** Saves a text as a file of the browser (the SQL of a rollback), without a link to a server. */
function saveText(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/sql;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The steps after the review (docs/ki-upload-konzept.md 8): the dry run, the apply and
 * the rollback SQL. The dry run shows what would be written and counts the files by the
 * status of the supply; the apply is possible only after a valid dry run without
 * conflicts, with the typed catalog code; rows that differ from the database are
 * replaced only for the files the person ticks. The panel never shows a text of a
 * document.
 */
export function TransferPanel({
  runId,
  status,
  version,
  accepted,
  client,
  onChanged,
}: Props) {
  const { t } = useLanguage();
  const headingId = useId();
  const typedId = useId();
  const [phase, setPhase] = useState<'idle' | 'dry' | 'apply' | 'rollback'>(
    'idle'
  );
  const [dry, setDry] = useState<DryRun | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<TransferReport | null>(null);
  const [dialog, setDialog] = useState(false);
  const [typed, setTyped] = useState('');
  const [rollback, setRollback] = useState<RollbackAnswer | null>(null);

  const replaceKey = useMemo(() => [...selection].sort().join(','), [selection]);
  const reviewing = status === 'review';
  const busy = phase !== 'idle';
  const valid =
    dry !== null && dry.version === version && dry.replaceKey === replaceKey;
  const report = dry?.report ?? null;
  const clean = valid && report?.status === 'ok' && report.readyToApply;
  const differing = useMemo(
    () => (report?.stock.files ?? []).filter(f => f.status === 'differs'),
    [report]
  );

  const runDry = async () => {
    setPhase('dry');
    setError(null);
    setDone(null);
    try {
      const answer = await client.dryRun(runId, {
        replaceFiles: [...selection],
      });
      setDry({ report: answer, version, replaceKey });
    } catch (e) {
      setDry(null);
      setError(transferErrorText(t, e));
    } finally {
      setPhase('idle');
      onChanged();
    }
  };

  const runApply = async () => {
    setDialog(false);
    setPhase('apply');
    setError(null);
    try {
      const answer = await client.apply(runId, {
        replaceFiles: [...selection],
        confirm: typed,
      });
      if (answer.status === 'conflict') {
        setDry({ report: answer, version, replaceKey });
        setError(t('contentUpload.transfer.error.conflictAtApply'));
      } else {
        setDone(answer);
        setDry(null);
        setSelection(new Set());
      }
    } catch (e) {
      if (
        e instanceof UploadApiError &&
        ['DRY_RUN_REQUIRED', 'STALE_DECISIONS', 'RUN_STATE'].includes(
          e.code ?? ''
        )
      ) {
        setDry(null);
      }
      setError(transferErrorText(t, e));
    } finally {
      setTyped('');
      setPhase('idle');
      onChanged();
    }
  };

  const loadRollback = async () => {
    setPhase('rollback');
    setError(null);
    try {
      setRollback(await client.rollbackSql(runId));
    } catch (e) {
      setRollback(null);
      setError(transferErrorText(t, e));
    } finally {
      setPhase('idle');
    }
  };

  const toggle = (id: string, on: boolean) =>
    setSelection(prev => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  if (status !== 'review' && status !== 'applying' && status !== 'applied') {
    return null;
  }

  return (
    <section
      id="transfer"
      aria-labelledby={headingId}
      className={`${CARD} space-y-5`}
    >
      <div>
        <h2 id={headingId} className="text-foreground text-xl font-bold">
          {t('contentUpload.transfer.title')}
        </h2>
        <p className="text-muted mt-1 text-sm">
          {t('contentUpload.transfer.intro')}
        </p>
      </div>

      <div aria-live="polite" role="status" className="space-y-3">
        {phase === 'dry' && (
          <p className={`${NOTICE_INFO} flex items-center gap-3`}>
            <LoadingSpinner size="sm" />
            {t('contentUpload.transfer.dryRunning')}
          </p>
        )}
        {phase === 'apply' && (
          <p className={`${NOTICE_WARN} flex items-center gap-3`}>
            <LoadingSpinner size="sm" />
            {t('contentUpload.transfer.applying')}
          </p>
        )}
        {done && (
          <div className={NOTICE_INFO}>
            <p className="font-medium">
              {t('contentUpload.transfer.doneTitle')}
            </p>
            <p>
              {t('contentUpload.transfer.doneText', {
                insert: sum(done, 'insert'),
                update: sum(done, 'update'),
              })}
            </p>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className={NOTICE_ERROR}>
          {error}
        </p>
      )}

      {status === 'applying' && (
        <p className={NOTICE_INFO}>{t('contentUpload.state.applying')}</p>
      )}

      {reviewing && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={busy || accepted === 0}
              onClick={() => void runDry()}
            >
              {t('contentUpload.transfer.dryRun')}
            </button>
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={busy || !clean}
              onClick={() => {
                setTyped('');
                setDialog(true);
              }}
            >
              {t('contentUpload.transfer.apply')}
            </button>
          </div>
          {accepted === 0 && (
            <p className="text-muted text-sm">
              {t('contentUpload.transfer.noneAccepted')}
            </p>
          )}
          {accepted > 0 && !clean && (
            <p className="text-muted text-sm">
              {t('contentUpload.transfer.needDryRun')}
            </p>
          )}
        </div>
      )}

      {reviewing && dry && !valid && (
        <p className={NOTICE_WARN}>
          {dry.version !== version
            ? t('contentUpload.transfer.outdated')
            : t('contentUpload.transfer.selectionChanged')}
        </p>
      )}

      {reviewing && report && (
        <DryRunResult
          t={t}
          report={report}
          valid={valid}
          version={dry?.version ?? version}
          differing={differing}
          selection={selection}
          busy={busy}
          onToggle={toggle}
          onAll={on =>
            setSelection(on ? new Set(differing.map(f => f.fileId)) : new Set())
          }
        />
      )}

      {status === 'applied' && (
        <div className="space-y-3">
          <h3 className="text-foreground text-lg font-semibold">
            {t('contentUpload.transfer.rollbackTitle')}
          </h3>
          <p className="text-muted text-sm">
            {t('contentUpload.transfer.rollbackIntro')}
          </p>
          <button
            type="button"
            className={BTN_SECONDARY}
            disabled={busy}
            onClick={() => void loadRollback()}
          >
            {t('contentUpload.transfer.rollbackCreate')}
          </button>
          {rollback && (
            <RollbackResult t={t} runId={runId} answer={rollback} />
          )}
        </div>
      )}

      {dialog && report && (
        <Modal
          titleId={`${headingId}-apply`}
          descriptionId={`${headingId}-apply-text`}
          onClose={() => setDialog(false)}
        >
          <h2
            id={`${headingId}-apply`}
            className="text-foreground text-xl font-bold"
          >
            {t('contentUpload.transfer.confirmTitle')}
          </h2>
          <div
            id={`${headingId}-apply-text`}
            className="text-foreground mt-3 space-y-2 text-sm"
          >
            <p>
              {t('contentUpload.transfer.confirmText', {
                insert: sum(report, 'insert'),
                update: sum(report, 'update'),
              })}
            </p>
            <p>{t('contentUpload.transfer.confirmInactive')}</p>
            <p>{t('contentUpload.transfer.confirmRollback')}</p>
          </div>
          <div className="mt-4">
            <label htmlFor={typedId} className={LABEL}>
              {t('contentUpload.transfer.typeCode', {
                code: UPLOAD_CATALOG_CODE,
              })}
            </label>
            <input
              id={typedId}
              type="text"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={FIELD}
              data-initial-focus
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setDialog(false)}
              className={BTN_SECONDARY}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void runApply()}
              disabled={typed !== UPLOAD_CATALOG_CODE || busy}
              className={BTN_PRIMARY}
            >
              {t('contentUpload.transfer.confirm')}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The result of a dry run
// ---------------------------------------------------------------------------

function DryRunResult({
  t,
  report,
  valid,
  version,
  differing,
  selection,
  busy,
  onToggle,
  onAll,
}: {
  t: Translate;
  report: TransferReport;
  valid: boolean;
  version: number;
  differing: TransferReport['stock']['files'];
  selection: ReadonlySet<string>;
  busy: boolean;
  onToggle: (id: string, on: boolean) => void;
  onAll: (on: boolean) => void;
}) {
  const tables = Object.entries(report.tables);
  const excluded = groupByCode(report.excluded);
  const skipped = groupByCode(report.skipped);
  return (
    <div className="space-y-4" aria-label={t('contentUpload.transfer.resultTitle')} role="group">
      <h3 className="text-foreground text-lg font-semibold">
        {t('contentUpload.transfer.resultTitle')}
      </h3>
      <p className="text-muted text-sm">
        {valid
          ? t('contentUpload.transfer.valid', {
              version,
              hash: report.decisionsHash.slice(0, 12),
            })
          : t('contentUpload.transfer.invalid', {
              hash: report.decisionsHash.slice(0, 12),
            })}
      </p>
      {report.status === 'conflict' ? (
        <p className={NOTICE_ERROR}>
          {t('contentUpload.transfer.conflicts', {
            count: report.conflicts.length,
          })}
        </p>
      ) : (
        <p className={NOTICE_INFO}>{t('contentUpload.transfer.noConflict')}</p>
      )}

      <div>
        <h4 className="text-foreground mb-2 text-sm font-semibold">
          {t('contentUpload.transfer.stockTitle')}
        </h4>
        <ul className="flex flex-wrap gap-2">
          {STOCK_STATUSES.map(s => (
            <li
              key={s}
              className="border-border text-foreground flex items-center gap-1.5 rounded-lg border px-2 py-1 text-sm"
            >
              <span aria-hidden="true" className="w-4 text-center font-bold">
                {STOCK_SYMBOL[s]}
              </span>
              <span>{stockLabel(t, s)}</span>
              <span className="font-bold">{report.stock.counts[s]}</span>
            </li>
          ))}
        </ul>
        {report.extended.length > 0 && (
          <p className="text-muted mt-2 text-sm">
            {t('contentUpload.transfer.extended', {
              quizzes: report.extended.length,
              questions: report.extended.reduce((n, e) => n + e.added, 0),
              moved: report.extended.reduce((n, e) => n + e.moved, 0),
            })}
          </p>
        )}
      </div>

      {tables.length > 0 && (
        <div className="overflow-x-auto">
          <table className="text-foreground w-full min-w-[420px] text-left text-sm">
            <caption className="sr-only">
              {t('contentUpload.transfer.tablesCaption')}
            </caption>
            <thead>
              <tr className="border-border border-b">
                <th scope="col" className="px-2 py-2 font-semibold">
                  {t('contentUpload.transfer.col.table')}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">
                  {t('contentUpload.transfer.col.insert')}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">
                  {t('contentUpload.transfer.col.update')}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">
                  {t('contentUpload.transfer.col.unchanged')}
                </th>
              </tr>
            </thead>
            <tbody>
              {tables.map(([name, count]) => (
                <tr key={name} className="border-border border-b">
                  <th scope="row" className="px-2 py-1.5 font-normal">
                    {codeText(
                      t,
                      'contentUpload.transfer.table',
                      name,
                      'contentUpload.transfer.table.other'
                    )}
                  </th>
                  <td className="px-2 py-1.5 text-right">{count.insert}</td>
                  <td className="px-2 py-1.5 text-right">{count.update}</td>
                  <td className="px-2 py-1.5 text-right">{count.unchanged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.conflicts.length > 0 && (
        <div>
          <h4 className="text-foreground mb-2 text-sm font-semibold">
            {t('contentUpload.transfer.conflictsTitle')}
          </h4>
          <ul className="text-foreground list-disc space-y-1 pl-5 text-sm">
            {report.conflicts.slice(0, 50).map(c => (
              <li key={`${c.table}:${c.key}`}>
                <span className="font-medium">
                  {c.table} {c.key}
                </span>
                <span className="text-muted block">{c.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {differing.length > 0 && (
        <fieldset className="border-border space-y-2 rounded-xl border p-4">
          <legend className="text-foreground px-1 text-sm font-semibold">
            {t('contentUpload.transfer.differsTitle', {
              count: differing.length,
            })}
          </legend>
          <p className="text-muted text-sm">
            {t('contentUpload.transfer.differsHelp')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={BTN_SMALL}
              disabled={busy}
              onClick={() => onAll(true)}
            >
              {t('contentUpload.transfer.selectAll')}
            </button>
            <button
              type="button"
              className={BTN_SMALL}
              disabled={busy || selection.size === 0}
              onClick={() => onAll(false)}
            >
              {t('contentUpload.transfer.selectNone')}
            </button>
          </div>
          <ul className="space-y-1">
            {differing.map(f => (
              <li key={f.fileId}>
                <label className="text-foreground flex min-h-[32px] items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-6 w-6 accent-red-700"
                    checked={selection.has(f.fileId)}
                    disabled={busy}
                    onChange={e => onToggle(f.fileId, e.target.checked)}
                  />
                  <span className="break-all">
                    {t('contentUpload.transfer.replaceFile', {
                      name: f.fileName,
                    })}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {(excluded.length > 0 || skipped.length > 0) && (
        <div>
          <h4 className="text-foreground mb-2 text-sm font-semibold">
            {t('contentUpload.transfer.leftOutTitle')}
          </h4>
          <ul className="text-foreground list-disc space-y-1 pl-5 text-sm">
            {excluded.map(([code, n]) => (
              <li key={`e-${code}`}>
                {n} ×{' '}
                {codeText(
                  t,
                  'contentUpload.transfer.excluded',
                  code,
                  'contentUpload.transfer.excluded.other'
                )}
              </li>
            ))}
            {skipped.map(([code, n]) => (
              <li key={`s-${code}`}>
                {n} ×{' '}
                {codeText(
                  t,
                  'contentUpload.transfer.skipped',
                  code,
                  'contentUpload.transfer.skipped.other'
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The rollback SQL
// ---------------------------------------------------------------------------

function RollbackResult({
  t,
  runId,
  answer,
}: {
  t: Translate;
  runId: string;
  answer: RollbackAnswer;
}) {
  const deletes = Object.values(answer.deletes).reduce((n, c) => n + c, 0);
  const restores = Object.values(answer.restores).reduce((n, c) => n + c, 0);
  if (answer.sql === null) {
    return (
      <div className={NOTICE_WARN}>
        <p className="font-medium">{t('contentUpload.transfer.rollbackBlocked')}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {answer.blockers.map(b => (
            <li key={b.code}>
              {codeText(
                t,
                'contentUpload.transfer.blocker',
                b.code,
                'contentUpload.transfer.blocker.other'
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const sql = answer.sql;
  return (
    <div className="space-y-3">
      <p className="text-foreground text-sm">
        {t('contentUpload.transfer.rollbackSummary', { deletes, restores })}
      </p>
      <p className={NOTICE_WARN}>{t('contentUpload.transfer.rollbackManual')}</p>
      {answer.notes.length > 0 && (
        <ul className="text-muted list-disc space-y-1 pl-5 text-sm">
          {answer.notes.map(note => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className={BTN_PRIMARY}
        onClick={() =>
          saveText(
            `rueckbau-${runId.slice(0, 8)}-${answer.applyId.slice(0, 8)}.sql`,
            sql
          )
        }
      >
        {t('contentUpload.transfer.rollbackDownload')}
      </button>
    </div>
  );
}
