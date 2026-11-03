'use client';

/**
 * Where the HAI lives on the page: at the bottom right.
 *
 * Three parts share one anchor so they always meet at the same spot:
 *  - the HAI symbol (HaiButton, the round fish pond, also the handle of the panel),
 *  - the chat panel (HaiChat, slides in from the right),
 *  - the voice mode figure (it rises out of the symbol, which turns into its pond).
 *
 * The main navigation is at the left, so nothing here has to give way to it.
 * While the panel is open (from md up) the symbol rides on its left edge, so it
 * stays visible and clickable. On a phone the panel is a sheet over the full
 * width that leaves a strip at the bottom for the symbol.
 */

import { useHai } from './HaiProvider';

/** id of the chat panel (aria-controls of the HAI symbol) */
export const HAI_PANEL_ID = 'hai-chat-panel';

/** Width of the chat panel from md up, in px (the symbol rides this far to the left). */
export const HAI_PANEL_WIDTH = 420;

/** Height of the page header (h-16) that stays visible above the panel. */
export const HAI_HEADER_OFFSET_CLASS = 'top-16';

// bottom right (bottom-6 right-6 from sm up, as before), plus the safe area of
// a phone (notch, home bar); z-40: part of the page, an open viewer or dialog
// (z-50) lies over it (WMCNL-2969)
const ANCHOR_BASE =
  'fixed bottom-4 right-4 z-40 pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] sm:bottom-6 sm:right-6 transition-transform duration-300 ease-out motion-reduce:transition-none';

export interface HaiAnchor {
  className: string;
  panelOpen: boolean;
}

/** The panel is open. False outside of the chat provider (the figure alone, tests). */
function usePanelOpen(): boolean {
  try {
    // useHai reads the context first and throws without a provider
    return useHai().viewMode === 'widget';
  } catch {
    return false;
  }
}

export function useHaiAnchor(): HaiAnchor {
  const panelOpen = usePanelOpen();
  // the panel open: the symbol rides on its left edge
  const className = panelOpen
    ? `${ANCHOR_BASE} md:-translate-x-[420px]`
    : ANCHOR_BASE;
  return { className, panelOpen };
}
