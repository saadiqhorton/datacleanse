import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setInstanceAIConfig } from "../ai";
import { db, type DB } from "../db";
import { insertTestUser, setupTestEnv } from "../testing";
import { applyFile, setDecision } from "./review";
import { allChanges, fileActivity, getFileForUser, listChanges, listFilesForUser, summaryForReport } from "./repo";
import { changeCount, crmCsv, uploadAndClean } from "./test-support";
import { createUpload } from "./upload";

let conn: DB;
let counter = 0;

before(() => {
  ({ db: conn } = setupTestEnv());
  setInstanceAIConfig({ provider: "off" }, null);
});

function newUser(name = "Maria Rossi"): string {
  counter++;
  const id = `usr_repo${counter}xyz`;
  insertTestUser(conn, id, `repo${counter}@example.com`);
  db().prepare("UPDATE users SET name = ? WHERE id = ?").run(name, id);
  return id;
}

describe("file reads are owner-scoped", () => {
  it("returns a file only to its owner, with profile, options and change counts", async () => {
    const owner = newUser();
    const { fileId } = await uploadAndClean(owner);
    const detail = getFileForUser(owner, fileId);
    assert.ok(detail);
    assert.equal(detail.name, "crm_export_q3.csv");
    assert.equal(detail.status, "needs_review");
    assert.equal(detail.rowCount, 41);
    assert.equal(detail.profile?.columns.length, 9);
    assert.equal(detail.options.dedupe, true);
    assert.equal(detail.hasOriginal, true);
    assert.equal(detail.hasCleaned, false);
    assert.ok((detail.deletesInMs ?? 0) > 23 * 3600 * 1000);
    assert.equal(detail.counts.total, changeCount(fileId));
    assert.equal(detail.counts.bySource.ai.approved + detail.counts.bySource.ai.pending + detail.counts.bySource.ai.skipped, 0);
    assert.ok(detail.counts.bySource.rule.approved > 0);

    assert.equal(getFileForUser(newUser(), fileId), null, "another user gets nothing");
    assert.equal(getFileForUser(owner, "not-an-id"), null);
    assert.equal(getFileForUser(owner, "file_doesnotexist"), null);
  });

  it("lists only the user's files, filtered by status and name", async () => {
    const userId = newUser();
    const a = await uploadAndClean(userId, crmCsv(5), {}, "Alpha Report.csv");
    await uploadAndClean(userId, crmCsv(5), {}, "beta.tsv");
    await uploadAndClean(newUser(), crmCsv(5), {}, "alpha-other-user.csv");
    await applyFile(userId, a.fileId);

    const all = listFilesForUser(userId).map((f) => f.name);
    assert.deepEqual(all.sort(), ["Alpha Report.csv", "beta.tsv"]);
    assert.deepEqual(listFilesForUser(userId, { q: "ALPHA" }).map((f) => f.name), ["Alpha Report.csv"]);
    assert.deepEqual(listFilesForUser(userId, { status: "ready" }).map((f) => f.name), ["Alpha Report.csv"]);
    assert.deepEqual(listFilesForUser(userId, { status: "needs_review" }).map((f) => f.name), ["beta.tsv"]);
    const listed = listFilesForUser(userId, { status: "ready" })[0];
    assert.equal(listed.approvedByName, "Maria Rossi");
    assert.ok(listed.changeCount > 0);
    assert.equal(listed.pendingCount, 0);
  });

  it("pages and filters a file's changes", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    const all = listChanges(fileId, { filter: "all", limit: 5 });
    assert.equal(all.total, changeCount(fileId));
    assert.equal(all.items.length, 5);
    assert.ok(all.items.every((c, i, arr) => i === 0 || arr[i - 1].rowIndex <= c.rowIndex));
    assert.equal(all.items[0].rowNumber, all.items[0].rowIndex + 2);

    const page2 = listChanges(fileId, { filter: "all", limit: 5, offset: 5 });
    assert.notEqual(page2.items[0].id, all.items[0].id);

    assert.equal(listChanges(fileId, { filter: "ai" }).total, 0);
    assert.equal(listChanges(fileId, { filter: "pending" }).total, 0);
    assert.equal(listChanges(fileId, { filter: "rule" }).total, all.total);
    assert.equal(listChanges(fileId, { filter: "all", limit: 100000 }).items.length, Math.min(all.total, 500));
  });

  it("shows who decided a change", async () => {
    const userId = newUser("Ana Silva");
    const { fileId } = await uploadAndClean(userId);
    const id = (db().prepare("SELECT id FROM changes WHERE file_id = ? AND source = 'rule' AND decision = 'approved' LIMIT 1").get(fileId) as { id: number }).id;
    setDecision(userId, fileId, [id], "skipped");
    const item = listChanges(fileId, { filter: "all", limit: 500 }).items.find((c) => c.id === id);
    assert.equal(item?.decision, "skipped");
    assert.equal(item?.decidedByName, "Ana Silva");
  });

  it("returns the audit trail oldest first, with actor names", async () => {
    const userId = newUser("Jo Park");
    const { fileId } = await uploadAndClean(userId);
    setDecision(userId, fileId, [(db().prepare("SELECT id FROM changes WHERE file_id = ? LIMIT 1").get(fileId) as { id: number }).id], "skipped");
    const activity = fileActivity(fileId);
    assert.equal(activity[0].action, "file.uploaded");
    assert.equal(activity[0].actorName, "Jo Park");
    const times = activity.map((a) => a.at);
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  it("summarizes changes for a report, with rows in from the row count", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    const { summary, changes } = summaryForReport(fileId);
    assert.equal(changes.length, changeCount(fileId));
    assert.equal(summary.rowsOut + summary.rowsRemoved, 41, "rows in = rows out + rows removed");
    assert.equal(summary.rowsRemoved, 1, "one duplicate merged");
    assert.equal(summary.rowsOut, 40);
    assert.ok(summary.byColumn.length > 0);
    assert.equal(allChanges(fileId).changes.length, changes.length);
  });

  it("creates uploads only for the user's own rows", async () => {
    const userId = newUser();
    const { fileId } = await createUpload(userId, { name: "x.csv", bytes: new TextEncoder().encode("a\n1\n") });
    assert.equal(getFileForUser(newUser(), fileId), null);
  });
});
