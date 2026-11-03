'use client';

import { useCatalog } from '@/contexts/CatalogContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { catalogDisplayTitle } from '@/lib/catalog/display-title';

/**
 * Names the occupation the user works in: when it is not FIAE (the branding is
 * applied), and for FIAE too as soon as the user has several occupations (tabs),
 * so the indicator does not vanish when the tab is switched back to FIAE
 * (KFB-1179). A user with FIAE only sees no badge, so today's look stays as it
 * is. The occupation is chosen with the tabs of the pages (CatalogTabs), not
 * here. It exists as `bar` inside the header (small breakpoint and up) and as
 * `strip` below the header on a phone.
 */
export function CatalogBadge({
  placement = 'bar',
}: {
  placement?: 'bar' | 'strip';
}) {
  const { catalogs, activeCode, brandingApplied, branding, tabs } =
    useCatalog();
  const { t } = useLanguage();

  const showForFiae = (tabs?.length ?? 0) > 1;
  if (!activeCode || (!brandingApplied && !showForFiae)) return null;

  const active = catalogs.find(c => c.code === activeCode);
  const label = brandingApplied
    ? (branding.shortName ?? activeCode)
    : activeCode;
  const title = active
    ? catalogDisplayTitle(t, active.code, active.title)
    : activeCode;

  const badge = (
    <div
      className="flex shrink-0 items-center rounded-full bg-[hsl(var(--accent)/0.15)] px-3 py-1 text-xs font-bold tracking-wide text-[hsl(var(--accent))] ring-1 ring-[hsl(var(--accent)/0.3)]"
      title={title}
      data-testid={`catalog-badge-${placement}`}
    >
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">
        {t('catalog.branding.badge', { title })}
      </span>
    </div>
  );

  if (placement === 'strip') {
    return (
      <div className="bg-card/80 border-border/60 flex items-center justify-end border-b px-4 py-2 sm:hidden">
        {badge}
      </div>
    );
  }
  return <div className="hidden sm:block">{badge}</div>;
}
