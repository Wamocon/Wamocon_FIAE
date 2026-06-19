import { NextRequest } from 'next/server';

/**
 * Derive the public application base URL from an incoming request.
 * Falls back to NEXT_PUBLIC_APP_URL, then to a production default.
 */
export function getBaseUrlFromRequest(request: NextRequest): string {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host') || '';

  if (host) {
    const protocol = forwardedProto === 'https' ? 'https' : 'http';
    return `${protocol}://${host}`;
  }

  return (process.env.NEXT_PUBLIC_APP_URL || 'https://fiae-learn.com').replace(
    /\/$/,
    ''
  );
}
