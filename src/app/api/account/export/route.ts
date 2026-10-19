import { getSession } from "@/server/auth/session";
import { exportAccount } from "@/server/settings/export";

/**
 * Downloads the signed-in user's data as JSON. Secrets are excluded: the export reads only app tables
 * (never auth_account or auth_session), and server/settings/export.ts omits password and key material.
 */
export async function GET() {
  // Reads the session cookie, so the response is always per request and never cached.
  const current = await getSession();
  if (!current) {
    return Response.json({ error: "Sign in required.", code: "unauthorized" }, { status: 401 });
  }

  const payload = exportAccount(current.user.id);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="datacleanse-export-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
