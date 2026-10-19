import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, insertTestUser } from "../testing";
import {
  createSessionRecord,
  lookupSession,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  revokeAllSessions,
  markTwoFactorPassed,
  sessionIdFromToken,
  SESSION_TTL_MS,
  LAST_SEEN_WRITE_INTERVAL_MS,
} from "./sessions";

test("a new session is stored hashed and expires in 30 days", () => {
  const { db: conn } = setupTestEnv();
  const uid = insertTestUser(conn);
  const token = createSessionRecord(uid, { twoFactorPassed: false, userAgent: "UA" });
  const row = conn.prepare("SELECT id, expires_at, created_at FROM sessions").get() as {
    id: string;
    expires_at: number;
    created_at: number;
  };
  assert.equal(row.id, sessionIdFromToken(token));
  assert.notEqual(row.id, token, "raw token must not be stored");
  assert.ok(Math.abs(row.expires_at - row.created_at - SESSION_TTL_MS) < 5000);
  const session = lookupSession(token);
  assert.equal(session?.userId, uid);
  assert.equal(session?.twoFactorPassed, false);
  assert.equal(session?.userAgent, "UA");
});

test("unknown and empty tokens return null", () => {
  const { db: conn } = setupTestEnv();
  insertTestUser(conn);
  assert.equal(lookupSession("not-a-real-token"), null);
  assert.equal(lookupSession(""), null);
});

test("an expired session is rejected and removed", () => {
  const { db: conn } = setupTestEnv();
  const uid = insertTestUser(conn);
  const token = createSessionRecord(uid, { twoFactorPassed: false, userAgent: "" });
  conn.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(Date.now() - 1, sessionIdFromToken(token));
  assert.equal(lookupSession(token), null);
  const left = conn.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
  assert.equal(left.n, 0);
});

test("last_seen_at is bumped at most every 5 minutes", () => {
  const { db: conn } = setupTestEnv();
  const uid = insertTestUser(conn);
  const token = createSessionRecord(uid, { twoFactorPassed: false, userAgent: "" });
  const id = sessionIdFromToken(token);
  const stale = Date.now() - LAST_SEEN_WRITE_INTERVAL_MS - 1000;
  conn.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(stale, id);
  lookupSession(token);
  const bumped = conn.prepare("SELECT last_seen_at FROM sessions WHERE id = ?").get(id) as { last_seen_at: number };
  assert.ok(bumped.last_seen_at > stale + 1000);

  lookupSession(token);
  const recent = conn.prepare("SELECT last_seen_at FROM sessions WHERE id = ?").get(id) as { last_seen_at: number };
  assert.equal(recent.last_seen_at, bumped.last_seen_at, "no write within the interval");
});

test("listSessions skips expired rows; revoke functions respect ownership", () => {
  const { db: conn } = setupTestEnv();
  const a = insertTestUser(conn, "user_a", "a@example.com");
  const b = insertTestUser(conn, "user_b", "b@example.com");
  const a1 = createSessionRecord(a, { twoFactorPassed: false, userAgent: "" });
  const a2 = createSessionRecord(a, { twoFactorPassed: false, userAgent: "" });
  const a3 = createSessionRecord(a, { twoFactorPassed: false, userAgent: "" });
  const b1 = createSessionRecord(b, { twoFactorPassed: false, userAgent: "" });
  conn.prepare("UPDATE sessions SET expires_at = 0 WHERE id = ?").run(sessionIdFromToken(a3));
  assert.equal(listSessions(a).length, 2);

  assert.equal(revokeSession(b, sessionIdFromToken(a1)), false, "cannot revoke another user's session");
  assert.ok(lookupSession(a1));
  assert.equal(revokeSession(a, sessionIdFromToken(a1)), true);
  assert.equal(lookupSession(a1), null);

  // a3 is expired but still stored, so it is removed too.
  assert.equal(revokeOtherSessions(a, sessionIdFromToken(a2)), 1);
  assert.ok(lookupSession(a2));
  assert.ok(lookupSession(b1), "other users are untouched");

  assert.equal(revokeAllSessions(a), 1);
  assert.equal(lookupSession(a2), null);
  assert.ok(lookupSession(b1));
});

test("markTwoFactorPassed flips the flag on the session", () => {
  const { db: conn } = setupTestEnv();
  const uid = insertTestUser(conn);
  const token = createSessionRecord(uid, { twoFactorPassed: false, userAgent: "" });
  markTwoFactorPassed(sessionIdFromToken(token));
  assert.equal(lookupSession(token)?.twoFactorPassed, true);
});
