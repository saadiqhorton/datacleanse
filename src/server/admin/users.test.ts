import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv } from "../testing";
import type { DB } from "../db";
import { authReady, getAuth } from "../auth/better-auth";
import { getUserById } from "../auth/users";
import { AdminError } from "./errors";
import { countEnabledAdmins, listUsers, setUserDisabled, setUserRole } from "./users";

const PASSWORD = "correct-horse-battery";

let conn: DB;
let ADMIN: string;
let MARIA: string;
let BOB: string;

async function signUp(name: string, email: string): Promise<string> {
  const res = await getAuth().api.signUpEmail({ body: { name, email, password: PASSWORD } });
  return res.user.id;
}

/** Signs in and returns the cookie-bearing request headers for that browser. */
async function signIn(email: string): Promise<Headers> {
  const res = await getAuth().api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
  return new Headers({ cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] });
}

function sessionCount(userId: string): number {
  return (conn.prepare("SELECT COUNT(*) AS n FROM auth_session WHERE userId = ?").get(userId) as { n: number }).n;
}

beforeEach(async () => {
  process.env.ALLOW_SIGNUPS = "1";
  conn = setupTestEnv().db;
  await authReady();
  ADMIN = await signUp("Owner", "admin@northwind.co");
  MARIA = await signUp("Maria Rossi", "maria@northwind.co");
  BOB = await signUp("Bob Lee", "bob@northwind.co");
  // Sign-up also starts a session; start each test with none.
  conn.prepare("DELETE FROM auth_session").run();
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
  it("counts files that are not deleted, and the first account is the admin", () => {
    addFile("file_1", MARIA, false);
    addFile("file_2", MARIA, false);
    addFile("file_3", MARIA, true);
    const page = listUsers();
    assert.equal(page.total, 3);
    const maria = page.items.find((u) => u.id === MARIA)!;
    assert.equal(maria.fileCount, 2);
    assert.equal(page.items[0].id, ADMIN, "oldest first, so the owner is at the top");
    assert.equal(page.items[0].role, "admin");
    assert.equal("totpEnabled" in maria, false);
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

  it("disabling signs out every session of the user and blocks new sign-ins; enabling restores access", async () => {
    const first = await signIn("maria@northwind.co");
    await signIn("maria@northwind.co");
    const bobSession = await signIn("bob@northwind.co");
    assert.equal(sessionCount(MARIA), 2);

    setUserDisabled(ADMIN, MARIA, true);

    assert.equal(getUserById(MARIA)!.disabled, true);
    assert.equal(sessionCount(MARIA), 0);
    assert.equal(await getAuth().api.getSession({ headers: first }), null);
    assert.equal(sessionCount(BOB), 1, "other users keep their sessions");
    assert.ok(await getAuth().api.getSession({ headers: bobSession }));
    await assert.rejects(getAuth().api.signInEmail({ body: { email: "maria@northwind.co", password: PASSWORD } }));

    setUserDisabled(ADMIN, MARIA, false);
    assert.equal(getUserById(MARIA)!.disabled, false);
    const back = await getAuth().api.signInEmail({ body: { email: "maria@northwind.co", password: PASSWORD } });
    assert.equal(back.user.email, "maria@northwind.co");
    assert.ok(auditActions().includes("admin.user_disabled"));
    assert.ok(auditActions().includes("admin.user_enabled"));
  });

  it("a disabled admin cannot disable anyone", () => {
    conn.prepare("UPDATE users SET role = 'admin', disabled = 1 WHERE id = ?").run(BOB);
    assert.throws(() => setUserDisabled(BOB, MARIA, true), (err: unknown) => {
      return err instanceof AdminError && /active admin/.test(err.message);
    });
    assert.equal(getUserById(MARIA)!.disabled, false);
  });
});
