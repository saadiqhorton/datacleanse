import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Decision, ProposedChange } from "../types";
import { changeColumn, summarizeChanges, ROWS_LABEL } from "./summary";

function value(
  rowIndex: number,
  column: string,
  ruleId: string,
  decision: Decision,
  before: string,
  after: string,
  source: "rule" | "ai" = "rule",
): ProposedChange {
  return { rowIndex, column, kind: "value", before, after, source, ruleId, reason: "", decision };
}

function merge(
  rowIndex: number,
  mergeIntoRow: number,
  decision: Decision,
  reason: string,
  ruleId = "dedupe_key",
): ProposedChange {
  return {
    rowIndex,
    column: null,
    kind: "merge",
    before: null,
    after: null,
    mergeIntoRow,
    source: "rule",
    ruleId,
    reason,
    decision,
  };
}

function flag(rowIndex: number, column: string, decision: Decision): ProposedChange {
  return { rowIndex, column, kind: "flag", before: "", after: null, source: "rule", ruleId: "flag_missing", reason: "Empty", decision };
}

/** A mixed fixture: rule and AI edits, pending and skipped items, merges and flags. */
function fixture(): ProposedChange[] {
  return [
    // signup_date: three layouts (MM/DD/YYYY, ISO, "Mon DD, YYYY"), plus "3/4/2026" which is the MM/DD layout too.
    value(0, "signup_date", "normalize_date", "approved", "03/14/2026", "2026-03-14"),
    value(1, "signup_date", "normalize_date", "approved", "2026-03-15", "2026-03-15"),
    value(2, "signup_date", "normalize_date", "approved", "Mar 16, 2026", "2026-03-16"),
    value(3, "signup_date", "normalize_date", "skipped", "3/4/2026", "2026-03-04"),
    // company: whitespace and casing, both rules
    value(4, "company", "trim_whitespace", "approved", "  Acme ", "Acme"),
    value(5, "company", "title_case", "approved", "acme corp.", "Acme Corp"),
    // country: one rule fix, two AI suggestions (one approved, one pending) and one skipped
    value(6, "country", "country_names", "approved", "US", "United States"),
    value(7, "country", "ai", "approved", "Deutschland", "Germany", "ai"),
    value(8, "country", "ai", "pending", "Frankr", "France", "ai"),
    value(9, "country", "ai", "skipped", "Nippon", "Japan", "ai"),
    // phone: one rule edit
    value(2, "phone", "phone_e164", "approved", "(555) 010-0142", "+1 555-010-0142"),
    // merges: two approved (rows 3 and 7), one pending (row 8). Only the first names its column.
    merge(3, 1, "approved", 'Duplicate of row 2, column "email"'),
    merge(7, 2, "approved", "Exact duplicate of row 3"),
    merge(8, 1, "pending", 'Duplicate of row 2, column "email"'),
    // flags never count
    flag(4, "email", "approved"),
    flag(5, "email", "pending"),
    flag(6, "email", "skipped"),
  ];
}

describe("summarizeChanges", () => {
  it("counts applied, skipped and pending edits, and ignores flags", () => {
    const s = summarizeChanges(fixture(), { rowsIn: 10 });
    // approved: 3 dates + 2 whitespace + 2 country + 1 phone + 2 merges = 10
    assert.equal(s.applied, 10);
    // skipped: 1 date + 1 country
    assert.equal(s.skipped, 2);
    // pending: 1 AI suggestion + 1 merge
    assert.equal(s.pending, 2);
  });

  it("counts distinct removed rows and derives rows out", () => {
    const s = summarizeChanges(fixture(), { rowsIn: 10 });
    assert.equal(s.rowsRemoved, 2);
    assert.equal(s.rowsOut, 8);
  });

  it("counts a row once even when several merges name it", () => {
    const changes = [merge(3, 1, "approved", "dup"), merge(3, 2, "approved", "dup again")];
    const s = summarizeChanges(changes, { rowsIn: 5 });
    assert.equal(s.rowsRemoved, 1);
    assert.equal(s.rowsOut, 4);
  });

  it("never reports negative rows out", () => {
    const s = summarizeChanges([merge(0, 1, "approved", "dup"), merge(1, 0, "approved", "dup")], { rowsIn: 1 });
    assert.equal(s.rowsOut, 0);
  });

  it("groups by column with fixed, total and method", () => {
    const s = summarizeChanges(fixture(), { rowsIn: 10 });
    const byName = new Map(s.byColumn.map((c) => [c.column, c]));

    assert.deepEqual(byName.get("signup_date"), {
      column: "signup_date",
      issue: "3 date formats",
      fixed: 3,
      total: 4,
      method: "Rule",
    });
    assert.deepEqual(byName.get("company"), {
      column: "company",
      issue: "Whitespace, casing",
      fixed: 2,
      total: 2,
      method: "Rule",
    });
    assert.deepEqual(byName.get("country"), {
      column: "country",
      issue: "Typos, codes vs names, Ambiguous values",
      fixed: 2,
      total: 4,
      method: "Rule + AI",
    });
    assert.deepEqual(byName.get("phone"), {
      column: "phone",
      issue: "Mixed formats",
      fixed: 1,
      total: 1,
      method: "Rule",
    });
  });

  it("groups merges under the column named in their reason, else under the rows bucket", () => {
    const s = summarizeChanges(fixture(), { rowsIn: 10 });
    const byName = new Map(s.byColumn.map((c) => [c.column, c]));

    // Approved merge on row 3 and pending merge on row 8; the flags on email are not counted.
    assert.deepEqual(byName.get("email"), {
      column: "email",
      issue: "Duplicate records",
      fixed: 1,
      total: 2,
      method: "Rule",
    });
    assert.deepEqual(byName.get(ROWS_LABEL), {
      column: ROWS_LABEL,
      issue: "Duplicate records",
      fixed: 1,
      total: 1,
      method: "Rule",
    });
  });

  it("leaves flags out of byColumn", () => {
    const s = summarizeChanges(fixture(), { rowsIn: 10 });
    assert.ok(!s.byColumn.some((c) => c.issue.includes("Missing values")));
    assert.equal(s.byColumn.find((c) => c.column === "email")?.total, 2);
  });

  it("labels a single date layout in the singular", () => {
    const changes = [
      value(0, "d", "normalize_date", "approved", "2026-03-14", "2026-03-14"),
      value(1, "d", "normalize_date", "approved", "2026-03-15", "2026-03-15"),
    ];
    assert.equal(summarizeChanges(changes, { rowsIn: 2 }).byColumn[0].issue, "1 date format");
  });

  it("falls back to 'Date formats' when no before-layout is known", () => {
    const changes = [value(0, "d", "normalize_date", "approved", "", "2026-03-14")];
    assert.equal(summarizeChanges(changes, { rowsIn: 1 }).byColumn[0].issue, "Date formats");
  });

  it("labels AI edits as ambiguous values and unknown saved rules as other fixes", () => {
    const changes = [
      value(0, "name", "ai", "approved", "x", "y", "ai"),
      value(1, "name", "r_saved_42", "approved", "x", "y"),
    ];
    assert.equal(summarizeChanges(changes, { rowsIn: 2 }).byColumn[0].issue, "Ambiguous values, Other fixes");
  });

  it("matches saved rules that are named after their built-in action", () => {
    const changes = [value(0, "email", "lowercase_2", "approved", "A@x.io", "a@x.io")];
    assert.equal(summarizeChanges(changes, { rowsIn: 1 }).byColumn[0].issue, "Whitespace, casing");
  });

  it("returns zeros for an empty change list", () => {
    assert.deepEqual(summarizeChanges([], { rowsIn: 7 }), {
      applied: 0,
      skipped: 0,
      pending: 0,
      rowsRemoved: 0,
      rowsOut: 7,
      byColumn: [],
    });
  });
});

it("merges labelled 'Same <column>' are reported under that column", () => {
  const merge: ProposedChange = {
    rowIndex: 3, column: null, kind: "merge", before: "J. Ortiz", after: "Jane Ortiz", mergeIntoRow: 1,
    source: "rule", ruleId: "builtin:dedupe_key:email", reason: "Same email", confidence: 0.95, decision: "approved",
  };
  assert.equal(changeColumn(merge), "email");
});
