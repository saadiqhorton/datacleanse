import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setInstanceAIConfig } from "../../ai";
import type { DB } from "../../db";
import { createUpload } from "../../files/upload";
import { fileRow, jobContextFor, jobRow, startJob } from "../../files/test-support";
import { insertTestUser, setupTestEnv } from "../../testing";
import { CHUNK_THRESHOLD_ROWS, runCleanJob } from "./clean";

let conn: DB;

before(() => {
  ({ db: conn } = setupTestEnv());
  setInstanceAIConfig({ provider: "off" }, null);
});

/** A file just over the chunk threshold, with one duplicate across a chunk boundary and one padded value near the end. */
function largeCsv(rows: number): string {
  const lines = ["customer_id,email,amount"];
  for (let i = 0; i < rows; i++) {
    let email = `user${i}@x.com`;
    if (i === 10) email = "User10@X.com"; // same as row 150010 once lowercased; keep-last merges row 10
    if (i === 150010) email = "user10@x.com";
    if (i === rows - 2) email = "  tail@x.com ";
    lines.push(`${i + 1},${email},${i}`);
  }
  return lines.join("\n") + "\n";
}

describe("clean job on a large file", () => {
  it("proposes in chunks with correct row offsets, and dedupes across chunks", async () => {
    const userId = insertTestUser(conn, "usr_largefile1", "large@example.com");
    const rows = CHUNK_THRESHOLD_ROWS + 1;
    const { fileId, jobId } = await createUpload(userId, {
      name: "big_export.csv",
      bytes: new TextEncoder().encode(largeCsv(rows)),
      mode: "rules_only",
    });
    startJob(jobId);
    const steps: string[] = [];
    await runCleanJob(jobContextFor(jobId, (step) => steps.push(step)));

    const file = fileRow(fileId);
    assert.equal(file.status, "needs_review", file.error ?? "");
    assert.equal(file.row_count, rows);

    const meta = JSON.parse(jobRow(jobId).meta_json) as { chunked?: boolean };
    assert.equal(meta.chunked, true);
    assert.ok(steps.some((s) => s.startsWith("Applying cleaning rules · ")), "progress moved through the chunks");

    const changes = conn
      .prepare("SELECT row_index, kind, column_name, before, after, merge_into_row FROM changes WHERE file_id = ? ORDER BY id")
      .all(fileId) as {
      row_index: number;
      kind: string;
      column_name: string | null;
      before: string | null;
      after: string | null;
      merge_into_row: number | null;
    }[];

    const merge = changes.find((c) => c.kind === "merge");
    assert.ok(merge, "expected a merge across chunks");
    assert.equal(merge.row_index, 10);
    assert.equal(merge.merge_into_row, 150010);

    const tail = changes.find((c) => c.row_index === rows - 2 && c.column_name === "email");
    assert.ok(tail, "a change in the last chunk is reported at its real row index");
    assert.equal(tail.before, "  tail@x.com ");
    assert.equal(tail.after, "tail@x.com");

    assert.ok(changes.every((c) => c.row_index >= 0 && c.row_index < rows), "no row index out of range");
    // Sorted by row, so a merge at row 10 comes before anything later.
    const rowOrder = changes.map((c) => c.row_index);
    assert.deepEqual(rowOrder, [...rowOrder].sort((a, b) => a - b));
    assert.equal(jobRow(jobId).error, null);
  });
});
