import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as OTPAuth from "otpauth";
import { setupTestEnv } from "../testing";
import { db } from "../db";
import { createUser } from "./users";
import { beginTotpEnrollment, confirmTotp, disableTotp, verifyTotp } from "./totp";

/**
 * Freezes Date.now in the middle of a 30-second step, so codes for the steps before and after are
 * unambiguous. Restored automatically when the test ends.
 */
function pinClock(t: TestContext): number {
  const mid = Math.floor(Date.now() / 30_000) * 30_000 + 15_000;
  t.mock.method(Date, "now", () => mid);
  return Math.floor(mid / 30_000);
}

/** A code for the step `offsetPeriods` away from now, for the secret in an otpauth URL. */
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

function storedStep(userId: string): number | null {
  const row = db().prepare("SELECT totp_last_step FROM users WHERE id = ?").get(userId) as {
    totp_last_step: number | null;
  };
  return row.totp_last_step;
}

test("enrollment stores an encrypted secret and requires a confirming code", async (t) => {
  pinClock(t);
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
  assert.equal(confirmTotp(user.id, codeFor(otpauthUrl, 1)), false, "already enabled");
});

test("verifyTotp accepts each step in the window once, rejects codes outside it", async (t) => {
  pinClock(t);
  setupTestEnv();
  const user = await createUser({ email: "w@example.com", name: "W", password: "password-long-1" });
  const { otpauthUrl } = beginTotpEnrollment(user.id);
  // The previous period is inside the window, so it confirms enrollment.
  assert.equal(confirmTotp(user.id, codeFor(otpauthUrl, -1)), true, "previous period within window 1");

  assert.equal(verifyTotp(user.id, codeFor(otpauthUrl)), true, "current period, not yet used");
  assert.equal(verifyTotp(user.id, codeFor(otpauthUrl, 1)), true, "next period within window 1");
  assert.equal(verifyTotp(user.id, codeFor(otpauthUrl, -5)), false, "far outside the window");
  assert.equal(verifyTotp(user.id, wrongCode(otpauthUrl)), false, "wrong code");
  assert.equal(verifyTotp(user.id, "12345"), false, "too short");
  assert.equal(verifyTotp(user.id, "abcdef"), false, "not digits");
  assert.equal(verifyTotp(user.id, ""), false);
});

test("a sign-in code is accepted once: replays are rejected, the next step is accepted", async (t) => {
  const now = pinClock(t);
  setupTestEnv();
  const user = await createUser({ email: "replay@example.com", name: "R", password: "password-long-1" });
  const { otpauthUrl } = beginTotpEnrollment(user.id);
  const enrollCode = codeFor(otpauthUrl);
  assert.equal(confirmTotp(user.id, enrollCode), true);

  const nextStep = codeFor(otpauthUrl, 1);
  assert.equal(verifyTotp(user.id, nextStep), true, "a later step is accepted");
  assert.equal(verifyTotp(user.id, nextStep), false, "replaying the later step is rejected");
  assert.equal(verifyTotp(user.id, enrollCode), false, "an earlier step is rejected once a later one was accepted");
  assert.equal(verifyTotp(user.id, codeFor(otpauthUrl, -1)), false, "older steps stay rejected");
  assert.equal(storedStep(user.id), now + 1, "the accepted step is recorded");
});

test("a code used to confirm enrollment cannot be replayed", async (t) => {
  pinClock(t);
  setupTestEnv();
  const user = await createUser({ email: "cfm@example.com", name: "C", password: "password-long-1" });
  const { otpauthUrl } = beginTotpEnrollment(user.id);
  const code = codeFor(otpauthUrl);
  assert.equal(confirmTotp(user.id, code), true);
  assert.equal(verifyTotp(user.id, code), false, "the confirming code is spent");
});

test("disableTotp needs a valid, unused code and clears the secret", async (t) => {
  pinClock(t);
  setupTestEnv();
  const user = await createUser({ email: "x@example.com", name: "X", password: "password-long-1" });
  const { otpauthUrl } = beginTotpEnrollment(user.id);
  assert.equal(confirmTotp(user.id, codeFor(otpauthUrl)), true);

  assert.equal(disableTotp(user.id, wrongCode(otpauthUrl)), false);
  assert.equal(disableTotp(user.id, codeFor(otpauthUrl)), false, "the confirming code is already used");
  assert.equal(disableTotp(user.id, codeFor(otpauthUrl, 1)), true);
  const stored = db().prepare("SELECT totp_secret, totp_enabled FROM users WHERE id = ?").get(user.id) as {
    totp_secret: string | null;
    totp_enabled: number;
  };
  assert.equal(stored.totp_enabled, 0);
  assert.equal(stored.totp_secret, null);
});

test("a code used to sign in cannot also disable two-factor", async (t) => {
  pinClock(t);
  setupTestEnv();
  const user = await createUser({ email: "dis2@example.com", name: "D", password: "password-long-1" });
  const { otpauthUrl } = beginTotpEnrollment(user.id);
  assert.equal(confirmTotp(user.id, codeFor(otpauthUrl)), true);
  const signInCode = codeFor(otpauthUrl, 1);
  assert.equal(verifyTotp(user.id, signInCode), true, "sign-in with a fresh code");
  assert.equal(disableTotp(user.id, signInCode), false, "the same code cannot disable TOTP");
  assert.equal(disableTotp(user.id, codeFor(otpauthUrl)), false, "a step not newer than the used one is refused");
  assert.equal(verifyTotp(user.id, signInCode), false, "still enabled, and the code stays spent");
});

test("beginTotpEnrollment refuses while TOTP is enabled", async (t) => {
  pinClock(t);
  setupTestEnv();
  const user = await createUser({ email: "y@example.com", name: "Y", password: "password-long-1" });
  const { otpauthUrl } = beginTotpEnrollment(user.id);
  confirmTotp(user.id, codeFor(otpauthUrl));
  assert.throws(() => beginTotpEnrollment(user.id), /already enabled/);
});

test("re-enrolling starts with no used steps", async (t) => {
  pinClock(t);
  setupTestEnv();
  const user = await createUser({ email: "re@example.com", name: "E", password: "password-long-1" });
  const first = beginTotpEnrollment(user.id);
  assert.equal(confirmTotp(user.id, codeFor(first.otpauthUrl)), true);
  assert.equal(disableTotp(user.id, codeFor(first.otpauthUrl, 1)), true);

  const second = beginTotpEnrollment(user.id);
  assert.equal(storedStep(user.id), null);
  assert.equal(confirmTotp(user.id, codeFor(second.otpauthUrl)), true);
});
