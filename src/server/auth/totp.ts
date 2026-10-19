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

function checkCode(secretBase32: string, label: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return totpFor(secretBase32, label).validate({ token: code, window: WINDOW }) !== null;
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
  db().prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(encrypt(secret), userId);
  const totp = totpFor(secret, user.email);
  return { secret, otpauthUrl: totp.toString() };
}

/** Confirms enrollment with a code from the authenticator app. Returns false for a wrong code. */
export function confirmTotp(userId: string, code: string): boolean {
  const user = getUserById(userId);
  const row = rowFor(userId);
  if (!user || !row?.totp_secret || row.totp_enabled === 1) return false;
  const secret = decrypt(row.totp_secret);
  if (!checkCode(secret, user.email, code)) return false;
  db().prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(userId);
  audit("auth.2fa_enabled", "Two-factor sign-in enabled.", { actor: userId });
  return true;
}

/** Checks a sign-in code. False when TOTP is not enabled or the code is wrong. */
export function verifyTotp(userId: string, code: string): boolean {
  const user = getUserById(userId);
  const row = rowFor(userId);
  if (!user || !row?.totp_secret || row.totp_enabled !== 1) return false;
  return checkCode(decrypt(row.totp_secret), user.email, code);
}

/** Turns TOTP off after a valid code. Returns false when the code is wrong. */
export function disableTotp(userId: string, code: string): boolean {
  if (!verifyTotp(userId, code)) return false;
  db()
    .prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?")
    .run(userId);
  audit("auth.2fa_disabled", "Two-factor sign-in disabled.", { actor: userId });
  return true;
}
