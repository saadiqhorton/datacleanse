import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Papa from "papaparse";
import type { Table } from "../types";
import { compareTables, MAX_DETAIL_ENTRIES } from "./compare";
import { compareToCsv } from "./export";

const names = { leftName: "old.csv", rightName: "new.csv" };

describe("compareTables", () => {
  test("the design example: plan change and a zip code that gained leading zeros", () => {
    const left: Table = {
      headers: ["email", "plan", "zip"],
      rows: [
        ["jane@acme.io", "starter", "2134"],
        ["bob@acme.io", "team", "1001"],
      ],
    };
    const right: Table = {
      headers: ["email", "plan", "zip"],
      rows: [
        ["jane@acme.io", "team", "02134"],
        ["bob@acme.io", "team", "1001"],
        ["new@acme.io", "starter", "55"],
      ],
    };
    const result = compareTables(left, right, names);

    assert.deepEqual(result.keyColumns, ["email"]);
    assert.equal(result.keyUnique, true);
    assert.deepEqual(result.changed, [
      { key: "jane@acme.io", column: "plan", before: "starter", after: "team" },
      { key: "jane@acme.io", column: "zip", before: "2134", after: "02134" },
    ]);
    assert.deepEqual(result.columns.typeChanged, [
      { column: "zip", from: "number", to: "text", note: "leading zeros kept" },
    ]);
    assert.deepEqual(result.counts, { added: 1, removed: 0, changed: 1, unchanged: 1 });
    assert.deepEqual(result.added, [{ key: "new@acme.io", row: { email: "new@acme.io", plan: "starter", zip: "55" } }]);
    assert.equal(result.leftName, "old.csv");
    assert.equal(result.rightName, "new.csv");
  });

  test("counts added and removed rows, and reports added and removed columns", () => {
    const left: Table = {
      headers: ["id", "name", "legacy"],
      rows: [
        ["1", "Ann", "x"],
        ["2", "Ben", "y"],
        ["3", "Cy", "z"],
      ],
    };
    const right: Table = {
      headers: ["id", "name", "segment"],
      rows: [
        ["2", "Ben", "gold"],
        ["3", "Cy", "silver"],
        ["4", "Di", "gold"],
        ["5", "Ed", "bronze"],
      ],
    };
    const result = compareTables(left, right, names);

    assert.deepEqual(result.keyColumns, ["id"]);
    assert.deepEqual(result.columns.added, ["segment"]);
    assert.deepEqual(result.columns.removed, ["legacy"]);
    assert.deepEqual(result.counts, { added: 2, removed: 1, changed: 0, unchanged: 2 });
    assert.deepEqual(result.removed, [{ key: "1", row: { id: "1", name: "Ann", legacy: "x" } }]);
    assert.deepEqual(
      result.added.map((a) => a.key),
      ["4", "5"],
    );
  });

  test("auto-detects an email key over an id key", () => {
    const left: Table = {
      headers: ["id", "email", "score"],
      rows: [
        ["1", "a@x.io", "1"],
        ["2", "b@x.io", "2"],
      ],
    };
    const right: Table = {
      headers: ["id", "email", "score"],
      rows: [
        ["2", "b@x.io", "2"],
        ["1", "a@x.io", "5"],
      ],
    };
    const result = compareTables(left, right, names);
    assert.deepEqual(result.keyColumns, ["email"]);
    assert.equal(result.counts.changed, 1);
    assert.deepEqual(result.changed, [{ key: "a@x.io", column: "score", before: "1", after: "5" }]);
  });

  test("auto-detects an id column when there is no email", () => {
    const left: Table = { headers: ["sku", "order_id"], rows: [["A", "10"], ["B", "11"]] };
    const right: Table = { headers: ["sku", "order_id"], rows: [["A", "10"], ["B", "12"]] };
    const result = compareTables(left, right, names);
    // sku and order_id are both unique; the *_id column ranks ahead of a plain column.
    assert.deepEqual(result.keyColumns, ["order_id"]);
    assert.equal(result.keyUnique, true);
  });

  test("falls back to an (email, customer_id) pair when no single column is unique", () => {
    const left: Table = {
      headers: ["email", "customer_id", "plan"],
      rows: [
        ["a@x.io", "1", "free"],
        ["a@x.io", "2", "pro"],
        ["b@x.io", "1", "pro"],
        ["b@x.io", "2", "free"],
      ],
    };
    const right: Table = {
      headers: ["email", "customer_id", "plan"],
      rows: [
        ["a@x.io", "1", "pro"],
        ["a@x.io", "2", "pro"],
        ["b@x.io", "1", "pro"],
        ["b@x.io", "2", "pro"],
      ],
    };
    const result = compareTables(left, right, names);
    assert.deepEqual(result.keyColumns, ["email", "customer_id"]);
    assert.equal(result.keyUnique, true);
    assert.deepEqual(result.counts, { added: 0, removed: 0, changed: 2, unchanged: 2 });
  });

  test("empty cells do not make a column a key", () => {
    const left: Table = { headers: ["ref", "name"], rows: [["", "a"], ["", "b"]] };
    const right: Table = { headers: ["ref", "name"], rows: [["", "a"], ["", "b"]] };
    const result = compareTables(left, right, names);
    assert.deepEqual(result.keyColumns, ["name"]);
    assert.equal(result.keyUnique, true);
  });

  test("duplicate keys give keyUnique false and rows are paired in order", () => {
    const left: Table = {
      headers: ["email", "plan"],
      rows: [
        ["a@x.io", "free"],
        ["a@x.io", "pro"],
      ],
    };
    const right: Table = {
      headers: ["email", "plan"],
      rows: [
        ["a@x.io", "free"],
        ["a@x.io", "team"],
        ["a@x.io", "team"],
      ],
    };
    const result = compareTables(left, right, names);
    assert.deepEqual(result.keyColumns, ["email"]);
    assert.equal(result.keyUnique, false);
    assert.deepEqual(result.changed, [{ key: "a@x.io", column: "plan", before: "pro", after: "team" }]);
    assert.deepEqual(result.counts, { added: 1, removed: 0, changed: 1, unchanged: 1 });
  });

  test("explicit keyColumns are used and checked against both files", () => {
    const left: Table = {
      headers: ["first", "last", "age"],
      rows: [["Ann", "Lee", "30"]],
    };
    const right: Table = {
      headers: ["first", "last", "age"],
      rows: [["Ann", "Lee", "31"]],
    };
    const result = compareTables(left, right, { ...names, keyColumns: ["first", "last"] });
    assert.deepEqual(result.keyColumns, ["first", "last"]);
    assert.equal(result.keyUnique, true);
    assert.deepEqual(result.changed, [{ key: "Ann | Lee", column: "age", before: "30", after: "31" }]);

    assert.throws(
      () => compareTables(left, right, { ...names, keyColumns: ["nope"] }),
      /Key column "nope" is not in old.csv/,
    );
  });

  test("files with no shared columns: every row is removed or added", () => {
    const left: Table = { headers: ["a"], rows: [["1"], ["2"]] };
    const right: Table = { headers: ["b"], rows: [["1"]] };
    const result = compareTables(left, right, names);
    assert.deepEqual(result.keyColumns, []);
    assert.deepEqual(result.counts, { added: 1, removed: 2, changed: 0, unchanged: 0 });
  });

  test("numbers and text: a column whose values all look numeric is a number", () => {
    const left: Table = { headers: ["id", "amount"], rows: [["1", "10.5"], ["2", "3"]] };
    const right: Table = { headers: ["id", "amount"], rows: [["1", "10.50"], ["2", "3"]] };
    const result = compareTables(left, right, names);
    assert.deepEqual(result.columns.typeChanged, []);
    assert.equal(result.counts.changed, 1);
  });

  test("leading zeros dropped on the right gets a note", () => {
    const left: Table = { headers: ["id", "zip"], rows: [["1", "02134"]] };
    const right: Table = { headers: ["id", "zip"], rows: [["1", "2134"]] };
    const result = compareTables(left, right, names);
    assert.deepEqual(result.columns.typeChanged, [
      { column: "zip", from: "text", to: "number", note: "leading zeros dropped" },
    ]);
  });

  test("empty columns do not count as a type change", () => {
    const left: Table = { headers: ["id", "note"], rows: [["1", ""], ["2", ""]] };
    const right: Table = { headers: ["id", "note"], rows: [["1", "hello"], ["2", ""]] };
    const result = compareTables(left, right, names);
    assert.deepEqual(result.columns.typeChanged, []);
  });

  test("detail lists are capped at 5,000 while counts stay exact", () => {
    const n = MAX_DETAIL_ENTRIES + 1000;
    const leftRows: string[][] = [];
    const rightRows: string[][] = [];
    for (let i = 0; i < n; i++) {
      leftRows.push([String(i), "old"]);
      rightRows.push([String(i), "new"]);
    }
    // 5,500 extra rows on each side that do not match anything.
    for (let i = 0; i < 5500; i++) {
      leftRows.push([`L${i}`, "x"]);
      rightRows.push([`R${i}`, "y"]);
    }
    const result = compareTables(
      { headers: ["id", "v"], rows: leftRows },
      { headers: ["id", "v"], rows: rightRows },
      names,
    );
    assert.equal(result.counts.changed, n);
    assert.equal(result.counts.unchanged, 0);
    assert.equal(result.counts.added, 5500);
    assert.equal(result.counts.removed, 5500);
    assert.equal(result.changed.length, MAX_DETAIL_ENTRIES);
    assert.equal(result.added.length, MAX_DETAIL_ENTRIES);
    assert.equal(result.removed.length, MAX_DETAIL_ENTRIES);
  });

  test("a header named __proto__ stays plain data", () => {
    const left: Table = { headers: ["id", "__proto__"], rows: [["1", "x"]] };
    const right: Table = { headers: ["id", "other"], rows: [["2", "y"]] };
    const result = compareTables(left, right, names);
    assert.equal(result.removed[0].row.__proto__, "x");
    assert.equal(Object.getPrototypeOf(result.removed[0].row), Object.prototype);
  });
});

describe("compareToCsv", () => {
  test("exports changes with RFC 4180 quoting", () => {
    const left: Table = {
      headers: ["email", "note"],
      rows: [["a@x.io", "plain"]],
    };
    const right: Table = {
      headers: ["email", "note"],
      rows: [["a@x.io", 'says "hi", then\nleaves']],
    };
    const csv = compareToCsv(compareTables(left, right, names));
    assert.equal(
      csv,
      'change_type,key,column,before,after\r\n' +
        'changed,a@x.io,note,plain,"says ""hi"", then\nleaves"\r\n',
    );
    const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: true });
    assert.deepEqual(parsed.data[1], ["changed", "a@x.io", "note", "plain", 'says "hi", then\nleaves']);
  });

  test("lists column changes, added and removed rows, and type changes", () => {
    const left: Table = {
      headers: ["email", "zip", "gone"],
      rows: [
        ["a@x.io", "2134", "1"],
        ["b@x.io", "5", "2"],
      ],
    };
    const right: Table = {
      headers: ["email", "zip", "new"],
      rows: [
        ["a@x.io", "02134", "9"],
        ["c@x.io", "7", "8"],
      ],
    };
    const csv = compareToCsv(compareTables(left, right, names));
    const rows = Papa.parse<string[]>(csv, { skipEmptyLines: true }).data;
    assert.deepEqual(rows[0], ["change_type", "key", "column", "before", "after"]);
    assert.deepEqual(rows.slice(1), [
      ["column_added", "", "new", "", ""],
      ["column_removed", "", "gone", "", ""],
      ["type_changed", "", "zip", "number", "text (leading zeros kept)"],
      ["changed", "a@x.io", "zip", "2134", "02134"],
      ["removed", "b@x.io", "email", "b@x.io", ""],
      ["removed", "b@x.io", "zip", "5", ""],
      ["removed", "b@x.io", "gone", "2", ""],
      ["added", "c@x.io", "email", "", "c@x.io"],
      ["added", "c@x.io", "zip", "", "7"],
      ["added", "c@x.io", "new", "", "8"],
    ]);
  });

  test("neutralises spreadsheet formulas", () => {
    const left: Table = { headers: ["id", "v"], rows: [["1", "10"]] };
    const right: Table = { headers: ["id", "v"], rows: [["1", '=HYPERLINK("http://x")']] };
    const csv = compareToCsv(compareTables(left, right, names));
    assert.match(csv, /changed,1,v,10,"'=HYPERLINK\(""http:\/\/x""\)"\r\n$/);
  });
});
