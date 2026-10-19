"use server";

import { redirect } from "next/navigation";
import { audit } from "../audit";
import { env } from "../env";
import { authReady, getAuth } from "./better-auth";
import {
  MESSAGES,
  apiFailure,
  newPasswordProblem,
  resetFailure,
  signInFailure,
  signUpFailure,
} from "./actions-logic";
import { safeNext } from "./redirects";
import { getSession, signOut } from "./session";
import { normalizeEmail } from "./users";

/** State returned to the forms through useActionState. Never contains passwords. */
export type FormState = {
  error?: string;
  message?: string;
  email?: string;
  name?: string;
  /** Set when a reset link is dead, so the form can offer a new one. */
  linkInvalid?: boolean;
} | null;

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

/** Sign-in form. Email and password through Better Auth; redirects to `next` on success. */
export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const next = safeNext(field(formData, "next"));
  const rawEmail = field(formData, "email");
  const email = normalizeEmail(rawEmail);
  if (!email) return { error: MESSAGES.email, email: rawEmail };
  const password = field(formData, "password");
  if (!password) return { error: MESSAGES.password, email: rawEmail };

  await authReady();
  let userId: string;
  try {
    const res = await getAuth().api.signInEmail({ body: { email, password } });
    userId = res.user.id;
  } catch (err) {
    if (!apiFailure(err)) throw err;
    audit("auth.sign_in_failed", `Failed password sign-in for ${email}.`);
    return { error: signInFailure(err), email: rawEmail };
  }
  audit("auth.signed_in", "Signed in with password.", { actor: userId });
  redirect(next);
}

/** Sign-up form. Creates the account (the first one becomes the owner), signs in, and goes to the file list. */
export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = field(formData, "name").trim();
  const rawEmail = field(formData, "email");
  const password = field(formData, "password");

  if (!name) return { error: MESSAGES.name, email: rawEmail, name };
  const email = normalizeEmail(rawEmail);
  if (!email) return { error: MESSAGES.email, email: rawEmail, name };

  await authReady();
  try {
    // autoSignIn is on, so the session cookie is set through the nextCookies plugin. Sign-ups closed
    // and the profile row are handled by the databaseHooks in better-auth.ts.
    await getAuth().api.signUpEmail({ body: { name, email, password } });
  } catch (err) {
    if (!apiFailure(err)) throw err;
    return { error: signUpFailure(err), email: rawEmail, name };
  }
  redirect("/files");
}

/** Reset request form. Always gives the same answer, whether or not the address has an account. */
export async function requestPasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const rawEmail = field(formData, "email");
  const email = normalizeEmail(rawEmail);
  if (!email) return { error: MESSAGES.email, email: rawEmail };

  await authReady();
  try {
    // Better Auth emails a link to ${redirectTo}?token=... (or ?error=INVALID_TOKEN when it is dead).
    await getAuth().api.requestPasswordReset({ body: { email, redirectTo: `${env.appUrl}/reset-password` } });
  } catch (err) {
    // The answer must not depend on what went wrong, so log it for the operator and say the same thing.
    console.error("[auth] could not start a password reset", err);
  }
  return { message: MESSAGES.resetSent, email: rawEmail };
}

/** Sets a new password from an emailed reset link. Better Auth signs out every session. */
export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = field(formData, "token");
  const password = field(formData, "password");
  const problem = newPasswordProblem(password, field(formData, "confirm"));
  if (problem) return { error: problem };
  if (!token) return { error: MESSAGES.resetLinkInvalid, linkInvalid: true };

  await authReady();
  try {
    await getAuth().api.resetPassword({ body: { newPassword: password, token } });
  } catch (err) {
    if (!apiFailure(err)) throw err;
    return resetFailure(err);
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
