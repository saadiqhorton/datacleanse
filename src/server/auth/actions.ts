"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "../audit";
import { authenticate, AuthError, createUser, normalizeEmail, type UserRecord } from "./users";
import { passwordProblem } from "./passwords";
import { safeNext } from "./redirects";
import { emailRequestLimiter, signInLimiter, twoFactorLimiter } from "./rateLimit";
import { getSession, passTwoFactor, signIn, signOut } from "./session";
import { requestMagicLink, requestPasswordReset, resetPassword } from "./tokens";
import { verifyTotp } from "./totp";

/** State returned to the forms through useActionState. Never contains passwords. */
export type FormState = {
  error?: string;
  message?: string;
  email?: string;
  name?: string;
  /** Set when a reset link is dead, so the form can offer a new one. */
  linkInvalid?: boolean;
} | null;

const CHECK_EMAIL_MESSAGE = "Check your email for a sign-in link.";
const RESET_SENT_MESSAGE = "If an account exists for that address, we've sent a reset link. Check your email.";
const EMAIL_ERROR = "Enter a valid email address.";

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

/** Client IP for rate limiting. Trusts the first X-Forwarded-For hop, so the proxy must set it. */
async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return h.get("x-real-ip")?.trim() || "unknown";
}

function minutesUntil(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}

/** Sign-in form: password sign-in, or a magic link when intent is "magic". */
export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const intent = field(formData, "intent");
  const next = safeNext(field(formData, "next"));
  const rawEmail = field(formData, "email");
  const email = normalizeEmail(rawEmail);
  if (!email) return { error: EMAIL_ERROR, email: rawEmail };

  const key = `${email}|${await clientIp()}`;

  if (intent === "magic") {
    if (emailRequestLimiter.isLimited(key)) return { message: CHECK_EMAIL_MESSAGE, email };
    emailRequestLimiter.record(key);
    try {
      await requestMagicLink(email);
    } catch (err) {
      console.error("[auth] could not send sign-in link", err);
      return { error: "We couldn't send the sign-in link. Try again in a moment.", email };
    }
    return { message: CHECK_EMAIL_MESSAGE, email };
  }

  const password = field(formData, "password");
  if (!password) return { error: "Enter your password.", email };

  if (signInLimiter.isLimited(key)) {
    const wait = minutesUntil(signInLimiter.retryAfterMs(key));
    return { error: `Too many failed attempts. Try again in ${wait} minute${wait === 1 ? "" : "s"}.`, email };
  }

  const user = await authenticate(email, password);
  if (!user) {
    signInLimiter.record(key);
    audit("auth.sign_in_failed", `Failed password sign-in for ${email}.`);
    return { error: "Email or password is incorrect.", email };
  }

  signInLimiter.reset(key);
  await signIn(user.id, { twoFactorPassed: false });
  // With TOTP the sign-in is only complete after the second factor, which audits auth.signed_in.
  if (!user.totpEnabled) audit("auth.signed_in", "Signed in with password.", { actor: user.id });
  redirect(user.totpEnabled ? `/signin/2fa?next=${encodeURIComponent(next)}` : next);
}

/** Sign-up form. Creates the account, signs the visitor in, and goes to the file list. */
export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = field(formData, "name").trim();
  const rawEmail = field(formData, "email");
  const password = field(formData, "password");

  if (!name) return { error: "Enter your name.", email: rawEmail, name };
  const email = normalizeEmail(rawEmail);
  if (!email) return { error: EMAIL_ERROR, email: rawEmail, name };
  const problem = passwordProblem(password);
  if (problem) return { error: problem, email, name };

  let user: UserRecord;
  try {
    user = await createUser({ email, name, password });
  } catch (err) {
    if (err instanceof AuthError && err.code === "email_taken") {
      return { error: "An account with this email already exists. Sign in instead.", email, name };
    }
    if (err instanceof AuthError) return { error: err.message, email, name };
    throw err;
  }

  await signIn(user.id, { twoFactorPassed: false });
  audit("auth.signed_up", "Account created.", { actor: user.id });
  redirect("/files");
}

/** Second-factor form on /signin/2fa. */
export async function verifyTwoFactorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const next = safeNext(field(formData, "next"));
  const current = await getSession();
  if (!current) redirect(`/signin?next=${encodeURIComponent(next)}`);
  if (!current.user.totpEnabled || current.session.twoFactorPassed) redirect(next);

  // Keyed by user, not session, so signing in again does not reset the count.
  const key = `2fa:${current.user.id}`;
  if (twoFactorLimiter.isLimited(key)) {
    const wait = minutesUntil(twoFactorLimiter.retryAfterMs(key));
    return { error: `Too many incorrect codes. Try again in ${wait} minute${wait === 1 ? "" : "s"}.` };
  }

  const code = field(formData, "code").replace(/\s+/g, "");
  if (!verifyTotp(current.user.id, code)) {
    twoFactorLimiter.record(key);
    audit("auth.sign_in_failed", "Incorrect two-factor code.", { actor: current.user.id });
    return { error: "That code isn't right. Check your authenticator app and try again." };
  }

  twoFactorLimiter.reset(key);
  await passTwoFactor();
  audit("auth.signed_in", "Two-factor code accepted.", { actor: current.user.id });
  redirect(next);
}

/** Reset request form. Always answers the same way, whether or not the address has an account. */
export async function requestPasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const rawEmail = field(formData, "email");
  const email = normalizeEmail(rawEmail);
  if (!email) return { error: EMAIL_ERROR, email: rawEmail };

  const key = `reset|${email}|${await clientIp()}`;
  if (!emailRequestLimiter.isLimited(key)) {
    emailRequestLimiter.record(key);
    await requestPasswordReset(email);
  }
  return { message: RESET_SENT_MESSAGE, email };
}

/** Sets a new password from an emailed reset link. Signs out every session. */
export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = field(formData, "token");
  const password = field(formData, "password");
  let user: UserRecord | null;
  try {
    user = await resetPassword(token, password);
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    throw err;
  }
  if (!user) {
    return { error: "This reset link is invalid or has expired. Request a new one.", linkInvalid: true };
  }
  redirect("/signin?reset=1");
}

/** Signs out the current session and clears its cookie. */
export async function signOutAction(): Promise<void> {
  const current = await getSession();
  await signOut();
  if (current) audit("auth.signed_out", "Signed out.", { actor: current.user.id });
  redirect("/signin");
}
