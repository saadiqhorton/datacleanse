import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/server/audit";
import { createSessionRecord } from "@/server/auth/sessions";
import { sessionCookieOptions, SESSION_COOKIE } from "@/server/auth/session";
import { consumeMagicLink } from "@/server/auth/tokens";

const EXPIRED = "/signin?error=link_expired";

/** Consumes a single-use sign-in link, starts a session, and sends the visitor on. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const fail = () => {
    const res = NextResponse.redirect(new URL(EXPIRED, request.url));
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  };

  if (!token || token.length > 200) return fail();

  let user;
  try {
    user = await consumeMagicLink(token);
  } catch (err) {
    console.error("[auth] magic link failed", err);
    return fail();
  }
  if (!user) {
    audit("auth.sign_in_failed", "Sign-in link was invalid, expired, or already used.");
    return fail();
  }

  const sessionToken = createSessionRecord(user.id, {
    twoFactorPassed: false,
    userAgent: request.headers.get("user-agent") ?? "",
  });
  const res = NextResponse.redirect(new URL(user.totpEnabled ? "/signin/2fa" : "/files", request.url));
  res.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
  res.headers.set("Referrer-Policy", "no-referrer");
  audit("auth.signed_in", "Signed in with a sign-in link.", { actor: user.id });
  return res;
}
