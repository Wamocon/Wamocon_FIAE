import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes that don't require authentication
  const publicRoutes = ['/', '/register', '/forgot-password', '/reset-password'];
  if (publicRoutes.includes(pathname)) {
    return NextResponse.next();
  }

  // Check for authentication token in localStorage (this will be handled client-side)
  // For now, we'll let the client-side components handle authentication
  // The middleware will just ensure the routes are accessible

  // Role-based route protection
  if (pathname.startsWith('/trainee/')) {
    // Trainee routes - let the component handle role checking
    return NextResponse.next();
  }

  if (pathname.startsWith('/trainer/')) {
    // Trainer routes - let the component handle role checking
    return NextResponse.next();
  }

  // Default: allow access
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
