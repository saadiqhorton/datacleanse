import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv } from "../testing";
import { db } from "../db";
import { findUserByEmail, getUserById, insertAppUser, normalizeEmail, signupsOpen } from "./users";

afterEach(() => {
  delete process.env.ALLOW_SIGNUPS;
});

test("the first app user is the owner (admin), later ones are regular users, and each gets settings", () => {
  setupTestEnv();
  insertAppUser("auth_first", "Owner@Example.com", "Owner");
  insertAppUser("auth_second", "maria@northwind.co", " Maria ");
  assert.equal(getUserById("auth_first")?.role, "admin");
  assert.equal(getUserById("auth_first")?.email, "owner@example.com");
  assert.equal(getUserById("auth_second")?.role, "user");
  assert.equal(getUserById("auth_second")?.name, "Maria");
  const settings = db().prepare("SELECT COUNT(*) AS n FROM user_settings").get() as { n: number };
  assert.equal(settings.n, 2);
});

test("insertAppUser is idempotent for the same id", () => {
  setupTestEnv();
  insertAppUser("auth_once", "once@example.com", "Once");
  insertAppUser("auth_once", "once@example.com", "Once");
  const n = db().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  assert.equal(n.n, 1);
});

test("sign-ups are open only for the first account unless ALLOW_SIGNUPS=1", () => {
  setupTestEnv();
  assert.equal(signupsOpen(), true);
  insertAppUser("auth_owner", "owner@example.com", "Owner");
  assert.equal(signupsOpen(), false);
  process.env.ALLOW_SIGNUPS = "1";
  assert.equal(signupsOpen(), true);
});

test("normalizeEmail trims, lowercases, and rejects non-addresses", () => {
  assert.equal(normalizeEmail("  Maria@Northwind.CO "), "maria@northwind.co");
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail(`${"a".repeat(250)}@x.co`), null);
});

test("user records never expose credentials, and the account is found by any-case email", () => {
  setupTestEnv();
  insertAppUser("auth_p", "p@example.com", "P");
  const byId = getUserById("auth_p") as unknown as Record<string, unknown>;
  assert.equal(byId.password_hash, undefined);
  assert.equal(byId.totp_secret, undefined);
  assert.equal(byId.hasPassword, true);
  assert.equal(byId.totpEnabled, false);
  assert.equal(findUserByEmail("P@example.com")?.id, "auth_p");
  assert.equal(findUserByEmail("nobody@example.com"), null);
});
