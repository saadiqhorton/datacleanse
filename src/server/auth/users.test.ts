import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv } from "../testing";
import { db } from "../db";
import { audit } from "../audit";
import { authenticate, changePassword, createUser, AuthError, getUserById, findUserByEmail } from "./users";
import { createSessionRecord, listSessions, lookupSession, sessionIdFromToken } from "./sessions";

test("first user is admin, second is a regular user, and each gets settings", async () => {
  setupTestEnv();
  const first = await createUser({ email: "Owner@Example.com", name: "Owner", password: "owner-password-1" });
  const second = await createUser({ email: "maria@northwind.co", name: "Maria", password: "maria-password-1" });
  assert.equal(first.role, "admin");
  assert.equal(first.email, "owner@example.com");
  assert.equal(second.role, "user");
  const settings = db().prepare("SELECT COUNT(*) AS n FROM user_settings").get() as { n: number };
  assert.equal(settings.n, 2);
});

test("duplicate email (any case) is rejected with email_taken", async () => {
  setupTestEnv();
  await createUser({ email: "a@example.com", name: "A", password: "password-long-1" });
  await assert.rejects(createUser({ email: "A@EXAMPLE.com", name: "A2" }), (err: unknown) => {
    return err instanceof AuthError && err.code === "email_taken";
  });
});

test("createUser validates email and password length", async () => {
  setupTestEnv();
  await assert.rejects(createUser({ email: "not-an-email", name: "x" }), { code: "invalid_email" });
  await assert.rejects(createUser({ email: "ok@example.com", name: "x", password: "short" }), { code: "weak_password" });
});

test("authenticate accepts the right password and rejects the rest", async () => {
  setupTestEnv();
  const user = await createUser({ email: "u@example.com", name: "U", password: "password-long-1" });
  assert.equal((await authenticate("u@example.com", "password-long-1"))?.id, user.id);
  assert.equal(await authenticate("u@example.com", "wrong-password-1"), null);
  assert.equal(await authenticate("nobody@example.com", "password-long-1"), null);
  assert.equal(await authenticate("garbage", "password-long-1"), null);
});

test("disabled users cannot authenticate", async () => {
  setupTestEnv();
  const user = await createUser({ email: "d@example.com", name: "D", password: "password-long-1" });
  db().prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(user.id);
  assert.equal(await authenticate("d@example.com", "password-long-1"), null);
});

test("magic-link-only accounts (no password) cannot sign in with a password", async () => {
  setupTestEnv();
  await createUser({ email: "m@example.com", name: "M" });
  assert.equal(await authenticate("m@example.com", "anything-long-1"), null);
});

test("changePassword checks the current password and signs out other sessions", async () => {
  setupTestEnv();
  const user = await createUser({ email: "c@example.com", name: "C", password: "old-password-1" });
  const keep = createSessionRecord(user.id, { twoFactorPassed: false, userAgent: "a" });
  const other = createSessionRecord(user.id, { twoFactorPassed: false, userAgent: "b" });
  await assert.rejects(changePassword(user.id, "bad-password-1", "new-password-1", sessionIdFromToken(keep)), {
    code: "wrong_password",
  });
  await changePassword(user.id, "old-password-1", "new-password-1", sessionIdFromToken(keep));
  assert.equal(await authenticate("c@example.com", "old-password-1"), null);
  assert.ok((await authenticate("c@example.com", "new-password-1")) !== null);
  assert.ok(lookupSession(keep), "current session stays signed in");
  assert.equal(lookupSession(other), null, "other session is signed out");
  assert.equal(listSessions(user.id).length, 1);
});

test("getUserById and findUserByEmail never expose the password hash or TOTP secret", async () => {
  setupTestEnv();
  const user = await createUser({ email: "p@example.com", name: "P", password: "password-long-1" });
  const byId = getUserById(user.id) as unknown as Record<string, unknown>;
  assert.equal(byId.password_hash, undefined);
  assert.equal(byId.passwordHash, undefined);
  assert.equal(byId.totp_secret, undefined);
  assert.equal(findUserByEmail("P@example.com")?.id, user.id);
});

test("audit writes an entry", () => {
  setupTestEnv();
  audit("auth.test_event", "hello");
  const row = db().prepare("SELECT action, detail FROM audit_log").get() as { action: string; detail: string };
  assert.deepEqual(row, { action: "auth.test_event", detail: "hello" });
});
