import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, type DB } from "../db";
import { QueryRejectedError } from "../query";
import { insertTestUser, setupTestEnv } from "../testing";
import { JobBlocked } from "./queue";
import { runTracked } from "./tracked";

let conn: DB;

before(() => {
  ({ db: conn } = setupTestEnv());
});

function jobsOf(userId: string) {
  return db()
    .prepare("SELECT type, status, progress, error, file_id, started_at, finished_at FROM jobs WHERE user_id = ? ORDER BY created_at, id")
    .all(userId) as {
    type: string;
    status: string;
    progress: number;
    error: string | null;
    file_id: string | null;
    started_at: number | null;
    finished_at: number | null;
  }[];
}

describe("runTracked", () => {
  it("records a done job with timings and returns the result", async () => {
    const userId = insertTestUser(conn, "usr_track1xyz", "track1@example.com");
    const value = await runTracked("ask", userId, { question: "how many" }, () => 42);
    assert.equal(value, 42);
    const [job] = jobsOf(userId);
    assert.equal(job.type, "ask");
    assert.equal(job.status, "done");
    assert.equal(job.progress, 100);
    assert.ok(job.started_at !== null && job.finished_at !== null && job.finished_at >= job.started_at);
  });

  it("records a rejected query as blocked, audits the reason, and rethrows", async () => {
    const userId = insertTestUser(conn, "usr_track2xyz", "track2@example.com");
    await assert.rejects(
      runTracked("ask", userId, {}, () => {
        throw new QueryRejectedError("Query must be read-only.");
      }),
      (e: unknown) => e instanceof QueryRejectedError,
    );
    const [job] = jobsOf(userId);
    assert.equal(job.status, "blocked");
    assert.equal(job.error, "Query must be read-only.");
    const audit = db().prepare("SELECT detail FROM audit_log WHERE action = 'ask.query_rejected' AND actor_user_id = ?").all(userId) as { detail: string }[];
    assert.deepEqual(audit, [{ detail: "Query must be read-only." }]);
  });

  it("treats JobBlocked as blocked without an audit entry", async () => {
    const userId = insertTestUser(conn, "usr_track3xyz", "track3@example.com");
    await assert.rejects(runTracked("compare", userId, {}, () => Promise.reject(new JobBlocked("Too big"))));
    assert.equal(jobsOf(userId)[0].status, "blocked");
  });

  it("records other errors as failed, audits them, and rethrows", async () => {
    const userId = insertTestUser(conn, "usr_track4xyz", "track4@example.com");
    await assert.rejects(runTracked("compare", userId, {}, () => Promise.reject(new Error("disk full"))), /disk full/);
    const [job] = jobsOf(userId);
    assert.equal(job.status, "failed");
    assert.equal(job.error, "disk full");
    const audit = db().prepare("SELECT action FROM audit_log WHERE actor_user_id = ?").all(userId) as { action: string }[];
    assert.ok(audit.some((a) => a.action === "job.failed"));
  });

  it("links the job to a file only when the user owns it", async () => {
    const owner = insertTestUser(conn, "usr_track5xyz", "track5@example.com");
    const other = insertTestUser(conn, "usr_track6xyz", "track6@example.com");
    db()
      .prepare("INSERT INTO files (id, user_id, original_name, alias, size_bytes, status, created_at, expires_at) VALUES ('file_track0001', ?, 'a.csv', 'a', 1, 'ready', 0, 0)")
      .run(owner);
    await runTracked("ask", owner, { fileId: "file_track0001" }, () => 1);
    await runTracked("ask", other, { fileId: "file_track0001" }, () => 1);
    assert.equal(jobsOf(owner)[0].file_id, "file_track0001");
    assert.equal(jobsOf(other)[0].file_id, null);
  });
});
