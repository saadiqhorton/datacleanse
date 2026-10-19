import { test } from "node:test";
import assert from "node:assert/strict";
import * as OTPAuth from "otpauth";
import { setupTestEnv } from "../testing";
import { db } from "../db";
import { createUser } from "./users";
import { beginTotpEnrollment, confirmTotp, disableTotp, verifyTotp } from "./totp";

/** A code that is valid right now for the secret in an otpauth URL. */
function codeFor(otpauthUrl: string, offsetPeriods = 0): string {
  const totp = OTPAuth.URI.parse(otpauthUrl) as OTPAuth.TOTP;
  return totp.generate({ timestamp: Date.now() + offsetPeriods * 30_000 });
}

/** A six-digit code that is not valid in the current window (-1..+1) for this secret. */
function wrongCode(otpauthUrl: string): string {
  const valid = new Set([-1, 0, 1].map((o) => codeFor(otpauthUrl, o)));
  for (let n = 0; n < 1_000_000; n++) {
    const candidate = String(n).padStart(6, "0");
    if (!valid.has(candidate)) return candidate;
  }
  throw new Error("unreachable");
}

test("enrollment stores an encrypted secret and requires a confirming code", async () => {
  setupTestEnv();
  const user = await createUser({ email: "t@example.com", name: "T", password: "password-long-1" });
  const { secret, otpauthUrl } = beginTotpEnrollment(user.id);
  assert.match(otpauthUrl, /^otpauth:\/\/totp\/DataCleanse:t%40example\.com\?/);
  assert.match(otpauthUrl, /algorithm=SHA1/);
  assert.match(otpauthUrl, /digits=6/);
  assert.match(otpauthUrl, /period=30/);

  const stored = db().prepare("SELECT totp_secret, totp_enabled FROM users WHERE id = ?").get(user.id) as {
    totp_secret: string;
    totp_enabled: number;
  };
  assert.equal(stored.totp_enabled, 0);
  assert.ok(!stored.totp_secret.includes(secret), "secret must be stored encrypted");

  assert.equal(verifyTotp(user.id, codeFor(otpauthUrl)), false, "not enabled yet");
  assert.equal(confirmTotp(user.id, wrongCode(otpauthUrl)), false);
  assert.equal(confirmTotp(user.id, codeFor(otpauthUrl)), true);
  assert.equal(confirmTotp(user.id, codeFor(otpauthUrl)), false, "already enabled");
});

test("verifyTotp accepts the current code and the adjacent window, rejects others", async () => {
  setupTestEnv();
  const user = await createUser({ email: "w@example.com", name: "W", password: "password-long-1" });
  const { otpauthUrl } = beginTotpEnrollment(user.id);
  assert.equal(confirmTotp(user.id, codeFor(otpauthUrl)), true);

  assert.equal(verifyTotp(user.id, codeFor(otpauthUrl)), true);
  assert.equal(verifyTotp(user.id, codeFor(otpauthUrl, -1)), true, "previous period within window 1");
  assert.equal(verifyTotp(user.id, codeFor(otpauthUrl, -5)), false, "far outside the window");
  assert.equal(verifyTotp(user.id, wrongCode(otpauthUrl)), false, "wrong code");
  assert.equal(verifyTotp(user.id, "12345"), false, "too short");
  assert.equal(verifyTotp(user.id, "abcdef"), false, "not digits");
  assert.equal(verifyTotp(user.id, ""), false);
});

test("disableTotp needs a valid code and clears the secret", async () => {
  setupTestEnv();
  const user = await createUser({ email: "x@example.com", name: "X", password: "password-long-1" });
  const { otpauthUrl } = beginTotpEnrollment(user.id);
  confirmTotp(user.id, codeFor(otpauthUrl));

  assert.equal(disableTotp(user.id, wrongCode(otpauthUrl)), false);
  assert.equal(disableTotp(user.id, codeFor(otpauthUrl)), true);
  const stored = db().prepare("SELECT totp_secret, totp_enabled FROM users WHERE id = ?").get(user.id) as {
    totp_secret: string | null;
    totp_enabled: number;
  };
  assert.equal(stored.totp_enabled, 0);
  assert.equal(stored.totp_secret, null);
});

test("beginTotpEnrollment refuses while TOTP is enabled", async () => {
  setupTestEnv();
  const user = await createUser({ email: "y@example.com", name: "Y", password: "password-long-1" });
  const { otpauthUrl } = beginTotpEnrollment(user.id);
  confirmTotp(user.id, codeFor(otpauthUrl));
  assert.throws(() => beginTotpEnrollment(user.id), /already enabled/);
});
