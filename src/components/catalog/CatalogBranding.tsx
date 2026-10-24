'use client';

import { useEffect } from 'react';
import { useCatalog } from '@/contexts/CatalogContext';
import { DEFAULT_PLATFORM_TITLE, brandingCss } from '@/lib/catalog/branding';

/**
 * Applies the branding of the active occupation to the page: the accent color
 * (theme variables, both themes) and the platform name in the browser title.
 * Does nothing for FIAE, so today's look stays exactly as it is. Renders
 * nothing itself. The style rules contain only numbers derived from a checked
 * color (see brandingCss), never text from the settings.
 */
export function CatalogBranding() {
  const { brandingApplied, branding } = useCatalog();
  const { accent, title } = branding;

  useEffect(() => {
    if (!brandingApplied) return;

    let style: HTMLStyleElement | null = null;
    const css = brandingCss(accent);
    if (css) {
      style = document.createElement('style');
      style.setAttribute('data-catalog-branding', '');
      style.textContent = css;
      document.head.appendChild(style);
    }

    // The framework (re)writes the title of every page, also late while the
    // page streams in. So the platform name is replaced again whenever the
    // title changes, not only once.
    let renamed = false;
    const rename = () => {
      const current = document.title;
      if (
        current.includes(DEFAULT_PLATFORM_TITLE) &&
        !current.includes(title)
      ) {
        document.title = current.split(DEFAULT_PLATFORM_TITLE).join(title);
        renamed = true;
      }
    };
    let observer: MutationObserver | null = null;
    if (title !== DEFAULT_PLATFORM_TITLE) {
      rename();
      observer = new MutationObserver(rename);
      // The title element may sit in the body (streamed metadata), so the
      // whole document is watched, not only the head.
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    return () => {
      observer?.disconnect();
      style?.remove();
      if (renamed && document.title.includes(title)) {
        document.title = document.title
          .split(title)
          .join(DEFAULT_PLATFORM_TITLE);
      }
    };
  }, [brandingApplied, accent, title]);

  return null;
}
