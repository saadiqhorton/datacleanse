import { db } from "../db";

export type Role = "user" | "admin";

/**
 * Public view of an app user. Credentials live in Better Auth's tables now, so `hasPassword` is always
 * true (email + password is the only sign-in method) and `totpEnabled` is always false (no second factor).
 */
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
  password_changed_at: number | null;
  role: Role;
  disabled: number;
  created_at: number;
}

const USER_COLUMNS = "id, email, name, password_changed_at, role, disabled, created_at";

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
    hasPassword: true,
    totpEnabled: false,
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
 * DataCleanse is single-user by default: sign-up is open only until the first (owner) account exists.
 * Set ALLOW_SIGNUPS=1 to let anyone who can reach the instance create an account.
 */
export function signupsOpen(): boolean {
  return process.env["ALLOW_SIGNUPS"] === "1" || !hasAnyUser();
}

export function hasAnyUser(): boolean {
  return db().prepare("SELECT 1 FROM users LIMIT 1").get() !== undefined;
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

/**
 * Creates the app's profile row for an account Better Auth just created (same id), plus default
 * settings. The first account becomes the owner (admin). Idempotent.
 */
export function insertAppUser(id: string, rawEmail: string, rawName: string): void {
  const email = normalizeEmail(rawEmail) ?? rawEmail.trim().toLowerCase();
  const conn = db();
  const now = Date.now();
  conn.transaction(() => {
    if (conn.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) return;
    const { n } = conn.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    const role: Role = n === 0 ? "admin" : "user";
    conn
      .prepare("INSERT INTO users (id, email, name, role, password_changed_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, email, rawName.trim(), role, now, now);
    conn.prepare("INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?)").run(id, now);
  })();
}

/**
 * App accounts created before the switch to Better Auth have no auth_user row. Signing up again with the
 * same email claims that account (keeping its id, files and settings), even when sign-ups are closed.
 */
export function unclaimedUserIdForEmail(rawEmail: string): string | null {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;
  const row = db()
    .prepare(
      `SELECT u.id FROM users u
       WHERE u.email = ? AND NOT EXISTS (SELECT 1 FROM auth_user a WHERE a.id = u.id)`,
    )
    .get(email) as { id: string } | undefined;
  return row?.id ?? null;
}

/** True when some app account still has to be claimed by signing up (see unclaimedUserIdForEmail). */
export function hasUnclaimedUsers(): boolean {
  return (
    db().prepare("SELECT 1 FROM users u WHERE NOT EXISTS (SELECT 1 FROM auth_user a WHERE a.id = u.id) LIMIT 1").get() !==
    undefined
  );
}
