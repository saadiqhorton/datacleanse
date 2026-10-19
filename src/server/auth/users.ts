import crypto from "node:crypto";
import { audit } from "../audit";
import { db } from "../db";
import { newId } from "../ids";
import { hashPassword, passwordProblem, verifyPassword } from "./passwords";
import { revokeOtherSessions } from "./sessions";

export type Role = "user" | "admin";

/** Public view of a user. Never includes the password hash or TOTP secret. */
export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
  hasPassword: boolean;
  totpEnabled: boolean;
  disabled: boolean;
  createdAt: number;
  passwordChangedAt: number | null;
}

export type AuthErrorCode = "invalid_email" | "email_taken" | "weak_password" | "wrong_password";

/** Expected validation or credential failures. Messages are safe to show to the user. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  password_changed_at: number | null;
  role: Role;
  totp_enabled: number;
  disabled: number;
  created_at: number;
}

const USER_COLUMNS =
  "id, email, name, password_hash, password_changed_at, role, totp_enabled, disabled, created_at";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trims and lowercases an email, or returns null when it is not plausibly an address. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    hasPassword: row.password_hash !== null,
    totpEnabled: row.totp_enabled === 1,
    disabled: row.disabled === 1,
    createdAt: row.created_at,
    passwordChangedAt: row.password_changed_at,
  };
}

function rowById(id: string): UserRow | undefined {
  return db().prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}

function rowByEmail(email: string): UserRow | undefined {
  return db().prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`).get(email) as UserRow | undefined;
}

/**
 * Creates a user and their default settings row. The first user ever created becomes an admin.
 * Password is optional: magic-link-only accounts have none.
 */
export async function createUser(input: { email: string; name?: string; password?: string }): Promise<UserRecord> {
  const email = normalizeEmail(input.email);
  if (!email) throw new AuthError("invalid_email", "Enter a valid email address.");
  if (input.password !== undefined) {
    const problem = passwordProblem(input.password);
    if (problem) throw new AuthError("weak_password", problem);
  }
  const passwordHash = input.password !== undefined ? await hashPassword(input.password) : null;
  const conn = db();
  const id = newId("usr");
  const now = Date.now();
  const name = (input.name ?? "").trim();

  try {
    conn.transaction(() => {
      const { n } = conn.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
      const role: Role = n === 0 ? "admin" : "user";
      conn
        .prepare(
          `INSERT INTO users (id, email, name, password_hash, password_changed_at, role, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, email, name, passwordHash, passwordHash ? now : null, role, now);
      conn.prepare("INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?)").run(id, now);
    })();
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed: users\.email/.test(err.message)) {
      throw new AuthError("email_taken", "An account with this email already exists.");
    }
    throw err;
  }
  return toRecord(rowById(id)!);
}

/** Public user lookup by id. */
export function getUserById(id: string): UserRecord | null {
  const row = rowById(id);
  return row ? toRecord(row) : null;
}

/** Public user lookup by email (case-insensitive). */
export function findUserByEmail(raw: string): UserRecord | null {
  const email = normalizeEmail(raw);
  if (!email) return null;
  const row = rowByEmail(email);
  return row ? toRecord(row) : null;
}

let dummyHash: Promise<string> | null = null;
/** A hash of a random secret, verified when no real account matches, so timing does not reveal existence. */
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(crypto.randomBytes(32).toString("hex"));
  return dummyHash;
}

/**
 * Checks email and password. Returns the user, or null for unknown email, wrong password,
 * no password set, or a disabled account. Always runs one scrypt verify.
 */
export async function authenticate(rawEmail: string, password: string): Promise<UserRecord | null> {
  const email = normalizeEmail(rawEmail);
  const row = email ? rowByEmail(email) : undefined;
  const ok = await verifyPassword(password, row?.password_hash ?? (await getDummyHash()));
  if (!row || row.password_hash === null || row.disabled === 1 || !ok) return null;
  return toRecord(row);
}

/** Stores a new password hash and stamps password_changed_at. Callers handle authorization and sessions. */
export async function writePassword(userId: string, password: string): Promise<void> {
  const problem = passwordProblem(password);
  if (problem) throw new AuthError("weak_password", problem);
  const hash = await hashPassword(password);
  db()
    .prepare("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?")
    .run(hash, Date.now(), userId);
}

/**
 * Changes a password after verifying the current one. Signs out every other session;
 * `keepSessionId` (the caller's session id) stays signed in.
 */
export async function changePassword(
  userId: string,
  current: string,
  next: string,
  keepSessionId: string,
): Promise<void> {
  const row = rowById(userId);
  if (!row || row.disabled === 1) throw new AuthError("wrong_password", "Current password is incorrect.");
  if (!row.password_hash || !(await verifyPassword(current, row.password_hash))) {
    throw new AuthError("wrong_password", "Current password is incorrect.");
  }
  await writePassword(userId, next);
  revokeOtherSessions(userId, keepSessionId);
  audit("auth.password_changed", "Password changed. Other sessions signed out.", { actor: userId });
}
