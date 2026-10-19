import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, type DB } from "../db";
import { insertTestUser, setupTestEnv } from "../testing";
import type { FileProfileData } from "../types";
import {
  aiSampleRowCount,
  bucketOf,
  clampPage,
  confidencePercent,
  filterCount,
  firstParam,
  mergeLabel,
  pageCount,
  pageSpan,
  parseFilter,
  parsePage,
  piiColumnNames,
  reviewHref,
  reviewTotals,
  retentionLabel,
  rowLabel,
  ruleActionOf,
  tallyTotals,
  pluralize,
  type ChangeTally,
} from "./review-view";

let conn: DB;

before(() => {
  ({ db: conn } = setupTestEnv());
});

const HOUR = 60 * 60 * 1000;

function tally(over: Partial<ChangeTally> & { n: number }): ChangeTally {
  return { kind: "value", source: "rule", ruleId: "trim_whitespace", decision: "approved", ...over };
}

describe("ruleActionOf", () => {
  it("finds the action in built-in, numbered and saved rule ids", () => {
    assert.equal(ruleActionOf("normalize_date"), "normalize_date");
    assert.equal(ruleActionOf("trim_whitespace_2"), "trim_whitespace");
    assert.equal(ruleActionOf("builtin:normalize_date:signup_date"), "normalize_date");
    assert.equal(ruleActionOf("phone_e164:rule_x"), "phone_e164");
    assert.equal(ruleActionOf("title_case"), "title_case");
  });

  it("returns null for ai, empty and unknown ids", () => {
    assert.equal(ruleActionOf("ai"), null);
    assert.equal(ruleActionOf(""), null);
    assert.equal(ruleActionOf(null), null);
    assert.equal(ruleActionOf("builtin:made_up"), null);
  });
});

describe("bucketOf", () => {
  it("puts date normalization, merges and text fixes on their stat cards", () => {
    assert.equal(bucketOf({ kind: "value", source: "rule", ruleId: "builtin:normalize_date:signup_date" }), "dates");
    assert.equal(bucketOf({ kind: "merge", source: "rule", ruleId: "dedupe_key" }), "duplicates");
    assert.equal(bucketOf({ kind: "merge", source: "ai", ruleId: "ai" }), "duplicates");
    for (const id of ["trim_whitespace", "title_case", "lowercase", "phone_e164", "country_names", "map_values", "fix_typos"]) {
      assert.equal(bucketOf({ kind: "value", source: "rule", ruleId: id }), "text", id);
    }
  });

  it("keeps AI value changes, flags and unknown rules out of the stat cards", () => {
    assert.equal(bucketOf({ kind: "value", source: "ai", ruleId: "ai" }), "other");
    assert.equal(bucketOf({ kind: "value", source: "ai", ruleId: "normalize_date" }), "other");
    assert.equal(bucketOf({ kind: "flag", source: "rule", ruleId: "flag_missing" }), "other");
    assert.equal(bucketOf({ kind: "value", source: "rule", ruleId: "builtin:made_up" }), "other");
  });
});

describe("tallyTotals", () => {
  it("counts every change for the total and pills, and only approved edits for the cards", () => {
    const totals = tallyTotals([
      tally({ n: 3, ruleId: "builtin:normalize_date:signup_date" }),
      tally({ n: 2, ruleId: "builtin:normalize_date:signup_date", decision: "skipped" }),
      tally({ n: 4, ruleId: "trim_whitespace" }),
      tally({ n: 1, kind: "merge", ruleId: "dedupe_key" }),
      tally({ n: 5, kind: "flag", ruleId: "flag_missing", decision: "approved" }),
      tally({ n: 6, source: "ai", ruleId: "ai", decision: "pending" }),
      tally({ n: 2, source: "ai", ruleId: "ai", decision: "approved" }),
      tally({ n: 1, source: "ai", ruleId: "ai", decision: "skipped" }),
    ]);

    assert.equal(totals.total, 3 + 2 + 4 + 1 + 5 + 6 + 2 + 1);
    assert.equal(totals.pending, 6);
    assert.equal(totals.approved, 3 + 4 + 1 + 5 + 2);
    assert.equal(totals.skipped, 2 + 1);
    assert.equal(totals.rule, 3 + 2 + 4 + 1 + 5);
    assert.equal(totals.ai, 6 + 2 + 1);
    assert.equal(totals.aiOpen, 6 + 2);

    // Flags are approved but never edits; AI approvals are edits but have no card.
    assert.equal(totals.approvedEdits, 3 + 4 + 1 + 2);
    assert.deepEqual(totals.buckets, { dates: 3, duplicates: 1, text: 4 });
  });

  it("is all zeros for a file with no changes", () => {
    const totals = tallyTotals([]);
    assert.equal(totals.total, 0);
    assert.equal(totals.approvedEdits, 0);
    assert.deepEqual(totals.buckets, { dates: 0, duplicates: 0, text: 0 });
  });

  it("reads filter pill counts from the totals", () => {
    const totals = tallyTotals([tally({ n: 2 }), tally({ n: 1, source: "ai", ruleId: "ai", decision: "pending" })]);
    assert.equal(filterCount(totals, "all"), 3);
    assert.equal(filterCount(totals, "pending"), 1);
    assert.equal(filterCount(totals, "rule"), 2);
    assert.equal(filterCount(totals, "ai"), 1);
  });
});

describe("reviewTotals (database)", () => {
  it("groups the file's changes and leaves other files out", () => {
    const userId = insertTestUser(conn, "usr_viewtotals", "viewtotals@example.com");
    const now = Date.now();
    const insertFile = (id: string) =>
      db()
        .prepare(
          "INSERT INTO files (id, user_id, original_name, alias, size_bytes, status, created_at, expires_at) VALUES (?, ?, ?, ?, 10, 'needs_review', ?, ?)",
        )
        .run(id, userId, `${id}.csv`, id, now, now + 24 * HOUR);
    insertFile("file_viewtotals1");
    insertFile("file_viewtotals2");

    const insertChange = (fileId: string, row: number, f: Partial<ChangeTally> & { ruleId: string; source: "rule" | "ai" }) =>
      db()
        .prepare(
          `INSERT INTO changes (file_id, row_index, column_name, kind, before, after, source, rule_id, reason, confidence, decision)
           VALUES (?, ?, 'c', ?, 'a', 'b', ?, ?, 'test', 0.5, ?)`,
        )
        .run(fileId, row, f.kind ?? "value", f.source, f.ruleId, f.decision ?? "approved");

    insertChange("file_viewtotals1", 0, { ruleId: "builtin:normalize_date:signup_date", source: "rule" });
    insertChange("file_viewtotals1", 1, { ruleId: "trim_whitespace", source: "rule" });
    insertChange("file_viewtotals1", 2, { ruleId: "ai", source: "ai", decision: "pending" });
    insertChange("file_viewtotals1", 3, { ruleId: "flag_missing", source: "rule", kind: "flag" });
    insertChange("file_viewtotals2", 0, { ruleId: "trim_whitespace", source: "rule" });

    const totals = reviewTotals("file_viewtotals1");
    assert.equal(totals.total, 4);
    assert.equal(totals.pending, 1);
    assert.equal(totals.aiOpen, 1);
    assert.equal(totals.approvedEdits, 2);
    assert.deepEqual(totals.buckets, { dates: 1, duplicates: 0, text: 1 });
  });
});

describe("filters and paging", () => {
  it("parses ?filter= and falls back to all", () => {
    assert.equal(parseFilter("pending"), "pending");
    assert.equal(parseFilter("ai"), "ai");
    assert.equal(parseFilter("rule"), "rule");
    assert.equal(parseFilter("bogus"), "all");
    assert.equal(parseFilter(undefined), "all");
    assert.equal(parseFilter(["ai", "rule"]), "ai");
  });

  it("parses ?page= as a whole number from 1", () => {
    assert.equal(parsePage("3"), 3);
    assert.equal(parsePage("0"), 1);
    assert.equal(parsePage("-2"), 1);
    assert.equal(parsePage("2.5"), 1);
    assert.equal(parsePage("abc"), 1);
    assert.equal(parsePage(undefined), 1);
    assert.equal(parsePage("99999999999"), 1);
    assert.equal(firstParam(["4", "5"]), "4");
  });

  it("works out page counts, clamping and spans for 50 per page", () => {
    assert.equal(pageCount(0), 1);
    assert.equal(pageCount(50), 1);
    assert.equal(pageCount(51), 2);
    assert.equal(pageCount(214), 5);
    assert.equal(clampPage(9, 214), 5);
    assert.equal(clampPage(0, 214), 1);
    assert.equal(clampPage(2, 214), 2);
    assert.deepEqual(pageSpan(1, 214), { from: 1, to: 50 });
    assert.deepEqual(pageSpan(5, 214), { from: 201, to: 214 });
    assert.deepEqual(pageSpan(1, 0), { from: 0, to: 0 });
  });

  it("builds links that keep the filter and leave defaults out", () => {
    assert.equal(reviewHref("file_abc123", {}), "/review/file_abc123");
    assert.equal(reviewHref("file_abc123", { filter: "all", page: 1 }), "/review/file_abc123");
    assert.equal(reviewHref("file_abc123", { filter: "ai" }), "/review/file_abc123?filter=ai");
    assert.equal(reviewHref("file_abc123", { filter: "pending", page: 2 }), "/review/file_abc123?filter=pending&page=2");
    assert.throws(() => reviewHref("../etc", {}));
  });
});

describe("labels and copy", () => {
  it("shows rows 1-based, as the design does", () => {
    assert.equal(rowLabel(117, "signup_date"), "#118 · signup_date");
    assert.equal(rowLabel(0, null), "#1");
    assert.equal(mergeLabel(86, 401), "#87 + #402");
    assert.equal(mergeLabel(86, null), "#87");
  });

  it("rounds confidence to a whole percent and clamps it", () => {
    assert.equal(confidencePercent(0.72), 72);
    assert.equal(confidencePercent(0.815), 82);
    assert.equal(confidencePercent(1.4), 100);
    assert.equal(confidencePercent(null), null);
    assert.equal(confidencePercent(Number.NaN), null);
  });

  it("describes retention from the file's own created and expiry times", () => {
    const t0 = 1_000_000_000_000;
    assert.equal(retentionLabel(t0, t0 + 24 * HOUR), "24 hours");
    assert.equal(retentionLabel(t0, t0 + HOUR), "1 hour");
    assert.equal(retentionLabel(t0, t0 + 168 * HOUR), "7 days");
    assert.equal(retentionLabel(t0, t0 + 24 * HOUR - 1000), "24 hours");
  });

  it("lists PII columns in file order and counts the AI sample", () => {
    const profile = {
      rowCount: 3,
      columnCount: 3,
      delimiter: ",",
      encoding: "utf-8",
      columns: [
        { name: "email", pii: true },
        { name: "amount", pii: false },
        { name: "phone", pii: true },
      ],
      sample: Array.from({ length: 25 }, () => ({})),
    } as unknown as FileProfileData;
    assert.deepEqual(piiColumnNames(profile), ["email", "phone"]);
    assert.deepEqual(piiColumnNames(null), []);
    assert.equal(aiSampleRowCount(profile), 20);
    assert.equal(aiSampleRowCount(null), 20);
  });

  it("pluralizes simply", () => {
    assert.equal(pluralize(1, "change"), "1 change");
    assert.equal(pluralize(214, "change"), "214 changes");
    assert.equal(pluralize(0, "change"), "0 changes");
  });
});
