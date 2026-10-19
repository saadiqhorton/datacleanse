import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isSignedInNonAdmin } from "./server/auth/admin-gate";

/** Must match PATH_HEADER in src/server/auth/session.ts. */
const PATH_HEADER = "x-dc-pathname";

const PUBLIC_EXACT = new Set(["/signin", "/signup", "/api/health", "/favicon.ico"]);
const PUBLIC_PREFIXES = ["/signin/", "/api/auth/", "/reset-password", "/_next/"];

/** A path that does not exist, so Next serves its 404 page with a 404 status. */
const NOT_FOUND_PATH = "/_not-found-proxy";

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Root-level static files in public/ (e.g. /file.svg). Nested paths are never exempt.
  return /^\/[a-z0-9_-]+\.(svg|png|jpe?g|webp|ico|txt|xml|json|webmanifest)$/i.test(pathname);
}

/**
 * Cheap first gate: checks only that Better Auth's session cookie is present. The real checks
 * (session validity, disabled accounts) happen in requireUser() on each page and server function.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATH_HEADER, `${pathname}${search}`);

  // Admin pages answer non-admins with a real 404 status. The page-level check can only show a not-found
  // page with a 200, because the page has already started streaming by then.
  const token = getSessionCookie(request);
  if (token && isAdminPath(pathname) && (await isSignedInNonAdmin(request.headers))) {
    return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));
  }

  if (isPublic(pathname) || token) {
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
