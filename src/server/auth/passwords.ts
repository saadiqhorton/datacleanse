import crypto from "node:crypto";

export const MIN_PASSWORD_LENGTH = 10;
/** Upper bound keeps scrypt cost bounded for hostile inputs. */
export const MAX_PASSWORD_LENGTH = 1024;

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
const MAXMEM = 64 * 1024 * 1024;

function scrypt(pw: string, salt: Buffer, keylen: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pw, salt, keylen, { N: n, r, p, maxmem: MAXMEM }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** Returns a human-readable problem with a candidate password, or null when it is acceptable. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (pw.length > MAX_PASSWORD_LENGTH) return "Password is too long.";
  return null;
}

/** Hashes with scrypt and a random 16-byte salt. Format: scrypt$N$r$p$salt$hash (salt and hash base64url). */
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(pw, salt, KEYLEN, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Constant-time check of a password against a stored hash. Malformed hashes never verify. */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await scrypt(pw, salt, expected.length, n, r, p);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
