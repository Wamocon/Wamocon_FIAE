'use client';

import { useId, useRef, type KeyboardEvent } from 'react';
import { useCatalog } from '@/contexts/CatalogContext';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * One tab per training (occupation) at the top of the content and list pages of
 * a trainer level user who has more than one occupation. Nothing is rendered
 * for everybody else (a single occupation, a trainee), so a FIAE user sees no
 * change.
 *
 * ARIA tabs with manual activation: the arrow keys, Home and End move the focus
 * between the tabs, Enter or Space chooses one (a choice loads the page content
 * again, so it must not happen on every arrow key). The row scrolls sideways on
 * a narrow screen and never widens the page. The choice itself is made in the
 * CatalogProvider (selectTab): validated against the occupations of the user,
 * named in the URL (?catalog=CODE), remembered in the browser.
 * The selected tab is marked with an inset shadow, not a border: the global style
 * sheet forces every border color in both themes.
 */
export function CatalogTabs() {
  const { tabs, activeCode, selectTab } = useCatalog();
  const { t } = useLanguage();
  const baseId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  if (tabs.length < 2 || !activeCode) return null;

  const activeIndex = Math.max(
    0,
    tabs.findIndex(tab => tab.code === activeCode)
  );

  const moveFocus = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    buttons.current[next]?.focus();
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    // Alt+Arrow is back and forward of the browser, the history is used here
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        moveFocus(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        moveFocus(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveFocus(0);
        break;
      case 'End':
        event.preventDefault();
        moveFocus(tabs.length - 1);
        break;
    }
  };

  return (
    <div
      className="bg-card/80 border-border/60 sticky top-0 z-20 overflow-x-auto border-b px-4 backdrop-blur-md sm:px-6"
      data-tour="catalog-tabs"
    >
      <p role="status" className="sr-only">
        {t('catalog.tabs.current', {
          title: tabs[activeIndex]?.title ?? activeCode,
        })}
      </p>
      <div
        role="tablist"
        aria-label={t('catalog.tabs.label')}
        className="flex w-max min-w-full gap-1"
      >
        {tabs.map((tab, index) => {
          const selected = tab.code === activeCode;
          return (
            <button
              key={tab.code}
              ref={element => {
                buttons.current[index] = element;
              }}
              id={`${baseId}-${tab.code}`}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={index === activeIndex ? 0 : -1}
              title={tab.title}
              onClick={() => selectTab(tab.code)}
              onKeyDown={event => onKeyDown(event, index)}
              className={`min-h-11 shrink-0 cursor-pointer px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] ${
                selected
                  ? 'text-foreground shadow-[inset_0_-3px_0_0_hsl(var(--accent))]'
                  : 'text-muted-foreground hover:text-foreground hover:shadow-[inset_0_-3px_0_0_hsl(var(--muted-foreground)/0.4)]'
              }`}
            >
              {tab.branding.shortName ?? tab.code}
            </button>
          );
        })}
      </div>
    </div>
  );
}
