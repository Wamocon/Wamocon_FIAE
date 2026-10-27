'use client';

import { useCatalog } from '@/contexts/CatalogContext';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Names the occupation the user works in when it is not FIAE (the branding is
 * applied). Shows nothing for FIAE, so today's look stays as it is. The
 * occupation is chosen with the tabs of the pages (CatalogTabs), not here. It
 * exists as `bar` inside the header (small breakpoint and up) and as `strip`
 * below the header on a phone.
 */
export function CatalogBadge({
  placement = 'bar',
}: {
  placement?: 'bar' | 'strip';
}) {
  const { catalogs, activeCode, brandingApplied, branding } = useCatalog();
  const { t } = useLanguage();

  if (!brandingApplied || !activeCode) return null;

  const active = catalogs.find(c => c.code === activeCode);
  const label = branding.shortName ?? activeCode;

  const badge = (
    <div
      className="flex shrink-0 items-center rounded-full bg-[hsl(var(--accent)/0.15)] px-3 py-1 text-xs font-bold tracking-wide text-[hsl(var(--accent))] ring-1 ring-[hsl(var(--accent)/0.3)]"
      title={active?.title}
      data-testid={`catalog-badge-${placement}`}
    >
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">
        {t('catalog.branding.badge', { title: active?.title ?? activeCode })}
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
