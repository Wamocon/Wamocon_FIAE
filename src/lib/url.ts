import { NextRequest } from 'next/server';

/**
 * Derive the public application base URL from an incoming request.
 *
 * Resolution order (most → least authoritative):
 *  1. `X-Forwarded-Host` / `X-Forwarded-Proto` — set by the reverse proxy
 *     (Nginx) and reflects the real public request.
 *  2. `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` — explicit canonical URL.
 *     Critical fallback when the proxy does NOT forward the Host header,
 *     which would otherwise leak the internal container host (e.g.
 *     `localhost:3002`) into certificate QR codes and break verification.
 *  3. Raw `Host` header — direct/local access.
 *  4. Production default.
 */
export function getBaseUrlFromRequest(request: NextRequest): string {
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    .trim();
  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    .trim();

  // 1. Proxy-forwarded host (accurate for the real public request).
  if (forwardedHost) {
    const protocol = forwardedProto === 'https' ? 'https' : 'http';
    return `${protocol}://${forwardedHost}`;
  }

  // 2. Explicitly configured canonical public URL — reliable behind proxies
  //    that strip/omit forwarding headers.
  const configured =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  // 3. Raw Host header (direct or development access).
  const host = request.headers.get('host');
  if (host) {
    const protocol = forwardedProto === 'https' ? 'https' : 'http';
    return `${protocol}://${host}`;
  }

  // 4. Last-resort production default.
  return 'https://fiae-learn.com';
}
