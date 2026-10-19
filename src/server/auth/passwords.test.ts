import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, passwordProblem, verifyPassword, MIN_PASSWORD_LENGTH } from "./passwords";

test("hash round-trips and rejects a wrong password", async () => {
  const hash = await hashPassword("correct horse battery");
  assert.match(hash, /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await verifyPassword("correct horse battery", hash), true);
  assert.equal(await verifyPassword("correct horse batterY", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

test("each hash uses a fresh random salt", async () => {
  const a = await hashPassword("same-password-1");
  const b = await hashPassword("same-password-1");
  assert.notEqual(a, b);
  const saltA = a.split("$")[4];
  const saltB = b.split("$")[4];
  assert.equal(Buffer.from(saltA, "base64url").length, 16);
  assert.notEqual(saltA, saltB);
});

test("malformed or foreign hashes never verify", async () => {
  assert.equal(await verifyPassword("anything-long", ""), false);
  assert.equal(await verifyPassword("anything-long", "bcrypt$10$abc"), false);
  assert.equal(await verifyPassword("anything-long", "scrypt$0$8$1$AAAA$AAAA"), false);
  assert.equal(await verifyPassword("anything-long", "scrypt$16384$8$1$$"), false);
});

test("passwordProblem enforces the minimum length", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 10);
  assert.notEqual(passwordProblem("123456789"), null);
  assert.equal(passwordProblem("1234567890"), null);
});
