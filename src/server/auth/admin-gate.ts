import { authReady, getAuth } from "./better-auth";
import { getUserById } from "./users";

/**
 * True when the request belongs to a signed-in account that is not an admin. Proxy uses this to
 * answer /admin with a real 404 before the page streams, since notFound() inside a page cannot change
 * the status once the response has started. Anything else returns false and is left to the pages,
 * which still run requireAdmin() themselves.
 */
export async function isSignedInNonAdmin(requestHeaders: Headers): Promise<boolean> {
  await authReady();
  const result = await getAuth().api.getSession({ headers: requestHeaders });
  if (!result) return false;
  const user = getUserById(result.user.id);
  return !!user && !user.disabled && user.role !== "admin";
}
