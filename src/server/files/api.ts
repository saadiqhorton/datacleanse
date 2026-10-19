import { getSession, type CurrentSession } from "../auth/session";

/**
 * The signed-in user for an API route, or the 401 response to return. Call after `await connection()`.
 */
export async function apiSession(): Promise<CurrentSession | Response> {
  const current = await getSession();
  if (!current) return Response.json({ error: "Sign in required.", code: "unauthorized" }, { status: 401 });
  return current;
}
