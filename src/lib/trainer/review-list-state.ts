/**
 * Where the trainer was in the list of reviews when a detail page was opened
 * (WMCNL-3002): after "Details" and back the list sprang to its top. The page
 * stores the address of the list (tab, filter, occupation), the scroll position
 * and how many rows were loaded, and takes them again when it comes back, so
 * the list loads that many rows and scrolls to the same place.
 *
 * This is a convenience of the browser tab (sessionStorage): it can be empty or
 * unavailable, then the list simply starts at the top. Nothing here is read by
 * the server.
 */

const KEY = 'wmc.trainer.reviews.listState';
/** A position older than this is not restored. */
const MAX_AGE_MS = 15 * 60 * 1000;
/** The most rows that are loaded again for a restored position. */
export const MAX_RESTORED_ROWS = 400;

export type ReviewListState = {
  /** The query string of the list page (view, status, catalog, ...), without "?". */
  search: string;
  /** Identifies the list: tab, filter, text, occupation. */
  key: string;
  scrollTop: number;
  loaded: number;
  savedAt: number;
};

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveReviewListState(
  state: Omit<ReviewListState, 'savedAt'>,
  now: number = Date.now()
): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ ...state, savedAt: now }));
  } catch {
    // no storage: the list starts at the top
  }
}

function read(now: number): ReviewListState | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ReviewListState> | null;
    if (
      !value ||
      typeof value.key !== 'string' ||
      typeof value.search !== 'string' ||
      typeof value.scrollTop !== 'number' ||
      typeof value.loaded !== 'number' ||
      typeof value.savedAt !== 'number' ||
      now - value.savedAt > MAX_AGE_MS
    ) {
      return null;
    }
    return value as ReviewListState;
  } catch {
    return null;
  }
}

/** The stored position when it belongs to the list `key`. */
export function readReviewListState(
  key: string,
  now: number = Date.now()
): ReviewListState | null {
  const state = read(now);
  return state && state.key === key ? state : null;
}

/**
 * Removes the stored position. The page does it once the list is loaded again
 * (not when it reads the position: a page that loads twice, as in development,
 * must still find it), so a later visit of the same list starts at the top.
 */
export function clearReviewListState(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** The query string of the list the trainer came from, for the way back. */
export function peekReviewListSearch(now: number = Date.now()): string | null {
  return read(now)?.search ?? null;
}
