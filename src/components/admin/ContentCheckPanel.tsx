'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Download,
  FileJson,
  FileSpreadsheet,
  Info,
  ListChecks,
  MinusCircle,
  Sparkles,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  downloadText,
  reportFileName,
  reportToCsv,
  reportToJson,
  type CsvLabels,
} from '@/lib/catalog/content-check/export';
import type {
  ContentCheckReport,
  Finding,
  FindingRefType,
  FindingSeverity,
  FindingSource,
} from '@/lib/catalog/content-check/types';

const SEVERITIES: readonly FindingSeverity[] = ['error', 'warning', 'info'];
const SOURCES: readonly FindingSource[] = ['script', 'ki', 'plan'];
const REF_TYPES: readonly FindingRefType[] = [
  'catalog',
  'course',
  'enabler',
  'useCase',
  'quiz',
  'question',
  'document',
  'learningField',
];
const KNOWN_CATEGORIES = new Set([
  'structure',
  'quiz',
  'document',
  'text',
  'content',
  'plan',
]);

/**
 * Severity as symbol plus text, never color alone. The rail on the left edge of
 * a finding repeats the severity, the colors have a light and a dark variant.
 */
const SEVERITY_STYLE: Record<
  FindingSeverity,
  { Icon: LucideIcon; text: string; rail: string }
> = {
  error: {
    Icon: XCircle,
    text: 'text-red-700 dark:text-red-400',
    rail: 'border-red-600 dark:border-red-500',
  },
  warning: {
    Icon: AlertTriangle,
    text: 'text-amber-700 dark:text-amber-400',
    rail: 'border-amber-600 dark:border-amber-500',
  },
  info: {
    Icon: Info,
    text: 'text-blue-700 dark:text-blue-400',
    rail: 'border-blue-600 dark:border-blue-500',
  },
};

const SOURCE_ICON: Record<FindingSource, LucideIcon> = {
  script: ListChecks,
  ki: Sparkles,
  plan: ClipboardCheck,
};

type ErrorKey = 'generic' | 'rate' | 'running' | 'forbidden' | 'notFound';

const errorKeyOf = (status: number): ErrorKey =>
  status === 429
    ? 'rate'
    : status === 409
      ? 'running'
      : status === 403
        ? 'forbidden'
        : status === 404
          ? 'notFound'
          : 'generic';

const BUTTON =
  'text-foreground hover:bg-accent/10 border-border focus-visible:ring-accent flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50';

function SourceBadge({ source }: { source: FindingSource }) {
  const { t } = useLanguage();
  const Icon = SOURCE_ICON[source];
  return (
    <span
      className={`text-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        source === 'ki'
          ? 'border border-dashed border-purple-600 dark:border-purple-400'
          : 'bg-accent/10'
      }`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {t(`contentCheck.source.${source}`)}
    </span>
  );
}

function FindingItem({ finding }: { finding: Finding }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const style = SEVERITY_STYLE[finding.severity];
  const hasBody =
    !!finding.details ||
    !!finding.hint ||
    finding.refs.length > 0 ||
    finding.source === 'ki';

  return (
    <li
      className={`border-l-4 py-2 pr-1 pl-3 ${style.rail} ${
        finding.source === 'ki' ? 'border-dashed' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        disabled={!hasBody}
        className="focus-visible:ring-accent flex min-h-[44px] w-full items-start gap-2 rounded-lg text-left focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default"
      >
        <style.Icon
          className={`mt-0.5 h-4 w-4 shrink-0 ${style.text}`}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="sr-only">
            {t(`contentCheck.severityOne.${finding.severity}`)}:{' '}
          </span>
          <span className="text-foreground block font-medium break-words">
            {finding.summary}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <SourceBadge source={finding.source} />
            {finding.refs.length === 1 ? (
              <span className="text-muted text-xs break-words">
                {t(`contentCheck.refType.${finding.refs[0].type}`)}:{' '}
                {finding.refs[0].label}
              </span>
            ) : finding.refs.length > 1 ? (
              <span className="text-muted text-xs tabular-nums">
                {t('contentCheck.finding.objectCount', {
                  count: finding.refs.length,
                })}
              </span>
            ) : null}
          </span>
        </span>
        {hasBody && (
          <ChevronDown
            className={`text-muted mt-1 h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${
              open ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          />
        )}
      </button>

      {open && hasBody && (
        <div id={bodyId} className="mt-1 space-y-2 pl-6 text-sm">
          {finding.source === 'ki' && (
            <p className="text-muted flex items-start gap-1 text-xs">
              <Sparkles
                className="mt-0.5 h-3 w-3 shrink-0"
                aria-hidden="true"
              />
              {t('contentCheck.finding.kiNote')}
            </p>
          )}
          {finding.details && (
            <p className="text-foreground break-words">
              <span className="text-muted">
                {t('contentCheck.finding.details')}:{' '}
              </span>
              {finding.details}
            </p>
          )}
          {finding.hint && (
            <p className="text-foreground break-words">
              <span className="text-muted">
                {t('contentCheck.finding.hint')}:{' '}
              </span>
              {finding.hint}
            </p>
          )}
          {finding.refs.length > 0 && (
            <div>
              <p className="text-muted text-xs">
                {t('contentCheck.finding.objects')}
              </p>
              <ul role="list" className="mt-1 space-y-0.5">
                {finding.refs.map(r => (
                  <li
                    key={`${r.type}-${r.id}`}
                    className="text-foreground break-words"
                  >
                    <span className="text-muted">
                      {t(`contentCheck.refType.${r.type}`)}:{' '}
                    </span>
                    {r.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function SeverityGroup({
  severity,
  findings,
  categoryName,
}: {
  severity: FindingSeverity;
  findings: Finding[];
  categoryName: (category: string) => string;
}) {
  const { t } = useLanguage();
  // Errors and warnings are open, the notes are folded away
  const [open, setOpen] = useState(severity !== 'info');
  const headingId = useId();
  const regionId = useId();
  const style = SEVERITY_STYLE[severity];

  const byCategory = useMemo(() => {
    const groups = new Map<string, Finding[]>();
    for (const f of findings) {
      const list = groups.get(f.category) ?? [];
      list.push(f);
      groups.set(f.category, list);
    }
    return [...groups.entries()];
  }, [findings]);

  return (
    <section aria-labelledby={headingId} className="border-border border-t">
      <h4 id={headingId} className="text-foreground">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          aria-controls={regionId}
          className="focus-visible:ring-accent flex min-h-[44px] w-full items-center gap-2 text-left font-semibold focus-visible:ring-2 focus-visible:outline-none"
        >
          <style.Icon
            className={`h-5 w-5 shrink-0 ${style.text}`}
            aria-hidden="true"
          />
          <span>{t(`contentCheck.severity.${severity}`)}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${style.text} bg-foreground/5`}
          >
            {findings.length}
          </span>
          <ChevronDown
            className={`text-muted ml-auto h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${
              open ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          />
        </button>
      </h4>
      <div id={regionId} hidden={!open} className="pb-3">
        {byCategory.map(([category, list]) => (
          <div key={category} className="mt-2">
            <h5 className="text-muted text-xs font-semibold tracking-wide uppercase">
              {categoryName(category)} ({list.length})
            </h5>
            <ul role="list" className="mt-1">
              {list.map((f, i) => (
                <FindingItem key={`${f.rule}-${i}`} finding={f} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The content check of one training catalog (platform admin only): a button for
 * the script checks, one with the AI review, the result grouped by severity and
 * category, filtered by source, and the report as JSON or CSV. The check runs on
 * demand and is not stored, so nothing is loaded when the panel appears. The
 * route checks the right again.
 */
export function ContentCheckPanel({
  catalogId,
  catalogCode,
}: {
  catalogId: string;
  catalogCode: string;
}) {
  const { t, language } = useLanguage();
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle'
  );
  const [loadingKi, setLoadingKi] = useState(false);
  const [requestedKi, setRequestedKi] = useState(false);
  const [report, setReport] = useState<ContentCheckReport | null>(null);
  const [errorKey, setErrorKey] = useState<ErrorKey>('generic');
  const [source, setSource] = useState<FindingSource | 'all'>('all');
  // Only the newest request may change the screen, nothing is set after unmount
  const latest = useRef(0);
  useEffect(
    () => () => {
      latest.current += 1;
    },
    []
  );

  const run = useCallback(
    async (ki: boolean) => {
      const mine = ++latest.current;
      setStatus('loading');
      setLoadingKi(ki);
      try {
        const res = await authFetch(
          `/api/admin/catalogs/${catalogId}/content-check`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ki }),
            cache: 'no-store',
          }
        );
        if (!res.ok) {
          if (mine === latest.current) {
            // An older result must not stand next to the error as if it were new
            setReport(null);
            setErrorKey(errorKeyOf(res.status));
            setStatus('error');
          }
          return;
        }
        const body = (await res.json()) as ContentCheckReport;
        if (mine === latest.current) {
          setReport(body);
          setRequestedKi(ki);
          setSource('all');
          setStatus('done');
        }
      } catch {
        if (mine === latest.current) {
          setReport(null);
          setErrorKey('generic');
          setStatus('error');
        }
      }
    },
    [catalogId]
  );

  const categoryName = useCallback(
    (category: string) =>
      KNOWN_CATEGORIES.has(category)
        ? t(`contentCheck.category.${category}`)
        : category,
    [t]
  );

  const visible = useMemo(
    () =>
      report
        ? report.findings.filter(f => source === 'all' || f.source === source)
        : [],
    [report, source]
  );

  const sourceCount = (s: FindingSource | 'all') =>
    report
      ? report.findings.filter(f => s === 'all' || f.source === s).length
      : 0;

  const download = (kind: 'json' | 'csv') => {
    if (!report) return;
    if (kind === 'json') {
      downloadText(
        reportFileName(report, 'json'),
        reportToJson(report),
        'application/json;charset=utf-8'
      );
      return;
    }
    const labels: CsvLabels = {
      headers: [
        t('contentCheck.csv.severity'),
        t('contentCheck.csv.source'),
        t('contentCheck.csv.category'),
        t('contentCheck.csv.rule'),
        t('contentCheck.csv.summary'),
        t('contentCheck.csv.details'),
        t('contentCheck.csv.hint'),
        t('contentCheck.csv.objects'),
      ],
      severity: Object.fromEntries(
        SEVERITIES.map(s => [s, t(`contentCheck.severityOne.${s}`)])
      ) as CsvLabels['severity'],
      source: Object.fromEntries(
        SOURCES.map(s => [s, t(`contentCheck.source.${s}`)])
      ) as CsvLabels['source'],
      refType: Object.fromEntries(
        REF_TYPES.map(r => [r, t(`contentCheck.refType.${r}`)])
      ) as CsvLabels['refType'],
      category: categoryName,
    };
    downloadText(
      reportFileName(report, 'csv'),
      reportToCsv(report, labels),
      'text/csv;charset=utf-8'
    );
  };

  const loading = status === 'loading';
  const titleId = `content-check-${catalogId}`;
  const ranText = (key: 'script' | 'ki' | 'plan') => {
    if (!report) return '';
    if (key === 'ki' && !requestedKi) return t('contentCheck.ran.notRequested');
    return report.ran[key]
      ? t('contentCheck.ran.yes')
      : t('contentCheck.ran.no');
  };

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={loading}
      className="border-border mt-6 border-t pt-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id={titleId}
            className="text-foreground flex items-center gap-2 text-lg font-bold"
          >
            <ClipboardCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
            {t('contentCheck.title')}
            <span className="sr-only"> {catalogCode}</span>
          </h3>
          <p className="text-muted mt-1 max-w-3xl text-sm">
            {t('contentCheck.hint')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => run(false)}
            disabled={loading}
            className={BUTTON}
          >
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            {t('contentCheck.run')}
          </button>
          <button
            type="button"
            onClick={() => run(true)}
            disabled={loading}
            aria-describedby={`${titleId}-ki`}
            className={BUTTON}
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {t('contentCheck.runKi')}
          </button>
        </div>
      </div>
      <p id={`${titleId}-ki`} className="text-muted mt-2 text-xs">
        {t('contentCheck.kiHint')}
      </p>

      <p
        role="status"
        className={loading ? 'text-muted mt-4 text-sm' : 'sr-only'}
      >
        {loading
          ? t(loadingKi ? 'contentCheck.runningKi' : 'contentCheck.running')
          : status === 'done'
            ? t('contentCheck.done')
            : ''}
      </p>

      {status === 'error' && (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
          {t(`contentCheck.error.${errorKey}`)}
        </p>
      )}

      {status === 'idle' && (
        <p className="text-muted mt-4 flex items-center gap-1.5 text-sm">
          <MinusCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('contentCheck.idle')}
        </p>
      )}

      {report && status !== 'idle' && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted text-sm tabular-nums">
              {t('contentCheck.generated', {
                time: new Date(report.generatedAt).toLocaleString(language),
              })}
              {' · '}
              {t(
                report.findings.length === 1
                  ? 'contentCheck.total.one'
                  : 'contentCheck.total',
                { count: report.findings.length.toLocaleString(language) }
              )}
            </p>
            <div
              role="group"
              aria-label={t('contentCheck.download.group')}
              className="flex flex-wrap items-center gap-2"
            >
              <button
                type="button"
                onClick={() => download('json')}
                className={BUTTON}
              >
                <FileJson className="h-4 w-4" aria-hidden="true" />
                <Download className="h-3 w-3" aria-hidden="true" />
                {t('contentCheck.download.json')}
              </button>
              <button
                type="button"
                onClick={() => download('csv')}
                className={BUTTON}
              >
                <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                <Download className="h-3 w-3" aria-hidden="true" />
                {t('contentCheck.download.csv')}
              </button>
            </div>
          </div>

          <ul
            role="list"
            className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm tabular-nums"
          >
            {SEVERITIES.map(s => {
              const style = SEVERITY_STYLE[s];
              return (
                <li
                  key={s}
                  className={`flex items-center gap-1.5 font-semibold ${style.text}`}
                >
                  <style.Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{report.counts[s].toLocaleString(language)}</span>
                  <span className="font-medium">
                    {t(`contentCheck.severity.${s}`)}
                  </span>
                </li>
              );
            })}
          </ul>

          <ul
            role="list"
            className="text-muted mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs"
          >
            {SOURCES.map(key => (
              <li key={key} className="flex items-center gap-1">
                {report.ran[key] ? (
                  <CheckCircle2
                    className="h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <MinusCircle
                    className="h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span>
                  {t(`contentCheck.ran.label.${key}`)}: {ranText(key)}
                </span>
              </li>
            ))}
          </ul>

          {report.notes.length > 0 && (
            <div className="mt-3">
              <p className="text-muted text-xs font-semibold">
                {t('contentCheck.notes')}
              </p>
              <ul
                role="list"
                className="text-muted mt-1 list-disc space-y-0.5 pl-5 text-xs"
              >
                {report.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          <div
            role="group"
            aria-label={t('contentCheck.source.filter')}
            className="mt-4 flex flex-wrap gap-2"
          >
            {(['all', ...SOURCES] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                aria-pressed={source === s}
                className={`focus-visible:ring-accent flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none ${
                  source === s
                    ? 'border-accent bg-accent/15 text-foreground'
                    : 'border-border text-foreground hover:bg-accent/10'
                }`}
              >
                {source === s && (
                  <CheckCircle2
                    className="h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                )}
                {t(`contentCheck.source.${s}`)}
                <span className="text-muted text-xs tabular-nums">
                  {sourceCount(s)}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-3">
            {report.findings.length === 0 ? (
              <p className="flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('contentCheck.empty.none')}
              </p>
            ) : visible.length === 0 ? (
              <p className="text-muted text-sm">
                {t('contentCheck.empty.filtered')}
              </p>
            ) : (
              SEVERITIES.map(s => {
                const list = visible.filter(f => f.severity === s);
                return list.length === 0 ? null : (
                  <SeverityGroup
                    key={s}
                    severity={s}
                    findings={list}
                    categoryName={categoryName}
                  />
                );
              })
            )}
          </div>
        </div>
      )}
    </section>
  );
}
