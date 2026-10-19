/**
 * Pure helpers for the auth server actions: validation rules, user-facing copy, and mapping of Better
 * Auth API errors to form messages. No database or framework imports, so they are unit-tested directly.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const MESSAGES = {
  email: "Enter a valid email address.",
  name: "Enter your name.",
  password: "Enter your password.",
  passwordShort: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
  passwordLong: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
  passwordMismatch: "The passwords don't match.",
  invalidCredentials: "Email or password is incorrect.",
  alreadyRegistered: "An account with this email already exists. Sign in instead.",
  resetSent: "If an account exists for that email, we sent a reset link.",
  resetLinkInvalid: "This reset link is invalid or expired.",
  generic: "Something went wrong. Try again in a moment.",
} as const;

/** Shown on /signin after a successful reset (redirect to /signin?reset=1). */
export const PASSWORD_CHANGED_NOTICE = "Password changed. Sign in with your new password.";

/** Why a new password is not acceptable, or null when it is. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return MESSAGES.passwordShort;
  if (password.length > PASSWORD_MAX_LENGTH) return MESSAGES.passwordLong;
  return null;
}

/** New-password check for the reset form: length rules, then the confirmation must match. */
export function newPasswordProblem(password: string, confirmation: string): string | null {
  return passwordProblem(password) ?? (password === confirmation ? null : MESSAGES.passwordMismatch);
}

export interface AuthApiFailure {
  /** Better Auth error code such as "INVALID_TOKEN", when the error carries one. */
  code: string | null;
  /** The error's message, for errors that come without a code (e.g. a database hook). */
  message: string | null;
  /** HTTP status of the failure, when known. */
  status: number | null;
}

/**
 * Reads a Better Auth APIError (or anything shaped like one). Returns null for other thrown values,
 * such as database or programming errors, which the actions should let surface.
 */
export function apiFailure(err: unknown): AuthApiFailure | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { body?: unknown; message?: unknown; statusCode?: unknown };
  const body = typeof e.body === "object" && e.body !== null ? (e.body as { code?: unknown; message?: unknown }) : {};
  const code = typeof body.code === "string" ? body.code : null;
  const message =
    typeof body.message === "string" ? body.message : typeof e.message === "string" ? e.message : null;
  const status = typeof e.statusCode === "number" ? e.statusCode : null;
  if (code === null && status === null) return null;
  return { code, message, status };
}

/** Sign-in failure copy. Wrong password, unknown email and disabled accounts all read the same. */
export function signInFailure(err: unknown): string {
  const failure = apiFailure(err);
  if (failure?.code === "INVALID_EMAIL") return MESSAGES.email;
  if (failure?.status === 401) return MESSAGES.invalidCredentials;
  return MESSAGES.generic;
}

/** Sign-up failure copy. Database hooks (e.g. sign-ups closed) provide their own message. */
export function signUpFailure(err: unknown): string {
  const failure = apiFailure(err);
  switch (failure?.code) {
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return MESSAGES.alreadyRegistered;
    case "INVALID_EMAIL":
      return MESSAGES.email;
    case "PASSWORD_TOO_SHORT":
      return MESSAGES.passwordShort;
    case "PASSWORD_TOO_LONG":
      return MESSAGES.passwordLong;
  }
  return failure?.message || MESSAGES.generic;
}

/** Reset failure copy. A dead or used link sends the form back to "request a new link". */
export function resetFailure(err: unknown): { error: string; linkInvalid: boolean } {
  const failure = apiFailure(err);
  if (failure?.code === "INVALID_TOKEN" || failure?.code === "USER_NOT_FOUND") {
    return { error: MESSAGES.resetLinkInvalid, linkInvalid: true };
  }
  if (failure?.code === "PASSWORD_TOO_SHORT") return { error: MESSAGES.passwordShort, linkInvalid: false };
  if (failure?.code === "PASSWORD_TOO_LONG") return { error: MESSAGES.passwordLong, linkInvalid: false };
  return { error: MESSAGES.generic, linkInvalid: false };
}
