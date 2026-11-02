/**
 * fetch() for the app's own API: adds the Supabase access token as
 * `Authorization: Bearer <token>`, which the server-side session layer
 * (src/lib/auth/session.ts) verifies. The session lives in localStorage, so
 * the token has to be attached explicitly.
 *
 * The token is only sent to same-origin requests (relative URLs). Absolute
 * URLs to other hosts never receive it.
 *
 * A user with more than one occupation (catalog) and a verified choice also
 * sends `x-catalog: <code>` to same-origin requests, so the server answers for
 * that occupation. The choice comes from src/lib/catalog/selection.ts, which
 * the CatalogProvider keeps up to date. A user with a single occupation never
 * sends the header, nothing changes for them.
 *
 * A 401 for a token that authFetch attached itself is tried once more with a
 * fresh token (another tab may have rotated it, or the first one was refused
 * during a short outage). A 401 does not run the request, so the repeat is safe
 * for every method. A request body that is a stream cannot be sent twice and is
 * not repeated.
 */

import { supabase } from '@/lib/supabase';
import {
  CATALOG_REQUEST_HEADER,
  getCatalogHeader,
  isCatalogPending,
  whenCatalogSettled,
} from '@/lib/catalog/selection';

/** Current access token, or null when nobody is signed in. */
export async function getAccessToken(): Promise<string | null> {
  try {
    // getSession() refreshes an expired access token with the refresh token
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

let refreshing: Promise<string | null> | null = null;

/**
 * A token different from `rejected`: the one another tab has stored by now, or
 * a freshly refreshed one. Parallel callers share one refresh, the refresh
 * token rotates with every call.
 */
function freshAccessToken(rejected: string): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const current = await getAccessToken();
        if (current && current !== rejected) return current;
        const { data } = await supabase.auth.refreshSession();
        return data?.session?.access_token ?? null;
      } catch {
        return null;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

function isSameOrigin(input: RequestInfo | URL): boolean {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try {
    return (
      typeof window !== 'undefined' &&
      new URL(url).origin === window.location.origin
    );
  } catch {
    return false;
  }
}

/** The lookup of the user's occupations, which has to work without a choice. */
function isCatalogLookup(input: RequestInfo | URL): boolean {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  try {
    return new URL(url, 'http://localhost').pathname === '/api/me/catalogs';
  } catch {
    return false;
  }
}

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  if (!isSameOrigin(input)) return fetch(input, init);

  const headers = new Headers(init.headers);
  let attachedToken: string | null = null;
  if (!headers.has('Authorization')) {
    attachedToken = await getAccessToken();
    if (attachedToken) headers.set('Authorization', `Bearer ${attachedToken}`);
  }
  if (!headers.has(CATALOG_REQUEST_HEADER) && !isCatalogLookup(input)) {
    // The occupations are still loading and a choice is stored: do not start
    // the request in the wrong occupation.
    if (isCatalogPending()) await whenCatalogSettled();
    const catalog = getCatalogHeader();
    if (catalog) headers.set(CATALOG_REQUEST_HEADER, catalog);
  }
  const response = await fetch(input, { ...init, headers });
  if (response.status !== 401 || !attachedToken || isStream(init.body)) {
    return response;
  }
  const retryToken = await freshAccessToken(attachedToken);
  if (!retryToken || retryToken === attachedToken) return response;
  const retryHeaders = new Headers(headers);
  retryHeaders.set('Authorization', `Bearer ${retryToken}`);
  return fetch(input, { ...init, headers: retryHeaders });
}

function isStream(body: RequestInit['body']): boolean {
  return (
    typeof ReadableStream !== 'undefined' && body instanceof ReadableStream
  );
}
