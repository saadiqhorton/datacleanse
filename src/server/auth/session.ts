import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { sha256 } from "../ids";
import { lookupSession, markTwoFactorPassed, createSessionRecord, revokeAllSessions, revokeSession, SESSION_TTL_MS, type SessionRecord } from "./sessions";
import { getUserById, type UserRecord } from "./users";
import { safeNext } from "./redirects";

/** Cookie holding the raw session token. Only sha256(token) is stored server-side. */
export const SESSION_COOKIE = "dc_session";
/** Request header set by src/proxy.ts with the requested path and query, used for ?next=. */
export const PATH_HEADER = "x-dc-pathname";

export interface CurrentSession {
  user: UserRecord;
  session: SessionRecord;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

type Resolved =
  | { status: "signed_out" }
  | { status: "disabled"; userId: string }
  | { status: "ok"; current: CurrentSession };

async function resolve(): Promise<Resolved> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { status: "signed_out" };
  const session = lookupSession(token);
  if (!session) return { status: "signed_out" };
  const user = getUserById(session.userId);
  if (!user) return { status: "signed_out" };
  if (user.disabled) return { status: "disabled", userId: user.id };
  return { status: "ok", current: { user, session } };
}

/** The signed-in user and session, or null when signed out, expired, or disabled. */
export async function getSession(): Promise<CurrentSession | null> {
  const r = await resolve();
  return r.status === "ok" ? r.current : null;
}

/** Id of the session behind the cookie, without checking it is still valid. Null when no cookie. */
export async function getCurrentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? sha256(token) : null;
}

async function nextQuery(): Promise<string> {
  const requested = (await headers()).get(PATH_HEADER);
  if (!requested) return "";
  return `?next=${encodeURIComponent(safeNext(requested))}`;
}

/**
 * For protected pages and server functions. Redirects when the visitor must sign in or pass
 * two-factor first. Disabled accounts lose all their sessions.
 * Call inside a <Suspense> boundary (cacheComponents): it reads cookies.
 */
export async function requireUser(): Promise<CurrentSession> {
  const r = await resolve();
  if (r.status === "signed_out") redirect(`/signin${await nextQuery()}`);
  if (r.status === "disabled") {
    revokeAllSessions(r.userId);
    redirect("/signin?error=disabled");
  }
  const { current } = r;
  if (current.user.totpEnabled && !current.session.twoFactorPassed) {
    redirect(`/signin/2fa${await nextQuery()}`);
  }
  return current;
}

/** requireUser plus an admin role check. Non-admins get a 404, not a hint that the page exists. */
export async function requireAdmin(): Promise<CurrentSession> {
  const current = await requireUser();
  if (current.user.role !== "admin") notFound();
  return current;
}

/**
 * Creates a session and sets the cookie. Only call from a Server Function or Route Handler,
 * because cookies cannot be written during render.
 */
export async function signIn(userId: string, opts: { twoFactorPassed: boolean; userAgent?: string }): Promise<void> {
  const token = createSessionRecord(userId, {
    twoFactorPassed: opts.twoFactorPassed,
    userAgent: opts.userAgent ?? (await headers()).get("user-agent") ?? "",
  });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
}

/** Marks the current session as having passed the second factor. */
export async function passTwoFactor(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return;
  const session = lookupSession(token);
  if (session) markTwoFactorPassed(session.id);
}

/** Revokes the current session and clears the cookie. Only from a Server Function or Route Handler. */
export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const session = lookupSession(token);
    if (session) revokeSession(session.userId, session.id);
  }
  store.delete(SESSION_COOKIE);
}
