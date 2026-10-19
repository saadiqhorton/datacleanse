import { afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { setInstanceAIConfig } from "../ai";
import { env } from "../env";
import { db, type DB } from "../db";
import { insertTestUser, setupTestEnv } from "../testing";
import { FileError } from "./errors";
import { getFileForUser } from "./repo";
import { retryAi, retryFile, aliasFromName, createUpload, sanitizeFileName, uniqueAlias, validateOptionsInput } from "./upload";
import { absoluteDataPath, fileDirRel, originalRel, storedFileExists } from "./storage";
import { auditRows, crmCsv, fileRow, jobRow, uploadAndClean } from "./test-support";

let conn: DB;
let counter = 0;

before(() => {
  ({ db: conn } = setupTestEnv());
  setInstanceAIConfig({ provider: "off" }, null);
});

afterEach(() => {
  delete process.env.MAX_UPLOAD_MB;
});

function newUser(): string {
  counter++;
  return insertTestUser(conn, `usr_up${counter}xyz`, `up${counter}@example.com`);
}

function fileCount(userId: string): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM files WHERE user_id = ?").get(userId) as { n: number }).n;
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function expectFileError(fn: () => unknown, code: string) {
  assert.throws(fn, (e: unknown) => e instanceof FileError && e.code === code);
}

describe("naming and aliases", () => {
  it("keeps only the last path segment and the supported extension", () => {
    assert.equal(sanitizeFileName("C:\\fakepath\\Q3 data.CSV"), "Q3 data.CSV");
    assert.equal(sanitizeFileName("../../etc/crm.tsv"), "crm.tsv");
    assert.equal(sanitizeFileName("notes.txt"), "notes.txt");
    assert.equal(sanitizeFileName("bad\u0000name.csv"), "badname.csv");
    expectFileError(() => sanitizeFileName("payload.exe"), "unsupported");
    expectFileError(() => sanitizeFileName("archive.csv.zip"), "unsupported");
  });

  it("caps the display name at 200 characters, extension included", () => {
    const name = sanitizeFileName(`${"a".repeat(300)}.csv`);
    assert.equal(name.length, 200);
    assert.ok(name.endsWith(".csv"));
  });

  it("makes a snake_case SQL alias and suffixes clashes", () => {
    assert.equal(aliasFromName("CRM Export (Q3).csv"), "crm_export_q3");
    assert.equal(aliasFromName("2026 sales.tsv"), "f_2026_sales");
    assert.equal(aliasFromName("Café.txt"), "cafe");
    assert.equal(aliasFromName("!!!.csv"), "file");
    const taken = new Set(["crm_export_q3"]);
    assert.equal(uniqueAlias("crm_export_q3", taken), "crm_export_q3_2");
    taken.add("crm_export_q3_2");
    assert.equal(uniqueAlias("crm_export_q3", taken), "crm_export_q3_3");
    const long = uniqueAlias("x".repeat(63), new Set(["x".repeat(63)]));
    assert.match(long, /^[a-z_][a-z0-9_]{0,62}$/);
    assert.equal(long.length, 63);
  });

  it("validates options strictly", () => {
    assert.deepEqual(validateOptionsInput({ dedupe: false }).dedupe, false);
    expectFileError(() => validateOptionsInput({ dedupe: "yes" as unknown as boolean }), "invalid");
    expectFileError(() => validateOptionsInput({ bogus: true } as never), "invalid");
    expectFileError(() => validateOptionsInput({ dateOrder: "ymd" as never }), "invalid");
  });
});

describe("createUpload", () => {
  it("stores the original, a files row with its settings, the audit entry, and a queued clean job", async () => {
    const userId = newUser();
    const text = crmCsv(5);
    const { fileId, jobId } = await createUpload(userId, { name: "crm_export_q3.csv", bytes: bytes(text) });

    const row = fileRow(fileId);
    assert.equal(row.status, "processing");
    assert.equal(row.original_name, "crm_export_q3.csv");
    assert.equal(row.alias, "crm_export_q3");
    assert.equal(row.size_bytes, Buffer.byteLength(text));
    assert.equal(row.storage_path, originalRel(userId, fileId));
    assert.equal(row.mode, "rules_ai");
    assert.equal(row.ai_status, "none");
    const retentionMs = row.expires_at - row.created_at;
    assert.equal(retentionMs, 24 * 60 * 60 * 1000, "default retention is 24 hours");
    assert.equal(readBack(fileId), text);
    assert.equal(existsSync(absoluteDataPath(fileDirRel(userId, fileId) + "/original.csv")), true);

    const job = jobRow(jobId);
    assert.equal(job.status, "queued");
    assert.equal(JSON.parse(job.meta_json).fileCount, 1);
    assert.deepEqual(auditRows(fileId), [{ action: "file.uploaded", detail: "Uploaded" }]);
  });

  it("uses the user's default mode and retention", async () => {
    const userId = newUser();
    db()
      .prepare("INSERT INTO user_settings (user_id, retention_hours, default_mode, updated_at) VALUES (?, 168, 'rules_only', ?)")
      .run(userId, Date.now());
    const { fileId } = await createUpload(userId, { name: "a.csv", bytes: bytes("a,b\n1,2\n") });
    const row = fileRow(fileId);
    assert.equal(row.mode, "rules_only");
    assert.equal(row.expires_at - row.created_at, 7 * 24 * 60 * 60 * 1000);
  });

  it("gives each file a unique alias per user", async () => {
    const userId = newUser();
    const a = await createUpload(userId, { name: "crm export.csv", bytes: bytes("a\n1\n") });
    const b = await createUpload(userId, { name: "CRM-export.csv", bytes: bytes("a\n2\n") });
    assert.equal(fileRow(a.fileId).alias, "crm_export");
    assert.equal(fileRow(b.fileId).alias, "crm_export_2");
    const other = await createUpload(newUser(), { name: "crm export.csv", bytes: bytes("a\n1\n") });
    assert.equal(fileRow(other.fileId).alias, "crm_export", "aliases are per user");
  });

  it("refuses a bad extension without creating anything", async () => {
    const userId = newUser();
    await assert.rejects(createUpload(userId, { name: "run.exe", bytes: bytes("MZ") }), (e: unknown) => e instanceof FileError && e.code === "unsupported");
    assert.equal(fileCount(userId), 0);
  });

  it("refuses an upload over the size limit and leaves no copy on disk", async () => {
    process.env.MAX_UPLOAD_MB = "0.0001";
    const userId = newUser();
    await assert.rejects(
      createUpload(userId, { name: "big.csv", bytes: bytes("x".repeat(env.maxUploadBytes + 1)) }),
      (e: unknown) => e instanceof FileError && e.code === "too_large",
    );
    assert.equal(fileCount(userId), 0);
    assert.equal(existsSync(absoluteDataPath(fileDirRel(userId, "file_none0000000"))), false);
  });

  it("enforces the limit while streaming and removes the partial file", async () => {
    process.env.MAX_UPLOAD_MB = "0.0001";
    const userId = newUser();
    const chunk = new Uint8Array(40);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
        if (++pulled >= 20) controller.close();
      },
    });
    let pulled = 0;
    await assert.rejects(
      createUpload(userId, { name: "stream.csv", bytes: stream }),
      (e: unknown) => e instanceof FileError && e.code === "too_large",
    );
    assert.equal(fileCount(userId), 0);
  });

  it("accepts a stream within the limit", async () => {
    const userId = newUser();
    const parts = [bytes("customer_id,name\n"), bytes("1,Ana\n")];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const p of parts) controller.enqueue(p);
        controller.close();
      },
    });
    const { fileId } = await createUpload(userId, { name: "streamed.csv", bytes: stream });
    assert.equal(fileRow(fileId).size_bytes, parts.reduce((n, p) => n + p.length, 0));
    assert.equal(readBack(fileId), "customer_id,name\n1,Ana\n");
  });

  it("only accepts a rule set the user owns", async () => {
    const owner = newUser();
    const stranger = newUser();
    db()
      .prepare("INSERT INTO rule_sets (id, user_id, name, header_match_json, created_at, updated_at) VALUES ('rset_owned001', ?, 'Mine', '[]', ?, ?)")
      .run(owner, Date.now(), Date.now());
    await assert.rejects(
      createUpload(stranger, { name: "a.csv", bytes: bytes("a\n1\n"), ruleSetId: "rset_owned001" }),
      (e: unknown) => e instanceof FileError && e.code === "not_found",
    );
    const ok = await createUpload(owner, { name: "a.csv", bytes: bytes("a\n1\n"), ruleSetId: "rset_owned001" });
    assert.equal(fileRow(ok.fileId).rule_set_id, "rset_owned001");
  });

  it("rejects an unknown mode", async () => {
    const userId = newUser();
    await assert.rejects(
      createUpload(userId, { name: "a.csv", bytes: bytes("a\n1\n"), mode: "magic" as never }),
      (e: unknown) => e instanceof FileError && e.code === "invalid",
    );
  });
});

describe("retry", () => {
  it("re-runs a failed file whose original is still there", async () => {
    const userId = newUser();
    const bad = Buffer.concat([Buffer.from("a,b\n1,"), Buffer.from([0xff]), Buffer.from("\n")]);
    const { fileId } = await uploadAndClean(userId, new Uint8Array(bad));
    assert.equal(fileRow(fileId).status, "failed");

    const { jobId } = await retryFile(userId, fileId);
    const row = fileRow(fileId);
    assert.equal(row.status, "processing");
    assert.equal(row.error, null);
    assert.equal(jobRow(jobId).status, "queued");
    assert.equal(auditRows(fileId).at(-1)?.action, "file.retried");
  });

  it("refuses a file that is not failed, and another user's file", async () => {
    const owner = newUser();
    const { fileId } = await uploadAndClean(owner);
    await assert.rejects(retryFile(owner, fileId), (e: unknown) => e instanceof FileError && e.code === "conflict");
    await assert.rejects(retryFile(newUser(), fileId), (e: unknown) => e instanceof FileError && e.code === "not_found");
    await assert.rejects(retryFile(owner, "not-an-id"), (e: unknown) => e instanceof FileError && e.code === "not_found");
  });

  it("says so when the original has gone", async () => {
    const userId = newUser();
    const bad = new Uint8Array(Buffer.from([0x61, 0x2c, 0x62, 0x0a, 0xff, 0x0a]));
    const { fileId } = await uploadAndClean(userId, bad);
    rmSync(absoluteDataPath(fileDirRel(userId, fileId)), { recursive: true, force: true });
    assert.equal(await storedFileExists(fileRow(fileId).storage_path), false);
    await assert.rejects(retryFile(userId, fileId), (e: unknown) => e instanceof FileError && e.code === "gone");
  });

  it("'Wait for AI' is offered only when AI was unavailable", async () => {
    const userId = newUser();
    const { fileId } = await uploadAndClean(userId);
    assert.throws(() => retryAi(userId, fileId), (e: unknown) => e instanceof FileError && e.code === "conflict");
    assert.equal(getFileForUser(userId, fileId)?.aiStatus, "skipped");
  });
});

function readBack(fileId: string): string {
  return readFileSync(absoluteDataPath(fileRow(fileId).storage_path as string), "utf8");
}
