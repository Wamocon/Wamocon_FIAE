'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  acceptRows,
  rowsToPlan,
  valueToText,
} from '@/lib/catalog/content-plan/rows';
import {
  type PlanIssue,
  type PlanMethod,
  type PlanRow,
  type PlanRowScope,
  type StoredContentPlan,
} from '@/lib/catalog/content-plan/types';

type Props = {
  catalogId: string;
  /** Called after a plan was saved or removed, so the statistics reload. */
  onChanged?: () => void;
};

type Proposal = {
  fileName: string;
  method: PlanMethod;
  rows: PlanRow[];
  issues: PlanIssue[];
  warnings: string[];
  ki: { accepted: number; dropped: number } | null;
};

/** Files the server reads (it checks type and size again). */
const EXTENSIONS = ['docx', 'xlsx', 'csv', 'json', 'pdf'];
const MAX_BYTES = 5 * 1024 * 1024;
const NEEDS_KI = new Set(['docx', 'pdf']);

const GROUPS: { scope: PlanRowScope[]; key: string }[] = [
  { scope: ['totals'], key: 'totals' },
  { scope: ['component'], key: 'components' },
  { scope: ['learningField'], key: 'learningFields' },
  { scope: ['relation'], key: 'relations' },
  { scope: ['note'], key: 'notes' },
];

const extensionOf = (name: string) => name.toLowerCase().split('.').pop() ?? '';

const button =
  'text-foreground hover:bg-accent/10 border-border focus-visible:ring-accent flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50';
const primary =
  'flex min-h-[44px] items-center gap-1.5 rounded-xl bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none disabled:opacity-50';

/**
 * Platform admin only: the optional plan document of one occupation. The
 * hierarchy of the training (totals, components, learning fields, relations)
 * can be read from a document in addition to the manual targets, never
 * instead of them. The flow: download the template, upload a file, check the
 * PROPOSAL (every field with its source, switch fields off or change them),
 * apply. Excel, CSV and JSON are read by script after the template, Word and
 * PDF by the AI after an explicit confirmation. The server checks the right,
 * type, size and every value again, this panel only helps to get them right.
 */
export function ContentPlanPanel({ catalogId, onChanged }: Props) {
  const { t, language } = useLanguage();
  const id = useId();
  const base = `/api/admin/catalogs/${catalogId}/content-plan`;

  const [expanded, setExpanded] = useState(false);
  const [stored, setStored] = useState<StoredContentPlan | null | undefined>(
    undefined
  );
  const [busy, setBusy] = useState<'reading' | 'saving' | 'removing' | null>(
    null
  );
  const [pending, setPending] = useState<File | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<HTMLButtonElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const latest = useRef(0);

  const message = useCallback(
    (code: unknown, fallback = 'contentPlan.error.generic') => {
      const key = `contentPlan.error.${String(code)}`;
      const text = t(key);
      return text === key ? t(fallback) : text;
    },
    [t]
  );

  const loadStored = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const res = await authFetch(base, { cache: 'no-store' });
      if (!res.ok) throw new Error('load');
      const body = (await res.json()) as { stored: StoredContentPlan | null };
      if (mine === latest.current) setStored(body.stored);
    } catch {
      if (mine === latest.current) {
        setStored(undefined);
        setError(t('contentPlan.loadFailed'));
      }
    }
  }, [base, t]);

  // The stored plan is loaded when the panel is opened, not with the page
  useEffect(() => {
    if (expanded && stored === undefined) void loadStored();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  useEffect(
    () => () => {
      latest.current += 1;
    },
    []
  );

  // The keyboard user lands on the proposal that just appeared
  useEffect(() => {
    if (proposal) headingRef.current?.focus();
  }, [proposal]);

  const reset = () => {
    setPending(null);
    setProposal(null);
    setSelected(new Set());
    setEdits({});
    setInvalid(new Set());
    setConfirmRemove(false);
    requestAnimationFrame(() => uploadRef.current?.focus());
  };

  const downloadTemplate = async (format: 'xlsx' | 'json') => {
    setError(null);
    try {
      const res = await authFetch(`${base}/template?format=${format}`);
      if (!res.ok) throw new Error('template');
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `plan-vorlage.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(t('contentPlan.templateFailed'));
    }
  };

  const parse = async (file: File, useKi: boolean) => {
    setError(null);
    setPending(null);
    setBusy('reading');
    try {
      const form = new FormData();
      form.append('file', file);
      if (useKi) form.append('ki', 'true');
      const res = await authFetch(`${base}/parse`, {
        method: 'POST',
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(message(body?.code));
        return;
      }
      const rows = body.rows as PlanRow[];
      const warnings = (body.warnings ?? []) as string[];
      setProposal({
        fileName: String(body.fileName ?? file.name),
        method: body.method as PlanMethod,
        rows,
        issues: (body.issues ?? []) as PlanIssue[],
        warnings,
        ki: body.ki
          ? { accepted: body.ki.accepted, dropped: body.ki.dropped }
          : null,
      });
      // The unchanged template is never preselected
      setSelected(
        new Set(
          warnings.includes('EXAMPLE_TEMPLATE') ? [] : rows.map(r => r.id)
        )
      );
      setEdits({});
      setInvalid(new Set());
    } catch {
      setError(t('contentPlan.error.generic'));
    } finally {
      setBusy(null);
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setProposal(null);
    const ext = extensionOf(file.name);
    if (!EXTENSIONS.includes(ext)) {
      setError(t('contentPlan.error.UNSUPPORTED_TYPE'));
      return;
    }
    if (file.size === 0) {
      setError(t('contentPlan.error.EMPTY_FILE'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('contentPlan.error.FILE_TOO_LARGE'));
      return;
    }
    // Word and PDF go to the AI only after a confirmation
    if (NEEDS_KI.has(ext)) setPending(file);
    else void parse(file, false);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    handleFile(event.dataTransfer.files?.[0]);
  };

  const apply = async () => {
    if (!proposal) return;
    const accepted = acceptRows(proposal.rows, selected, edits);
    setInvalid(new Set(accepted.invalid));
    if (accepted.invalid.length > 0) {
      setError(
        t('contentPlan.invalidFields', { count: accepted.invalid.length })
      );
      return;
    }
    if (accepted.rows.length === 0) return;
    setError(null);
    setBusy('saving');
    try {
      const res = await authFetch(base, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: rowsToPlan(accepted.rows),
          fileName: proposal.fileName,
          method: proposal.method,
        }),
      });
      if (!res.ok) throw new Error('save');
      const body = (await res.json()) as { stored: StoredContentPlan };
      setStored(body.stored);
      toast.success(t('contentPlan.saved'));
      reset();
      onChanged?.();
    } catch {
      setError(t('contentPlan.saveFailed'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setError(null);
    setBusy('removing');
    try {
      const res = await authFetch(base, { method: 'DELETE' });
      if (!res.ok) throw new Error('remove');
      setStored(null);
      setConfirmRemove(false);
      toast.success(t('contentPlan.removed'));
      onChanged?.();
    } catch {
      setError(t('contentPlan.removeFailed'));
    } finally {
      setBusy(null);
    }
  };

  const fieldLabel = (row: PlanRow) => {
    if (row.scope === 'totals') {
      return t(`contentPlan.field.totals.${row.field}`);
    }
    if (row.scope === 'component') {
      return t(`contentPlan.field.component.${row.field}`);
    }
    if (row.scope === 'learningField') {
      return t(`contentPlan.field.learningField.${row.field}`);
    }
    if (row.scope === 'relation') {
      return `${t(`contentPlan.relation.${row.ref}`)}: ${row.field}`;
    }
    return t('contentPlan.field.note');
  };

  const toggle = (rowId: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });

  const rows = proposal?.rows ?? [];
  const allSelected = rows.length > 0 && selected.size === rows.length;

  const renderRow = (row: PlanRow) => {
    const label = fieldLabel(row);
    const bad = invalid.has(row.id);
    const isKi = proposal?.method === 'ki';
    return (
      <tr key={row.id} className="border-border border-t align-top">
        <td className="w-12 px-2 py-2 text-center">
          <input
            type="checkbox"
            checked={selected.has(row.id)}
            onChange={() => toggle(row.id)}
            aria-label={t('contentPlan.selectRow', { field: label })}
            className="h-5 w-5 accent-red-700"
          />
        </td>
        <th
          scope="row"
          className="text-foreground px-2 py-2 text-left text-sm font-medium break-words"
        >
          {label}
        </th>
        <td className="px-2 py-2">
          <input
            type="text"
            value={edits[row.id] ?? valueToText(row.value)}
            onChange={e =>
              setEdits(prev => ({ ...prev, [row.id]: e.target.value }))
            }
            aria-label={t('contentPlan.editValue', { field: label })}
            aria-invalid={bad}
            className={`bg-background text-foreground focus:ring-accent min-h-[44px] w-full min-w-[8rem] rounded-xl border px-3 py-1.5 text-sm focus:ring-2 focus:outline-none ${
              bad ? 'border-red-600' : 'border-border'
            }`}
          />
        </td>
        <td className="text-muted px-2 py-2 text-xs">
          {row.quote !== '' && (
            <span className="border-accent/60 block border-l-2 pl-2 break-words">
              {isKi ? `„${row.quote}“` : row.quote}
            </span>
          )}
        </td>
      </tr>
    );
  };

  const header = (
    <thead className="text-muted text-xs">
      <tr>
        <th scope="col" className="px-2 py-1 text-center">
          <span className="sr-only">{t('contentPlan.col.select')}</span>
        </th>
        <th scope="col" className="px-2 py-1 text-left font-medium">
          {t('contentPlan.col.field')}
        </th>
        <th scope="col" className="px-2 py-1 text-left font-medium">
          {t('contentPlan.col.value')}
        </th>
        <th scope="col" className="px-2 py-1 text-left font-medium">
          {t('contentPlan.col.quote')}
        </th>
      </tr>
    </thead>
  );

  const group = (key: string, scope: PlanRowScope[]) => {
    const list = rows.filter(r => scope.includes(r.scope));
    if (list.length === 0) return null;
    const refs = [...new Set(list.map(r => r.ref))];
    const nested = scope[0] === 'component' || scope[0] === 'learningField';
    return (
      <section key={key} className="mt-4">
        <h4 className="text-foreground text-sm font-semibold">
          {t(`contentPlan.group.${key}`)}
        </h4>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <caption className="sr-only">
              {t('contentPlan.tableCaption')}
            </caption>
            {header}
            {nested ? (
              refs.map(ref => (
                <tbody key={ref}>
                  <tr className="bg-accent/10">
                    <th
                      scope="rowgroup"
                      colSpan={4}
                      className="text-foreground px-2 py-1 text-left text-sm font-semibold break-words"
                    >
                      {ref}
                    </th>
                  </tr>
                  {list.filter(r => r.ref === ref).map(renderRow)}
                </tbody>
              ))
            ) : (
              <tbody>{list.map(renderRow)}</tbody>
            )}
          </table>
        </div>
      </section>
    );
  };

  const counts = (plan: StoredContentPlan['plan']) => ({
    components: plan.components?.length ?? 0,
    learningFields: plan.learningFields?.length ?? 0,
    relations: plan.relations?.length ?? 0,
  });

  return (
    <div
      aria-labelledby={`${id}-title`}
      role="group"
      className="bg-background/60 border-border mt-4 rounded-2xl border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3
            id={`${id}-title`}
            className="text-foreground flex items-center gap-2 font-semibold"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            {t('contentPlan.title')}
          </h3>
          <p className="text-muted mt-0.5 text-sm">
            {t('contentPlan.optional')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          aria-controls={`${id}-body`}
          className={button}
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          )}
          {expanded ? t('contentPlan.close') : t('contentPlan.open')}
        </button>
      </div>

      {expanded && (
        <div id={`${id}-body`} className="mt-4">
          <p className="text-foreground text-sm font-medium">
            {t('contentPlan.neverReplaces')}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void downloadTemplate('xlsx')}
              className={button}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t('contentPlan.templateXlsx')}
            </button>
            <button
              type="button"
              onClick={() => void downloadTemplate('json')}
              className={button}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t('contentPlan.templateJson')}
            </button>
          </div>

          <div
            onDragOver={e => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`mt-3 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-dashed p-4 transition-colors motion-reduce:transition-none ${
              dragOver ? 'border-accent bg-accent/10' : 'border-border'
            }`}
          >
            <button
              ref={uploadRef}
              type="button"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
              aria-describedby={`${id}-drop`}
              className={primary}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              {t('contentPlan.upload')}
            </button>
            <p id={`${id}-drop`} className="text-muted min-w-0 flex-1 text-sm">
              {dragOver
                ? t('contentPlan.dropActive')
                : t('contentPlan.dropHint')}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".docx,.xlsx,.csv,.json,.pdf"
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
              onChange={e => {
                handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>

          <div
            role="alert"
            className="mt-2 text-sm text-red-700 dark:text-red-400"
          >
            {error}
          </div>
          <p role="status" className="sr-only">
            {busy === 'reading' ? t('contentPlan.reading') : ''}
          </p>
          {busy === 'reading' && (
            <div className="mt-3 flex items-center gap-2" aria-hidden="true">
              <LoadingSpinner size="sm" />
              <span className="text-muted text-sm">
                {t('contentPlan.reading')}
              </span>
            </div>
          )}

          {pending && (
            <div className="border-border mt-3 rounded-2xl border p-4">
              <h4 className="text-foreground flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {t('contentPlan.kiConfirmTitle')}
              </h4>
              <p className="text-muted mt-1 text-sm">
                {t('contentPlan.kiConfirmText')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void parse(pending, true)}
                  className={primary}
                >
                  {t('contentPlan.kiRead')}
                </button>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className={button}
                >
                  {t('contentPlan.kiCancel')}
                </button>
              </div>
            </div>
          )}

          {proposal && (
            <div className="border-accent/40 mt-4 rounded-2xl border p-4">
              <h4
                ref={headingRef}
                tabIndex={-1}
                className="text-foreground text-base font-semibold focus:outline-none"
              >
                {t('contentPlan.proposal', { name: proposal.fileName })}
              </h4>
              <p
                className={`mt-1 flex items-center gap-1.5 text-sm font-medium ${
                  proposal.method === 'ki'
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-muted'
                }`}
              >
                {proposal.method === 'ki' && (
                  <AlertTriangle
                    className="h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                )}
                {proposal.method === 'ki'
                  ? t('contentPlan.methodKi')
                  : t('contentPlan.methodScript')}
              </p>
              {proposal.ki && (
                <p className="text-muted mt-1 text-xs">
                  {t('contentPlan.kiStats', {
                    kept: proposal.ki.accepted,
                    dropped: proposal.ki.dropped,
                  })}
                </p>
              )}
              {proposal.warnings
                .filter(w => w !== 'KI_REVIEW')
                .map(w => (
                  <p
                    key={w}
                    className="mt-2 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400"
                  >
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    {t(`contentPlan.warning.${w}`)}
                  </p>
                ))}
              {proposal.issues.length > 0 && (
                <details className="mt-2 text-sm">
                  <summary className="text-muted cursor-pointer">
                    {t('contentPlan.issuesTitle', {
                      count: proposal.issues.length,
                    })}
                  </summary>
                  <ul className="text-muted mt-1 list-disc pl-5 text-xs">
                    {proposal.issues.map((issue, index) => (
                      <li key={`${issue.where}-${index}`}>
                        {issue.where}: {t(`contentPlan.issue.${issue.message}`)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <label className="text-foreground mt-3 flex min-h-[44px] items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(
                      allSelected ? new Set() : new Set(rows.map(r => r.id))
                    )
                  }
                  className="h-5 w-5 accent-red-700"
                />
                {t('contentPlan.selectAll')}
              </label>
              <p role="status" className="text-muted text-xs">
                {t('contentPlan.selectedCount', {
                  selected: selected.size,
                  total: rows.length,
                })}
              </p>

              {GROUPS.map(g => group(g.key, g.scope))}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void apply()}
                  disabled={busy !== null || selected.size === 0}
                  className={primary}
                >
                  {t('contentPlan.applyCount', { count: selected.size })}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    toast.success(t('contentPlan.discarded'));
                  }}
                  disabled={busy === 'saving'}
                  className={button}
                >
                  {t('contentPlan.discard')}
                </button>
              </div>
            </div>
          )}

          <div className="border-border mt-4 border-t pt-3">
            <h4 className="text-foreground text-sm font-semibold">
              {t('contentPlan.storedTitle')}
            </h4>
            {stored === undefined ? (
              <p className="text-muted mt-1 text-sm">
                {error ? '' : t('contentPlan.reading')}
              </p>
            ) : stored === null ? (
              <p className="text-muted mt-1 text-sm">
                {t('contentPlan.storedNone')}
              </p>
            ) : (
              <div className="mt-1 text-sm">
                <p className="text-foreground">
                  {t('contentPlan.storedSource', {
                    name: stored.source.fileName,
                    method: t(`contentPlan.method.${stored.source.method}`),
                    date: new Date(stored.source.savedAt).toLocaleDateString(
                      language
                    ),
                    count: stored.source.fieldCount,
                  })}
                </p>
                <p className="text-muted">
                  {t('contentPlan.storedSummary', counts(stored.plan))}
                </p>
                {!confirmRemove ? (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    disabled={busy !== null}
                    className={`${button} mt-2`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    {t('contentPlan.remove')}
                  </button>
                ) : (
                  <div
                    className="mt-2"
                    role="group"
                    aria-label={t('contentPlan.remove')}
                  >
                    <p className="text-foreground">
                      {t('contentPlan.removeConfirm')}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void remove()}
                        disabled={busy !== null}
                        className={primary}
                        autoFocus
                      >
                        {t('contentPlan.removeYes')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(false)}
                        className={button}
                      >
                        {t('contentPlan.removeNo')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
