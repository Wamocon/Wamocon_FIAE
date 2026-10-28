'use client';

import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  DECIDABLE,
  UNCHECKED_REASONS,
} from '@/lib/content-upload/review/states';
import type {
  AssignmentDto,
  DecisionAction,
  ReviewOptions,
  ReviewRowDto,
  SortKey,
} from '@/lib/content-upload/review/types';
import { BandBadge } from '@/components/admin/content-upload/BandBadge';
import { StockBadge } from '@/components/admin/content-upload/StockBadge';
import { KiBadge } from '@/components/admin/content-upload/KiBadge';
import {
  KIND_KEYS,
  fileCodeLabel,
  formatBytes,
  formatDate,
  levelLabel,
  kiStateLabel,
  sourceLabel,
  statusLabel,
  typeLabel,
} from '@/components/admin/content-upload/labels';
import {
  BTN_PRIMARY,
  BTN_SMALL,
  FIELD,
  LABEL,
} from '@/components/admin/content-upload/styles';

type Translate = ReturnType<typeof useLanguage>['t'];

/** "Quiz leicht, K1-a": the type and assignment of a file in one phrase. */
export function describeAssignment(t: Translate, a: AssignmentDto): string {
  if (!a.docType) return '';
  const head = [
    typeLabel(t, a.docType),
    a.quizLevel ? levelLabel(t, a.quizLevel) : '',
  ]
    .filter(Boolean)
    .join(' ');
  const where = a.enablerCode ?? a.componentCode;
  return where ? `${head}, ${where}` : head;
}

/**
 * What a row stands for: "Enabler-Quizze (JSON), 12 Quizze, 36 Sätze, 360 Fragen" for a
 * quiz file, "Lernfeld-Zuordnung (Excel), 71 Positionen" for the mapping table. A Word or
 * PDF row has no contents and is described by its assignment.
 */
export function describeContents(
  t: Translate,
  contents: NonNullable<ReviewRowDto['contents']>
): string {
  const n = contents.numbers;
  if (contents.kind === 'mapping_xlsx') {
    return `${t('contentUpload.contents.mapping_xlsx')}, ${t(
      'contentUpload.contents.mapping_xlsx.counts',
      { positions: n.positions ?? 0, blocks: n.blocks ?? 0 }
    )}`;
  }
  const head = t(
    contents.variant === 'global'
      ? 'contentUpload.contents.quiz_json.global'
      : 'contentUpload.contents.quiz_json.lesson'
  );
  return `${head}, ${t('contentUpload.contents.quiz_json.counts', {
    quizzes: n.quizzes ?? 0,
    sets: n.sets ?? 0,
    questions: n.questions ?? 0,
  })}`;
}

/**
 * Reasons that say the content was not checked with full certainty: such a
 * proposal is not taken as it stands either (the same list as the route has).
 */

/** The proposal is taken as it stands only in the band high or medium without such a reason (as the route does). */
export function canAcceptAsProposed(row: ReviewRowDto): boolean {
  if (row.decision?.action === 'accept') return true;
  const proposal = row.proposal;
  if (!proposal) return false;
  // a proposal of the model needs a person who names the assignment (as the route says)
  if (proposal.source === 'ki') return false;
  if (proposal.band !== 'high' && proposal.band !== 'medium') return false;
  return !proposal.reasons.some(r => UNCHECKED_REASONS.has(r.code));
}

type Props = {
  rows: ReviewRowDto[];
  options: ReviewOptions | null;
  /** The run is in the state review: decisions may be written. */
  decidable: boolean;
  busy: boolean;
  selected: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  /** The file whose editor takes the focus (after "choose an assignment first"). */
  focusEditorOf: string | null;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  onToggleSelect: (id: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
  onToggleExpand: (id: string) => void;
  onDecide: (row: ReviewRowDto, action: DecisionAction) => void;
  onSaveAssignment: (row: ReviewRowDto, assignment: AssignmentDto) => void;
  onOpenDuplicate: (key: string) => void;
};

const COLUMNS = 7;

export function ReviewTable({
  rows,
  options,
  decidable,
  busy,
  selected,
  expanded,
  focusEditorOf,
  sort,
  onSort,
  onToggleSelect,
  onToggleAll,
  onToggleExpand,
  onDecide,
  onSaveAssignment,
  onOpenDuplicate,
}: Props) {
  const { t, language } = useLanguage();
  // only a file that can be decided can be selected, so only those count
  const selectable = rows.filter(
    r => decidable && DECIDABLE.includes(r.status)
  );
  const allOnPage =
    selectable.length > 0 && selectable.every(r => selected.has(r.id));
  const someOnPage = selectable.some(r => selected.has(r.id));
  const headBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headBox.current)
      headBox.current.indeterminate = someOnPage && !allOnPage;
  }, [someOnPage, allOnPage]);

  const sortButton = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => onSort(key)}
      className="inline-flex min-h-[32px] items-center gap-1 rounded font-semibold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
    >
      {label}
      <span aria-hidden="true">{sort === key ? '▾' : ''}</span>
    </button>
  );
  const ariaSort = (key: SortKey) => (sort === key ? 'ascending' : 'none');

  return (
    <div className="border-border overflow-x-auto rounded-2xl border">
      <table
        className="text-foreground w-full min-w-[960px] text-left text-sm"
        aria-busy={busy}
      >
        <caption className="sr-only">
          {t('contentUpload.table.caption')}
        </caption>
        <thead>
          <tr className="border-border border-b">
            <th scope="col" className="w-10 px-3 py-3">
              <input
                ref={headBox}
                type="checkbox"
                checked={allOnPage}
                onChange={e => onToggleAll(e.target.checked)}
                aria-label={t('contentUpload.table.selectAll')}
                disabled={selectable.length === 0}
                className="h-6 w-6 accent-red-700"
              />
            </th>
            <th scope="col" aria-sort={ariaSort('path')} className="px-3 py-3">
              {sortButton('path', t('contentUpload.col.file'))}
            </th>
            <th scope="col" className="px-3 py-3 font-semibold">
              {t('contentUpload.col.proposal')}
            </th>
            <th scope="col" className="px-3 py-3 font-semibold">
              {t('contentUpload.col.source')}
            </th>
            <th scope="col" aria-sort={ariaSort('band')} className="px-3 py-3">
              {sortButton('band', t('contentUpload.col.confidence'))}
            </th>
            <th scope="col" className="px-3 py-3 font-semibold">
              {t('contentUpload.col.stock')}
            </th>
            <th scope="col" className="px-3 py-3 font-semibold">
              {t('contentUpload.col.decision')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <Fragment key={row.id}>
              <Row
                row={row}
                t={t}
                language={language}
                decidable={decidable}
                busy={busy}
                selected={selected.has(row.id)}
                expanded={expanded.has(row.id)}
                onToggleSelect={onToggleSelect}
                onToggleExpand={onToggleExpand}
                onDecide={onDecide}
                onOpenDuplicate={onOpenDuplicate}
              />
              {expanded.has(row.id) && (
                <tr
                  className="border-border bg-card border-b"
                  id={`details-${row.id}`}
                >
                  <td colSpan={COLUMNS} className="px-4 py-4">
                    <Details
                      row={row}
                      options={options}
                      decidable={decidable}
                      busy={busy}
                      autoFocus={focusEditorOf === row.id}
                      onSave={onSaveAssignment}
                      onOpenDuplicate={onOpenDuplicate}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------

function Row({
  row,
  t,
  language,
  decidable,
  busy,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onDecide,
  onOpenDuplicate,
}: {
  row: ReviewRowDto;
  t: Translate;
  language: string;
  decidable: boolean;
  busy: boolean;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: Props['onToggleSelect'];
  onToggleExpand: Props['onToggleExpand'];
  onDecide: Props['onDecide'];
  onOpenDuplicate: Props['onOpenDuplicate'];
}) {
  const canDecide = decidable && DECIDABLE.includes(row.status);
  const meta = [
    formatBytes(row.sizeBytes),
    row.pageCount
      ? t('contentUpload.table.pages', { count: row.pageCount })
      : '',
  ]
    .filter(Boolean)
    .join(', ');
  const proposalText = row.proposal
    ? row.contents
      ? describeContents(t, row.contents)
      : describeAssignment(t, row.effective)
    : '';
  const decisionValue = row.decision?.action ?? '';

  return (
    <tr className="border-border border-b align-top">
      <td className="px-3 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={e => onToggleSelect(row.id, e.target.checked)}
          disabled={!canDecide}
          aria-label={t('contentUpload.table.selectRow', {
            name: row.fileName,
          })}
          className="h-6 w-6 accent-red-700"
        />
      </td>
      <th scope="row" className="px-3 py-3 font-normal">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => onToggleExpand(row.id)}
            aria-expanded={expanded}
            aria-controls={expanded ? `details-${row.id}` : undefined}
            aria-label={t(
              expanded
                ? 'contentUpload.table.hideDetails'
                : 'contentUpload.table.showDetails',
              { name: row.fileName }
            )}
            className={`${BTN_SMALL} !min-w-[32px] !px-2`}
          >
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          </button>
          <div className="min-w-0">
            <div className="font-medium break-all">{row.fileName}</div>
            <div className="text-muted text-xs break-all">{row.relPath}</div>
            <div className="text-muted text-xs">{meta}</div>
          </div>
        </div>
      </th>
      <td className="px-3 py-3">
        {row.proposal ? (
          <>
            <div className="font-medium">
              {proposalText || t('contentUpload.table.noAssignment')}
              {row.proposal.isNew && (
                <span className="border-border ml-2 rounded-md border px-1.5 py-0.5 text-xs font-normal">
                  {t('contentUpload.table.new')}
                </span>
              )}
            </div>
            {row.derived?.kind && (
              <div className="text-muted text-xs">
                {t(KIND_KEYS[row.derived.kind])}
                {row.derived.phase
                  ? `, ${t('contentUpload.table.phase', { phase: row.derived.phase })}`
                  : ''}
              </div>
            )}
            {row.status === 'unclear' && (
              <div className="text-muted text-xs">
                {row.ki ? kiStateLabel(t, row.ki) : t('contentUpload.notSent')}
              </div>
            )}
          </>
        ) : (
          <div>
            <span className="font-medium">{statusLabel(t, row.status)}</span>
            {row.statusCode && (
              <div className="text-muted text-xs">
                {fileCodeLabel(t, row.statusCode)}
              </div>
            )}
          </div>
        )}
        {row.duplicate && (
          <div className="mt-1 text-xs">
            <button
              type="button"
              className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
              onClick={() => onOpenDuplicate(row.duplicate!.key)}
            >
              {t('contentUpload.table.duplicateOf', {
                count: row.duplicate.size,
              })}
            </button>
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        {row.proposal ? (
          row.proposal.source === 'ki' ? (
            <KiBadge />
          ) : (
            sourceLabel(t, row.proposal.source)
          )
        ) : (
          ''
        )}
      </td>
      <td className="px-3 py-3">
        {row.proposal ? (
          <BandBadge
            band={row.proposal.band}
            confidence={row.proposal.confidence}
          />
        ) : (
          <span className="text-muted">-</span>
        )}
      </td>
      <td className="px-3 py-3">
        {DECIDABLE.includes(row.status) ? (
          <StockBadge stock={row.stock} />
        ) : (
          <span className="text-muted">-</span>
        )}
      </td>
      <td className="px-3 py-3">
        {canDecide ? (
          // Buttons, not a select: a closed select writes its value with the first
          // arrow key (WCAG 3.2.2), a button decides only when it is pressed. A call
          // that runs makes them aria-disabled and not disabled, so the focus stays.
          <div
            role="group"
            aria-label={t('contentUpload.table.decisionFor', {
              name: row.fileName,
            })}
            className="flex flex-col items-start gap-1"
          >
            {(['accept', 'reject', 'defer'] as const).map(action => (
              <button
                key={action}
                type="button"
                aria-pressed={decisionValue === action}
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (!busy) onDecide(row, action);
                }}
                className={`${BTN_SMALL} w-full justify-start ${
                  decisionValue === action ? '!border-red-700 !bg-red-700/15' : ''
                }`}
              >
                <span aria-hidden="true" className="w-3 font-bold">
                  {decisionValue === action ? '✓' : ''}
                </span>
                {t(`contentUpload.decision.${action}`)}
              </button>
            ))}
          </div>
        ) : row.decision ? (
          <span>
            {t(`contentUpload.decision.${row.decision.action}`)}
            <span className="text-muted block text-xs">
              {formatDate(row.decision.decidedAt, language)}
            </span>
          </span>
        ) : (
          <span className="text-muted">-</span>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// The details of a row: reasons, hints and the editor of the assignment
// ---------------------------------------------------------------------------

function Details({
  row,
  options,
  decidable,
  busy,
  autoFocus,
  onSave,
  onOpenDuplicate,
}: {
  row: ReviewRowDto;
  options: ReviewOptions | null;
  decidable: boolean;
  busy: boolean;
  autoFocus: boolean;
  onSave: Props['onSaveAssignment'];
  onOpenDuplicate: Props['onOpenDuplicate'];
}) {
  const { t, language } = useLanguage();
  const reasons = row.proposal?.reasons ?? [];
  // A quiz JSON file and the Excel mapping hold many items that name their own
  // component, enabler and level: there is no assignment to edit, only to accept or not
  const canEdit =
    decidable &&
    DECIDABLE.includes(row.status) &&
    options !== null &&
    !row.contents;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3">
        <h2 className="text-foreground font-semibold">
          {t('contentUpload.details.reasons')}
        </h2>
        {reasons.length > 0 ? (
          <ul className="space-y-1">
            {reasons.map((reason, i) => (
              <li key={`${reason.code}-${i}`}>
                <span>{reason.text}</span>{' '}
                <span className="text-muted text-xs">({reason.code})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t('contentUpload.details.noReasons')}</p>
        )}
        {row.statusCode && (
          <p>
            <span className="font-medium">
              {t('contentUpload.details.code')}:{' '}
            </span>
            {fileCodeLabel(t, row.statusCode)}
          </p>
        )}
        {row.proposal?.source === 'ki' && (
          <p className="text-muted">{t('contentUpload.ki.detailsNote')}</p>
        )}
        {row.contents && (
          <p className="text-muted" data-testid="fixed-kind-note">
            {t(`contentUpload.contents.${row.contents.kind}.note`)}
          </p>
        )}
        {row.contents && (row.contents.numbers.setsWithErrors ?? 0) > 0 && (
          <p>
            {t('contentUpload.contents.setsWithErrors', {
              count: row.contents.numbers.setsWithErrors,
            })}
          </p>
        )}
        {row.copyOfId && <p>{t('contentUpload.details.copy')}</p>}
        {row.duplicate && (
          <p>
            {t('contentUpload.details.versions', { count: row.duplicate.size })}{' '}
            <button
              type="button"
              className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
              onClick={() => onOpenDuplicate(row.duplicate!.key)}
            >
              {t('contentUpload.table.decideDuplicate')}
            </button>
          </p>
        )}
        {row.clientMtimeMs !== null && (
          <p className="text-muted text-xs">
            {t('contentUpload.details.changed', {
              date: formatDate(row.clientMtimeMs, language),
            })}
          </p>
        )}
      </div>
      {canEdit && (
        <AssignmentEditor
          key={[
            row.effective.docType,
            row.effective.componentCode,
            row.effective.enablerCode,
            row.effective.quizLevel,
            row.decision?.decidedAt,
          ].join('|')}
          row={row}
          options={options!}
          busy={busy}
          autoFocus={autoFocus}
          onSave={onSave}
        />
      )}
    </div>
  );
}

function AssignmentEditor({
  row,
  options,
  busy,
  autoFocus,
  onSave,
}: {
  row: ReviewRowDto;
  options: ReviewOptions;
  busy: boolean;
  autoFocus: boolean;
  onSave: Props['onSaveAssignment'];
}) {
  const { t } = useLanguage();
  const id = useId();
  const first = useRef<HTMLSelectElement>(null);
  const isPdf = row.ext === 'pdf';
  const [docType, setDocType] = useState(row.effective.docType ?? '');
  const [componentCode, setComponentCode] = useState(
    row.effective.componentCode ?? ''
  );
  const [enablerCode, setEnablerCode] = useState(
    row.effective.enablerCode ?? ''
  );
  const [quizLevel, setQuizLevel] = useState(row.effective.quizLevel ?? '');

  useEffect(() => {
    if (autoFocus) first.current?.focus();
  }, [autoFocus]);

  const types = isPdf
    ? ['pdf_original']
    : options.docTypes.filter(type => type !== 'pdf_original');
  const component = options.components.find(c => c.code === componentCode);
  const global = docType === 'global_quiz';
  const needsLevel = docType === 'quiz' || (isPdf && quizLevel !== '');
  const showEnabler = !global && !(isPdf && row.effective.enablerCode === null);

  return (
    <form
      className="space-y-3"
      onSubmit={event => {
        event.preventDefault();
        if (busy) return;
        onSave(row, {
          docType: docType || null,
          componentCode: componentCode || null,
          enablerCode: global || !enablerCode ? null : enablerCode,
          quizLevel: needsLevel && quizLevel ? quizLevel : null,
        });
      }}
    >
      <h2 className="text-foreground font-semibold">
        {t('contentUpload.details.assignment')}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-type`} className={LABEL}>
            {t('contentUpload.field.type')}
          </label>
          <select
            id={`${id}-type`}
            ref={first}
            value={docType}
            onChange={e => setDocType(e.target.value)}
            disabled={busy || isPdf}
            className={FIELD}
          >
            <option value="">{t('contentUpload.field.choose')}</option>
            {types.map(type => (
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
            value={componentCode}
            onChange={e => {
              setComponentCode(e.target.value);
              setEnablerCode('');
            }}
            disabled={busy}
            className={FIELD}
          >
            <option value="">{t('contentUpload.field.choose')}</option>
            {options.components.map(c => (
              <option key={c.code} value={c.code}>
                {c.code}
                {c.title ? ` ${c.title}` : ''}
                {c.isNew ? ` (${t('contentUpload.table.new')})` : ''}
              </option>
            ))}
          </select>
        </div>
        {showEnabler && (
          <div>
            <label htmlFor={`${id}-enabler`} className={LABEL}>
              {t('contentUpload.field.enabler')}
            </label>
            <select
              id={`${id}-enabler`}
              value={enablerCode}
              onChange={e => setEnablerCode(e.target.value)}
              disabled={busy || !component}
              className={FIELD}
            >
              <option value="">{t('contentUpload.field.choose')}</option>
              {(component?.enablers ?? []).map(e => (
                <option key={e.code} value={e.code}>
                  {e.code}
                  {e.title ? ` ${e.title}` : ''}
                  {e.isNew ? ` (${t('contentUpload.table.new')})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {needsLevel && (
          <div>
            <label htmlFor={`${id}-level`} className={LABEL}>
              {t('contentUpload.field.level')}
            </label>
            <select
              id={`${id}-level`}
              value={quizLevel}
              onChange={e => setQuizLevel(e.target.value)}
              disabled={busy}
              className={FIELD}
            >
              <option value="">{t('contentUpload.field.choose')}</option>
              {options.quizLevels.map(level => (
                <option key={level} value={level}>
                  {levelLabel(t, level)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <p className="text-muted text-xs">
        {t('contentUpload.details.derivedHint')}
      </p>
      <button type="submit" aria-disabled={busy || undefined} className={BTN_PRIMARY}>
        {t('contentUpload.details.saveAccept')}
      </button>
    </form>
  );
}
