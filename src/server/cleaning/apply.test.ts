import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ProposedChange, Table } from "../types";
import { DEFAULT_CLEAN_OPTIONS } from "../types";
import { applyChanges } from "./apply";
import { proposeChanges } from "./propose";
import { rulesFromOptions } from "./rules";

function value(
  rowIndex: number,
  column: string,
  before: string,
  after: string,
  decision: ProposedChange["decision"] = "approved",
  extra: Partial<ProposedChange> = {},
): ProposedChange {
  return {
    rowIndex,
    column,
    kind: "value",
    before,
    after,
    source: "rule",
    ruleId: "test",
    reason: "test",
    confidence: 1,
    decision,
    ...extra,
  };
}

function merge(rowIndex: number, into: number, decision: ProposedChange["decision"] = "approved"): ProposedChange {
  return {
    rowIndex,
    column: null,
    kind: "merge",
    before: "",
    after: "",
    mergeIntoRow: into,
    source: "rule",
    ruleId: "test",
    reason: "Same email",
    confidence: 0.95,
    decision,
  };
}

const T: Table = {
  headers: ["name", "email", "phone"],
  rows: [
    ["Jane", "", "555"],
    ["jane", "jane@x.com", ""],
    ["Bob", "bob@y.com", "777"],
  ],
};

describe("applyChanges", () => {
  it("applies approved value changes and ignores pending, skipped and flag changes", () => {
    const changes: ProposedChange[] = [
      value(0, "name", "Jane", "Jane Doe"),
      value(1, "name", "jane", "Jane Pending", "pending"),
      value(2, "name", "Bob", "Robert", "skipped"),
      { ...value(0, "phone", "555", ""), kind: "flag", after: null, before: "" },
    ];
    const { table, rowsRemoved } = applyChanges(T, changes);
    assert.equal(rowsRemoved, 0);
    assert.deepEqual(table.rows, [
      ["Jane Doe", "", "555"],
      ["jane", "jane@x.com", ""],
      ["Bob", "bob@y.com", "777"],
    ]);
  });

  it("does not mutate the input table", () => {
    const before = JSON.stringify(T);
    const changes = [value(0, "name", "Jane", "X"), merge(1, 2)];
    const { table } = applyChanges(T, changes);
    assert.equal(JSON.stringify(T), before);
    assert.notEqual(table.rows, T.rows);
    assert.notEqual(table.headers, T.headers);
  });

  it("skips a value change whose cell no longer holds the proposed 'before'", () => {
    const { table } = applyChanges(T, [value(0, "name", "Jim", "Jimmy")]);
    assert.equal(table.rows[0][0], "Jane");
  });

  it("ignores changes that point at unknown columns or out-of-range rows", () => {
    const { table } = applyChanges(T, [value(0, "nope", "a", "b"), value(99, "name", "a", "b")]);
    assert.deepEqual(table.rows, T.rows);
  });

  it("removes an approved merged row and fills the kept row's empty cells from it", () => {
    // Row 0 (Jane, no email, phone 555) merges into row 1 (jane, email, no phone).
    const { table, rowsRemoved } = applyChanges(T, [merge(0, 1)]);
    assert.equal(rowsRemoved, 1);
    assert.deepEqual(table.rows, [
      ["jane", "jane@x.com", "555"],
      ["Bob", "bob@y.com", "777"],
    ]);
  });

  it("keeps the kept row's own values when they are not empty", () => {
    const { table } = applyChanges(
      { headers: ["name"], rows: [["old"], ["new"]] },
      [merge(0, 1)],
    );
    assert.deepEqual(table.rows, [["new"]]);
  });

  it("does not apply a pending or skipped merge", () => {
    const { table, rowsRemoved } = applyChanges(T, [merge(0, 1, "pending"), merge(2, 1, "skipped")]);
    assert.equal(rowsRemoved, 0);
    assert.deepEqual(table.rows, T.rows);
  });

  it("follows merge chains so the surviving row gets blanks from every removed row", () => {
    // Row 0 into row 1, row 1 into row 2; row 0 has the only phone number.
    const t: Table = { headers: ["name", "phone"], rows: [["A", "555"], ["", ""], ["C", ""]] };
    const { table, rowsRemoved } = applyChanges(t, [merge(0, 1), merge(1, 2)]);
    assert.equal(rowsRemoved, 2);
    assert.deepEqual(table.rows, [["C", "555"]]);
  });

  it("applies approved AI value changes like rule changes", () => {
    const ai = value(2, "name", "Bob", "Robert", "approved", { source: "ai", ruleId: "ai" });
    const { table } = applyChanges(T, [ai]);
    assert.equal(table.rows[2][0], "Robert");
  });

  it("applies the defaults end to end to a messy table", () => {
    const messy: Table = {
      headers: ["name", "signup_date", "company", "phone", "email"],
      rows: [
        ["Jane", "03/25/22", "  acme corp. ", "(555)0142 x", " JANE@X.com "],
        ["jane", "2022-01-02", "IBM LLC", "+44 20 7946 0958", "jane@x.com"],
      ],
    };
    const changes = proposeChanges(messy, rulesFromOptions(DEFAULT_CLEAN_OPTIONS, messy.headers));
    const { table, rowsRemoved } = applyChanges(messy, changes);
    // Same email and similar names: the older row merges into the newer one.
    assert.equal(rowsRemoved, 1);
    assert.deepEqual(table.rows, [["Jane", "2022-01-02", "IBM LLC", "+44 2079460958", "jane@x.com"]]);
  });
});
