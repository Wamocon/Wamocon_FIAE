'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Lock } from 'lucide-react';
import { CatalogRequestDialog } from '@/components/catalog/CatalogRequestDialog';
import type { PublicCatalogSummary } from '@/components/catalog/CatalogSelection';
import { useAuth } from '@/contexts/AuthContext';
import { useCatalog } from '@/contexts/CatalogContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { normalizeRole, ROLE } from '@/lib/auth/roles';
import { FIAE_CATALOG_CODE, isBrandingApplied } from '@/lib/catalog/branding';
import { dashboardPathForRole } from '@/lib/catalog/choice';

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; catalogs: PublicCatalogSummary[] };

function sortCatalogs(catalogs: PublicCatalogSummary[]) {
  const rank = (code: string) => (code === FIAE_CATALOG_CODE ? 0 : 1);
  return [...catalogs].sort(
    (a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code)
  );
}

/**
 * The occupation choice after the sign in: one tile for every active
 * occupation of the platform (public list). An occupation the user has
 * (CatalogContext) is open and leads into it. Every other one is greyed out,
 * not hidden, and offers "Abo anfragen" (dialog), except for a trainee, who is
 * told to ask the trainer. A platform administrator has every occupation.
 *
 * What a tile shows (title, description, duration, phases) comes from the data
 * of the occupation, nothing is fixed here. The accent only comes from the
 * branding of an occupation the user has (and never for FIAE).
 */
export function CatalogTiles() {
  const { t } = useLanguage();
  const router = useRouter();
  const { profile } = useAuth();
  const { status, catalogs: mine, activeCode, selectCatalog } = useCatalog();
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [requesting, setRequesting] = useState<PublicCatalogSummary | null>(
    null
  );
  const opener = useRef<HTMLElement | null>(null);
  const alive = useRef(false);
  const baseId = useId();

  const load = useCallback(async () => {
    setList({ status: 'loading' });
    try {
      const res = await fetch('/api/catalogs');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!alive.current) return;
      setList({
        status: 'ready',
        catalogs: Array.isArray(data?.catalogs) ? data.catalogs : [],
      });
    } catch {
      if (alive.current) setList({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const isTrainee = normalizeRole(profile?.role) === ROLE.TRAINEE;
  const destination = dashboardPathForRole(profile?.role);

  const choose = (code: string) => {
    // The occupation the app already works in: nothing to change, no reload
    if (code === activeCode) router.push(destination);
    else selectCatalog(code, destination);
  };

  const userLoading = status === 'idle' || status === 'loading';
  if (list.status === 'loading' || userLoading) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t('catalog.tiles.loading')}
      </p>
    );
  }

  if (list.status === 'error') {
    return (
      <div role="alert" className="space-y-4">
        <p className="text-sm text-red-600 dark:text-red-400">
          {t('catalog.tiles.error')}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="bg-primary text-primary-foreground hover:bg-primary/90 min-h-11 rounded-xl px-5 py-2 text-sm font-semibold"
        >
          {t('catalog.tiles.retry')}
        </button>
      </div>
    );
  }

  // The occupations of the user are unknown: do not guess which tile is open,
  // let the person go on (like the rest of the app, which fails open)
  if (status === 'error') {
    return (
      <div role="alert" className="space-y-4">
        <p className="text-foreground text-sm">
          {t('catalog.tiles.userError')}
        </p>
        <button
          type="button"
          onClick={() => router.push(destination)}
          className="bg-primary text-primary-foreground hover:bg-primary/90 min-h-11 rounded-xl px-5 py-2 text-sm font-semibold"
        >
          {t('catalog.tiles.continueDashboard')}
        </button>
      </div>
    );
  }

  if (list.catalogs.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {t('catalog.tiles.empty')}
      </p>
    );
  }

  const owned = new Map(mine.map(option => [option.code, option]));

  return (
    <>
      <ul
        aria-label={t('catalog.tiles.listLabel')}
        className="grid gap-4 sm:grid-cols-2 sm:gap-6"
      >
        {sortCatalogs(list.catalogs).map(catalog => {
          const option = owned.get(catalog.code);
          const open = !!option;
          const accent =
            option && isBrandingApplied(catalog.code)
              ? option.branding.accent
              : null;
          const [first, second] = catalog.phaseMonths ?? [];
          const titleId = `${baseId}-${catalog.code}-title`;
          const lockedId = `${baseId}-${catalog.code}-locked`;
          return (
            <li key={catalog.code}>
              <article
                aria-labelledby={titleId}
                className={`focus-within:ring-accent relative flex h-full flex-col overflow-hidden rounded-2xl border-2 p-5 shadow-xl transition-colors focus-within:ring-2 sm:p-6 ${
                  open
                    ? 'border-accent/30 hover:border-accent/60 glass-effect-enhanced'
                    : 'border-border bg-muted/30 border-dashed'
                }`}
              >
                {accent && (
                  <span
                    aria-hidden="true"
                    data-testid={`tile-accent-${catalog.code}`}
                    className="absolute inset-x-0 top-0 h-1.5"
                    style={{ backgroundColor: accent }}
                  />
                )}
                <h2
                  id={titleId}
                  className={`text-xl font-bold ${open ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  {catalog.title}
                </h2>
                {!open && (
                  <p
                    id={lockedId}
                    className="bg-muted text-muted-foreground mt-2 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                  >
                    <Lock aria-hidden="true" className="h-3.5 w-3.5" />
                    {t('catalog.tiles.locked')}
                  </p>
                )}
                {catalog.description && (
                  <p className="text-muted-foreground mt-3 text-sm">
                    {catalog.description}
                  </p>
                )}
                <ul
                  className={`mt-4 flex-1 space-y-1 text-sm ${open ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  <li>
                    {t('catalogs.duration', { years: catalog.durationYears })}
                  </li>
                  {first !== undefined && second !== undefined && (
                    <li>{t('catalogs.phases', { first, second })}</li>
                  )}
                </ul>

                {open && (
                  <button
                    type="button"
                    onClick={() => choose(catalog.code)}
                    aria-label={t('catalog.tiles.openLabel', {
                      title: catalog.title,
                    })}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-accent mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold after:absolute after:inset-0 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {t('catalog.tiles.open')}
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </button>
                )}

                {!open && isTrainee && (
                  <p className="text-muted-foreground mt-6 text-sm">
                    {t('catalog.tiles.traineeLocked')}
                  </p>
                )}

                {!open && !isTrainee && (
                  <button
                    type="button"
                    aria-disabled="true"
                    aria-haspopup="dialog"
                    aria-describedby={lockedId}
                    aria-label={t('catalog.tiles.requestLabel', {
                      title: catalog.title,
                    })}
                    onClick={event => {
                      opener.current = event.currentTarget;
                      setRequesting(catalog);
                    }}
                    className="border-border bg-background text-foreground hover:bg-muted focus-visible:ring-accent mt-6 inline-flex min-h-11 items-center justify-center rounded-xl border px-5 py-3 text-sm font-semibold after:absolute after:inset-0 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {t('catalog.tiles.requestAction')}
                  </button>
                )}
              </article>
            </li>
          );
        })}
      </ul>

      {requesting && (
        <CatalogRequestDialog
          catalog={requesting}
          onClose={() => setRequesting(null)}
          restoreFocusTo={opener}
        />
      )}
    </>
  );
}
