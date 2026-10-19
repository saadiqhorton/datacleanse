import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv } from "../testing";
import { comparisonExport } from "./export";
import { getComparisonForUser, listComparisonsForUser, parseStoredResult } from "./repo";
import { runComparison } from "./run";
import { LEFT_CSV, RIGHT_CSV, addFile, newUser } from "./test-support";
import { exportFileName, pageOf, parsePage, parseTab, tabCount } from "./view";
import { db } from "../db";

before(() => {
  setupTestEnv();
});

describe("saved comparisons", () => {
  it("lists the owner's comparisons newest first with counts from the stored result", async () => {
    const owner = newUser();
    const other = newUser();
    const left = await addFile(owner, "customers_sept.csv", LEFT_CSV);
    const right = await addFile(owner, "customers_oct.csv", RIGHT_CSV);
    const first = await runComparison(owner, { leftId: left, rightId: right, useCleaned: false });
    // Make the first one clearly older, so the second is newer.
    db().prepare("UPDATE compares SET created_at = created_at - 1000 WHERE id = ?").run(first);
    const second = await runComparison(owner, { leftId: right, rightId: left, useCleaned: false });
    await runComparison(other, {
      leftId: await addFile(other, "x.csv", LEFT_CSV),
      rightId: await addFile(other, "y.csv", RIGHT_CSV),
      useCleaned: false,
    });

    const list = listComparisonsForUser(owner);
    assert.deepEqual(list.map((c) => c.id), [second, first]);
    assert.deepEqual(
      { leftName: list[1].leftName, rightName: list[1].rightName, added: list[1].added, removed: list[1].removed, changed: list[1].changed, unchanged: list[1].unchanged, keyUnique: list[1].keyUnique },
      { leftName: "customers_sept.csv", rightName: "customers_oct.csv", added: 1, removed: 1, changed: 1, unchanged: 1, keyUnique: true },
    );
    assert.equal(listComparisonsForUser(other).length, 1);
    assert.equal(listComparisonsForUser(owner, 1).length, 1);
  });

  it("returns null for another user's comparison and for a bad id", async () => {
    const owner = newUser();
    const stranger = newUser();
    const id = await runComparison(owner, {
      leftId: await addFile(owner, "a.csv", LEFT_CSV),
      rightId: await addFile(owner, "b.csv", RIGHT_CSV),
      useCleaned: false,
    });
    assert.equal(getComparisonForUser(stranger, id), null);
    assert.equal(getComparisonForUser(owner, "not a valid id"), null);
    assert.equal(getComparisonForUser(owner, "cmp_missing"), null);
  });

  it("round-trips the stored result, and the export is an attachment-ready CSV", async () => {
    const owner = newUser();
    const id = await runComparison(owner, {
      leftId: await addFile(owner, "customers_sept.csv", LEFT_CSV),
      rightId: await addFile(owner, "customers_oct.csv", RIGHT_CSV),
      useCleaned: false,
    });
    const record = getComparisonForUser(owner, id);
    assert.ok(record?.result);
    assert.deepEqual(parseStoredResult(JSON.stringify(record.result)), record.result);

    const exported = comparisonExport(owner, id);
    assert.equal(exported.filename, "customers_sept_vs_customers_oct.diff.csv");
    assert.ok(exported.text.startsWith("﻿change_type,key,column,before,after\r\n"));
    assert.match(exported.text, /\r\nchanged,jane@acme\.io,plan,starter,team\r\n/);
    assert.match(exported.text, /\r\nremoved,old@acme\.io,email,old@acme\.io,\r\n/);

    assert.throws(() => comparisonExport(newUser(), id), (err: unknown) => err instanceof Error && /not found/i.test(err.message));
  });

  it("treats a stored result that is not shaped like a comparison as unreadable", () => {
    assert.equal(parseStoredResult(null), null);
    assert.equal(parseStoredResult("{not json"), null);
    assert.equal(parseStoredResult(JSON.stringify({ leftName: "a" })), null);
  });
});

describe("view helpers", () => {
  it("parses tab and page query values safely", () => {
    assert.equal(parseTab(undefined), "changed");
    assert.equal(parseTab("removed"), "removed");
    assert.equal(parseTab(["added", "removed"]), "added");
    assert.equal(parseTab("drop table"), "changed");
    assert.equal(parsePage("3"), 3);
    assert.equal(parsePage("0"), 1);
    assert.equal(parsePage("-4"), 1);
    assert.equal(parsePage("abc"), 1);
    assert.equal(parsePage(undefined), 1);
  });

  it("pages entries 50 at a time and clamps past-the-end pages", () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    const second = pageOf(items, 2);
    assert.equal(second.items.length, 50);
    assert.equal(second.items[0], 50);
    assert.deepEqual([second.from, second.to, second.total, second.pageCount], [51, 100, 120, 3]);
    const last = pageOf(items, 9);
    assert.equal(last.page, 3);
    assert.deepEqual([last.from, last.to], [101, 120]);
    const none = pageOf([], 1);
    assert.deepEqual([none.page, none.pageCount, none.from, none.to], [1, 1, 0, 0]);
  });

  it("names the export file from both file names", () => {
    assert.equal(exportFileName("a b.csv", "c/d.tsv"), "a b_vs_c_d.diff.csv");
  });

  it("reports row counts per tab", async () => {
    const owner = newUser();
    const id = await runComparison(owner, {
      leftId: await addFile(owner, "a.csv", LEFT_CSV),
      rightId: await addFile(owner, "b.csv", RIGHT_CSV),
      useCleaned: false,
    });
    const result = getComparisonForUser(owner, id)?.result;
    assert.ok(result);
    assert.deepEqual(["changed", "added", "removed"].map((t) => tabCount(result, t as "changed")), [1, 1, 1]);
  });
});
