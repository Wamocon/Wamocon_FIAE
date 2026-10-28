'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BookOpen, Power, Rocket } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ContentReleasePanel } from '@/components/admin/ContentReleasePanel';
import {
  DEFAULT_CATALOG_CODE,
  catalogErrorMessage,
  type CatalogSummary,
} from '@/components/admin/catalogAdminApi';

type Props = {
  /** Called after a catalog was switched, so dependent lists can reload. */
  onChanged?: () => void;
};

/**
 * Platform admin only: which training catalogs (occupations) are active on the
 * platform. FIAE stays active, a catalog with enrolled trainees cannot be
 * switched off, the API answers 409 and the reason is shown here.
 */
export function CatalogActivationPanel({ onChanged }: Props) {
  const { t } = useLanguage();
  const [catalogs, setCatalogs] = useState<CatalogSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  // The catalog whose release tool is open
  const [releaseId, setReleaseId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/catalogs', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(t('admin.catalogs.loadFailed'));
      const data = await res.json();
      setCatalogs(data.catalogs || []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || t('error.unknown'));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (catalog: CatalogSummary) => {
    const next = !catalog.isActive;
    if (
      !next &&
      !window.confirm(
        t('admin.catalogs.confirmDeactivate', { name: catalog.title })
      )
    ) {
      return;
    }
    setBusyIds(prev => new Set(prev).add(catalog.id));
    try {
      const res = await authFetch(`/api/admin/catalogs/${catalog.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        throw new Error(
          await catalogErrorMessage(res, t, 'admin.catalogs.updateFailed')
        );
      }
      toast.success(
        next ? t('admin.catalogs.activated') : t('admin.catalogs.deactivated')
      );
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message || t('admin.catalogs.updateFailed'));
    } finally {
      setBusyIds(prev => {
        const n = new Set(prev);
        n.delete(catalog.id);
        return n;
      });
    }
  };

  return (
    <section
      aria-labelledby="catalog-panel-title"
      className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg"
    >
      <div className="mb-6 flex items-center gap-4">
        <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
          <BookOpen className="text-foreground h-6 w-6" />
        </div>
        <div>
          <h2
            id="catalog-panel-title"
            className="text-foreground text-xl font-bold"
          >
            {t('admin.catalogs.sectionTitle')}
          </h2>
          <p className="text-muted text-sm">
            {t('admin.catalogs.sectionSubtitle')}
          </p>
          <p className="text-muted mt-1 text-xs">
            {t('admin.catalogs.countNote')}
          </p>
        </div>
      </div>

      {error && <div className="text-sm text-red-500">{error}</div>}
      {!catalogs && !error && <LoadingSpinner size="md" />}

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(catalogs ?? []).map(catalog => {
          const isDefault = catalog.code === DEFAULT_CATALOG_CODE;
          return (
            <li
              key={catalog.id}
              className="bg-background/50 flex flex-col gap-3 rounded-2xl p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground font-semibold">
                      {catalog.title}
                    </span>
                    <span className="bg-accent/10 text-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                      {catalog.code}
                    </span>
                    {isDefault && (
                      <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400">
                        {t('admin.catalogs.defaultBadge')}
                      </span>
                    )}
                  </div>
                  <p className="text-muted mt-1 text-xs">
                    {t('admin.catalogs.trainees', {
                      count: catalog.traineeCount,
                    })}
                    {' · '}
                    {t('admin.catalogs.organizations', {
                      count: catalog.organizationCount,
                    })}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    catalog.isActive
                      ? 'bg-green-500/10 text-green-500'
                      : 'bg-red-500/10 text-red-500'
                  }`}
                >
                  {catalog.isActive
                    ? t('admin.catalogs.active')
                    : t('admin.catalogs.inactive')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => toggle(catalog)}
                disabled={
                  busyIds.has(catalog.id) || (isDefault && catalog.isActive)
                }
                title={
                  isDefault && catalog.isActive
                    ? t('admin.catalogs.error.DEFAULT_CATALOG')
                    : undefined
                }
                className={`flex w-fit items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-all disabled:opacity-50 ${
                  catalog.isActive
                    ? 'border border-red-400/50 text-red-500 hover:bg-red-500/10'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                <Power className="h-4 w-4" />
                {catalog.isActive
                  ? t('admin.catalogs.deactivate')
                  : t('admin.catalogs.activate')}
              </button>
              <button
                type="button"
                aria-expanded={releaseId === catalog.id}
                onClick={() =>
                  setReleaseId(releaseId === catalog.id ? null : catalog.id)
                }
                className="text-foreground hover:bg-accent/10 border-border focus-visible:ring-accent flex w-fit items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
              >
                <Rocket className="h-4 w-4" aria-hidden="true" />
                {t('contentRelease.open')}
              </button>
              {releaseId === catalog.id && (
                <ContentReleasePanel
                  catalogId={catalog.id}
                  catalogCode={catalog.code}
                  onClose={() => setReleaseId(null)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
