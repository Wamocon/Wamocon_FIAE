'use client';

import { useId, useState } from 'react';
import { Briefcase, ChevronDown } from 'lucide-react';
import { useCatalog } from '@/contexts/CatalogContext';
import { useLanguage } from '@/contexts/LanguageContext';

type Placement = 'bar' | 'strip';

/**
 * Switch between the occupations (catalogs) of the signed in user. Only shown
 * for a user with more than one occupation, so nothing changes for everyone
 * with a single occupation. A native select: labelled, works with the keyboard
 * and uses the picker of the phone.
 *
 * Choosing and switching are two steps (WCAG 3.2.2 On Input): changing the
 * select only marks the occupation, the button "Wechseln" next to it switches.
 * On Windows the arrow keys already change the value of a closed select, and a
 * reload on every change would throw away unsaved input. The switch loads the
 * page again with the chosen occupation (see CatalogProvider.selectCatalog).
 *
 * The header is full on a phone, so the switcher exists twice: `bar` inside
 * the header from the small breakpoint up and `strip` as its own row below the
 * header on a phone. Only one of them is displayed (and read out) at a time.
 */
export function CatalogSwitcher({
  placement = 'bar',
}: {
  placement?: Placement;
}) {
  const { catalogs, activeCode, isMultiple, selectCatalog } = useCatalog();
  const { t } = useLanguage();
  const id = useId();
  const [choice, setChoice] = useState<string | null>(null);

  if (!isMultiple || !activeCode) return null;

  const active = catalogs.find(c => c.code === activeCode);
  // The marked occupation, the active one as long as nothing else is marked.
  const selected =
    choice && catalogs.some(c => c.code === choice) ? choice : activeCode;

  const control = (
    <div className="relative shrink-0">
      <label htmlFor={id} className="sr-only">
        {t('catalog.switcher.label')}
      </label>
      <span id={`${id}-hint`} className="sr-only">
        {t('catalog.switcher.current', { title: active?.title ?? activeCode })}.{' '}
        {t('catalog.switcher.reloadHint')}
      </span>
      <Briefcase
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-[hsl(var(--accent))]"
      />
      <select
        id={id}
        value={selected}
        onChange={event => setChoice(event.target.value)}
        aria-describedby={`${id}-hint`}
        title={active?.title}
        className="bg-card text-foreground border-border h-9 max-w-[14rem] cursor-pointer appearance-none truncate rounded-lg border py-1 pr-7 pl-8 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))]"
      >
        {catalogs.map(catalog => (
          <option key={catalog.code} value={catalog.code}>
            {catalog.branding.shortName ?? catalog.code}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="text-muted pointer-events-none absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2"
      />
    </div>
  );

  const button = (
    <button
      type="button"
      disabled={selected === activeCode}
      onClick={() => selectCatalog(selected)}
      aria-describedby={`${id}-hint`}
      className="bg-card text-foreground border-border disabled:hover:border-border h-9 shrink-0 cursor-pointer rounded-lg border px-3 text-sm font-medium transition-colors hover:border-[hsl(var(--accent))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {t('catalog.switcher.apply')}
    </button>
  );

  if (placement === 'strip') {
    return (
      <div
        className="bg-card/80 border-border/60 flex items-center justify-end gap-2 border-b px-4 py-2 sm:hidden"
        data-tour="header-catalog-strip"
      >
        {control}
        {button}
      </div>
    );
  }
  return (
    <div
      className="hidden items-center gap-2 sm:flex"
      data-tour="header-catalog"
    >
      {control}
      {button}
    </div>
  );
}
