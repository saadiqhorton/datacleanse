import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, insertTestUser } from "../testing";
import type { DB } from "../db";
import { audit } from "../audit";
import { getOverviewStats } from "./overview";

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

let conn: DB;

beforeEach(() => {
  conn = setupTestEnv().db;
  insertTestUser(conn, "user_maria", "maria@northwind.co");
});

function job(id: string, status: string, createdAt: number) {
  conn
    .prepare("INSERT INTO jobs (id, user_id, type, status, created_at) VALUES (?, 'user_maria', 'clean', ?, ?)")
    .run(id, status, createdAt);
}

function aiCall(at: number) {
  conn
    .prepare("INSERT INTO ai_calls (at, user_id, provider, model, purpose, ok, ms) VALUES (?, 'user_maria', 'local', 'llama3.1', 'suggest_fixes', 1, 120)")
    .run(at);
}

describe("overview stats", () => {
  it("counts the last 24 hours for jobs and AI calls, and all queued or running jobs", () => {
    job("job_done_1h", "done", NOW - 1 * HOUR);
    job("job_failed_2h", "failed", NOW - 2 * HOUR);
    job("job_failed_30h", "failed", NOW - 30 * HOUR); // outside the day
    job("job_queued_old", "queued", NOW - 120 * HOUR); // old but still in the queue
    job("job_running_now", "running", NOW - 10 * 60 * 1000);
    job("job_done_25h", "done", NOW - 25 * HOUR); // outside the day

    aiCall(NOW - 1 * HOUR);
    aiCall(NOW - 23 * HOUR);
    aiCall(NOW - 25 * HOUR); // outside the day
    aiCall(NOW);

    assert.deepEqual(getOverviewStats(NOW), {
      jobsToday: 3, // done_1h, failed_2h, running_now
      failedToday: 1, // failed_2h
      queueDepth: 2, // queued_old, running_now
      aiCallsToday: 3,
    });
  });

  it("is zero on an empty instance", () => {
    assert.deepEqual(getOverviewStats(NOW), { jobsToday: 0, failedToday: 0, queueDepth: 0, aiCallsToday: 0 });
    audit("auth.signed_in", "unrelated", { actor: "user_maria" });
    assert.equal(getOverviewStats(NOW).jobsToday, 0);
  });
});
