'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/contexts/LanguageContext';

/** One active occupation as the public list `/api/catalogs` delivers it. */
export interface PublicCatalogSummary {
  code: string;
  title: string;
  description?: string | null;
  durationYears: number;
  occupationCode?: string | null;
  regulationVersion?: string | null;
  phaseMonths?: number[];
  schoolOrganization?: string | null;
}

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; catalogs: PublicCatalogSummary[] };

const SCHOOL_KEYS: Record<string, string> = {
  block: 'catalogs.school.block',
  weekdays: 'catalogs.school.weekdays',
};

/**
 * Selection of the training occupations before the login. Shows what a visitor
 * needs to choose: duration, phases, school form and regulation version, all
 * taken from the settings of the occupation, nothing is fixed in the code.
 */
export function CatalogSelection() {
  const { t } = useLanguage();
  const [state, setState] = useState<State>({ status: 'loading' });
  const alive = useRef(false);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const res = await fetch('/api/catalogs');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!alive.current) return;
      setState({
        status: 'ready',
        catalogs: Array.isArray(data?.catalogs) ? data.catalogs : [],
      });
    } catch {
      if (alive.current) setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  if (state.status === 'loading') {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t('catalogs.loading')}
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="space-y-4">
        <p className="text-sm text-red-500">{t('catalogs.error')}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl px-5 py-2 text-sm font-semibold"
        >
          {t('catalogs.retry')}
        </button>
      </div>
    );
  }

  if (state.catalogs.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">{t('catalogs.empty')}</p>
    );
  }

  return (
    <ul
      aria-label={t('catalogs.listLabel')}
      className="grid gap-6 md:grid-cols-2"
    >
      {state.catalogs.map(catalog => {
        const [first, second] = catalog.phaseMonths ?? [];
        const schoolKey = catalog.schoolOrganization
          ? SCHOOL_KEYS[catalog.schoolOrganization]
          : undefined;
        return (
          <li key={catalog.code}>
            <article className="border-accent/30 glass-effect-enhanced flex h-full flex-col rounded-2xl border-2 p-6 shadow-xl">
              <h2 className="text-foreground text-xl font-bold">
                {catalog.title}
              </h2>
              {catalog.description && (
                <p className="text-muted-foreground mt-2 text-sm">
                  {catalog.description}
                </p>
              )}
              <ul className="text-foreground mt-4 flex-1 space-y-1 text-sm">
                <li>
                  {t('catalogs.duration', { years: catalog.durationYears })}
                </li>
                {first !== undefined && second !== undefined && (
                  <li>{t('catalogs.phases', { first, second })}</li>
                )}
                {schoolKey && <li>{t(schoolKey)}</li>}
                {catalog.regulationVersion && (
                  <li>
                    {t('catalogs.regulation', {
                      version: catalog.regulationVersion,
                    })}
                  </li>
                )}
              </ul>
              <Link
                href="/login"
                className="bg-primary text-primary-foreground hover:bg-primary/90 mt-6 inline-block rounded-xl px-5 py-3 text-center text-sm font-semibold"
              >
                {t('catalogs.signIn')}
                <span className="sr-only"> {catalog.title}</span>
              </Link>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
