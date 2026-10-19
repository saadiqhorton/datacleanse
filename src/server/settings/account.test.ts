import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { setupTestEnv, insertTestUser } from "../testing";
import type { DB } from "../db";
import { createSessionRecord, lookupSession } from "../auth/sessions";
import { deleteAccount, userFilesDir } from "./account";
import { SettingsError } from "./errors";

let conn: DB;
let dataDir: string;

beforeEach(() => {
  ({ db: conn, dataDir } = setupTestEnv());
  insertTestUser(conn, "usr_maria", "maria@northwind.co");
  insertTestUser(conn, "usr_sam", "sam@northwind.co");
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
  it("removes the user's files directory and rows, and leaves other users alone", async () => {
    await addFile("usr_maria", "file_one");
    await addFile("usr_sam", "file_two");
    conn.prepare("INSERT INTO rule_sets (id, user_id, name, created_at, updated_at) VALUES ('rs_1','usr_maria','R',0,0)").run();
    const token = createSessionRecord("usr_maria", { twoFactorPassed: true, userAgent: "" });
    conn.prepare("INSERT INTO login_tokens (id, email, purpose, expires_at) VALUES ('t1','maria@northwind.co','magic_link',0)").run();

    await deleteAccount("usr_maria", "Maria@Northwind.co");

    assert.equal(await exists(path.join(dataDir, "files", "usr_maria")), false);
    assert.equal(await exists(path.join(dataDir, "files", "usr_sam", "file_two", "original.csv")), true);
    const count = (sql: string) => (conn.prepare(sql).get() as { n: number }).n;
    assert.equal(count("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_maria'"), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM files WHERE user_id = 'usr_maria'"), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM rule_sets WHERE user_id = 'usr_maria'"), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM user_settings WHERE user_id = 'usr_maria'"), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM login_tokens WHERE email = 'maria@northwind.co'"), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_sam'"), 1);
    assert.equal(lookupSession(token), null);

    const audit = conn.prepare("SELECT actor_user_id FROM audit_log WHERE action = 'account.deleted'").get() as
      | { actor_user_id: string | null }
      | undefined;
    assert.ok(audit);
    assert.equal(audit.actor_user_id, null);
  });

  it("needs the account's email to confirm", async () => {
    await addFile("usr_maria", "file_one");
    await assert.rejects(deleteAccount("usr_maria", "sam@northwind.co"), {
      message: "The email doesn't match your account.",
    });
    await assert.rejects(deleteAccount("usr_maria", ""), SettingsError);
    assert.equal(await exists(path.join(dataDir, "files", "usr_maria", "file_one")), true);
    assert.equal((conn.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_maria'").get() as { n: number }).n, 1);
  });

  it("blocks deleting the last admin, and nothing is removed", async () => {
    insertTestUser(conn, "usr_owner", "owner@northwind.co", "admin");
    await addFile("usr_owner", "file_owner");
    await assert.rejects(deleteAccount("usr_owner", "owner@northwind.co"), {
      message: "You are the last admin. Make another account an admin before deleting this one.",
    });
    assert.equal(await exists(path.join(dataDir, "files", "usr_owner", "file_owner")), true);
    assert.equal((conn.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_owner'").get() as { n: number }).n, 1);
  });

  it("allows deleting an admin when another enabled admin exists", async () => {
    insertTestUser(conn, "usr_owner", "owner@northwind.co", "admin");
    insertTestUser(conn, "usr_admin2", "second@northwind.co", "admin");
    await deleteAccount("usr_owner", "owner@northwind.co");
    assert.equal((conn.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_owner'").get() as { n: number }).n, 0);
  });

  it("does not count a disabled admin as a remaining admin", async () => {
    insertTestUser(conn, "usr_owner", "owner@northwind.co", "admin");
    insertTestUser(conn, "usr_old", "old@northwind.co", "admin");
    conn.prepare("UPDATE users SET disabled = 1 WHERE id = 'usr_old'").run();
    await assert.rejects(deleteAccount("usr_owner", "owner@northwind.co"), /last admin/);
  });

  it("refuses ids that could escape the files directory", () => {
    assert.throws(() => userFilesDir("../usr_sam"), SettingsError);
    assert.throws(() => userFilesDir("usr_../../x"), SettingsError);
    assert.throws(() => userFilesDir(""), SettingsError);
    assert.equal(userFilesDir("usr_maria"), path.join(path.resolve(dataDir), "files", "usr_maria"));
  });
});
