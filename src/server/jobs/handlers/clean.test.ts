import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setInstanceAIConfig } from "../../ai";
import { cancelJobForUser } from "../../files/jobs";
import { retryAi, createUpload } from "../../files/upload";
import { stepViews } from "../../files/steps";
import { db, type DB } from "../../db";
import { insertTestUser, setupTestEnv } from "../../testing";
import {
  CRM_HEADER,
  OUTSIDE_SAMPLE_MARKER,
  TYPO_COMPANY,
  auditRows,
  changeCount,
  closedPortBaseURL,
  crmCsv,
  fileRow,
  jobContextFor,
  jobRow,
  startFakeAI,
  startJob,
} from "../../files/test-support";
import { runCleanJob, acceptSuggestions, insertChanges } from "./clean";
import type { ProposedChange, Table } from "../../types";

let conn: DB;
let userCounter = 0;

before(() => {
  ({ db: conn } = setupTestEnv());
});

function newUser(): string {
  userCounter++;
  return insertTestUser(conn, `usr_clean${userCounter}x`, `clean${userCounter}@example.com`);
}

/** Uploads a CSV without starting it. Returns the ids. */
async function upload(userId: string, text: string | Uint8Array, extra: Record<string, unknown> = {}) {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  return createUpload(userId, { name: "crm_export_q3.csv", bytes, ...extra });
}

/** Runs the clean handler the way the queue would: start, run, then mark done if still running. */
async function runClean(jobId: string, onProgress?: (step: string, pct: number) => void) {
  startJob(jobId);
  await runCleanJob(jobContextFor(jobId, onProgress));
  db().prepare("UPDATE jobs SET status = 'done', progress = 100, finished_at = ? WHERE id = ? AND status = 'running'").run(Date.now(), jobId);
}

function changesOf(fileId: string, where = "1 = 1"): ProposedChange[] {
  return (db()
    .prepare(
      `SELECT row_index AS rowIndex, column_name AS "column", kind, before, after, merge_into_row AS mergeIntoRow,
              source, rule_id AS ruleId, reason, decision
       FROM changes WHERE file_id = ? AND ${where} ORDER BY id`,
    )
    .all(fileId) as unknown as ProposedChange[]).map((c) => ({ ...c, mergeIntoRow: c.mergeIntoRow ?? undefined }));
}

function setProvider(config: Parameters<typeof setInstanceAIConfig>[0]) {
  setInstanceAIConfig(config, null);
}

describe("clean job: AI off", () => {
  it("runs every step and leaves the file ready for review with rule changes", async () => {
    const userId = newUser();
    setProvider({ provider: "off" });
    const { fileId, jobId } = await upload(userId, crmCsv());
    await runClean(jobId);

    const file = fileRow(fileId);
    assert.equal(file.status, "needs_review");
    assert.equal(file.error, null);
    assert.equal(file.ai_status, "skipped");
    assert.equal(file.row_count, 41);
    assert.equal(file.column_count, 9);
    assert.equal(file.delimiter, ",");
    assert.equal(file.encoding, "utf-8");
    const profile = JSON.parse(file.profile_json as string) as { columns: unknown[]; sample: unknown[] };
    assert.equal(profile.columns.length, 9);
    assert.equal(profile.sample.length, 20);

    assert.equal(jobRow(jobId).status, "done");
    const steps = stepViews("done", JSON.parse(jobRow(jobId).meta_json) as Record<string, unknown>);
    assert.deepEqual(
      steps.map((s) => s.state),
      ["done", "done", "done", "done", "done", "done"],
    );
    assert.equal(steps[2].label, "Profiled 9 columns");
    assert.match(steps[3].label, /^Applied cleaning rules · [\d,]+ changes$/);
    assert.equal(steps[4].label, "AI skipped · rules only");
  });

  it("proposes the expected rule changes on the CRM fixture", async () => {
    const userId = newUser();
    setProvider({ provider: "off" });
    const { fileId, jobId } = await upload(userId, crmCsv());
    await runClean(jobId);

    const all = changesOf(fileId);
    const cell = (row: number, column: string) => all.find((c) => c.rowIndex === row && c.column === column && c.kind === "value");

    // Data row 1 first name is padded and lower case: trimmed and title cased.
    assert.equal(cell(0, "first_name")?.after, "Maria");
    // Data row 4 has an upper-case domain: the email is lowercased.
    assert.equal(cell(3, "email")?.after, "li.wei4@example.org");
    // Mixed date layouts are normalized to ISO.
    const dates = all.filter((c) => c.column === "signup_date" && c.kind === "value");
    assert.ok(dates.length > 0);
    for (const d of dates) assert.match(d.after ?? "", /^\d{4}-\d{2}-\d{2}$/);
    // Duplicate by email: row 1 is merged into the later row (keep last), with its name similar.
    const merge = all.find((c) => c.kind === "merge");
    assert.ok(merge, "expected a duplicate merge");
    assert.equal(merge.rowIndex, 0);
    assert.equal(merge.mergeIntoRow, 40);
    assert.equal(merge.reason, "Same email");
    assert.equal(merge.decision, "approved");
    // Every rule change is from a rule, never from AI.
    assert.ok(all.every((c) => c.source === "rule"));
    assert.equal(changeCount(fileId, "source = 'ai'"), 0);
  });
});

describe("clean job: AI on", () => {
  it("keeps only valid AI suggestions, maps them to the right row, and sends only the 20-row sample", async () => {
    const userId = newUser();
    const fake = await startFakeAI(() =>
      JSON.stringify({
        suggestions: [
          // Valid: sample row 3 is data row index 2, company "Northwnd".
          { row: 3, column: "company", before: TYPO_COMPANY, after: "Northwind", reason: "Likely typo", confidence: 0.92 },
          // Wrong before: the cell holds something else.
          { row: 4, column: "company", before: "NOT THERE", after: "X", reason: "Likely typo", confidence: 0.5 },
          // Column that does not exist.
          { row: 5, column: "no_such_column", before: "a", after: "b", reason: "x", confidence: 0.5 },
          // Outside the 20-row sample.
          { row: 25, column: "company", before: "y", after: "z", reason: "x", confidence: 0.5 },
          // Same value as the cell already holds.
          { row: 6, column: "company", before: "globex", after: "globex", reason: "x", confidence: 0.5 },
        ],
      }),
    );
    try {
      setProvider({ provider: "local", baseURL: fake.baseURL, model: "test-model" });
      const { fileId, jobId } = await upload(userId, crmCsv());
      await runClean(jobId);

      const file = fileRow(fileId);
      assert.equal(file.status, "needs_review");
      assert.equal(file.ai_status, "done");

      const ai = changesOf(fileId, "source = 'ai'");
      assert.equal(ai.length, 1);
      assert.equal(ai[0].rowIndex, 2);
      assert.equal(ai[0].column, "company");
      assert.equal(ai[0].before, TYPO_COMPANY);
      assert.equal(ai[0].after, "Northwind");
      assert.equal(ai[0].decision, "pending");
      assert.equal(ai[0].ruleId, "ai");

      // One request, and it carried the sample only.
      assert.equal(fake.requests.length, 1);
      const body = fake.requests[0] as { messages: { role: string; content: string }[] };
      const prompt = JSON.parse(body.messages[1].content) as { sample: unknown[]; columns: Record<string, unknown>[] };
      assert.equal(prompt.sample.length, 20);
      assert.ok(!body.messages[1].content.includes(OUTSIDE_SAMPLE_MARKER), "row 30 must not be sent");
      assert.ok(prompt.columns.every((c) => !("topValues" in c)), "column top values must not be sent");

      assert.ok(auditRows(fileId).some((a) => a.action === "ai.reviewed" && a.detail === "AI reviewed 20-row sample"));
    } finally {
      await fake.close();
    }
  });

  it("marks AI unavailable when the server is down, and still sends the file to review", async () => {
    const userId = newUser();
    setProvider({ provider: "local", baseURL: await closedPortBaseURL(), model: "test-model" });
    const { fileId, jobId } = await upload(userId, crmCsv());
    await runClean(jobId);

    const file = fileRow(fileId);
    assert.equal(file.status, "needs_review");
    assert.equal(file.ai_status, "unavailable");
    assert.equal(changeCount(fileId, "source = 'ai'"), 0);
    assert.ok(changeCount(fileId, "source = 'rule'") > 0);
    const audit = auditRows(fileId).find((a) => a.action === "ai.unavailable");
    assert.ok(audit && audit.detail.startsWith("AI unavailable: Could not reach"), audit?.detail);
    assert.equal(jobRow(jobId).error, null);
  });

  it("'Wait for AI' re-runs only the AI step once the server is back", async () => {
    const userId = newUser();
    setProvider({ provider: "local", baseURL: await closedPortBaseURL(), model: "test-model" });
    const { fileId, jobId } = await upload(userId, crmCsv());
    await runClean(jobId);
    const ruleCountBefore = changeCount(fileId, "source = 'rule'");
    assert.equal(fileRow(fileId).ai_status, "unavailable");

    const fake = await startFakeAI(() =>
      JSON.stringify({
        suggestions: [{ row: 3, column: "company", before: TYPO_COMPANY, after: "Northwind", reason: "Likely typo", confidence: 0.9 }],
      }),
    );
    try {
      setProvider({ provider: "local", baseURL: fake.baseURL, model: "test-model" });
      const { jobId: retryJob } = retryAi(userId, fileId);
      assert.equal(fileRow(fileId).status, "processing");
      await runClean(retryJob);

      const file = fileRow(fileId);
      assert.equal(file.status, "needs_review");
      assert.equal(file.ai_status, "done");
      assert.equal(changeCount(fileId, "source = 'ai'"), 1);
      assert.equal(changeCount(fileId, "source = 'rule'"), ruleCountBefore, "rule changes are not recomputed");
      assert.equal(JSON.parse(jobRow(retryJob).meta_json).aiOnly, true);
    } finally {
      await fake.close();
    }
  });
});

describe("clean job: failures and cancellation", () => {
  it("ends with the line-numbered message for invalid UTF-8", async () => {
    const userId = newUser();
    setProvider({ provider: "off" });
    const bytes = Buffer.concat([Buffer.from("customer_id,name\n1,Ana\n2,"), Buffer.from([0xff, 0xfe]), Buffer.from(",x\n")]);
    const { fileId, jobId } = await upload(userId, new Uint8Array(bytes));
    await runClean(jobId);

    const expected = `Line 3 isn't valid UTF-8. Re-export from your tool as "CSV UTF-8" and try again.`;
    const file = fileRow(fileId);
    assert.equal(file.status, "failed");
    assert.equal(file.error, expected);
    assert.equal(changeCount(fileId), 0);
    const job = jobRow(jobId);
    assert.equal(job.status, "failed");
    assert.equal(job.error, expected);
    assert.ok(auditRows(fileId).some((a) => a.action === "file.failed" && a.detail === expected));
  });

  it("fails an empty file with the user-facing message", async () => {
    const userId = newUser();
    setProvider({ provider: "off" });
    const { fileId, jobId } = await upload(userId, new Uint8Array());
    await runClean(jobId);
    assert.equal(fileRow(fileId).error, "This file is empty.");
    assert.equal(jobRow(jobId).status, "failed");
  });

  it("blocks a file that looks like an executable", async () => {
    const userId = newUser();
    setProvider({ provider: "off" });
    const { fileId, jobId } = await upload(userId, `MZ${CRM_HEADER}\n1,a,b,c@d.ee,,2026-01-01,US,x,1\n`);
    await runClean(jobId);
    const file = fileRow(fileId);
    assert.equal(file.status, "failed");
    assert.equal(file.error, "This file was blocked by the malware scan.");
    assert.ok(auditRows(fileId).some((a) => a.detail.includes("Windows executable")));
  });

  it("cancelled before it starts: the file fails with Cancelled and nothing is proposed", async () => {
    const userId = newUser();
    setProvider({ provider: "off" });
    const { fileId, jobId } = await upload(userId, crmCsv());
    const result = cancelJobForUser(userId, jobId);
    assert.deepEqual(result, { status: "cancelled" });
    assert.equal(fileRow(fileId).status, "failed");
    assert.equal(fileRow(fileId).error, "Cancelled");

    await runCleanJob(jobContextFor(jobId));
    assert.equal(changeCount(fileId), 0);
    assert.equal(jobRow(jobId).status, "cancelled");
  });

  it("cancelled mid-run: stops after the step in progress and records Cancelled", async () => {
    const userId = newUser();
    setProvider({ provider: "off" });
    const { fileId, jobId } = await upload(userId, crmCsv());
    await runClean(jobId, (step) => {
      if (step === "Profiling columns") db().prepare("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ?").run(Date.now(), jobId);
    });
    const file = fileRow(fileId);
    assert.equal(file.status, "failed");
    assert.equal(file.error, "Cancelled");
    assert.equal(changeCount(fileId), 0, "no changes are written after cancellation");
    assert.equal(jobRow(jobId).status, "cancelled");
  });

  it("other users cannot cancel a job", async () => {
    const owner = newUser();
    const other = newUser();
    setProvider({ provider: "off" });
    const { jobId } = await upload(owner, crmCsv());
    assert.equal(cancelJobForUser(other, jobId), null);
    assert.equal(jobRow(jobId).status, "queued");
  });
});

describe("clean job: modes and rule sets", () => {
  it("rules only never calls AI, even when a server is configured", async () => {
    const userId = newUser();
    setProvider({ provider: "local", baseURL: await closedPortBaseURL(), model: "test-model" });
    const { fileId, jobId } = await upload(userId, crmCsv(), { mode: "rules_only" });
    await runClean(jobId);
    const file = fileRow(fileId);
    assert.equal(file.status, "needs_review");
    assert.equal(file.ai_status, "skipped");
    assert.ok(!auditRows(fileId).some((a) => a.action === "ai.unavailable"));
  });

  it("an explicit rule set replaces the Upload options", async () => {
    const userId = newUser();
    setProvider({ provider: "off" });
    db()
      .prepare("INSERT INTO rule_sets (id, user_id, name, header_match_json, created_at, updated_at) VALUES (?, ?, ?, '[]', ?, ?)")
      .run("rset_trimonly1", userId, "Trim only", Date.now(), Date.now());
    db()
      .prepare("INSERT INTO rules (id, rule_set_id, column_pattern, action, params_json, position) VALUES (?, ?, '*', 'trim_whitespace', '{}', 0)")
      .run("rule_trim1", "rset_trimonly1");
    const { fileId, jobId } = await upload(userId, crmCsv(), { ruleSetId: "rset_trimonly1" });
    await runClean(jobId);

    const all = changesOf(fileId);
    assert.ok(all.length > 0);
    assert.ok(all.every((c) => c.ruleId === "trim_whitespace:rule_trim1"), "only the saved rule ran");
    assert.equal(all.filter((c) => c.kind === "merge").length, 0, "the built-in dedupe did not run");
  });

  it("a rule set whose headers match is applied automatically and recorded on the file", async () => {
    const userId = newUser();
    setProvider({ provider: "off" });
    db()
      .prepare("INSERT INTO rule_sets (id, user_id, name, header_match_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("rset_auto0001", userId, "CRM", JSON.stringify(["customer_id", "EMAIL"]), Date.now(), Date.now());
    db()
      .prepare("INSERT INTO rules (id, rule_set_id, column_pattern, action, params_json, position) VALUES (?, ?, '*', 'trim_whitespace', '{}', 0)")
      .run("rule_auto1", "rset_auto0001");
    const { fileId, jobId } = await upload(userId, crmCsv());
    await runClean(jobId);
    assert.equal(fileRow(fileId).rule_set_id, "rset_auto0001");
    assert.ok(changesOf(fileId).every((c) => c.ruleId === "trim_whitespace:rule_auto1"));
  });
});

describe("acceptSuggestions", () => {
  const table: Table = { headers: ["a", "b"], rows: [["x", "y"], ["p", "q"]] };

  it("keeps a valid suggestion and rejects bad rows, columns, mismatches and duplicates", () => {
    const out = acceptSuggestions(
      table,
      [
        { row: 1, column: "b", before: "y", after: "Y", reason: "fix", confidence: 0.8 },
        { row: 1, column: "b", before: "y", after: "Z", reason: "dup", confidence: 0.8 },
        { row: 2, column: "a", before: "wrong", after: "w", reason: "no", confidence: 0.8 },
        { row: 3, column: "a", before: "x", after: "w", reason: "out", confidence: 0.8 },
        { row: 0, column: "a", before: "x", after: "w", reason: "zero", confidence: 0.8 },
        { row: 2, column: "zz", before: "p", after: "w", reason: "col", confidence: 0.8 },
      ],
      2,
      [],
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].rowIndex, 0);
    assert.equal(out[0].column, "b");
    assert.equal(out[0].after, "Y");
    assert.equal(out[0].decision, "pending");
  });
});

describe("insertChanges", () => {
  it("writes every row across batch boundaries, in order", async () => {
    const userId = newUser();
    setProvider({ provider: "off" });
    const { fileId } = await upload(userId, crmCsv(5));
    const changes: ProposedChange[] = Array.from({ length: 1234 }, (_, i) => ({
      rowIndex: i,
      column: "company",
      kind: "value",
      before: `b${i}`,
      after: `a${i}`,
      source: "rule",
      ruleId: "builtin:test",
      reason: "test",
      confidence: 1,
      decision: i % 2 === 0 ? "approved" : "pending",
    }));
    insertChanges(fileId, changes);
    const stored = changesOf(fileId);
    assert.equal(stored.length, 1234);
    assert.deepEqual(stored.map((c) => c.rowIndex), changes.map((c) => c.rowIndex));
    assert.equal(stored[1233].after, "a1233");
    assert.equal(stored[1233].decision, "pending");
  });
});
