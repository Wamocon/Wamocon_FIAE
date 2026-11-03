'use client';

/**
 * Where the HAI lives on the page: at the bottom left.
 *
 * Three parts share one anchor so they always meet at the same spot:
 *  - the HAI symbol (HaiButton, the round fish pond, also the handle of the panel),
 *  - the chat panel (HaiChat, slides in from the left),
 *  - the voice mode figure (it rises out of the symbol, which turns into its pond).
 *
 * Next to the main navigation: with the sidebar kept open (desktop) the anchor
 * and the panel start right of it, so neither covers it. While the panel is open
 * (from md up) the symbol rides on its right edge, so it stays visible and
 * clickable. On a phone the panel is a sheet over the full width that leaves a
 * strip at the bottom for the symbol.
 */

import { useOptionalSidebar } from '@/contexts/SidebarContext';
import { useHai } from './HaiProvider';

/** id of the chat panel (aria-controls of the HAI symbol) */
export const HAI_PANEL_ID = 'hai-chat-panel';

/** Width of the chat panel from md up, in px (the symbol rides this far to the right). */
export const HAI_PANEL_WIDTH = 420;

/** Height of the page header (h-16) that stays visible above the panel. */
export const HAI_HEADER_OFFSET_CLASS = 'top-16';

// bottom left, plus the safe area of a phone (notch, home bar); z-40: part of
// the page, an open viewer or dialog (z-50) lies over it (WMCNL-2969), the
// navigation (z-41) over the symbol
const ANCHOR_BASE =
  'fixed bottom-4 left-4 z-40 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] sm:bottom-6 sm:left-6 transition-transform duration-300 ease-out motion-reduce:transition-none';

export interface HaiAnchor {
  className: string;
  panelOpen: boolean;
  sidebarOpen: boolean;
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
  const sidebar = useOptionalSidebar();
  const sidebarOpen = sidebar?.isOpen ?? false;
  const className = [
    ANCHOR_BASE,
    // the sidebar kept open (desktop): start right of it (18rem + 1.5rem)
    sidebarOpen ? 'lg:left-[19.5rem]' : '',
    // the panel open: the symbol rides on its right edge
    panelOpen ? 'md:translate-x-[420px]' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return { className, panelOpen, sidebarOpen };
}
