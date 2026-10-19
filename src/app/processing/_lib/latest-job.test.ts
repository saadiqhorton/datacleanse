import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { setInstanceAIConfig } from "@/server/ai";
import { db } from "@/server/db";
import { insertTestUser, setupTestEnv } from "@/server/testing";
import { crmCsv, uploadAndClean } from "@/server/files/test-support";
import { latestCleanJob } from "./latest-job";

before(() => {
  setupTestEnv();
  setInstanceAIConfig({ provider: "off" }, null);
});

function newUser(id: string): string {
  insertTestUser(db(), id, `${id}@example.com`);
  return id;
}

describe("latestCleanJob", () => {
  it("returns the newest clean job of a file the user owns", async () => {
    const owner = newUser("usr_latestjob1");
    const { fileId, jobId } = await uploadAndClean(owner, crmCsv(5));
    const latest = latestCleanJob(owner, fileId);
    assert.deepEqual(latest, { id: jobId, chunked: false });
  });

  it("reports a chunked run from the job meta", async () => {
    const owner = newUser("usr_latestjob2");
    const { fileId, jobId } = await uploadAndClean(owner, crmCsv(5));
    db().prepare("UPDATE jobs SET meta_json = json_patch(meta_json, '{\"chunked\":true}') WHERE id = ?").run(jobId);
    assert.equal(latestCleanJob(owner, fileId)?.chunked, true);
  });

  it("prefers the newer job when a file has been cleaned again", async () => {
    const owner = newUser("usr_latestjob3");
    const { fileId } = await uploadAndClean(owner, crmCsv(5));
    db()
      .prepare("INSERT INTO jobs (id, user_id, type, file_id, status, meta_json, created_at) VALUES (?, ?, 'clean', ?, 'queued', '{}', ?)")
      .run("job_later003", owner, fileId, Date.now() + 60_000);
    assert.equal(latestCleanJob(owner, fileId)?.id, "job_later003");
  });

  it("returns null for another user, a bad id, or a file with no jobs", async () => {
    const owner = newUser("usr_latestjob4");
    const other = newUser("usr_latestjob5");
    const { fileId } = await uploadAndClean(owner, crmCsv(5));
    assert.equal(latestCleanJob(other, fileId), null);
    assert.equal(latestCleanJob(owner, "not-an-id"), null);
    assert.equal(latestCleanJob(owner, "file_nojobs"), null);
  });
});
