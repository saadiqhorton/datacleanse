import { db } from "../db";
import { newToken, sha256 } from "../ids";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** last_seen_at is only written this often, to keep reads cheap. */
export const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionRecord {
  /** sha256 of the cookie token. Safe to show and to pass to revokeSession. */
  id: string;
  userId: string;
  twoFactorPassed: boolean;
  userAgent: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

interface SessionRow {
  id: string;
  user_id: string;
  two_factor_passed: number;
  user_agent: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

function toRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    twoFactorPassed: row.two_factor_passed === 1,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  };
}

/** The session id stored for a cookie token. */
export function sessionIdFromToken(token: string): string {
  return sha256(token);
}

/** Creates a session and returns the raw token for the cookie. Only its hash is stored. */
export function createSessionRecord(
  userId: string,
  opts: { twoFactorPassed: boolean; userAgent: string },
): string {
  const token = newToken();
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO sessions (id, user_id, two_factor_passed, user_agent, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionIdFromToken(token),
      userId,
      opts.twoFactorPassed ? 1 : 0,
      opts.userAgent.slice(0, 300),
      now,
      now,
      now + SESSION_TTL_MS,
    );
  return token;
}

/**
 * Returns the live session for a cookie token, or null when unknown or expired.
 * Expired rows are deleted. last_seen_at is bumped at most every 5 minutes.
 */
export function lookupSession(token: string): SessionRecord | null {
  if (!token) return null;
  const conn = db();
  const id = sessionIdFromToken(token);
  const row = conn.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at <= now) {
    conn.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  if (now - row.last_seen_at >= LAST_SEEN_WRITE_INTERVAL_MS) {
    conn.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, id);
    row.last_seen_at = now;
  }
  return toRecord(row);
}

/** Sessions for a user that have not expired, newest first. */
export function listSessions(userId: string): SessionRecord[] {
  const rows = db()
    .prepare("SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC")
    .all(userId, Date.now()) as SessionRow[];
  return rows.map(toRecord);
}

/** Signs out one session. Only sessions belonging to userId are affected. */
export function revokeSession(userId: string, sessionId: string): boolean {
  const res = db().prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(sessionId, userId);
  return res.changes > 0;
}

/** Signs out every session of a user except keepId. Returns how many were removed. */
export function revokeOtherSessions(userId: string, keepId: string): number {
  const res = db().prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, keepId);
  return res.changes;
}

/** Signs out every session of a user (password reset, account disabled). */
export function revokeAllSessions(userId: string): number {
  const res = db().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  return res.changes;
}

/** Records that the session passed the second factor. */
export function markTwoFactorPassed(sessionId: string): void {
  db().prepare("UPDATE sessions SET two_factor_passed = 1 WHERE id = ?").run(sessionId);
}
