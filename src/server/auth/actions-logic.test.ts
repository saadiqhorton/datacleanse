import { test } from "node:test";
import assert from "node:assert/strict";
import { APIError } from "better-auth/api";
import {
  MESSAGES,
  apiFailure,
  newPasswordProblem,
  passwordProblem,
  resetFailure,
  signInFailure,
  signUpFailure,
} from "./actions-logic";

test("passwords must be 10 to 128 characters", () => {
  assert.equal(passwordProblem("123456789"), MESSAGES.passwordShort);
  assert.equal(passwordProblem("1234567890"), null);
  assert.equal(passwordProblem("x".repeat(128)), null);
  assert.equal(passwordProblem("x".repeat(129)), MESSAGES.passwordLong);
});

test("the reset form checks length before the confirmation matches", () => {
  assert.equal(newPasswordProblem("correct-horse-1", "correct-horse-1"), null);
  assert.equal(newPasswordProblem("correct-horse-1", "correct-horse-2"), MESSAGES.passwordMismatch);
  assert.equal(newPasswordProblem("short", "short"), MESSAGES.passwordShort);
});

test("apiFailure reads Better Auth errors and ignores other thrown values", () => {
  const err = new APIError("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" });
  assert.deepEqual(apiFailure(err), { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password", status: 401 });
  assert.equal(apiFailure(new Error("database is locked")), null);
  assert.equal(apiFailure("boom"), null);
  assert.equal(apiFailure(null), null);
});

test("wrong password, unknown email and disabled accounts all show the same sign-in message", () => {
  const wrong = new APIError("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" });
  // A disabled account fails to create its session (see the session.create hook in better-auth.ts).
  const disabled = new APIError("UNAUTHORIZED", { code: "FAILED_TO_CREATE_SESSION", message: "Failed to create session" });
  assert.equal(signInFailure(wrong), "Email or password is incorrect.");
  assert.equal(signInFailure(disabled), "Email or password is incorrect.");
  assert.equal(signInFailure(new Error("unexpected")), MESSAGES.generic);
});

test("sign-up maps existing emails and short passwords, and passes hook messages through", () => {
  const taken = new APIError("UNPROCESSABLE_ENTITY", {
    code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
    message: "User already exists. Use another email.",
  });
  assert.equal(signUpFailure(taken), "An account with this email already exists. Sign in instead.");
  const short = new APIError("BAD_REQUEST", { code: "PASSWORD_TOO_SHORT", message: "Password too short" });
  assert.equal(signUpFailure(short), "Password must be at least 10 characters.");
  const closed = new APIError("FORBIDDEN", { message: "Sign-ups are closed on this DataCleanse. Ask the owner to invite you." });
  assert.equal(signUpFailure(closed), "Sign-ups are closed on this DataCleanse. Ask the owner to invite you.");
});

test("reset failures on a dead link ask for a new link", () => {
  const dead = new APIError("BAD_REQUEST", { code: "INVALID_TOKEN", message: "Invalid token" });
  assert.deepEqual(resetFailure(dead), { error: "This reset link is invalid or expired.", linkInvalid: true });
  assert.deepEqual(resetFailure(new Error("x")), { error: MESSAGES.generic, linkInvalid: false });
});
