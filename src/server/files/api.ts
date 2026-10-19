import { getSession, type CurrentSession } from "../auth/session";

/**
 * The signed-in user for an API route, or the 401/403 response to return. Call after `await connection()`.
 */
export async function apiSession(): Promise<CurrentSession | Response> {
  const current = await getSession();
  if (!current) return Response.json({ error: "Sign in required.", code: "unauthorized" }, { status: 401 });
  if (current.user.totpEnabled && !current.session.twoFactorPassed) {
    return Response.json({ error: "Finish two-factor sign-in first.", code: "two_factor_required" }, { status: 403 });
  }
  return current;
}
