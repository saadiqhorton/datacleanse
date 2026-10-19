import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, insertTestUser } from "../testing";
import type { DB } from "../db";
import { getUserById } from "../auth/users";
import { createSessionRecord, listSessions, lookupSession } from "../auth/sessions";
import { AdminError } from "./errors";
import { countEnabledAdmins, inviteUser, listUsers, setUserDisabled, setUserRole } from "./users";

const ADMIN = "user_admin";
const SECOND_ADMIN = "user_second_admin";
const MARIA = "user_maria";
const BOB = "user_bob";

let conn: DB;

beforeEach(() => {
  conn = setupTestEnv().db;
  insertTestUser(conn, ADMIN, "admin@northwind.co", "admin");
  insertTestUser(conn, MARIA, "maria@northwind.co");
  insertTestUser(conn, BOB, "bob@northwind.co");
  conn.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(MARIA);
});

function addFile(id: string, userId: string, deleted: boolean) {
  conn
    .prepare(
      `INSERT INTO files (id, user_id, original_name, alias, size_bytes, status, created_at, expires_at, deleted_at)
       VALUES (?, ?, 'people.csv', 'people', 10, ?, 1, 2, ?)`,
    )
    .run(id, userId, deleted ? "deleted" : "ready", deleted ? 3 : null);
}

function auditActions(): string[] {
  return (conn.prepare("SELECT action FROM audit_log ORDER BY id").all() as { action: string }[]).map((r) => r.action);
}

function roleOf(id: string): string {
  return (conn.prepare("SELECT role FROM users WHERE id = ?").get(id) as { role: string }).role;
}

describe("user list", () => {
  it("counts files that are not deleted and reports 2FA", () => {
    addFile("file_1", MARIA, false);
    addFile("file_2", MARIA, false);
    addFile("file_3", MARIA, true);
    const page = listUsers();
    assert.equal(page.total, 3);
    const maria = page.items.find((u) => u.id === MARIA)!;
    assert.equal(maria.fileCount, 2);
    assert.equal(maria.totpEnabled, true);
    assert.equal(page.items.find((u) => u.id === BOB)!.totpEnabled, false);
    assert.equal(countEnabledAdmins(), 1);
  });
});

describe("changing roles", () => {
  it("an admin cannot change their own role", () => {
    assert.throws(() => setUserRole(ADMIN, ADMIN, "user"), (err: unknown) => {
      return err instanceof AdminError && /own role/.test(err.message);
    });
    assert.equal(roleOf(ADMIN), "admin");
  });

  it("an admin can promote a user, and an admin can demote another admin while one other stays", () => {
    setUserRole(ADMIN, BOB, "admin");
    assert.equal(roleOf(BOB), "admin");
    assert.equal(countEnabledAdmins(), 2);

    setUserRole(BOB, ADMIN, "user");
    assert.equal(roleOf(ADMIN), "user");
    assert.ok(auditActions().includes("admin.user_promoted"));
    assert.ok(auditActions().includes("admin.user_demoted"));
  });

  it("a disabled admin cannot demote the only enabled admin", () => {
    // BOB is a regular user here, so BOB has no standing to demote ADMIN.
    assert.throws(() => setUserRole(BOB, ADMIN, "user"), (err: unknown) => {
      return err instanceof AdminError && /active admin/.test(err.message);
    });
    assert.equal(roleOf(ADMIN), "admin");
  });

  it("a non-admin cannot promote anyone", () => {
    assert.throws(() => setUserRole(MARIA, BOB, "admin"), AdminError);
    assert.equal(roleOf(BOB), "user");
  });
});

describe("disabling accounts", () => {
  it("an admin cannot disable their own account", () => {
    assert.throws(() => setUserDisabled(ADMIN, ADMIN, true), (err: unknown) => {
      return err instanceof AdminError && /own account/.test(err.message);
    });
    assert.equal(getUserById(ADMIN)!.disabled, false);
  });

  it("disabling signs out every session of the user, and enabling restores access without restoring sessions", () => {
    const first = createSessionRecord(MARIA, { twoFactorPassed: true, userAgent: "laptop" });
    const second = createSessionRecord(MARIA, { twoFactorPassed: false, userAgent: "phone" });
    createSessionRecord(BOB, { twoFactorPassed: false, userAgent: "other" });
    assert.equal(listSessions(MARIA).length, 2);

    setUserDisabled(ADMIN, MARIA, true);

    assert.equal(getUserById(MARIA)!.disabled, true);
    assert.equal(listSessions(MARIA).length, 0);
    assert.equal(lookupSession(first), null);
    assert.equal(lookupSession(second), null);
    assert.equal(listSessions(BOB).length, 1, "other users keep their sessions");

    setUserDisabled(ADMIN, MARIA, false);
    assert.equal(getUserById(MARIA)!.disabled, false);
    assert.equal(lookupSession(first), null);
    assert.ok(auditActions().includes("admin.user_disabled"));
    assert.ok(auditActions().includes("admin.user_enabled"));
  });

  it("a disabled admin cannot disable anyone", () => {
    insertTestUser(conn, SECOND_ADMIN, "former@northwind.co", "admin");
    conn.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(SECOND_ADMIN);
    assert.throws(() => setUserDisabled(SECOND_ADMIN, MARIA, true), (err: unknown) => {
      return err instanceof AdminError && /active admin/.test(err.message);
    });
    assert.equal(getUserById(MARIA)!.disabled, false);
  });
});

describe("inviting people", () => {
  it("creates a regular account without a password and emails a sign-in link", async () => {
    const result = await inviteUser(ADMIN, "  Dana@Northwind.co ", "Dana Park");
    assert.deepEqual(result, { email: "dana@northwind.co", emailSent: true });

    const row = conn
      .prepare("SELECT role, name, password_hash FROM users WHERE email = 'dana@northwind.co'")
      .get() as { role: string; name: string; password_hash: string | null };
    assert.equal(row.role, "user");
    assert.equal(row.name, "Dana Park");
    assert.equal(row.password_hash, null);

    const tokens = conn.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = 'dana@northwind.co' AND purpose = 'magic_link'").get() as { n: number };
    assert.equal(tokens.n, 1);
    assert.ok(auditActions().includes("admin.user_invited"));
  });

  it("rejects invalid and existing addresses with a message for the form", async () => {
    await assert.rejects(inviteUser(ADMIN, "not-an-email"), (err: unknown) => {
      return err instanceof AdminError && /valid email/.test(err.message);
    });
    await assert.rejects(inviteUser(ADMIN, "MARIA@northwind.co"), (err: unknown) => {
      return err instanceof AdminError && /already exists/.test(err.message);
    });
  });

  it("a disabled admin cannot send invites", async () => {
    conn.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(ADMIN);
    await assert.rejects(inviteUser(ADMIN, "new@northwind.co"), AdminError);
  });
});
