import { audit } from "../audit";
import { db } from "../db";
import { sendEmail } from "../email";
import { env } from "../env";
import { newToken, sha256 } from "../ids";
import { AuthError, createUser, findUserByEmail, normalizeEmail, writePassword, type UserRecord } from "./users";
import { passwordProblem } from "./passwords";
import { revokeAllSessions } from "./sessions";

export const TOKEN_TTL_MS = 15 * 60 * 1000;

type Purpose = "magic_link" | "password_reset";

/** Stores sha256(token) with its email. Expired rows are pruned here. */
function storeToken(email: string, purpose: Purpose): string {
  const now = Date.now();
  const conn = db();
  conn.prepare("DELETE FROM login_tokens WHERE expires_at < ?").run(now - 24 * 60 * 60 * 1000);
  const token = newToken();
  conn
    .prepare("INSERT INTO login_tokens (id, email, purpose, expires_at) VALUES (?, ?, ?, ?)")
    .run(sha256(token), email, purpose, now + TOKEN_TTL_MS);
  return token;
}

/**
 * Atomically consumes a single-use token. Returns its email, or null when the token is
 * unknown, expired, already used, or for another purpose.
 */
function consumeToken(token: string, purpose: Purpose): string | null {
  if (!token) return null;
  const now = Date.now();
  const row = db()
    .prepare(
      `UPDATE login_tokens SET used_at = ?
       WHERE id = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
       RETURNING email`,
    )
    .get(now, sha256(token), purpose, now) as { email: string } | undefined;
  return row?.email ?? null;
}

function magicLinkUrl(token: string): string {
  return `${env.appUrl}/auth/magic?token=${token}`;
}

function resetUrl(token: string): string {
  return `${env.appUrl}/reset-password?token=${token}`;
}

/**
 * Emails a single-use sign-in link. Behaves the same for known and unknown addresses:
 * the email is always sent, and consuming the link creates the account if it is new.
 * Invalid addresses are ignored silently.
 */
export async function requestMagicLink(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!email) return;
  const token = storeToken(email, "magic_link");
  audit("auth.magic_link_requested", `Sign-in link requested for ${email}.`);
  await sendEmail({
    to: email,
    subject: "Your DataCleanse sign-in link",
    text: [
      "Use this link to sign in to DataCleanse:",
      "",
      magicLinkUrl(token),
      "",
      "The link works once and expires in 15 minutes.",
      "If you did not ask for it, you can ignore this email.",
    ].join("\n"),
  });
}

/**
 * Consumes a magic-link token and returns the signed-in user, creating the account on first use.
 * Returns null for invalid or expired tokens and for disabled accounts.
 */
export async function consumeMagicLink(token: string): Promise<UserRecord | null> {
  const email = consumeToken(token, "magic_link");
  if (!email) return null;
  let user = findUserByEmail(email);
  if (!user) {
    try {
      user = await createUser({ email, name: email.split("@")[0] });
    } catch (err) {
      // Lost a race with a concurrent sign-up for the same address: use that account.
      if (!(err instanceof AuthError && err.code === "email_taken")) throw err;
      user = findUserByEmail(email);
    }
  }
  if (!user || user.disabled) return null;
  return user;
}

/**
 * Starts a password reset. Only existing, enabled accounts get an email, but every caller gets
 * the same result, so the response does not reveal whether the address has an account.
 */
export async function requestPasswordReset(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!email) return;
  const user = findUserByEmail(email);
  if (!user || user.disabled) return;
  const token = storeToken(email, "password_reset");
  audit("auth.password_reset_requested", `Password reset requested for ${email}.`, { actor: user.id });
  // Not awaited: sending time must not reveal whether the account exists.
  sendEmail({
    to: email,
    subject: "Reset your DataCleanse password",
    text: [
      "Use this link to choose a new DataCleanse password:",
      "",
      resetUrl(token),
      "",
      "The link works once and expires in 15 minutes.",
      "If you did not ask for it, you can ignore this email. Your password stays the same.",
    ].join("\n"),
  }).catch((err: unknown) => {
    console.error("[auth] could not send password reset email", err);
  });
}

/**
 * Sets a new password with a reset token and signs out every session of that user.
 * Returns the user, or null when the token is invalid or expired.
 * Throws AuthError("weak_password") before consuming the token, so a typo does not burn it.
 */
export async function resetPassword(token: string, newPassword: string): Promise<UserRecord | null> {
  const problem = passwordProblem(newPassword);
  if (problem) throw new AuthError("weak_password", problem);
  const email = consumeToken(token, "password_reset");
  if (!email) return null;
  const user = findUserByEmail(email);
  if (!user || user.disabled) return null;
  await writePassword(user.id, newPassword);
  revokeAllSessions(user.id);
  audit("auth.password_reset", "Password reset with emailed link. All sessions signed out.", { actor: user.id });
  return user;
}
