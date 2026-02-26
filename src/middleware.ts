import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/* =====================================================================
 * Cache-Control tiers for API GET responses.
 * Values are aligned with src/lib/api-cache.ts `cacheHeaders`.
 * ===================================================================== */
const CC_LONG = 'public, s-maxage=900, stale-while-revalidate=1800'; // 15 min – only for truly static data
const CC_MEDIUM = 'private, no-cache';  // mutable data – always reach origin
const CC_SHORT = 'private, no-cache';  // mutable data – always reach origin

/** Static / reference data — rarely or never changes */
const LONG_RE =
  /^\/api\/(training-(use-cases|components)|softskill-criteria|trainee\/evaluations\/softskills|trainee\/lernfelder\/|verify\/)/;

/** Trainer & trainee data routes — changes on writes, 5 min TTL */
const MEDIUM_RE = /^\/api\/(trainer|trainee)\//;

/** Routes that must NOT be cached (AI chat, auth, real-time) */
const NO_CACHE_RE = /^\/api\/(hai\/|auth\/|register)/;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /* ── API route caching (GET only) ─────────────────────────────── */
  if (pathname.startsWith('/api/')) {
    const response = NextResponse.next();

    if (request.method === 'GET' && !NO_CACHE_RE.test(pathname)) {
      if (LONG_RE.test(pathname)) {
        response.headers.set('Cache-Control', CC_LONG);
      } else if (MEDIUM_RE.test(pathname)) {
        response.headers.set('Cache-Control', CC_MEDIUM);
      } else {
        response.headers.set('Cache-Control', CC_SHORT);
      }
    }

    return response;
  }

  /* ── Page routes ──────────────────────────────────────────────── */
  const publicRoutes = [
    '/',
    '/register',
    '/forgot-password',
    '/reset-password',
  ];
  if (publicRoutes.includes(pathname) || pathname.startsWith('/verify')) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/trainee/') || pathname.startsWith('/trainer/')) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /* API routes — for Cache-Control headers */
    '/api/:path*',
    /*
     * All other paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
