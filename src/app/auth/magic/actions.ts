"use server";

import { redirect } from "next/navigation";
import { audit } from "@/server/audit";
import { signIn } from "@/server/auth/session";
import { consumeMagicLink } from "@/server/auth/tokens";
import type { UserRecord } from "@/server/auth/users";

const EXPIRED = "/signin?error=link_expired";

/**
 * Uses up a magic link and starts a session. Only this action consumes a link: the GET page
 * just checks it, so link scanners that open the URL cannot sign anyone in.
 */
export async function confirmMagicLinkAction(formData: FormData): Promise<void> {
  const raw = formData.get("token");
  const token = typeof raw === "string" && raw.length <= 200 ? raw : "";

  let user: UserRecord | null = null;
  try {
    user = token ? await consumeMagicLink(token) : null;
  } catch (err) {
    console.error("[auth] magic link failed", err);
  }
  if (!user) {
    audit("auth.sign_in_failed", "Sign-in link was invalid, expired, or already used.");
    redirect(EXPIRED);
  }

  await signIn(user.id, { twoFactorPassed: false });
  // With TOTP the sign-in is only complete after the second factor, which audits auth.signed_in.
  if (user.totpEnabled) redirect("/signin/2fa");
  audit("auth.signed_in", "Signed in with a sign-in link.", { actor: user.id });
  redirect("/files");
}
