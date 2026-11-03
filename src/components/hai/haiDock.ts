/**
 * Rules of the docked HAI panel: the chat panel is a column of the app layout
 * (MainLayout), the rest of the page makes room for it and the person can pull
 * it wider or narrower.
 *
 * Pure functions and constants only (no React), so the limits and the storage
 * are easy to test and the layout does not need to load the chat for them.
 */

/** localStorage key of the chosen width (a plain number as text). */
export const HAI_PANEL_WIDTH_KEY = 'hai-panel-width';

/** CSS variable with the width of the panel (the column and the panel read it). */
export const HAI_PANEL_WIDTH_VAR = '--hai-panel-width';
/** CSS variable with the space the page gives to the panel (0 while it is closed). */
export const HAI_DOCK_INSET_VAR = '--hai-dock-inset';
/** CSS variable with the duration of the width transition (0 while dragging). */
export const HAI_DOCK_MS_VAR = '--hai-dock-ms';

export const DOCK_DEFAULT_WIDTH = 420;
export const DOCK_MIN_WIDTH = 320;
/** Narrower minimum between 768 and 1023 px, so that 480 px stay for the page. */
export const DOCK_MIN_WIDTH_TABLET = 288;
export const DOCK_MAX_WIDTH = 720;
/** The panel never takes more than this share of the window. */
export const DOCK_MAX_SHARE = 0.6;
/** The page keeps at least this width next to the panel, else the panel is an overlay. */
export const DOCK_CONTENT_MIN = 480;
/** Below this window width the panel is a sheet over the page (a phone). */
export const DOCK_MIN_VIEWPORT = 768;
/** From this window width (Tailwind lg) the navigation is a column of the layout. */
export const DOCK_DESKTOP_VIEWPORT = 1024;
/** Width of the open navigation (w-72), it takes room next to the page from lg up. */
export const DOCK_SIDEBAR_WIDTH = 288;

export const DOCK_KEY_STEP = 24;
export const DOCK_KEY_STEP_LARGE = 96;
/** Opening and closing animate the column width for this long. */
export const DOCK_ANIMATION_MS = 280;

export interface DockLimits {
  /** The panel is a column of the layout (else it is an overlay). */
  docked: boolean;
  min: number;
  max: number;
}

/**
 * Where the panel may sit for this window: docked or overlay, and how wide.
 * Maximum: 720 px, 60 percent of the window and the page keeps 480 px (the
 * open navigation counts as part of what the page does not have).
 */
export function dockLimits(
  viewportWidth: number,
  sidebarOpen: boolean
): DockLimits {
  const min =
    viewportWidth < DOCK_DESKTOP_VIEWPORT
      ? DOCK_MIN_WIDTH_TABLET
      : DOCK_MIN_WIDTH;
  const reserved =
    viewportWidth >= DOCK_DESKTOP_VIEWPORT && sidebarOpen
      ? DOCK_SIDEBAR_WIDTH
      : 0;
  const max = Math.min(
    DOCK_MAX_WIDTH,
    Math.floor(viewportWidth * DOCK_MAX_SHARE),
    viewportWidth - reserved - DOCK_CONTENT_MIN
  );
  return {
    docked: viewportWidth >= DOCK_MIN_VIEWPORT && max >= min,
    min,
    max: Math.max(max, min),
  };
}

/** Keeps a width inside the limits (whole pixels, NaN becomes the default). */
export function clampDockWidth(
  width: number,
  limits: Pick<DockLimits, 'min' | 'max'>
): number {
  const value = Number.isFinite(width) ? width : DOCK_DEFAULT_WIDTH;
  return Math.round(Math.min(limits.max, Math.max(limits.min, value)));
}

/** The width the person chose last, kept in the absolute limits. Never throws. */
export function readStoredDockWidth(): number {
  try {
    const raw = window.localStorage.getItem(HAI_PANEL_WIDTH_KEY);
    if (raw === null || !/^\d{1,5}$/.test(raw.trim()))
      return DOCK_DEFAULT_WIDTH;
    return Math.min(
      DOCK_MAX_WIDTH,
      Math.max(DOCK_MIN_WIDTH, Number(raw.trim()))
    );
  } catch {
    return DOCK_DEFAULT_WIDTH;
  }
}

/** Remembers the width (only the number). A blocked storage is no error. */
export function writeStoredDockWidth(width: number): void {
  try {
    window.localStorage.setItem(HAI_PANEL_WIDTH_KEY, String(Math.round(width)));
  } catch {
    // private window, blocked or full storage: the width just is not kept
  }
}

/**
 * The new width for a key on the separator, or null when the key is not for it.
 * The panel sits at the right edge, so the separator at its left edge moves
 * left to widen it: arrow left is wider, arrow right is narrower.
 */
export function widthForKey(
  key: string,
  shiftKey: boolean,
  current: number,
  limits: Pick<DockLimits, 'min' | 'max'>
): number | null {
  const step = shiftKey ? DOCK_KEY_STEP_LARGE : DOCK_KEY_STEP;
  switch (key) {
    case 'ArrowLeft':
      return clampDockWidth(current + step, limits);
    case 'ArrowRight':
      return clampDockWidth(current - step, limits);
    case 'Home':
      return limits.min;
    case 'End':
      return limits.max;
    default:
      return null;
  }
}
