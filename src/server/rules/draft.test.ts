import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { insertTestUser, setupTestEnv } from "../testing";
import type { DB } from "../db";
import type { RuleSpec } from "../types";
import { draftRuleForUser, previewOnFile } from "./draft";

let conn: DB;
let dataDir: string;
const ALICE = "usr_alice";
const savedProvider = process.env.AI_PROVIDER;

beforeEach(() => {
  const env = setupTestEnv();
  conn = env.db;
  dataDir = env.dataDir;
  insertTestUser(conn, ALICE, "alice@northwind.co");
});

afterEach(() => {
  if (savedProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = savedProvider;
});

const trim: RuleSpec = {
  id: "draft",
  columnPattern: "*",
  action: "trim_whitespace",
  params: {},
  onLowConfidence: "apply",
  enabled: true,
  description: "Trim",
};

/** Writes a CSV where the stored path points, the way uploads do. Returns the relative storage path. */
function writeOriginal(fileId: string, csv: string): string {
  const relative = path.join("files", ALICE, fileId, "original.csv");
  fs.mkdirSync(path.dirname(path.join(dataDir, relative)), { recursive: true });
  fs.writeFileSync(path.join(dataDir, relative), csv);
  return relative;
}

describe("previewOnFile", () => {
  it("reports 'no file' when the user has no profiled file", async () => {
    assert.deepEqual(await previewOnFile(null, trim), { kind: "no_file" });
  });

  it("counts the cells a rule would change in the file's original CSV", async () => {
    const storagePath = writeOriginal("file_1", "name,country\n  Ann ,US\nBob,FR\n");
    const preview = await previewOnFile({ name: "contacts.csv", storagePath }, trim);
    assert.deepEqual(preview, { kind: "matches", matches: 1, fileName: "contacts.csv" });
  });

  it("says why it cannot preview when the file is missing from disk", async () => {
    const preview = await previewOnFile({ name: "gone.csv", storagePath: "files/nobody/none/original.csv" }, trim);
    assert.equal(preview.kind, "unavailable");
    if (preview.kind === "unavailable") assert.equal(preview.reason, "The file could not be read.");
  });

  it("never reads a path outside the data directory", async () => {
    const preview = await previewOnFile({ name: "x.csv", storagePath: "../../../../etc/passwd" }, trim);
    assert.equal(preview.kind, "unavailable");
    if (preview.kind === "unavailable") assert.match(preview.reason, /could not be found/);
  });

  it("explains a file that is not usable CSV", async () => {
    const storagePath = writeOriginal("file_empty", "");
    const preview = await previewOnFile({ name: "empty.csv", storagePath }, trim);
    assert.deepEqual(preview, { kind: "unavailable", fileName: "empty.csv", reason: "This file is empty." });
  });
});

describe("draftRuleForUser", () => {
  it("says AI is off, without calling any provider, when the person has turned it off", async () => {
    conn
      .prepare("INSERT INTO user_settings (user_id, ai_mode, updated_at) VALUES (?, 'off', ?)")
      .run(ALICE, Date.now());
    assert.deepEqual(await draftRuleForUser(ALICE, "Country should be the full English name"), {
      ok: false,
      error: "AI is off. Add the rule manually below.",
    });
  });

  it("says AI is off when the instance has no provider configured", async () => {
    process.env.AI_PROVIDER = "off";
    assert.deepEqual(await draftRuleForUser(ALICE, "Trim everything"), {
      ok: false,
      error: "AI is off. Add the rule manually below.",
    });
  });
});
