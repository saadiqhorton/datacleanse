import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setInstanceAIConfig } from "../ai";
import { sign } from "../crypto";
import type { DB } from "../db";
import { insertTestUser, setupTestEnv } from "../testing";
import { applyFile } from "./review";
import { contentDisposition, downloadLink, prepareDownload, type PreparedDownload } from "./downloads";
import { FileError } from "./errors";
import { sweepExpiredFiles } from "./retention";
import { uploadAndClean, CRM_HEADER } from "./test-support";

let conn: DB;
let counter = 0;

before(() => {
  ({ db: conn } = setupTestEnv());
  setInstanceAIConfig({ provider: "off" }, null);
});

function newUser(): string {
  counter++;
  return insertTestUser(conn, `usr_dl${counter}xyz`, `dl${counter}@example.com`);
}

/** The token inside a download link. */
function tokenOf(link: string): string {
  return new URL(`http://x${link}`).searchParams.get("token") as string;
}

function kindOf(link: string): string {
  return new URL(`http://x${link}`).searchParams.get("kind") as string;
}

function expectOk(result: PreparedDownload) {
  assert.equal(result.ok, true, result.ok ? "" : `${result.status} ${result.error}`);
  return result as Extract<PreparedDownload, { ok: true }>;
}

describe("download links", () => {
  it("serves the cleaned file to its owner, with a 15 minute link", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    await applyFile(userId, fileId);

    const link = downloadLink(userId, fileId, "cleaned");
    assert.match(link, new RegExp(`^/api/files/${fileId}/download\\?kind=cleaned&token=`));
    const ok = expectOk(await prepareDownload(userId, fileId, kindOf(link), tokenOf(link)));
    assert.equal(ok.contentType, "text/csv; charset=utf-8");
    assert.equal(ok.filename, "crm_export_q3.cleaned.csv");
    assert.equal(ok.body.type, "file");
    if (ok.body.type !== "file") return;
    assert.equal(readFileSync(ok.body.path, "utf8").split("\r\n")[0], CRM_HEADER);
    assert.equal(ok.body.size, readFileSync(ok.body.path).length);
  });

  it("rejects a tampered token, a token for another kind, and a token for another user", async () => {
    const userId = newUser();
    const other = newUser();
    const { fileId } = await uploadAndClean(userId);
    await applyFile(userId, fileId);
    const link = downloadLink(userId, fileId, "cleaned");
    const token = tokenOf(link);

    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    assert.equal((await prepareDownload(userId, fileId, "cleaned", flipped)).ok, false);
    assert.equal((await prepareDownload(userId, fileId, "original", token)).ok, false, "kind is bound");
    assert.equal((await prepareDownload(userId, fileId, "cleaned", token.slice(0, 20))).ok, false);
    assert.equal((await prepareDownload(userId, fileId, "cleaned", null)).ok, false);

    const denied = await prepareDownload(other, fileId, "cleaned", token);
    assert.equal(denied.ok, false, "the token is bound to its user");
    if (!denied.ok) assert.equal(denied.status, 403);

    assert.throws(() => downloadLink(other, fileId, "cleaned"), (e: unknown) => e instanceof FileError && e.code === "not_found");
  });

  it("rejects an expired token", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    await applyFile(userId, fileId);
    const expired = sign(`${fileId}|cleaned|${userId}`, -1000);
    const result = await prepareDownload(userId, fileId, "cleaned", expired);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });

  it("refuses another user's file even with a valid token for that file", async () => {
    const owner = newUser();
    const other = newUser();
    const { fileId } = await uploadAndClean(owner);
    await applyFile(owner, fileId);
    const token = sign(`${fileId}|cleaned|${other}`, 60_000);
    const result = await prepareDownload(other, fileId, "cleaned", token);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it("says not ready before the changes are applied", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    const cleaned = await prepareDownload(userId, fileId, "cleaned", tokenOf(downloadLink(userId, fileId, "cleaned")));
    assert.equal(cleaned.ok, false);
    if (!cleaned.ok) assert.equal(cleaned.status, 409);
    const report = await prepareDownload(userId, fileId, "report_pdf", tokenOf(downloadLink(userId, fileId, "report_pdf")));
    assert.equal(report.ok, false);
    if (!report.ok) assert.equal(report.status, 409);
    const changes = expectOk(await prepareDownload(userId, fileId, "changes_csv", tokenOf(downloadLink(userId, fileId, "changes_csv"))));
    assert.equal(changes.filename, "crm_export_q3.changes.csv");
  });

  it("produces a PDF report and a change log with a byte order mark", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    await applyFile(userId, fileId);

    const pdf = expectOk(await prepareDownload(userId, fileId, "report_pdf", tokenOf(downloadLink(userId, fileId, "report_pdf"))));
    assert.equal(pdf.contentType, "application/pdf");
    assert.equal(pdf.filename, "crm_export_q3.report.pdf");
    assert.equal(pdf.body.type, "bytes");
    if (pdf.body.type === "bytes") assert.equal(Buffer.from(pdf.body.bytes.subarray(0, 5)).toString("latin1"), "%PDF-");

    const log = expectOk(await prepareDownload(userId, fileId, "changes_csv", tokenOf(downloadLink(userId, fileId, "changes_csv"))));
    assert.equal(log.body.type, "text");
    if (log.body.type === "text") {
      assert.ok(log.body.text.startsWith("﻿row,column,change,before,after,source,rule,reason,confidence,decision,decided_by\r\n"));
      assert.ok(log.body.text.includes("Same email"), "merge reason is in the log");
    }
  });

  it("builds Content-Disposition with an ASCII fallback and a UTF-8 name", () => {
    assert.equal(
      contentDisposition("Café report.pdf"),
      `attachment; filename="Caf_ report.pdf"; filename*=UTF-8''Caf%C3%A9%20report.pdf`,
    );
    assert.equal(contentDisposition('a"b.csv'), `attachment; filename="a_b.csv"; filename*=UTF-8''a%22b.csv`);
  });

  it("rejects an unknown kind", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    const result = await prepareDownload(userId, fileId, "everything", tokenOf(downloadLink(userId, fileId, "original")));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });
});

describe("downloads after retention", () => {
  it("returns 410 for the original and cleaned copies, but keeps the report and change log", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    await applyFile(userId, fileId);
    const original = downloadLink(userId, fileId, "original");
    const cleaned = downloadLink(userId, fileId, "cleaned");
    const report = downloadLink(userId, fileId, "report_pdf");
    const log = downloadLink(userId, fileId, "changes_csv");

    await sweepExpiredFiles(Date.now() + 3 * 24 * 60 * 60 * 1000);

    const gone = await prepareDownload(userId, fileId, "original", tokenOf(original));
    assert.equal(gone.ok, false);
    if (!gone.ok) assert.equal(gone.status, 410);
    const goneCleaned = await prepareDownload(userId, fileId, "cleaned", tokenOf(cleaned));
    assert.equal(goneCleaned.ok, false);
    if (!goneCleaned.ok) assert.equal(goneCleaned.status, 410);
    expectOk(await prepareDownload(userId, fileId, "report_pdf", tokenOf(report)));
    expectOk(await prepareDownload(userId, fileId, "changes_csv", tokenOf(log)));
  });
});
