'use client';

/**
 * Where the HAI lives on the page: at the bottom right.
 *
 * Three parts share one anchor so they always meet at the same spot:
 *  - the HAI symbol (HaiButton, the round fish pond, also the handle of the panel),
 *  - the chat panel (HaiChat),
 *  - the voice mode figure (it rises out of the symbol, which turns into its pond).
 *
 * The main navigation is at the left, so nothing here has to give way to it.
 *
 * Docked (from 768 px up, when the page keeps 480 px, see haiDock.ts) the
 * panel is a column of the app layout and the page makes room for it. The
 * symbol then stays at the bottom right of the page that is left, next to the
 * panel: its right edge follows the space the page gives to the panel
 * (--hai-dock-inset, written by HaiDockContext, also while the panel is pulled).
 * It never lies on the panel, so it does not hide the input or the send
 * button, and it never hides more of the page than it does with the panel
 * closed. The voice figure rises from the same spot.
 *
 * Not docked (a phone, a window that is too narrow, no layout around): the
 * panel is a sheet over the page, and from md up the symbol rides on its left
 * edge. On a phone the sheet leaves a strip at the bottom for the symbol.
 */

import { useHai } from './HaiProvider';
import { DOCK_DEFAULT_WIDTH } from './haiDock';
import { useHaiDockVars, useOptionalHaiDock } from './HaiDockContext';

/** id of the chat panel (aria-controls of the HAI symbol) */
export const HAI_PANEL_ID = 'hai-chat-panel';

/** Default width of the chat panel in px (the person can pull it, haiDock.ts). */
export const HAI_PANEL_WIDTH = DOCK_DEFAULT_WIDTH;

/** Height of the page header (h-16) that stays visible above the sheet. */
export const HAI_HEADER_OFFSET_CLASS = 'top-16';

// bottom right (bottom-6 right-6 from sm up, as before), plus the safe area of
// a phone (notch, home bar); z-40: part of the page, an open viewer or dialog
// (z-50) lies over it (WMCNL-2969)
const ANCHOR_COMMON =
  'fixed bottom-4 z-40 pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] sm:bottom-6';

// the symbol rides on the left edge of the sheet (not docked)
const ANCHOR_SHEET = `${ANCHOR_COMMON} right-4 sm:right-6 transition-transform duration-300 ease-out motion-reduce:transition-none`;

// docked: the right edge follows the variable of the dock (haiDock.ts), 1.5rem
// is right-6 (docked means sm up), the width transition is the one of the column
const ANCHOR_DOCKED = `${ANCHOR_COMMON} right-[calc(var(--hai-dock-inset,0px)+1.5rem)] transition-[right] duration-[var(--hai-dock-ms,280ms)] ease-[cubic-bezier(0.32,0.72,0,1)]`;

export interface HaiAnchor {
  className: string;
  panelOpen: boolean;
  /** The panel is a column of the layout (the anchor sits left of it). */
  docked: boolean;
  /** Ref for the anchor element: the dock variables are written onto it. */
  ref: (element: HTMLElement | null) => void;
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
  const dock = useOptionalHaiDock();
  const ref = useHaiDockVars();
  const docked = !!dock?.docked;
  if (docked) {
    return { className: ANCHOR_DOCKED, panelOpen, docked, ref };
  }
  // the sheet open: the symbol rides on its left edge
  const className = panelOpen
    ? `${ANCHOR_SHEET} md:-translate-x-[420px]`
    : ANCHOR_SHEET;
  return { className, panelOpen, docked, ref };
}
