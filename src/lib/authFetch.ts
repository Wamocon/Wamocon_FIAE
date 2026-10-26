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
  if (!headers.has('Authorization')) {
    const token = await getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has(CATALOG_REQUEST_HEADER) && !isCatalogLookup(input)) {
    // The occupations are still loading and a choice is stored: do not start
    // the request in the wrong occupation.
    if (isCatalogPending()) await whenCatalogSettled();
    const catalog = getCatalogHeader();
    if (catalog) headers.set(CATALOG_REQUEST_HEADER, catalog);
  }
  return fetch(input, { ...init, headers });
}
