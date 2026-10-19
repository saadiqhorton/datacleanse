import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setInstanceAIConfig } from "../../ai";
import { db, type DB } from "../../db";
import { createUpload } from "../../files/upload";
import { fileRow, jobRow } from "../../files/test-support";
import { crmCsv } from "../../files/test-support";
import { insertTestUser, setupTestEnv } from "../../testing";
import { registerCleanHandler } from "./clean";

let conn: DB;

before(() => {
  ({ db: conn } = setupTestEnv());
  setInstanceAIConfig({ provider: "off" }, null);
  registerCleanHandler();
});

async function waitForJob(jobId: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = jobRow(jobId).status;
    if (status !== "queued" && status !== "running") return status;
    if (Date.now() > deadline) throw new Error(`job ${jobId} still ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("clean job through the queue", () => {
  it("an upload is picked up by the runner and finishes for review", async () => {
    const userId = insertTestUser(conn, "usr_queue0001", "queue@example.com");
    const { fileId, jobId } = await createUpload(userId, {
      name: "crm_export_q3.csv",
      bytes: new TextEncoder().encode(crmCsv()),
    });
    assert.equal(await waitForJob(jobId), "done");
    assert.equal(jobRow(jobId).progress, 100);
    const file = fileRow(fileId);
    assert.equal(file.status, "needs_review");
    assert.equal(file.ai_status, "skipped");
    assert.ok(file.error === null);
    assert.equal(db().prepare("SELECT COUNT(*) AS n FROM changes WHERE file_id = ?").get(fileId) !== undefined, true);
  });
});
