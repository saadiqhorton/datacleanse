import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { setInstanceAIConfig } from "../ai";
import { db, type DB } from "../db";
import { insertTestUser, setupTestEnv } from "../testing";
import { applyFile } from "./review";
import {
  deleteFileForUser,
  filesHref,
  filesView,
  formatCount,
  formatDeletesIn,
  listStatusOf,
  parseSearch,
  parseTab,
  processingLabel,
  tabMatches,
} from "./list-view";
import { absoluteDataPath, fileDirRel } from "./storage";
import { changeCount, crmCsv, fileRow, uploadAndClean } from "./test-support";
import { createUpload } from "./upload";

let conn: DB;
let counter = 0;

before(() => {
  ({ db: conn } = setupTestEnv());
  setInstanceAIConfig({ provider: "off" }, null);
});

function newUser(): string {
  counter++;
  return insertTestUser(conn, `usr_list${counter}xyz`, `list${counter}@example.com`);
}

function dirExists(userId: string, fileId: string): boolean {
  return existsSync(absoluteDataPath(fileDirRel(userId, fileId)));
}

function rowNamed<T extends { id: string }>(rows: T[], id: string): T | undefined {
  return rows.find((r) => r.id === id);
}

describe("pure helpers", () => {
  it("formats counts with thousands separators", () => {
    assert.equal(formatCount(0), "0");
    assert.equal(formatCount(642), "642");
    assert.equal(formatCount(4812), "4,812");
    assert.equal(formatCount(1234567), "1,234,567");
  });

  it("formats time left in minutes, hours and days", () => {
    const MIN = 60 * 1000;
    assert.equal(formatDeletesIn(null), "—");
    assert.equal(formatDeletesIn(0), "< 1 min");
    assert.equal(formatDeletesIn(59 * 1000), "< 1 min");
    assert.equal(formatDeletesIn(45 * MIN), "45 min");
    assert.equal(formatDeletesIn(59 * MIN + 59 * 1000), "59 min");
    assert.equal(formatDeletesIn(60 * MIN), "1 h");
    assert.equal(formatDeletesIn(21 * 60 * MIN + 10 * MIN), "21 h");
    assert.equal(formatDeletesIn(47 * 60 * MIN), "47 h");
    assert.equal(formatDeletesIn(7 * 24 * 60 * MIN), "7 d");
  });

  it("labels processing with a rounded, clamped percentage", () => {
    assert.equal(processingLabel(62), "Processing · 62%");
    assert.equal(processingLabel(61.6), "Processing · 62%");
    assert.equal(processingLabel(-5), "Processing · 0%");
    assert.equal(processingLabel(140), "Processing · 100%");
  });

  it("maps file statuses to list statuses", () => {
    assert.equal(listStatusOf("needs_review"), "review");
    assert.equal(listStatusOf("ready"), "ready");
    assert.equal(listStatusOf("failed"), "failed");
    assert.equal(listStatusOf("processing"), "processing");
    assert.equal(listStatusOf("uploaded"), "processing");
    assert.equal(listStatusOf("deleted"), "deleted");
  });

  it("reads the tab and search from the URL leniently", () => {
    assert.equal(parseTab("review"), "review");
    assert.equal(parseTab("ready"), "ready");
    assert.equal(parseTab("deleted"), "all", "deleted is not a pill");
    assert.equal(parseTab(undefined), "all");
    assert.equal(parseTab(["review", "ready"]), "all");
    assert.equal(parseSearch("  crm  "), "crm");
    assert.equal(parseSearch(undefined), "");
    assert.equal(parseSearch("x".repeat(500)).length, 200);
  });

  it("keeps the search and tab when building links", () => {
    assert.equal(filesHref(), "/files");
    assert.equal(filesHref({ tab: "all" }), "/files");
    assert.equal(filesHref({ tab: "review" }), "/files?status=review");
    assert.equal(filesHref({ tab: "failed", q: "leads export" }), "/files?status=failed&q=leads+export");
    assert.equal(filesHref({ q: "crm" }), "/files?q=crm");
  });

  it("matches rows to tabs, and All matches everything", () => {
    assert.equal(tabMatches("all", "deleted"), true);
    assert.equal(tabMatches("review", "review"), true);
    assert.equal(tabMatches("review", "ready"), false);
    assert.equal(tabMatches("processing", "deleted"), false);
  });
});

describe("filesView", () => {
  it("returns an empty view for a user with no files", async () => {
    const userId = newUser();
    const view = await filesView(userId);
    assert.equal(view.total, 0);
    assert.deepEqual(view.rows, []);
    assert.deepEqual(view.counts, { all: 0, review: 0, ready: 0, processing: 0, failed: 0 });
  });

  it("labels each status, and counts pills per status", async () => {
    const userId = newUser();
    const review = await uploadAndClean(userId, crmCsv(40), {}, "crm_export_q3.csv");
    const ready = await uploadAndClean(userId, crmCsv(40), {}, "payroll_sept.csv");
    await applyFile(userId, ready.fileId);
    const failed = await createUpload(userId, { name: "leads_export.csv", bytes: new TextEncoder().encode(crmCsv(3)) });
    db()
      .prepare("UPDATE files SET status = 'failed', error = ? WHERE id = ?")
      .run("Not valid UTF-8 at line 1,204", failed.fileId);
    const processing = await createUpload(userId, { name: "vendors_2026.csv", bytes: new TextEncoder().encode(crmCsv(3)) });
    db().prepare("UPDATE jobs SET progress = 62 WHERE id = ?").run(processing.jobId);

    const view = await filesView(userId);
    assert.equal(view.total, 4);
    assert.deepEqual(view.counts, { all: 4, review: 1, ready: 1, processing: 1, failed: 1 });

    const reviewRow = rowNamed(view.rows, review.fileId)!;
    assert.equal(reviewRow.status, "review");
    assert.equal(reviewRow.statusLabel, "Needs review");
    assert.match(reviewRow.changesLabel, /^[\d,]+ · [\d,]+ pending$/);
    assert.notEqual(reviewRow.changesLabel, "No changes");
    assert.equal(reviewRow.deletesLabel.endsWith(" h"), true);

    const readyRow = rowNamed(view.rows, ready.fileId)!;
    assert.equal(readyRow.status, "ready");
    assert.equal(readyRow.statusLabel, "Ready");
    assert.match(readyRow.changesLabel, /^[\d,]+ applied$/);
    assert.equal(readyRow.rowsLabel, formatCount(fileRow(ready.fileId).row_count ?? 0));

    const failedRow = rowNamed(view.rows, failed.fileId)!;
    assert.equal(failedRow.statusLabel, "Failed");
    assert.equal(failedRow.changesLabel, "Not valid UTF-8 at line 1,204");
    assert.equal(failedRow.changesTone, "error");
    assert.equal(failedRow.canRetry, true, "the original is still on disk");

    const processingRow = rowNamed(view.rows, processing.fileId)!;
    assert.equal(processingRow.status, "processing");
    assert.equal(processingRow.statusLabel, "Processing · 62%");
    assert.equal(processingRow.progress, 62);
    assert.equal(processingRow.changesLabel, "—");
  });

  it("uses the applied count for ready files, not the proposed one", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId, crmCsv(40));
    assert.equal(fileRow(fileId).status, "needs_review");
    const proposed = changeCount(fileId);
    assert.ok(proposed > 0);
    // Skip everything the rules proposed, then apply: nothing is applied.
    db().prepare("UPDATE changes SET decision = 'skipped' WHERE file_id = ?").run(fileId);
    await applyFile(userId, fileId);
    const view = await filesView(userId);
    assert.equal(rowNamed(view.rows, fileId)!.changesLabel, "0 applied");
  });

  it("filters rows by tab but keeps pill counts for the search", async () => {
    const userId = newUser();
    await uploadAndClean(userId, crmCsv(40), {}, "crm_q3.csv");
    const ready = await uploadAndClean(userId, crmCsv(40), {}, "crm_q4.csv");
    await applyFile(userId, ready.fileId);
    await uploadAndClean(userId, crmCsv(40), {}, "payroll.csv");

    const readyTab = await filesView(userId, { tab: "ready", q: "crm" });
    assert.deepEqual(readyTab.rows.map((r) => r.id), [ready.fileId]);
    assert.deepEqual(readyTab.counts, { all: 2, review: 1, ready: 1, processing: 0, failed: 0 });
    assert.equal(readyTab.total, 2);

    const everything = await filesView(userId, { tab: "all" });
    assert.equal(everything.rows.length, 3);
  });

  it("matches the search text case-insensitively and trims it", async () => {
    const userId = newUser();
    await uploadAndClean(userId, crmCsv(40), {}, "Vendors_2026.csv");
    await uploadAndClean(userId, crmCsv(40), {}, "payroll.csv");
    const view = await filesView(userId, { q: "  VENDORS " });
    assert.equal(view.total, 1);
    assert.equal(view.rows[0].name, "Vendors_2026.csv");
  });

  it("shows deleted files as Report kept with no time left", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId, crmCsv(40));
    await deleteFileForUser(userId, fileId);
    const view = await filesView(userId, { tab: "all" });
    const row = rowNamed(view.rows, fileId)!;
    assert.equal(row.status, "deleted");
    assert.equal(row.statusLabel, "Deleted");
    assert.equal(row.changesLabel, "Report kept");
    assert.equal(row.changesTone, "muted");
    assert.equal(row.deletesLabel, "—");
    assert.equal(view.counts.all, 1);
    assert.equal(view.counts.review, 0, "deleted files are not counted in a status pill");
  });

  it("does not offer a retry when the original copy is gone", async () => {
    const userId = newUser();
    const { fileId } = await createUpload(userId, { name: "gone.csv", bytes: new TextEncoder().encode(crmCsv(3)) });
    db().prepare("UPDATE files SET status = 'failed', error = 'Boom' WHERE id = ?").run(fileId);
    rmSync(absoluteDataPath(fileDirRel(userId, fileId)), { recursive: true, force: true });
    const view = await filesView(userId, { tab: "failed" });
    assert.equal(rowNamed(view.rows, fileId)!.canRetry, false);
  });

  it("is scoped to the user", async () => {
    const owner = newUser();
    const other = newUser();
    await uploadAndClean(owner, crmCsv(40), {}, "owner.csv");
    const view = await filesView(other);
    assert.equal(view.total, 0);
  });
});

describe("deleteFileForUser", () => {
  it("removes the copies now, keeps the changes, and audits file.deleted", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId, crmCsv(40));
    const changes = changeCount(fileId);
    assert.ok(dirExists(userId, fileId));

    await deleteFileForUser(userId, fileId);

    assert.equal(dirExists(userId, fileId), false);
    const row = fileRow(fileId);
    assert.equal(row.status, "deleted");
    assert.equal(row.storage_path, null);
    assert.equal(row.cleaned_path, null);
    assert.ok(row.deleted_at !== null);
    assert.equal(changeCount(fileId), changes, "changes are kept for the report");

    const audit = db()
      .prepare("SELECT actor_user_id FROM audit_log WHERE file_id = ? AND action = 'file.deleted'")
      .all(fileId) as { actor_user_id: string | null }[];
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_user_id, userId);
  });

  it("refuses another user's file as not found, and leaves it alone", async () => {
    const owner = newUser();
    const intruder = newUser();
    const { fileId } = await uploadAndClean(owner, crmCsv(40));
    await assert.rejects(deleteFileForUser(intruder, fileId), (e: { code?: string }) => e.code === "not_found");
    assert.equal(fileRow(fileId).status, "needs_review");
    assert.ok(dirExists(owner, fileId));
  });

  it("refuses a file that is still being processed", async () => {
    const userId = newUser();
    const { fileId } = await createUpload(userId, { name: "busy.csv", bytes: new TextEncoder().encode(crmCsv(5)) });
    await assert.rejects(deleteFileForUser(userId, fileId), (e: { code?: string }) => e.code === "conflict");
    assert.equal(fileRow(fileId).status, "processing");
    assert.ok(dirExists(userId, fileId));
  });

  it("refuses a file that was already deleted", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId, crmCsv(40));
    await deleteFileForUser(userId, fileId);
    await assert.rejects(deleteFileForUser(userId, fileId), (e: { code?: string }) => e.code === "conflict");
  });

  it("refuses ids that are not well-formed", async () => {
    const userId = newUser();
    await assert.rejects(deleteFileForUser(userId, "../../etc"), (e: { code?: string }) => e.code === "not_found");
  });
});
