import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { db } from "../db";
import { authReady, getAuth } from "./better-auth";
import { getUserById, type UserRecord } from "./users";
import { safeNext } from "./redirects";

/** Request header set by src/proxy.ts with the requested path and query, used for ?next=. */
export const PATH_HEADER = "x-dc-pathname";

export interface SessionInfo {
  /** Better Auth session id. */
  id: string;
  userId: string;
  userAgent: string;
  createdAt: number;
  expiresAt: number;
}

export interface CurrentSession {
  user: UserRecord;
  session: SessionInfo;
}

type Resolved =
  | { status: "signed_out" }
  | { status: "disabled"; userId: string }
  | { status: "ok"; current: CurrentSession };

async function resolve(): Promise<Resolved> {
  const requestHeaders = await headers();
  // Session lookup reads the clock and the database, so it must run at request time, never in a
  // prefetch prerender (where request data is known but Date.now() is not allowed).
  await connection();
  await authReady();
  const result = await getAuth().api.getSession({ headers: requestHeaders });
  if (!result) return { status: "signed_out" };
  const user = getUserById(result.user.id);
  if (!user) return { status: "signed_out" };
  if (user.disabled) return { status: "disabled", userId: user.id };
  const s = result.session;
  return {
    status: "ok",
    current: {
      user,
      session: {
        id: s.id,
        userId: s.userId,
        userAgent: s.userAgent ?? "",
        createdAt: new Date(s.createdAt).getTime(),
        expiresAt: new Date(s.expiresAt).getTime(),
      },
    },
  };
}

/** The signed-in user and session, or null when signed out, expired, or disabled. */
export async function getSession(): Promise<CurrentSession | null> {
  const r = await resolve();
  return r.status === "ok" ? r.current : null;
}

/** Id of the current session, or null when signed out. */
export async function getCurrentSessionId(): Promise<string | null> {
  return (await getSession())?.session.id ?? null;
}

async function nextQuery(): Promise<string> {
  const requested = (await headers()).get(PATH_HEADER);
  if (!requested) return "";
  return `?next=${encodeURIComponent(safeNext(requested))}`;
}

/**
 * For protected pages and server functions. Redirects to sign-in when signed out; disabled accounts
 * lose all their sessions. Call inside a <Suspense> boundary (cacheComponents): it reads request headers.
 */
export async function requireUser(): Promise<CurrentSession> {
  const r = await resolve();
  if (r.status === "signed_out") redirect(`/signin${await nextQuery()}`);
  if (r.status === "disabled") {
    revokeAllAuthSessions(r.userId);
    redirect("/signin?error=disabled");
  }
  return r.current;
}

/** requireUser plus an admin role check. Non-admins get a 404, not a hint that the page exists. */
export async function requireAdmin(): Promise<CurrentSession> {
  const current = await requireUser();
  if (current.user.role !== "admin") notFound();
  return current;
}

/** Ends the current session and clears the cookie. Only from a Server Function or Route Handler. */
export async function signOut(): Promise<void> {
  await authReady();
  await getAuth().api.signOut({ headers: await headers() });
}

/** Deletes every Better Auth session for a user (disable, delete account, password reset). */
export function revokeAllAuthSessions(userId: string): void {
  db().prepare("DELETE FROM auth_session WHERE userId = ?").run(userId);
}
