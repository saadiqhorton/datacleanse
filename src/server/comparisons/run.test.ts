import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareTables } from "../compare";
import { db } from "../db";
import { setupTestEnv } from "../testing";
import { CompareError } from "./errors";
import { loadComparisonInput, ownedFile } from "./inputs";
import { getComparisonForUser } from "./repo";
import { runComparison, sharedColumns } from "./run";
import { LEFT_CLEANED_CSV, LEFT_CSV, RIGHT_CSV, addFile, newUser } from "./test-support";

before(() => {
  setupTestEnv();
});

async function expectCompareError(promise: Promise<unknown>, code: string, pattern?: RegExp) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof CompareError, `expected CompareError, got ${String(err)}`);
    assert.equal(err.code, code);
    if (pattern) assert.match(err.message, pattern);
    return true;
  });
}

describe("runComparison", () => {
  it("compares two owned files, stores the result and reads it back", async () => {
    const owner = newUser();
    const left = await addFile(owner, "customers_sept.csv", LEFT_CSV);
    const right = await addFile(owner, "customers_oct.csv", RIGHT_CSV);

    const id = await runComparison(owner, { leftId: left, rightId: right, useCleaned: true });
    const record = getComparisonForUser(owner, id);
    assert.ok(record);
    assert.deepEqual(record.keyColumns, ["email"]);
    assert.equal(record.leftFileId, left);
    assert.equal(record.rightFileId, right);
    assert.ok(record.result);

    const expected = compareTables(
      { headers: ["email", "plan", "city"], rows: [["jane@acme.io", "starter", "Seoul"], ["bob@acme.io", "team", "Rome"], ["old@acme.io", "team", "Paris"]] },
      { headers: ["email", "plan", "city", "lifetime"], rows: [["jane@acme.io", "team", "Busan", "10"], ["bob@acme.io", "team", "Rome", "5"], ["new@acme.io", "starter", "Oslo", "1"]] },
      { leftName: "customers_sept.csv", rightName: "customers_oct.csv" },
    );
    assert.deepEqual(record.result, expected);
    assert.deepEqual(record.result.counts, { added: 1, removed: 1, changed: 1, unchanged: 1 });
    assert.deepEqual(record.result.columns.added, ["lifetime"]);

    const job = db().prepare("SELECT type, status FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(owner) as { type: string; status: string };
    assert.deepEqual(job, { type: "compare", status: "done" });
  });

  it("uses the cleaned copy when asked and present, the original otherwise", async () => {
    const owner = newUser();
    const left = await addFile(owner, "a.csv", LEFT_CSV, { cleaned: LEFT_CLEANED_CSV });
    const right = await addFile(owner, "b.csv", RIGHT_CSV);

    const cleanedInput = await loadComparisonInput(owner, left, true);
    assert.equal(cleanedInput.source, "cleaned");
    assert.equal(cleanedInput.table.rows[0][1], "team");

    const originalInput = await loadComparisonInput(owner, left, false);
    assert.equal(originalInput.source, "original");
    assert.equal(originalInput.table.rows[0][1], "starter");

    const id = await runComparison(owner, { leftId: left, rightId: right, useCleaned: true });
    const result = getComparisonForUser(owner, id)?.result;
    assert.ok(result);
    // With the cleaned copy the plan already matches, so only the city differs for jane.
    assert.deepEqual(result.changed.map((c) => c.column), ["city"]);
  });

  it("falls back to the original when the cleaned copy is missing on disk", async () => {
    const owner = newUser();
    const left = await addFile(owner, "a.csv", LEFT_CSV, { cleaned: LEFT_CLEANED_CSV, cleanedOnDisk: false });
    const input = await loadComparisonInput(owner, left, true);
    assert.equal(input.source, "original");
  });

  it("matches rows on an explicit key column that both files share", async () => {
    const owner = newUser();
    const left = await addFile(owner, "a.csv", "id,name\n1,Ann\n2,Ben\n");
    const right = await addFile(owner, "b.csv", "name,id\nAnn,1\nBen,3\n");
    const id = await runComparison(owner, { leftId: left, rightId: right, useCleaned: false, keyColumn: "id" });
    const record = getComparisonForUser(owner, id);
    assert.deepEqual(record?.keyColumns, ["id"]);
    assert.equal(record?.result?.counts.removed, 1);
    assert.equal(record?.result?.counts.added, 1);
  });

  it("rejects a key column that is not in both files, and records the job as blocked", async () => {
    const owner = newUser();
    const left = await addFile(owner, "a.csv", LEFT_CSV);
    const right = await addFile(owner, "b.csv", RIGHT_CSV);
    await expectCompareError(
      runComparison(owner, { leftId: left, rightId: right, useCleaned: false, keyColumn: "lifetime" }),
      "invalid",
      /"lifetime" is not a column both files share/,
    );
    const job = db().prepare("SELECT status FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(owner) as { status: string };
    assert.equal(job.status, "blocked");
    const count = db().prepare("SELECT COUNT(*) AS n FROM compares WHERE user_id = ?").get(owner) as { n: number };
    assert.equal(count.n, 0);
  });

  it("treats an empty key as auto-detect", async () => {
    const owner = newUser();
    const left = await addFile(owner, "a.csv", LEFT_CSV);
    const right = await addFile(owner, "b.csv", RIGHT_CSV);
    const id = await runComparison(owner, { leftId: left, rightId: right, useCleaned: false, keyColumn: "  " });
    assert.deepEqual(getComparisonForUser(owner, id)?.keyColumns, ["email"]);
  });

  it("will not compare another user's file, and says it is not found", async () => {
    const owner = newUser();
    const stranger = newUser();
    const mine = await addFile(owner, "mine.csv", LEFT_CSV);
    const theirs = await addFile(stranger, "theirs.csv", RIGHT_CSV);
    await expectCompareError(runComparison(owner, { leftId: mine, rightId: theirs, useCleaned: false }), "not_found");
    await expectCompareError(runComparison(owner, { leftId: "file_nope", rightId: mine, useCleaned: false }), "not_found");
    assert.throws(() => ownedFile(owner, theirs), /File not found/);
  });

  it("refuses the same file twice and deleted files", async () => {
    const owner = newUser();
    const file = await addFile(owner, "a.csv", LEFT_CSV);
    await expectCompareError(runComparison(owner, { leftId: file, rightId: file, useCleaned: false }), "invalid", /different files/);

    const gone = await addFile(owner, "gone.csv", RIGHT_CSV);
    db().prepare("UPDATE files SET status = 'deleted', storage_path = NULL, cleaned_path = NULL, deleted_at = ? WHERE id = ?").run(Date.now(), gone);
    await expectCompareError(runComparison(owner, { leftId: file, rightId: gone, useCleaned: false }), "gone", /was deleted/);
  });
});

describe("sharedColumns", () => {
  it("lists the headers both files share, in the left file's order", async () => {
    const owner = newUser();
    const left = await addFile(owner, "a.csv", LEFT_CSV);
    const right = await addFile(owner, "b.csv", RIGHT_CSV);
    assert.deepEqual(await sharedColumns(owner, left, right, false), ["email", "plan", "city"]);
    await expectCompareError(sharedColumns(owner, left, "file_missing", false), "not_found");
  });
});
