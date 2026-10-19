import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setInstanceAIConfig } from "../ai";
import { db, type DB } from "../db";
import { applyFile, setDecision } from "../files/review";
import { getFileForUser } from "../files/repo";
import { sweepExpiredFiles } from "../files/retention";
import { changeCount, crmCsv, uploadAndClean } from "../files/test-support";
import { insertTestUser, setupTestEnv } from "../testing";
import { summarizeChanges, type ChangeSummary } from "./summary";
import {
  activityText,
  cleanedState,
  downloadNote,
  fixedLabel,
  listReportsForUser,
  loadReportForUser,
  newestFirst,
  reportBadge,
  reportListStatus,
  reportStats,
  reviewHref,
  timeLeftLabel,
} from "./view";

let conn: DB;
let counter = 0;

before(() => {
  ({ db: conn } = setupTestEnv());
  setInstanceAIConfig({ provider: "off" }, null);
});

function newUser(name = "Maria Rossi"): string {
  counter++;
  const id = `usr_view${counter}xyz`;
  insertTestUser(conn, id, `view${counter}@example.com`);
  db().prepare("UPDATE users SET name = ? WHERE id = ?").run(name, id);
  return id;
}

/** Skips the first rule value change, then applies. Returns the file id. */
async function appliedFile(userId: string, name = "crm_export_q3.csv"): Promise<string> {
  const { fileId } = await uploadAndClean(userId, crmCsv(40), {}, name);
  const first = db()
    .prepare("SELECT id FROM changes WHERE file_id = ? AND source = 'rule' AND kind = 'value' ORDER BY id LIMIT 1")
    .get(fileId) as { id: number };
  setDecision(userId, fileId, [first.id], "skipped");
  await applyFile(userId, fileId);
  return fileId;
}

describe("loadReportForUser", () => {
  it("loads an applied file with totals over every change and activity newest first", async () => {
    const owner = newUser();
    const fileId = await appliedFile(owner);
    const report = loadReportForUser(owner, fileId);
    assert.ok(report);
    assert.equal(report.file.name, "crm_export_q3.csv");
    assert.equal(report.file.status, "ready");
    assert.ok(report.file.appliedAt !== null);
    assert.equal(report.file.approvedByName, "Maria Rossi");
    assert.equal(report.file.hasCleaned, true);

    const direct = summarizeChanges(
      (await import("../files/repo")).allChanges(fileId).changes,
      { rowsIn: report.file.rowCount ?? 0 },
    );
    assert.deepEqual(report.summary, direct);
    assert.equal(report.summary.skipped, 1);
    assert.ok(report.summary.applied > 0);
    assert.equal(report.summary.rowsOut, (report.file.rowCount ?? 0) - report.summary.rowsRemoved);
    assert.ok(report.summary.rowsRemoved > 0, "the fixture has a duplicate row to merge");
    assert.ok(report.summary.byColumn.some((c) => c.column === "signup_date"));

    const at = report.activity.map((a) => a.at);
    assert.deepEqual(at, [...at].sort((a, b) => b - a), "newest first");
    assert.ok(report.activity.length >= 2);
  });

  it("returns null for another user, a malformed id, or an unknown id", async () => {
    const owner = newUser();
    const fileId = await appliedFile(owner);
    assert.equal(loadReportForUser(newUser(), fileId), null);
    assert.equal(loadReportForUser(owner, "not-an-id"), null);
    assert.equal(loadReportForUser(owner, "file_doesnotexist"), null);
  });

  it("loads a file that is still waiting for review, with nothing applied", async () => {
    const owner = newUser();
    const { fileId } = await uploadAndClean(owner, crmCsv(40), {}, "waiting.csv");
    const report = loadReportForUser(owner, fileId);
    assert.ok(report);
    assert.equal(report.file.status, "needs_review");
    assert.equal(report.file.appliedAt, null);
    // Approved proposals count toward the totals even before the file is applied.
    assert.equal(report.summary.applied, changeCount(fileId, "kind <> 'flag' AND decision = 'approved'"));
    assert.equal(report.summary.rowsOut, (report.file.rowCount ?? 0) - report.summary.rowsRemoved);
    assert.equal(reviewHref(report.file), `/review/${fileId}`);
  });

  it("keeps the report after the cleaned copy is deleted", async () => {
    const owner = newUser();
    const fileId = await appliedFile(owner);
    const before = loadReportForUser(owner, fileId);
    assert.ok(before);
    await sweepExpiredFiles(Date.now() + 30 * 24 * 3600 * 1000);

    const report = loadReportForUser(owner, fileId);
    assert.ok(report);
    assert.equal(report.file.status, "deleted");
    assert.equal(report.file.hasCleaned, false);
    assert.equal(report.file.deletesInMs, null);
    assert.deepEqual(report.summary, before.summary, "totals survive deletion");
    assert.equal(report.file.appliedAt, before.file.appliedAt);
    assert.equal(getFileForUser(owner, fileId)?.status, "deleted");
    assert.deepEqual(cleanedState(report.file), { kind: "deleted", at: report.file.deletedAt });
  });
});

describe("listReportsForUser", () => {
  it("lists applied and deleted files, and files with edits; leaves out files with nothing to report", async () => {
    const userId = newUser();
    const applied = await appliedFile(userId, "alpha.csv");
    const waiting = (await uploadAndClean(userId, crmCsv(40), {}, "beta.csv")).fileId;
    const plain = (await uploadAndClean(userId, "id,score\n1,10\n2,20\n", {}, "plain.csv")).fileId;
    assert.equal(changeCount(plain, "kind <> 'flag'"), 0, "fixture has no edits");

    const items = listReportsForUser(userId);
    const ids = items.map((i) => i.id);
    assert.ok(ids.includes(applied));
    assert.ok(ids.includes(waiting));
    assert.ok(!ids.includes(plain));

    const row = items.find((i) => i.id === applied);
    assert.ok(row);
    assert.equal(row.name, "alpha.csv");
    assert.equal(row.applied, changeCount(applied, "kind <> 'flag' AND decision = 'approved'"));
    assert.equal(row.skipped, 1);
    assert.equal(row.rowsOut, getFileForUser(userId, applied)?.rowsOut);

    await sweepExpiredFiles(Date.now() + 30 * 24 * 3600 * 1000);
    const afterDelete = listReportsForUser(userId).find((i) => i.id === applied);
    assert.ok(afterDelete, "deleted files stay on the list");
    assert.equal(afterDelete.status, "deleted");
    assert.equal(reportListStatus(afterDelete).label, "Deleted");
  });

  it("only lists the caller's files, and an invalid user id gets nothing", async () => {
    const mine = newUser();
    const theirs = newUser();
    await appliedFile(theirs, "theirs.csv");
    const myFile = await appliedFile(mine, "mine.csv");
    assert.deepEqual(listReportsForUser(mine).map((i) => i.id), [myFile]);
    assert.deepEqual(listReportsForUser("bad id"), []);
  });
});

describe("report helpers", () => {
  it("names the badge for applied, waiting and deleted files", () => {
    assert.deepEqual(reportBadge({ status: "ready", appliedAt: 1 }), { label: "Applied", status: "ready" });
    assert.deepEqual(reportBadge({ status: "deleted", appliedAt: 1 }), { label: "Applied", status: "ready" });
    assert.deepEqual(reportBadge({ status: "needs_review", appliedAt: null }), { label: "Not applied yet", status: "review" });
    assert.deepEqual(reportBadge({ status: "deleted", appliedAt: null }), { label: "Not applied yet", status: "deleted" });
  });

  it("links back to review only while the file needs review", () => {
    assert.equal(reviewHref({ id: "file_a", status: "needs_review", appliedAt: null }), "/review/file_a");
    assert.equal(reviewHref({ id: "file_a", status: "ready", appliedAt: 5 }), null);
    assert.equal(reviewHref({ id: "file_a", status: "processing", appliedAt: null }), null);
  });

  it("formats the four stats in the design's order", () => {
    const summary: ChangeSummary = { applied: 1984, skipped: 16, pending: 0, rowsRemoved: 37, rowsOut: 4775, byColumn: [] };
    assert.deepEqual(reportStats(summary), [
      { label: "Applied", value: "1,984" },
      { label: "Skipped", value: "16" },
      { label: "Rows removed", value: "37" },
      { label: "Rows out", value: "4,775" },
    ]);
  });

  it("shows fixed as approved over total", () => {
    assert.equal(fixedLabel({ fixed: 96, total: 96 }), "96 / 96");
    assert.equal(fixedLabel({ fixed: 18, total: 24 }), "18 / 24");
    assert.equal(fixedLabel({ fixed: 0, total: 0 }), "0 / 0");
  });

  it("describes the cleaned file as available, deleted with a date, or absent", () => {
    const base = { status: "ready" as const, appliedAt: 10, hasCleaned: true, deletedAt: null };
    assert.deepEqual(cleanedState(base), { kind: "available" });
    assert.deepEqual(cleanedState({ ...base, status: "deleted", hasCleaned: false, deletedAt: 99 }), { kind: "deleted", at: 99 });
    assert.deepEqual(cleanedState({ ...base, appliedAt: null, status: "needs_review", hasCleaned: false }), { kind: "none" });
  });

  it("reads time left in the largest sensible unit", () => {
    const minute = 60_000;
    const hour = 60 * minute;
    assert.equal(timeLeftLabel(21 * hour + 5 * minute), "21 hours");
    assert.equal(timeLeftLabel(hour), "1 hour");
    assert.equal(timeLeftLabel(47 * hour), "47 hours");
    assert.equal(timeLeftLabel(48 * hour), "2 days");
    assert.equal(timeLeftLabel(7 * 24 * hour), "7 days");
    assert.equal(timeLeftLabel(5 * minute), "5 minutes");
    assert.equal(timeLeftLabel(1 * minute), "1 minute");
    assert.equal(timeLeftLabel(30_000), "less than a minute");
    assert.equal(timeLeftLabel(-5), "less than a minute");
    assert.equal(timeLeftLabel(Number.NaN), "less than a minute");
  });

  it("writes the footer note, and drops the deletion sentence once files are gone", () => {
    assert.equal(downloadNote(21 * 3600_000), "Download links expire after 15 minutes. Files are deleted in 21 hours.");
    assert.equal(downloadNote(null), "Download links expire after 15 minutes.");
  });

  it("puts the newest activity first without changing its input", () => {
    const input = [
      { id: 1, at: 100 },
      { id: 3, at: 300 },
      { id: 2, at: 300 },
    ];
    assert.deepEqual(newestFirst(input).map((i) => i.id), [3, 2, 1]);
    assert.deepEqual(input.map((i) => i.id), [1, 3, 2]);
  });

  it("names an activity line and its actor", () => {
    assert.equal(activityText({ detail: "Applied 198 changes", action: "file.applied", actorName: "Maria R." }), "Applied 198 changes · Maria R.");
    assert.equal(activityText({ detail: "", action: "file.uploaded", actorName: null }), "file.uploaded");
  });
});
