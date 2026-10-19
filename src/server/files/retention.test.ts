import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { setInstanceAIConfig } from "../ai";
import { cancelJob } from "../jobs/queue";
import { db, type DB } from "../db";
import { insertTestUser, setupTestEnv } from "../testing";
import { applyFile } from "./review";
import { sweepExpiredFiles } from "./retention";
import { absoluteDataPath, fileDirRel } from "./storage";
import { changeCount, crmCsv, fileRow, uploadAndClean } from "./test-support";
import { createUpload } from "./upload";

let conn: DB;
let counter = 0;
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

before(() => {
  ({ db: conn } = setupTestEnv());
  setInstanceAIConfig({ provider: "off" }, null);
});

function newUser(): string {
  counter++;
  return insertTestUser(conn, `usr_ret${counter}xyz`, `ret${counter}@example.com`);
}

function dirExists(userId: string, fileId: string): boolean {
  return existsSync(absoluteDataPath(dirname(fileDirRel(userId, fileId)) + "/" + fileId));
}

describe("retention sweep", () => {
  it("deletes an expired file's copies, keeps its changes, and audits once", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    await applyFile(userId, fileId);
    const changes = changeCount(fileId);
    assert.ok(changes > 0);
    assert.ok(dirExists(userId, fileId));

    const result = await sweepExpiredFiles(Date.now() + TWO_DAYS);
    assert.ok(result.deletedFiles >= 1);
    assert.equal(dirExists(userId, fileId), false, "the file directory is removed");

    const file = fileRow(fileId);
    assert.equal(file.status, "deleted");
    assert.equal(file.storage_path, null);
    assert.equal(file.cleaned_path, null);
    assert.ok(file.deleted_at !== null);
    assert.equal(changeCount(fileId), changes, "changes are kept");

    const audit = db()
      .prepare("SELECT actor_user_id, detail FROM audit_log WHERE action = 'retention.deleted'")
      .all() as { actor_user_id: string | null; detail: string }[];
    assert.ok(audit.some((a) => a.actor_user_id === null && a.detail.startsWith("Retention job deleted ")));

    // A second sweep finds nothing and writes no new audit line.
    const before = audit.length;
    const again = await sweepExpiredFiles(Date.now() + TWO_DAYS);
    assert.equal(again.deletedFiles, 0, "nothing left to delete");
    const after = db().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'retention.deleted'").get() as { n: number };
    assert.equal(after.n, before);
  });

  it("leaves files alone until they expire", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    const result = await sweepExpiredFiles(Date.now());
    assert.equal(result.deletedFiles, 0);
    assert.equal(fileRow(fileId).status, "needs_review");
    assert.ok(dirExists(userId, fileId));
  });

  it("does not delete a file whose job is still queued or running", async () => {
    const userId = newUser();
    const { fileId, jobId } = await createUpload(userId, { name: "busy.csv", bytes: new TextEncoder().encode(crmCsv(5)) });
    await sweepExpiredFiles(Date.now() + TWO_DAYS);
    assert.equal(fileRow(fileId).status, "processing");
    assert.ok(dirExists(userId, fileId));
    cancelJob(jobId);
  });

  it("removes expired sessions and used or expired login tokens", async () => {
    const userId = newUser();
    const now = Date.now();
    db()
      .prepare(
        `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES ('sess_old', ?, ?, ?, ?),
         ('sess_new', ?, ?, ?, ?)`,
      )
      .run(userId, now, now, now - 1, userId, now, now, now + 10 * 86400000);
    db()
      .prepare(
        `INSERT INTO login_tokens (id, email, purpose, expires_at, used_at) VALUES
         ('tok_expired', 'a@b.co', 'magic_link', ?, NULL), ('tok_used', 'a@b.co', 'magic_link', ?, ?),
         ('tok_live', 'a@b.co', 'magic_link', ?, NULL)`,
      )
      .run(now - 1, now + 60000, now, now + 60000);
    const result = await sweepExpiredFiles(now);
    assert.equal(result.deletedSessions, 1);
    assert.equal(result.deletedTokens, 2);
    const ids = (db().prepare("SELECT id FROM login_tokens").all() as { id: string }[]).map((r) => r.id);
    assert.deepEqual(ids, ["tok_live"]);
  });

  it("fails a file left in processing after its job was cancelled", async () => {
    const userId = newUser();
    const { fileId, jobId } = await createUpload(userId, { name: "stuck.csv", bytes: new TextEncoder().encode(crmCsv(5)) });
    cancelJob(jobId);
    await sweepExpiredFiles(Date.now());
    const file = fileRow(fileId);
    assert.equal(file.status, "failed");
    assert.equal(file.error, "Cancelled");
  });
});
