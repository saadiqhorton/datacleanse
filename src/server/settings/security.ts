import { z } from "zod";
import { audit } from "../audit";
import { revokeOtherSessions, revokeSession, listSessions } from "../auth/sessions";
import { getUserById, writePassword } from "../auth/users";
import { passwordProblem } from "../auth/passwords";
import { SettingsError } from "./errors";
import { describeUserAgent, type DeviceLabel } from "./userAgent";
import { relativeTime } from "./format";

export interface SessionView extends DeviceLabel {
  /** Session id (sha256 of the cookie token). Safe to pass back to revokeOneSession. */
  id: string;
  current: boolean;
  /** "3 h ago", or "just now". */
  lastActive: string;
  lastActiveAt: number;
}

/** "Last changed 3 months ago", or null when the account has never had a password set. */
export function passwordChangedLabel(changedAt: number | null, now = Date.now()): string | null {
  return changedAt === null ? null : `Last changed ${relativeTime(changedAt, now)}`;
}

/** Live sessions for a user, the caller's marked as current. Newest activity first. */
export function listSessionViews(userId: string, currentSessionId: string | null, now = Date.now()): SessionView[] {
  return listSessions(userId).map((s) => ({
    id: s.id,
    current: s.id === currentSessionId,
    ...describeUserAgent(s.userAgent),
    lastActive: relativeTime(s.lastSeenAt, now),
    lastActiveAt: s.lastSeenAt,
  }));
}

/** Signs out one of the user's other sessions. The current session must use the normal sign-out. */
export function revokeOneSession(userId: string, currentSessionId: string | null, sessionId: string): void {
  if (!/^[0-9a-f]{64}$/.test(sessionId)) throw new SettingsError("That session could not be found.");
  if (sessionId === currentSessionId) throw new SettingsError("Use Sign out to end this session.");
  if (!revokeSession(userId, sessionId)) throw new SettingsError("That session has already ended.");
  audit("auth.session_revoked", "Signed out one session.", { actor: userId });
}

/** Signs out every session except the caller's. Returns how many were ended. */
export function signOutOtherSessions(userId: string, keepSessionId: string): number {
  const ended = revokeOtherSessions(userId, keepSessionId);
  audit("auth.sessions_revoked", `Signed out ${ended} other session${ended === 1 ? "" : "s"}.`, { actor: userId });
  return ended;
}

/**
 * Sets a first password for an account that signs in with a magic link only. Accounts that already
 * have a password must use changePassword (which checks the current one).
 */
export async function setInitialPassword(userId: string, password: string, keepSessionId: string): Promise<void> {
  const user = getUserById(userId);
  if (!user || user.disabled) throw new SettingsError("Account not found.");
  if (user.hasPassword) throw new SettingsError("This account already has a password. Enter your current password instead.");
  const problem = passwordProblem(password);
  if (problem) throw new SettingsError(problem);

  await writePassword(userId, password);
  revokeOtherSessions(userId, keepSessionId);
  audit("auth.password_changed", "Password set. Other sessions signed out.", { actor: userId });
}

export const passwordFormSchema = z
  .object({
    current: z.string().max(1024),
    next: z.string(),
    confirm: z.string(),
  })
  .superRefine((v, ctx) => {
    const problem = passwordProblem(v.next);
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["next"] });
    if (v.next !== v.confirm) ctx.addIssue({ code: "custom", message: "The new passwords don't match.", path: ["confirm"] });
  });
