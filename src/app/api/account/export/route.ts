import { getSession } from "@/server/auth/session";
import { exportAccount } from "@/server/settings/export";

/** Downloads the signed-in user's data as JSON. Secrets are excluded (see server/settings/export.ts). */
export async function GET() {
  // Reads the session cookie, so the response is always per request and never cached.
  const current = await getSession();
  if (!current) {
    return Response.json({ error: "Sign in required.", code: "unauthorized" }, { status: 401 });
  }
  if (current.user.totpEnabled && !current.session.twoFactorPassed) {
    return Response.json({ error: "Finish two-factor sign-in first.", code: "two_factor_required" }, { status: 403 });
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
