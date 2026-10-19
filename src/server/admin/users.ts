import { audit } from "../audit";
import { revokeAllAuthSessions } from "../auth/session";
import type { Role } from "../auth/users";
import { db } from "../db";
import { AdminError } from "./errors";
import { assertAdminActor } from "./guard";
import { paged, resolvePage, type Paged } from "./paging";

export const USER_PAGE_SIZE = 50;

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  createdAt: number;
  /** Files not yet deleted. */
  fileCount: number;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: number;
  created_at: number;
  file_count: number;
}

interface TargetRow {
  id: string;
  email: string;
  role: Role;
  disabled: number;
}

/** Users oldest first, so the founding admin is at the top. */
export function listUsers(opts: { page?: number; pageSize?: number } = {}): Paged<AdminUser> {
  const conn = db();
  const pageSize = opts.pageSize ?? USER_PAGE_SIZE;
  const { n: total } = conn.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  const { page, offset } = resolvePage(opts.page ?? 1, total, pageSize);
  const rows = conn
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.disabled, u.created_at,
              (SELECT COUNT(*) FROM files f
                 WHERE f.user_id = u.id AND f.deleted_at IS NULL AND f.status != 'deleted') AS file_count
       FROM users u
       ORDER BY u.created_at ASC, u.id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(pageSize, offset) as UserRow[];

  return paged(
    rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      disabled: row.disabled === 1,
      createdAt: row.created_at,
      fileCount: row.file_count,
    })),
    total,
    page,
    pageSize,
  );
}

/** Admins who are not disabled. Used to decide whether an admin is the last one. */
export function countEnabledAdmins(): number {
  const row = db().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get() as {
    n: number;
  };
  return row.n;
}

function targetOf(userId: string): TargetRow {
  const row = db()
    .prepare("SELECT id, email, role, disabled FROM users WHERE id = ?")
    .get(userId) as TargetRow | undefined;
  if (!row) throw new AdminError("That account no longer exists.");
  return row;
}

/** Enabled admins other than `userId`. Zero means `userId` is the last one standing. */
function enabledAdminsOtherThan(userId: string): number {
  const row = db()
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?")
    .get(userId) as { n: number };
  return row.n;
}

/** Promotes to admin or demotes to user. Admins cannot change their own role or remove the last admin. */
export function setUserRole(actorId: string, userId: string, role: Role): void {
  assertAdminActor(actorId);
  const target = targetOf(userId);
  if (target.role === role) return;
  if (userId === actorId) throw new AdminError("You can't change your own role.");
  if (role === "user" && target.role === "admin" && enabledAdminsOtherThan(userId) === 0) {
    throw new AdminError("You can't demote the last admin.");
  }

  db().prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
  audit(
    role === "admin" ? "admin.user_promoted" : "admin.user_demoted",
    role === "admin" ? `Promoted ${target.email} to admin.` : `Demoted ${target.email} to user.`,
    { actor: actorId },
  );
}

/**
 * Disables or enables an account. Disabling signs out every session of that user. Admins cannot
 * disable themselves or the last enabled admin.
 */
export function setUserDisabled(actorId: string, userId: string, disabled: boolean): void {
  assertAdminActor(actorId);
  const target = targetOf(userId);
  if (userId === actorId) throw new AdminError("You can't disable your own account.");
  if ((target.disabled === 1) === disabled) return;
  if (disabled && target.role === "admin" && enabledAdminsOtherThan(userId) === 0) {
    throw new AdminError("You can't disable the last admin.");
  }

  db().transaction(() => {
    db().prepare("UPDATE users SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, userId);
    if (disabled) revokeAllAuthSessions(userId);
  })();
  audit(
    disabled ? "admin.user_disabled" : "admin.user_enabled",
    disabled ? `Disabled ${target.email}. Their sessions were signed out.` : `Enabled ${target.email}.`,
    { actor: actorId },
  );
}
