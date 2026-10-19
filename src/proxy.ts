import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Must match SESSION_COOKIE in src/server/auth/session.ts (kept separate: proxy stays dependency-free). */
const SESSION_COOKIE = "dc_session";
/** Must match PATH_HEADER in src/server/auth/session.ts. */
const PATH_HEADER = "x-dc-pathname";

const PUBLIC_EXACT = new Set(["/signin", "/signup", "/api/health", "/favicon.ico"]);
const PUBLIC_PREFIXES = ["/signin/", "/auth/", "/reset-password", "/_next/"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Root-level static files in public/ (e.g. /file.svg). Nested paths are never exempt.
  return /^\/[a-z0-9_-]+\.(svg|png|jpe?g|webp|ico|txt|xml|json|webmanifest)$/i.test(pathname);
}

/**
 * Cheap first gate: checks only that the session cookie is present. The real checks (session
 * validity, 2FA, disabled accounts) happen in requireUser() on each page and server function.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATH_HEADER, `${pathname}${search}`);

  if (isPublic(pathname) || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "Sign in required.", code: "unauthorized" }, { status: 401 });
  }

  const target = new URL("/signin", request.url);
  target.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(target);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
