'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpCircle,
  BarChart3,
  CheckCircle2,
  MinusCircle,
  Pencil,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ContentTargetsForm } from '@/components/admin/ContentTargetsForm';
import type {
  CatalogContentStats,
  ContentMetric,
  ContentStatsResponse,
  MetricStatus,
} from '@/lib/catalog/content-targets';

/**
 * Status as symbol plus text, never color alone. The colors only support the
 * words and have a light and a dark variant.
 */
const STATUS_STYLE: Record<
  MetricStatus,
  { Icon: LucideIcon; text: string; bar: string }
> = {
  met: {
    Icon: CheckCircle2,
    text: 'text-green-700 dark:text-green-400',
    bar: 'bg-green-600 dark:bg-green-500',
  },
  missing: {
    Icon: AlertTriangle,
    text: 'text-amber-700 dark:text-amber-400',
    bar: 'bg-amber-600 dark:bg-amber-500',
  },
  exceeds: {
    Icon: ArrowUpCircle,
    text: 'text-blue-700 dark:text-blue-400',
    bar: 'bg-blue-600 dark:bg-blue-500',
  },
  no_target: {
    Icon: MinusCircle,
    text: 'text-muted',
    bar: 'bg-muted',
  },
};

/** A difference with a real minus sign and an explicit plus for a surplus. */
function formatDifference(difference: number): string {
  if (difference > 0) return `+${difference}`;
  if (difference < 0) return `−${Math.abs(difference)}`;
  return '0';
}

function MetricItem({
  metric,
  targetsVisible,
}: {
  metric: ContentMetric;
  targetsVisible: boolean;
}) {
  const { t, language } = useLanguage();
  const number = (n: number) => n.toLocaleString(language);
  const label = t(`contentStats.metric.${metric.id}`);
  const style = STATUS_STYLE[metric.status];
  const hasTarget = metric.target !== null && metric.percent !== null;

  return (
    <li className="bg-background/50 rounded-2xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span className="text-foreground font-semibold">{label}</span>
        {targetsVisible && (
          <span
            className={`flex items-center gap-1 text-sm font-medium ${style.text}`}
          >
            <style.Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t(`contentStats.status.${metric.status}`)}
          </span>
        )}
      </div>

      {targetsVisible && hasTarget && (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={metric.percent ?? 0}
          aria-valuetext={t('contentStats.progress', {
            label,
            percent: metric.percent ?? 0,
            target: number(metric.target ?? 0),
          })}
          className="bg-foreground/10 mt-3 h-2 w-full overflow-hidden rounded-full"
        >
          <div
            className={`h-full rounded-full transition-[width] motion-reduce:transition-none ${style.bar}`}
            style={{ width: `${metric.percent ?? 0}%` }}
          />
        </div>
      )}

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm tabular-nums">
        <div className="flex gap-1.5">
          <dt className="text-muted">{t('contentStats.actual')}</dt>
          <dd className="text-foreground font-semibold">
            {number(metric.actual)}
          </dd>
        </div>
        {targetsVisible && (
          <>
            <div className="flex gap-1.5">
              <dt className="text-muted">{t('contentStats.target')}</dt>
              <dd className="text-foreground font-semibold">
                {metric.target === null
                  ? t('contentStats.noTarget')
                  : number(metric.target)}
              </dd>
            </div>
            {metric.difference !== null && (
              <div className="flex gap-1.5">
                <dt className="text-muted">{t('contentStats.difference')}</dt>
                <dd className={`font-semibold ${style.text}`}>
                  {formatDifference(metric.difference)}
                </dd>
              </div>
            )}
          </>
        )}
      </dl>

      {metric.active !== null && (
        <p className="text-muted mt-1 text-xs tabular-nums">
          {t('contentStats.activeSplit', {
            active: number(metric.active),
            inactive: number(Math.max(0, metric.actual - metric.active)),
          })}
        </p>
      )}
    </li>
  );
}

function CatalogCard({
  catalog,
  targetsVisible,
  canEditTargets,
  onSaved,
}: {
  catalog: CatalogContentStats;
  targetsVisible: boolean;
  canEditTargets: boolean;
  onSaved: () => void;
}) {
  const { t, language } = useLanguage();
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement | null>(null);
  const wasEditing = useRef(false);
  const titleId = `content-stats-${catalog.catalogId}`;

  // Back on the button that opened the form, so the keyboard keeps its place
  useEffect(() => {
    if (wasEditing.current && !editing) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  return (
    <section
      aria-labelledby={titleId}
      className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id={titleId}
              className="text-foreground min-w-0 text-xl font-bold break-words"
            >
              {catalog.title}
            </h2>
            <span className="bg-accent/10 text-foreground rounded-full px-2 py-0.5 text-xs font-medium">
              {catalog.code}
            </span>
          </div>
          <p className="text-muted mt-1 flex items-center gap-1 text-sm">
            {catalog.isActive ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <MinusCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            {catalog.isActive
              ? t('contentStats.catalogActive')
              : t('contentStats.catalogInactive')}
          </p>
        </div>
        {canEditTargets && !editing && (
          <button
            ref={editRef}
            type="button"
            onClick={() => setEditing(true)}
            className="text-foreground hover:bg-accent/10 border-border flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {t('contentStats.edit')}
          </button>
        )}
      </div>

      {editing && (
        <ContentTargetsForm
          catalog={catalog}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
          onClose={() => setEditing(false)}
        />
      )}

      <ul
        aria-label={t('contentStats.cardLabel', { name: catalog.title })}
        className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2"
      >
        {catalog.metrics.map(metric => (
          <MetricItem
            key={metric.id}
            metric={metric}
            targetsVisible={targetsVisible}
          />
        ))}
      </ul>

      <dl className="text-muted mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
        <div className="flex gap-1.5">
          <dt>{t('contentStats.extra.questions')}</dt>
          <dd className="text-foreground font-semibold">
            {catalog.questions.toLocaleString(language)}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>{t('contentStats.extra.mappings')}</dt>
          <dd className="text-foreground font-semibold">
            {catalog.mappings.toLocaleString(language)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * The content statistics of the training catalogs for the admin: actual,
 * target, difference and status per kind of content. The platform admin sees
 * every catalog with targets and may change them, an organization admin sees
 * the actual numbers of the catalogs of the own organization. The server
 * decides what is in the answer, this view only shows it.
 */
export function ContentStatsView() {
  const { t } = useLanguage();
  const [data, setData] = useState<ContentStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/content-stats', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(t('contentStats.loadFailed'));
      setData((await res.json()) as ContentStatsResponse);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('contentStats.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="from-accent to-primary flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br">
              <BarChart3
                className="text-foreground h-7 w-7"
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-foreground text-2xl font-bold sm:text-3xl">
                {t('contentStats.title')}
              </h1>
              <p className="text-muted">
                {data && !data.targetsVisible
                  ? t('contentStats.subtitleOrg')
                  : t('contentStats.subtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="text-foreground hover:bg-accent/10 border-border flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`}
              aria-hidden="true"
            />
            {t('contentStats.refresh')}
          </button>
        </div>
        {data && !data.targetsVisible && (
          <p className="text-muted mt-4 text-sm">
            {t('contentStats.targetsHidden')}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {!data && !error && (
        <div className="flex justify-center p-8">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {data && data.catalogs.length === 0 && (
        <p className="text-muted border-accent/30 rounded-3xl border p-8 text-center">
          {t('contentStats.empty')}
        </p>
      )}

      {data?.catalogs.map(catalog => (
        <CatalogCard
          key={catalog.catalogId}
          catalog={catalog}
          targetsVisible={data.targetsVisible}
          canEditTargets={data.canEditTargets}
          onSaved={load}
        />
      ))}
    </div>
  );
}
