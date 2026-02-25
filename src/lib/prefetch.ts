/**
 * Lightweight request prefetch & deduplication utility.
 *
 * Purpose: eliminate the sequential waterfall where we first wait for
 * auth (getSession → loadProfile) and only THEN start fetching page data.
 *
 * Usage:
 *   // Early (e.g. AuthContext init when cache hit) – fire the request immediately
 *   prefetch('/api/trainee/dashboard?userId=abc');
 *
 *   // Later (e.g. Dashboard component mount) – consume the in-flight response
 *   const data = await consumePrefetch(url);
 *   if (!data) { /* fallback to normal fetch * / }
 */

const inflight = new Map<string, Promise<unknown>>();

/**
 * Start fetching `url` in the background. If a request for the same URL
 * is already in-flight, this is a no-op (deduplication).
 *
 * The response is parsed as JSON and cached for up to 30 seconds.
 * Network / parse errors are swallowed and stored as `null`.
 */
export function prefetch(url: string): void {
  if (inflight.has(url)) return;

  const promise = fetch(url, { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);

  inflight.set(url, promise);

  // Auto-cleanup so stale entries don't leak memory
  setTimeout(() => inflight.delete(url), 30_000);
}

/**
 * If a prefetch for `url` exists, return its promise and remove the entry
 * (one-time consumption). Returns `null` when no prefetch is available.
 *
 * The returned promise resolves to the parsed JSON body (or `null` on error).
 */
export function consumePrefetch<T = unknown>(url: string): Promise<T> | null {
  const promise = inflight.get(url) as Promise<T> | undefined;
  if (promise) {
    inflight.delete(url);
    return promise;
  }
  return null;
}
