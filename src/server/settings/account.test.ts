import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { setupTestEnv } from "../testing";
import type { DB } from "../db";
import { authReady, getAuth } from "../auth/better-auth";
import { deleteAccount, userFilesDir } from "./account";
import { SettingsError } from "./errors";

const PASSWORD = "correct-horse-battery";
let conn: DB;
let dataDir: string;
let maria: string;
let sam: string;

async function signUp(name: string, email: string): Promise<string> {
  const res = await getAuth().api.signUpEmail({ body: { name, email, password: PASSWORD } });
  return res.user.id;
}

async function signedInHeaders(email: string): Promise<Headers> {
  const res = await getAuth().api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
  return new Headers({ cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] });
}

function count(sql: string, ...params: string[]): number {
  return (conn.prepare(sql).get(...params) as { n: number }).n;
}

beforeEach(async () => {
  process.env.ALLOW_SIGNUPS = "1";
  ({ db: conn, dataDir } = setupTestEnv());
  await authReady();
  maria = await signUp("Maria Rossi", "maria@northwind.co");
  sam = await signUp("Sam Park", "sam@northwind.co");
  // Sign-up also starts a session; start each test with none.
  conn.prepare("DELETE FROM auth_session").run();
});

/** A file row plus its bytes on disk, the way the upload code stores them. */
async function addFile(userId: string, fileId: string) {
  const dir = path.join(dataDir, "files", userId, fileId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "original.csv"), "name\nMaria\n");
  const now = Date.now();
  conn
    .prepare(
      `INSERT INTO files (id, user_id, original_name, alias, size_bytes, status, storage_path, created_at, expires_at)
       VALUES (?, ?, 'people.csv', 'people', 12, 'uploaded', ?, ?, ?)`,
    )
    .run(fileId, userId, `files/${userId}/${fileId}/original.csv`, now, now + 3600_000);
}

function exists(p: string) {
  return fs.access(p).then(() => true, () => false);
}

describe("deleteAccount", () => {
  it("removes the user's files, sessions and rows in both tables, and leaves other users alone", async () => {
    await addFile(maria, "file_one");
    await addFile(sam, "file_two");
    conn.prepare("INSERT INTO rule_sets (id, user_id, name, created_at, updated_at) VALUES ('rs_1', ?, 'R', 0, 0)").run(maria);
    // Sam is a second admin, so Maria is not the last one.
    conn.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(sam);
    const mariaHeaders = await signedInHeaders("maria@northwind.co");
    const samHeaders = await signedInHeaders("sam@northwind.co");
    conn
      .prepare("INSERT INTO auth_verification (id, identifier, value, expiresAt, createdAt, updatedAt) VALUES ('v1', 'reset-password:abc', ?, '2030-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')")
      .run(maria);

    await deleteAccount(maria, "Maria@Northwind.co");

    assert.equal(await exists(path.join(dataDir, "files", maria)), false);
    assert.equal(await exists(path.join(dataDir, "files", sam, "file_two", "original.csv")), true);
    assert.equal(count("SELECT COUNT(*) AS n FROM users WHERE id = ?", maria), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM auth_user WHERE id = ?", maria), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM auth_account WHERE userId = ?", maria), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM auth_session WHERE userId = ?", maria), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM auth_verification WHERE value = ?", maria), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM files WHERE user_id = ?", maria), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM rule_sets WHERE user_id = ?", maria), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM user_settings WHERE user_id = ?", maria), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM users WHERE id = ?", sam), 1);
    assert.equal(count("SELECT COUNT(*) AS n FROM auth_user WHERE id = ?", sam), 1);
    assert.equal(await getAuth().api.getSession({ headers: mariaHeaders }), null);
    assert.ok(await getAuth().api.getSession({ headers: samHeaders }));

    const audit = conn.prepare("SELECT actor_user_id FROM audit_log WHERE action = 'account.deleted'").get() as
      | { actor_user_id: string | null }
      | undefined;
    assert.ok(audit);
    assert.equal(audit.actor_user_id, null);
  });

  it("needs the account's email to confirm", async () => {
    await addFile(maria, "file_one");
    await assert.rejects(deleteAccount(maria, "sam@northwind.co"), {
      message: "The email doesn't match your account.",
    });
    await assert.rejects(deleteAccount(maria, ""), SettingsError);
    assert.equal(await exists(path.join(dataDir, "files", maria, "file_one")), true);
    assert.equal(count("SELECT COUNT(*) AS n FROM auth_user WHERE id = ?", maria), 1);
  });

  it("blocks deleting the last admin, and nothing is removed", async () => {
    // The first account is the owner (admin).
    await addFile(maria, "file_owner");
    await assert.rejects(deleteAccount(maria, "maria@northwind.co"), {
      message: "You are the last admin. Make another account an admin before deleting this one.",
    });
    assert.equal(await exists(path.join(dataDir, "files", maria, "file_owner")), true);
    assert.equal(count("SELECT COUNT(*) AS n FROM auth_user WHERE id = ?", maria), 1);
  });

  it("allows deleting an admin when another enabled admin exists", async () => {
    conn.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(sam);
    await deleteAccount(maria, "maria@northwind.co");
    assert.equal(count("SELECT COUNT(*) AS n FROM users WHERE id = ?", maria), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM auth_user WHERE id = ?", maria), 0);
  });

  it("does not count a disabled admin as a remaining admin", async () => {
    conn.prepare("UPDATE users SET role = 'admin', disabled = 1 WHERE id = ?").run(sam);
    await assert.rejects(deleteAccount(maria, "maria@northwind.co"), /last admin/);
  });

  it("refuses ids that could escape the files directory", () => {
    assert.throws(() => userFilesDir("../usr_sam"), SettingsError);
    assert.throws(() => userFilesDir("usr_../../x"), SettingsError);
    assert.throws(() => userFilesDir("a/b"), SettingsError);
    assert.throws(() => userFilesDir(""), SettingsError);
    assert.equal(userFilesDir("usr_maria"), path.join(path.resolve(dataDir), "files", "usr_maria"));
    assert.equal(userFilesDir(maria), path.join(path.resolve(dataDir), "files", maria));
  });
});
