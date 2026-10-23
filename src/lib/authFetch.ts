/**
 * fetch() for the app's own API: adds the Supabase access token as
 * `Authorization: Bearer <token>`, which the server-side session layer
 * (src/lib/auth/session.ts) verifies. The session lives in localStorage, so
 * the token has to be attached explicitly.
 *
 * The token is only sent to same-origin requests (relative URLs). Absolute
 * URLs to other hosts never receive it.
 */

import { supabase } from '@/lib/supabase';

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
  return fetch(input, { ...init, headers });
}
