import * as OTPAuth from "otpauth";
import { audit } from "../audit";
import { db } from "../db";
import { decrypt, encrypt } from "../crypto";
import { getUserById } from "./users";

const ISSUER = "DataCleanse";
const ALGORITHM = "SHA1";
const DIGITS = 6;
const PERIOD = 30;
const WINDOW = 1;

interface TotpRow {
  totp_secret: string | null;
  totp_enabled: number;
}

function totpFor(secretBase32: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

function rowFor(userId: string): TotpRow | undefined {
  return db()
    .prepare("SELECT totp_secret, totp_enabled FROM users WHERE id = ?")
    .get(userId) as TotpRow | undefined;
}

/**
 * The 30-second time step of the newest code in the window that equals `code`, or null.
 * Checks the same window as before (-WINDOW..+WINDOW periods around `now`).
 */
function matchStep(secretBase32: string, label: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const totp = totpFor(secretBase32, label);
  const current = Math.floor(now / 1000 / PERIOD);
  let best: number | null = null;
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    if (totp.generate({ timestamp: now + delta * PERIOD * 1000 }) !== code) continue;
    const step = current + delta;
    if (best === null || step > best) best = step;
  }
  return best;
}

/**
 * Starts (or restarts) TOTP enrollment. The secret is stored encrypted but stays disabled until
 * confirmTotp succeeds. Throws if TOTP is already enabled: disable it first.
 */
export function beginTotpEnrollment(userId: string): { secret: string; otpauthUrl: string } {
  const user = getUserById(userId);
  const row = rowFor(userId);
  if (!user || !row) throw new Error("User not found.");
  if (row.totp_enabled === 1) throw new Error("Two-factor sign-in is already enabled.");

  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  db()
    .prepare("UPDATE users SET totp_secret = ?, totp_last_step = NULL WHERE id = ?")
    .run(encrypt(secret), userId);
  const totp = totpFor(secret, user.email);
  return { secret, otpauthUrl: totp.toString() };
}

/**
 * Confirms enrollment with a code from the authenticator app. Returns false for a wrong code, or
 * a code already used. A code is accepted at most once, so it cannot be replayed to confirm.
 */
export function confirmTotp(userId: string, code: string): boolean {
  const user = getUserById(userId);
  const row = rowFor(userId);
  if (!user || !row?.totp_secret || row.totp_enabled === 1) return false;
  const step = matchStep(decrypt(row.totp_secret), user.email, code);
  if (step === null) return false;
  const result = db()
    .prepare(
      `UPDATE users SET totp_enabled = 1, totp_last_step = ?
       WHERE id = ? AND totp_enabled = 0 AND (totp_last_step IS NULL OR totp_last_step < ?)`,
    )
    .run(step, userId, step) as { changes: number };
  if (result.changes !== 1) return false;
  audit("auth.2fa_enabled", "Two-factor sign-in enabled.", { actor: userId });
  return true;
}

/**
 * Checks a sign-in code and uses it up: a code is accepted once, and any code from the same or an
 * earlier 30-second step is rejected afterwards. False when TOTP is not enabled, the code is wrong,
 * or the code was already used.
 */
export function verifyTotp(userId: string, code: string): boolean {
  const user = getUserById(userId);
  const row = rowFor(userId);
  if (!user || !row?.totp_secret || row.totp_enabled !== 1) return false;
  const step = matchStep(decrypt(row.totp_secret), user.email, code);
  if (step === null) return false;
  const result = db()
    .prepare(
      `UPDATE users SET totp_last_step = ?
       WHERE id = ? AND totp_enabled = 1 AND (totp_last_step IS NULL OR totp_last_step < ?)`,
    )
    .run(step, userId, step) as { changes: number };
  return result.changes === 1;
}

/** Turns TOTP off after a valid, unused code. Returns false when the code is wrong or already used. */
export function disableTotp(userId: string, code: string): boolean {
  if (!verifyTotp(userId, code)) return false;
  db()
    .prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = ?")
    .run(userId);
  audit("auth.2fa_disabled", "Two-factor sign-in disabled.", { actor: userId });
  return true;
}
