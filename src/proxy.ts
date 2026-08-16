/**
 * Gatekeeper for every page and API route except /login and static
 * assets. Named `proxy.ts`, not `middleware.ts` — Next.js 16 renamed the
 * file convention (same mechanism, see node_modules/next/dist/docs/.../
 * proxy.md's "Migration to Proxy" section).
 *
 * Auth is opt-in: when `APP_PASSWORD` isn't set (the default for local
 * development), `isAuthEnabled()` is false and every request passes
 * through unchanged — see src/lib/auth/session.ts's header comment. Set
 * both `APP_PASSWORD` and `SESSION_SECRET` before deploying anywhere
 * reachable off your own machine (README "Remote hosting and
 * authentication").
 *
 * Next.js's own docs warn that a Server Function (Server Action) is
 * handled as a POST to the route it's used on, so a broad matcher here
 * covers them too — but a matcher change that excludes a path would
 * silently remove that coverage. This matcher is intentionally an
 * exclude-list (everything protected by default) rather than an
 * include-list, so a newly added page is protected without anyone having
 * to remember to add it here.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthEnabled, verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

export function proxy(request: NextRequest) {
  if (!isAuthEnabled()) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (verifySessionToken(token)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!login|api/health|_next/static|_next/image|favicon.ico).*)",
  ],
};
