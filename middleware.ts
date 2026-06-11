import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Pages that don't require authentication
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout', '/api/webhook'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Redirect root to dashboard
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  
  // Allow public paths
  if (PUBLIC_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }
  
  // Allow static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const authCookie = request.cookies.get('re-analyzer-auth');
  
  if (!authCookie?.value) {
    // Redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Verify the cookie value (contains timestamp)
  try {
    const [token, timestamp] = authCookie.value.split(':');
    const authTime = parseInt(timestamp, 10);
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    // Check if token matches and session is still valid (24h)
    if (token !== 'authenticated' || now - authTime > twentyFourHours) {
      // Session expired, redirect to login
      const response = NextResponse.redirect(new URL('/login', request.url));
      response.cookies.delete('re-analyzer-auth');
      return response;
    }
  } catch {
    // Invalid cookie, redirect to login
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('re-analyzer-auth');
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};