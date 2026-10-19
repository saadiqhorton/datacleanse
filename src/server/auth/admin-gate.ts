import { lookupSession } from "./sessions";
import { getUserById } from "./users";

/**
 * True when the session cookie belongs to a signed-in account that is not an admin. Proxy uses this to
 * answer /admin with a real 404 before the page streams, since notFound() inside a page cannot change
 * the status once the response has started. Anything else (no session, expired, 2FA pending, admin) returns
 * false and is left to the pages, which still run requireAdmin() themselves.
 */
export function isSignedInNonAdmin(token: string): boolean {
  const session = lookupSession(token);
  if (!session) return false;
  const user = getUserById(session.userId);
  if (!user || user.disabled || user.role === "admin") return false;
  return session.twoFactorPassed || !user.totpEnabled;
}
