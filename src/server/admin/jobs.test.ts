import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, insertTestUser } from "../testing";
import type { DB } from "../db";
import { AdminError } from "./errors";
import { cancelJobAsAdmin, listJobs } from "./jobs";

const NOW = 1_700_000_000_000;
const ADMIN = "user_admin";
const MARIA = "user_maria";

let conn: DB;

beforeEach(() => {
  conn = setupTestEnv().db;
  insertTestUser(conn, ADMIN, "admin@northwind.co", "admin");
  insertTestUser(conn, MARIA, "maria@northwind.co");
});

function job(
  id: string,
  opts: { type?: string; status: string; created: number; started?: number | null; finished?: number | null; meta?: object; error?: string },
) {
  conn
    .prepare(
      `INSERT INTO jobs (id, user_id, type, status, error, meta_json, created_at, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      MARIA,
      opts.type ?? "clean",
      opts.status,
      opts.error ?? null,
      JSON.stringify(opts.meta ?? {}),
      opts.created,
      opts.started ?? null,
      opts.finished ?? null,
    );
}

function seedJobs() {
  job("job_queued", { type: "ask", status: "queued", created: NOW - 1000, meta: { fileCount: 3 } });
  job("job_running", { status: "running", created: NOW - 2000, started: NOW - 1500 });
  job("job_done", { status: "done", created: NOW - 5000, started: NOW - 5000, finished: NOW - 4000 });
  job("job_failed", {
    type: "ask",
    status: "failed",
    created: NOW - 6000,
    started: NOW - 6000,
    finished: NOW - 5900,
    error: "Boom: the file has no header row",
    meta: { fileCount: 1 },
  });
  job("job_cancelled", { status: "cancelled", created: NOW - 500, finished: NOW - 400 });
  job("job_blocked", { type: "ask", status: "blocked", created: NOW - 7000, started: NOW - 7000, finished: NOW - 6990 });
}

describe("listing jobs", () => {
  it("lists newest first with owner, file count and duration", () => {
    seedJobs();
    const page = listJobs({}, NOW);
    assert.equal(page.total, 6);
    assert.deepEqual(
      page.items.map((j) => j.id),
      ["job_cancelled", "job_queued", "job_running", "job_done", "job_failed", "job_blocked"],
    );
    const running = page.items.find((j) => j.id === "job_running")!;
    assert.equal(running.durationMs, 1500);
    assert.equal(running.userEmail, "maria@northwind.co");
    assert.equal(page.items.find((j) => j.id === "job_queued")!.fileCount, 3);
    assert.equal(page.items.find((j) => j.id === "job_cancelled")!.durationMs, null);
  });

  it("filters by status and keeps the failure text", () => {
    seedJobs();
    const failed = listJobs({ status: "failed" }, NOW);
    assert.equal(failed.total, 1);
    assert.equal(failed.items[0].error, "Boom: the file has no header row");
    assert.equal(listJobs({ status: "running" }, NOW).total, 1);
  });

  it("pages, and clamps a page past the end to the last page", () => {
    seedJobs();
    const first = listJobs({ pageSize: 4 }, NOW);
    assert.equal(first.pageCount, 2);
    assert.equal(first.items.length, 4);
    const last = listJobs({ pageSize: 4, page: 99 }, NOW);
    assert.equal(last.page, 2);
    assert.equal(last.items.length, 2);
  });
});

describe("cancelling jobs", () => {
  it("cancels a queued job and writes an audit entry", () => {
    seedJobs();
    cancelJobAsAdmin(ADMIN, "job_queued");
    const row = conn.prepare("SELECT status FROM jobs WHERE id = 'job_queued'").get() as { status: string };
    assert.equal(row.status, "cancelled");
    const audit = conn.prepare("SELECT actor_user_id, detail FROM audit_log WHERE action = 'admin.job_cancelled'").all() as {
      actor_user_id: string;
      detail: string;
    }[];
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_user_id, ADMIN);
    assert.match(audit[0].detail, /job_queued/);
  });

  it("refuses finished jobs, unknown jobs and non-admin actors", () => {
    seedJobs();
    assert.throws(() => cancelJobAsAdmin(ADMIN, "job_done"), (err: unknown) => {
      return err instanceof AdminError && /queued or running/.test(err.message);
    });
    assert.throws(() => cancelJobAsAdmin(ADMIN, "job_missing"), AdminError);
    assert.throws(() => cancelJobAsAdmin(MARIA, "job_running"), (err: unknown) => {
      return err instanceof AdminError && /active admin/.test(err.message);
    });
    const row = conn.prepare("SELECT status FROM jobs WHERE id = 'job_running'").get() as { status: string };
    assert.equal(row.status, "running", "a non-admin must not stop someone's job");
  });
});
