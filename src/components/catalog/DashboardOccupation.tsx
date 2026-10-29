'use client';

import { GraduationCap } from 'lucide-react';
import { useCatalog } from '@/contexts/CatalogContext';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Names the occupation (the title from the catalog) at the top of a dashboard.
 * Every occupation gets the same label, FIAE included, so the dashboards are
 * told apart the same way. It does not depend on the branding (which stays off
 * for FIAE) and sends no request: the list of the user is already held by the
 * CatalogProvider. Shows nothing while the list is unknown.
 */
export function DashboardOccupation() {
  const { status, catalogs, activeCode } = useCatalog();
  const { t } = useLanguage();

  if (status !== 'ready' || !activeCode) return null;
  const active = catalogs.find(c => c.code === activeCode);
  if (!active) return null;

  return (
    <div className="mb-4 flex">
      <div
        className="bg-card/70 border-border/60 inline-flex max-w-full items-center gap-2 rounded-full border px-4 py-1.5 text-sm shadow-sm backdrop-blur-sm"
        data-testid="dashboard-occupation"
      >
        <GraduationCap
          className="text-accent h-4 w-4 shrink-0"
          aria-hidden="true"
        />
        <span className="text-muted-foreground shrink-0">
          {t('catalog.dashboard.occupation')}
        </span>
        <span className="text-foreground truncate font-semibold">
          {active.title}
        </span>
      </div>
    </div>
  );
}
