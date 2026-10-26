/**
 * The occupation (catalog) the browser works in, as plain module state. React
 * context cannot be read by plain functions such as authFetch, so the
 * CatalogProvider (src/contexts/CatalogContext.tsx) writes the verified choice
 * here and authFetch and useApiQuery read it. No React and no server imports,
 * so there is no import cycle.
 *
 *  - header   the occupation code authFetch sends as `x-catalog`. It is only
 *             set for a user with more than one occupation and a verified
 *             choice, so a user with a single occupation (all FIAE users today)
 *             never sends the header.
 *  - pending  true while the occupations of the user are still loading and a
 *             choice is stored in the browser. Requests wait for the end of this
 *             state, so they do not start in the wrong occupation.
 *
 * The choice itself is stored in the browser under lfa.preferredCatalog. Every
 * access is guarded, the app works without localStorage.
 */

import { normalizeCatalogCode } from '@/lib/catalog/client';

export const PREFERRED_CATALOG_KEY = 'lfa.preferredCatalog';

/** Same name as CATALOG_HEADER in src/lib/catalog/scope.ts (server only). */
export const CATALOG_REQUEST_HEADER = 'x-catalog';

/** How long a request waits for the occupations to load, at most. */
const SETTLE_TIMEOUT_MS = 5000;

export type CatalogSelection = {
  header: string | null;
  pending: boolean;
};

// ---------------------------------------------------------------------------
// Stored choice
// ---------------------------------------------------------------------------

/** The stored choice, or null (nothing stored, invalid value, no storage). */
export function readPreferredCatalog(): string | null {
  try {
    return (
      normalizeCatalogCode(
        window.localStorage.getItem(PREFERRED_CATALOG_KEY)
      ) ?? null
    );
  } catch {
    return null;
  }
}

/** Store the choice (a valid code), or remove it with null. Never throws. */
export function writePreferredCatalog(code: string | null): void {
  try {
    const normalized = normalizeCatalogCode(code);
    if (normalized) {
      window.localStorage.setItem(PREFERRED_CATALOG_KEY, normalized);
    } else if (code === null) {
      window.localStorage.removeItem(PREFERRED_CATALOG_KEY);
    }
  } catch {
    // no storage available: the choice only lives until the next page load
  }
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const SERVER_SELECTION: CatalogSelection = Object.freeze({
  header: null,
  pending: false,
});

let state: CatalogSelection | null = null;
const listeners = new Set<() => void>();

function current(): CatalogSelection {
  if (!state) {
    state =
      typeof window === 'undefined'
        ? SERVER_SELECTION
        : { header: null, pending: readPreferredCatalog() !== null };
  }
  return state;
}

export function getCatalogSelection(): CatalogSelection {
  return current();
}

/** Snapshot for server rendering: no header, nothing pending. */
export function getServerCatalogSelection(): CatalogSelection {
  return SERVER_SELECTION;
}

/** The occupation code to send as `x-catalog`, or null (send nothing). */
export function getCatalogHeader(): string | null {
  return current().header;
}

export function isCatalogPending(): boolean {
  return current().pending;
}

export function subscribeCatalogSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Change the state. Subscribers are only told when something changed. */
export function setCatalogSelection(next: Partial<CatalogSelection>): void {
  const before = current();
  const header =
    'header' in next
      ? (normalizeCatalogCode(next.header) ?? null)
      : before.header;
  const pending = next.pending ?? before.pending;
  if (header === before.header && pending === before.pending) return;
  state = { header, pending };
  listeners.forEach(listener => listener());
}

/** Resolves when no choice is pending any more, or after the timeout. */
export function whenCatalogSettled(
  timeoutMs: number = SETTLE_TIMEOUT_MS
): Promise<void> {
  if (!isCatalogPending()) return Promise.resolve();
  return new Promise<void>(resolve => {
    let unsubscribe: () => void = () => {};
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    }
    unsubscribe = subscribeCatalogSelection(() => {
      if (!isCatalogPending()) done();
    });
  });
}

/** Test helper: forget the state, it is read from the storage again. */
export function resetCatalogSelection(): void {
  state = null;
  listeners.clear();
}
