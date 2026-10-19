import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setInstanceAIConfig } from "../ai";
import { db, type DB } from "../db";
import { insertTestUser, setupTestEnv } from "../testing";
import { applyFile, decideAllAI, setDecision, skipAIForFile } from "./review";
import { FileError } from "./errors";
import { auditRows, changeCount, crmCsv, fileRow, uploadAndClean } from "./test-support";
import { readFileSync } from "node:fs";
import { absoluteDataPath } from "./storage";

let conn: DB;
let counter = 0;

before(() => {
  ({ db: conn } = setupTestEnv());
  setInstanceAIConfig({ provider: "off" }, null);
});

function newUser(): string {
  counter++;
  return insertTestUser(conn, `usr_review${counter}x`, `review${counter}@example.com`);
}

function insertChange(
  fileId: string,
  f: { source: "rule" | "ai"; kind?: "value" | "flag" | "merge"; decision: string; rowIndex?: number; column?: string; before?: string; after?: string },
): number {
  return Number(
    db()
      .prepare(
        `INSERT INTO changes (file_id, row_index, column_name, kind, before, after, source, rule_id, reason, confidence, decision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test', 0.5, ?)`,
      )
      .run(
        fileId,
        f.rowIndex ?? 5,
        f.column ?? "company",
        f.kind ?? "value",
        f.before ?? "old",
        f.after ?? "new",
        f.source,
        f.source === "ai" ? "ai" : "builtin:test",
        f.decision,
      ).lastInsertRowid,
  );
}

function decisionOf(id: number): string {
  return (db().prepare("SELECT decision FROM changes WHERE id = ?").get(id) as { decision: string }).decision;
}

describe("review decisions", () => {
  it("applies the decision rules to each change", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    const pendingRule = insertChange(fileId, { source: "rule", decision: "pending" });
    const approvedRule = db().prepare("SELECT id FROM changes WHERE file_id = ? AND source = 'rule' AND decision = 'approved' LIMIT 1").get(fileId) as { id: number };
    const flag = insertChange(fileId, { source: "rule", kind: "flag", decision: "approved", rowIndex: 7 });
    const ai = insertChange(fileId, { source: "ai", decision: "pending", rowIndex: 8 });

    // A pending rule change can be approved.
    assert.deepEqual(setDecision(userId, fileId, [pendingRule], "approved"), { updated: 1, ignored: 0 });
    assert.equal(decisionOf(pendingRule), "approved");

    // An approved rule change can be skipped, but not approved again (it is not pending).
    assert.deepEqual(setDecision(userId, fileId, [approvedRule.id], "skipped"), { updated: 1, ignored: 0 });
    assert.deepEqual(setDecision(userId, fileId, [approvedRule.id], "approved"), { updated: 0, ignored: 1 });

    // Flags never toggle.
    assert.deepEqual(setDecision(userId, fileId, [flag], "skipped"), { updated: 0, ignored: 1 });

    // AI changes toggle both ways.
    assert.equal(setDecision(userId, fileId, [ai], "approved").updated, 1);
    assert.equal(setDecision(userId, fileId, [ai], "skipped").updated, 1);
    assert.equal(setDecision(userId, fileId, [ai], "approved").updated, 1);
    assert.equal(decisionOf(ai), "approved");

    // Ids from another file are ignored.
    const other = await uploadAndClean(userId, crmCsv(5), {}, "other.csv");
    const otherChange = db().prepare("SELECT id FROM changes WHERE file_id = ? LIMIT 1").get(other.fileId) as { id: number };
    assert.deepEqual(setDecision(userId, fileId, [otherChange.id], "skipped"), { updated: 0, ignored: 1 });

    const audit = auditRows(fileId).filter((a) => a.action === "file.approved" || a.action === "file.skipped");
    assert.ok(audit.some((a) => a.detail === "Approved 1 change"));
  });

  it("refuses other users and bad input", async () => {
    const owner = newUser();
    const stranger = newUser();
    const { fileId } = await uploadAndClean(owner);
    const id = insertChange(fileId, { source: "ai", decision: "pending" });
    assert.throws(() => setDecision(stranger, fileId, [id], "approved"), (e: unknown) => e instanceof FileError && e.code === "not_found");
    assert.throws(() => setDecision(owner, fileId, [], "approved"), (e: unknown) => e instanceof FileError && e.code === "invalid");
    assert.throws(() => setDecision(owner, fileId, [1.5], "approved"), (e: unknown) => e instanceof FileError && e.code === "invalid");
    assert.throws(() => setDecision(owner, fileId, [id], "maybe" as "approved"), (e: unknown) => e instanceof FileError && e.code === "invalid");
  });

  it("approves or skips every AI change at once, and skips AI for a file", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    insertChange(fileId, { source: "ai", decision: "pending", rowIndex: 1 });
    insertChange(fileId, { source: "ai", decision: "pending", rowIndex: 2 });
    insertChange(fileId, { source: "ai", decision: "skipped", rowIndex: 3 });

    assert.deepEqual(decideAllAI(userId, fileId, "approved"), { updated: 3 });
    assert.equal(changeCount(fileId, "source = 'ai' AND decision = 'approved'"), 3);
    assert.deepEqual(decideAllAI(userId, fileId, "skipped"), { updated: 3 });

    insertChange(fileId, { source: "ai", decision: "approved", rowIndex: 4 });
    assert.deepEqual(skipAIForFile(userId, fileId), { skipped: 1 });
    assert.equal(changeCount(fileId, "source = 'ai' AND decision <> 'skipped'"), 0);
    const file = fileRow(fileId);
    assert.equal(file.ai_status, "skipped");
    assert.equal((db().prepare("SELECT mode FROM files WHERE id = ?").get(fileId) as { mode: string }).mode, "rules_only");
  });

  it("refuses decisions once the file has been applied", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    const id = insertChange(fileId, { source: "ai", decision: "pending" });
    await applyFile(userId, fileId);
    assert.equal(fileRow(fileId).status, "ready");
    assert.throws(() => setDecision(userId, fileId, [id], "approved"), (e: unknown) => e instanceof FileError && e.code === "conflict");
    assert.throws(() => decideAllAI(userId, fileId, "approved"), (e: unknown) => e instanceof FileError && e.code === "conflict");
  });
});

describe("applyFile", () => {
  it("writes the cleaned CSV from approved changes only", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    // An AI suggestion the user approves, and one left pending (it must not be applied).
    const approvedAi = insertChange(fileId, { source: "ai", decision: "approved", rowIndex: 2, column: "company", before: "Northwnd", after: "Northwind" });
    const pendingAi = insertChange(fileId, { source: "ai", decision: "pending", rowIndex: 3, column: "company", before: "globex", after: "GLOBEX" });
    assert.equal(decisionOf(approvedAi), "approved");

    const result = await applyFile(userId, fileId);
    const file = fileRow(fileId);
    assert.equal(file.status, "ready");
    assert.equal(file.rows_out, 40);
    assert.equal(result.rowsOut, 40);
    assert.equal(file.approved_by, userId);
    assert.ok(file.applied_at !== null);
    assert.equal(file.cleaned_path, "files/" + userId + "/" + fileId + "/cleaned.csv");
    assert.equal(decisionOf(pendingAi), "skipped", "pending changes are treated as skipped");

    const text = readFileSync(absoluteDataPath(file.cleaned_path as string), "utf8");
    const lines = text.split("\r\n");
    assert.equal(lines[0], "customer_id,first_name,last_name,email,phone,signup_date,country,company,amount");
    assert.equal(lines.length, 40 + 2, "header, 40 rows, trailing newline");
    // Row 1 is merged away as a duplicate; the kept row (the last, id 9999) is not in the output.
    assert.ok(lines.some((l) => l.startsWith("9999,")), "the kept duplicate stays");
    assert.ok(!lines.some((l) => l.startsWith("1001,")), "the merged duplicate is removed");
    // Trimmed, title-cased first name and lowercased email are in the output.
    assert.ok(lines.some((l) => l.startsWith("1002,Tom,")), "title case applied");
    assert.ok(lines.some((l) => l.includes("li.wei4@example.org")), "email lowercased");
    // The approved AI fix is in, the pending one is not.
    assert.ok(lines.some((l) => l.includes(",Northwind,")), "approved AI suggestion applied");
    assert.ok(!lines.some((l) => l.includes(",GLOBEX,")), "pending AI suggestion not applied");

    const audit = auditRows(fileId);
    assert.ok(audit.some((a) => a.action === "file.applied" && /^Applied \d+ changes?$/.test(a.detail)));
    assert.ok(audit.some((a) => a.action === "file.skipped_ai" && a.detail === "Skipped 1 AI suggestion"));
  });

  it("keeps the byte order mark and the file's delimiter", async () => {
    const userId = newUser();
    const tsv = "customer_id\tname\tcity\n1\t  ana  \tRome\n2\tBob\tMilan\n";
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(tsv, "utf8")]);
    const { fileId } = await uploadAndClean(userId, new Uint8Array(bom), {}, "contacts.tsv");
    await applyFile(userId, fileId);
    const text = readFileSync(absoluteDataPath(fileRow(fileId).cleaned_path as string), "utf8");
    assert.ok(text.startsWith("﻿"), "BOM kept");
    assert.ok(text.startsWith("﻿customer_id\tname\tcity\r\n"), "tab delimited");
    assert.ok(text.includes("1\tAna\tRome"), "padded value trimmed and title cased");
  });

  it("refuses to apply twice", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    await applyFile(userId, fileId);
    await assert.rejects(applyFile(userId, fileId), (e: unknown) => e instanceof FileError && e.code === "conflict");
  });
});
