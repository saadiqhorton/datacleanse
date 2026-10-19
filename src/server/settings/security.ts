import { z } from "zod";
import { APIError } from "better-auth/api";
import { audit } from "../audit";
import { authReady, getAuth } from "../auth/better-auth";
import { db } from "../db";
import { SettingsError } from "./errors";
import { describeUserAgent, type DeviceLabel } from "./userAgent";
import { relativeTime } from "./format";

export interface SessionView extends DeviceLabel {
  /** Better Auth session id. Safe to pass back to revokeOneSession; the token never leaves the server. */
  id: string;
  current: boolean;
  /** "3 h ago", or "just now". */
  lastActive: string;
  lastActiveAt: number;
}

export const NEW_PASSWORD_MIN = 10;
export const NEW_PASSWORD_MAX = 128;

/** Better Auth session ids are short random strings. Anything else cannot match a session. */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Error code Better Auth returns from its API, or undefined for anything else. */
function apiErrorCode(err: unknown): string | undefined {
  return err instanceof APIError ? (err.body?.code as string | undefined) : undefined;
}

export function newPasswordProblem(password: string): string | null {
  if (password.length < NEW_PASSWORD_MIN) return `Password must be at least ${NEW_PASSWORD_MIN} characters.`;
  if (password.length > NEW_PASSWORD_MAX) return `Password must be ${NEW_PASSWORD_MAX} characters or fewer.`;
  return null;
}

/** "Last changed 3 months ago", or null when there is no password. */
export function passwordChangedLabel(changedAt: number | null, now = Date.now()): string | null {
  return changedAt === null ? null : `Last changed ${relativeTime(changedAt, now)}`;
}

/**
 * When the account's password was last set, from Better Auth's credential account. Null when the account
 * has no password (it should always have one: email and password is the only sign-in method).
 */
export function getPasswordInfo(userId: string): { changedAt: number } | null {
  const row = db()
    .prepare(
      "SELECT updatedAt FROM auth_account WHERE userId = ? AND providerId = 'credential' AND password IS NOT NULL",
    )
    .get(userId) as { updatedAt: string } | undefined;
  return row ? { changedAt: new Date(row.updatedAt).getTime() } : null;
}

/**
 * The user's live sessions, newest activity first, with the caller's marked as current. Read straight from
 * Better Auth's session table (the user's own rows), so tokens never leave the server and the list works
 * however long ago the user signed in.
 */
export async function listSessionViews(
  userId: string,
  _headers: Headers,
  currentSessionId: string | null,
  now = Date.now(),
): Promise<SessionView[]> {
  await authReady();
  const rows = db()
    .prepare("SELECT id, userAgent, updatedAt, expiresAt FROM auth_session WHERE userId = ?")
    .all(userId) as { id: string; userAgent: string | null; updatedAt: string | number; expiresAt: string | number }[];
  return rows
    .filter((s) => new Date(s.expiresAt).getTime() > now)
    .map((s) => {
      const lastActiveAt = new Date(s.updatedAt).getTime();
      return {
        id: s.id,
        current: s.id === currentSessionId,
        ...describeUserAgent(s.userAgent ?? ""),
        lastActive: relativeTime(lastActiveAt, now),
        lastActiveAt,
      };
    })
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

/**
 * Signs out one of the user's other sessions. The session is looked up by id on the server, so the
 * browser never sends or receives a session token. The current session must use normal sign-out.
 */
export async function revokeOneSession(
  userId: string,
  headers: Headers,
  currentSessionId: string | null,
  sessionId: string,
): Promise<void> {
  if (!SESSION_ID_RE.test(sessionId)) throw new SettingsError("That session could not be found.");
  if (sessionId === currentSessionId) throw new SettingsError("Use Sign out to end this session.");

  const row = db()
    .prepare("SELECT token FROM auth_session WHERE id = ? AND userId = ?")
    .get(sessionId, userId) as { token: string } | undefined;
  if (!row) throw new SettingsError("That session has already ended.");

  await authReady();
  await getAuth().api.revokeSession({ body: { token: row.token }, headers });
  audit("auth.session_revoked", "Signed out one session.", { actor: userId });
}

/** Signs out every session except the caller's. Returns how many were ended. */
export async function signOutOtherSessions(
  userId: string,
  headers: Headers,
  keepSessionId: string,
): Promise<number> {
  const { n } = db()
    .prepare("SELECT COUNT(*) AS n FROM auth_session WHERE userId = ? AND id != ?")
    .get(userId, keepSessionId) as { n: number };
  await authReady();
  await getAuth().api.revokeOtherSessions({ headers });
  audit("auth.sessions_revoked", `Signed out ${n} other session${n === 1 ? "" : "s"}.`, { actor: userId });
  return n;
}

/**
 * Changes the password after checking the current one. Better Auth signs out the other sessions and
 * rotates this browser's session cookie, so the caller stays signed in.
 */
export async function changeOwnPassword(
  userId: string,
  headers: Headers,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await authReady();
  try {
    await getAuth().api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers,
    });
  } catch (err) {
    switch (apiErrorCode(err)) {
      case "INVALID_PASSWORD":
        throw new SettingsError("Current password is incorrect.");
      case "UNAUTHORIZED":
        throw new SettingsError("Sign in again to change your password.");
      case "PASSWORD_TOO_SHORT":
        throw new SettingsError(`Password must be at least ${NEW_PASSWORD_MIN} characters.`);
      case "PASSWORD_TOO_LONG":
        throw new SettingsError(`Password must be ${NEW_PASSWORD_MAX} characters or fewer.`);
      default:
        throw err;
    }
  }
  audit("auth.password_changed", "Password changed. Other sessions signed out.", { actor: userId });
}

export const passwordFormSchema = z
  .object({
    current: z
      .string()
      .min(1, "Enter your current password.")
      .max(NEW_PASSWORD_MAX, "Current password is incorrect."),
    next: z.string(),
    confirm: z.string(),
  })
  .superRefine((v, ctx) => {
    const problem = newPasswordProblem(v.next);
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["next"] });
    if (v.next !== v.confirm) ctx.addIssue({ code: "custom", message: "The new passwords don't match.", path: ["confirm"] });
  });
