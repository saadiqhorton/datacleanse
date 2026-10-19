import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, insertTestUser } from "../testing";
import { db } from "../db";
import { getSentEmailsForTests } from "../email";
import { authenticate, createUser, findUserByEmail } from "./users";
import { createSessionRecord, lookupSession } from "./sessions";
import { consumeMagicLink, requestMagicLink, requestPasswordReset, resetPassword } from "./tokens";

/** Pulls the single-use token out of the most recent email. */
function tokenFromLastEmail(): string {
  const last = getSentEmailsForTests().at(-1);
  const match = last?.text.match(/token=([A-Za-z0-9_-]+)/);
  assert.ok(match, "email should contain a token link");
  return match[1];
}

function silenceEmailLog() {
  mock.method(console, "log", () => {});
}

test("magic link signs in once: the second use is rejected", async () => {
  silenceEmailLog();
  const { db: conn } = setupTestEnv();
  const uid = insertTestUser(conn, "user_m", "m@example.com");
  await requestMagicLink("m@example.com");
  const token = tokenFromLastEmail();
  assert.equal((await consumeMagicLink(token))?.id, uid);
  assert.equal(await consumeMagicLink(token), null, "single use");
  mock.restoreAll();
});

test("magic link for an unknown email creates the account", async () => {
  silenceEmailLog();
  setupTestEnv();
  assert.equal(findUserByEmail("new@example.com"), null);
  await requestMagicLink("New@Example.com");
  const user = await consumeMagicLink(tokenFromLastEmail());
  assert.ok(user);
  assert.equal(user.email, "new@example.com");
  assert.equal(user.role, "admin", "first account ever is admin");
  assert.equal(user.hasPassword, false);
  mock.restoreAll();
});

test("requestMagicLink behaves the same for known and unknown addresses", async () => {
  silenceEmailLog();
  const { db: conn } = setupTestEnv();
  insertTestUser(conn, "user_k", "known@example.com");
  await requestMagicLink("known@example.com");
  await requestMagicLink("unknown@example.com");
  const [known, unknown] = getSentEmailsForTests().slice(-2);
  assert.equal(known.subject, unknown.subject);
  assert.equal(known.text.replace(/token=\S+/, ""), unknown.text.replace(/token=\S+/, ""));
  mock.restoreAll();
});

test("invalid email in requestMagicLink sends nothing", async () => {
  silenceEmailLog();
  setupTestEnv();
  const before = getSentEmailsForTests().length;
  await requestMagicLink("not an email");
  assert.equal(getSentEmailsForTests().length, before);
  mock.restoreAll();
});

test("expired magic link is rejected", async () => {
  silenceEmailLog();
  setupTestEnv();
  await requestMagicLink("exp@example.com");
  const token = tokenFromLastEmail();
  db().prepare("UPDATE login_tokens SET expires_at = ?").run(Date.now() - 1);
  assert.equal(await consumeMagicLink(token), null);
  assert.equal(findUserByEmail("exp@example.com"), null, "no account from an expired link");
  mock.restoreAll();
});

test("garbage token is rejected", async () => {
  setupTestEnv();
  assert.equal(await consumeMagicLink(""), null);
  assert.equal(await consumeMagicLink("definitely-not-issued"), null);
});

test("a disabled account cannot sign in with a magic link", async () => {
  silenceEmailLog();
  const { db: conn } = setupTestEnv();
  const uid = insertTestUser(conn, "user_dis", "dis@example.com");
  conn.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(uid);
  await requestMagicLink("dis@example.com");
  assert.equal(await consumeMagicLink(tokenFromLastEmail()), null);
  mock.restoreAll();
});

test("password reset: sends only for existing accounts, is single-use, and revokes all sessions", async () => {
  silenceEmailLog();
  setupTestEnv();
  const uid = (await createUser({ email: "r@example.com", name: "R", password: "old-password-1" })).id;
  const session = createSessionRecord(uid, { twoFactorPassed: false, userAgent: "" });

  const sentBefore = getSentEmailsForTests().length;
  await requestPasswordReset("nobody@example.com");
  assert.equal(getSentEmailsForTests().length, sentBefore, "no email for unknown address");

  await requestPasswordReset("r@example.com");
  await new Promise((r) => setImmediate(r));
  const token = tokenFromLastEmail();

  await assert.rejects(resetPassword(token, "short"), { code: "weak_password" });
  const reset = await resetPassword(token, "new-password-1");
  assert.equal(reset?.id, uid);
  assert.equal(lookupSession(session), null, "all sessions revoked");
  assert.equal(await resetPassword(token, "another-password-1"), null, "token is single-use");
  assert.ok(await authenticate("r@example.com", "new-password-1"));
  mock.restoreAll();
});

test("expired reset token is rejected", async () => {
  silenceEmailLog();
  const { db: conn } = setupTestEnv();
  insertTestUser(conn, "user_e", "e@example.com");
  await requestPasswordReset("e@example.com");
  await new Promise((r) => setImmediate(r));
  const token = tokenFromLastEmail();
  conn.prepare("UPDATE login_tokens SET expires_at = 0").run();
  assert.equal(await resetPassword(token, "new-password-1"), null);
  mock.restoreAll();
});

test("a magic link cannot be used as a reset token", async () => {
  silenceEmailLog();
  const { db: conn } = setupTestEnv();
  insertTestUser(conn, "user_x", "x@example.com");
  await requestMagicLink("x@example.com");
  const token = tokenFromLastEmail();
  assert.equal(await resetPassword(token, "new-password-1"), null);
  mock.restoreAll();
});
