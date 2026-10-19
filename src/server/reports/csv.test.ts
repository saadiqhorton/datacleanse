import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ProposedChange } from "../types";
import { changeLogCsv, guardFormula } from "./csv";

const base: ProposedChange = {
  rowIndex: 0,
  column: "name",
  kind: "value",
  before: "a",
  after: "b",
  source: "rule",
  ruleId: "trim_whitespace",
  reason: "Extra spaces",
  confidence: 0.5,
  decision: "approved",
};

/** Parses CSV per RFC 4180 (quoted fields, doubled quotes, embedded newlines). Test-only. */
function parse(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && csv[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

describe("changeLogCsv", () => {
  it("writes the documented header", () => {
    const [first] = changeLogCsv([]).split("\r\n");
    assert.equal(first, "row,column,change,before,after,source,rule,reason,confidence,decision,decided_by");
  });

  it("numbers rows as spreadsheet rows (header is row 1)", () => {
    const csv = changeLogCsv([{ ...base, rowIndex: 0 }, { ...base, rowIndex: 4 }]);
    const rows = parse(csv);
    assert.equal(rows[1][0], "2");
    assert.equal(rows[2][0], "6");
  });

  it("quotes commas, quotes and line breaks per RFC 4180", () => {
    const csv = changeLogCsv([
      { ...base, before: "Smith, Jo", after: 'say "hi"', reason: "line one\nline two" },
    ]);
    assert.ok(csv.includes('"Smith, Jo"'));
    assert.ok(csv.includes('"say ""hi"""'));
    assert.ok(csv.includes('"line one\nline two"'));

    const rows = parse(csv);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].length, 11);
    assert.equal(rows[1][3], "Smith, Jo");
    assert.equal(rows[1][4], 'say "hi"');
    assert.equal(rows[1][7], "line one\nline two");
  });

  it("guards values that start with = + - @ tab or CR", () => {
    const hostile = ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"];
    const rows = parse(changeLogCsv(hostile.map((before) => ({ ...base, before }))));
    hostile.forEach((input, i) => {
      assert.equal(rows[i + 1][3], `'${input}`);
    });
  });

  it("guards a formula hidden behind leading spaces", () => {
    assert.equal(guardFormula("  =1+1"), "'  =1+1");
  });

  it("leaves ordinary text alone", () => {
    assert.equal(guardFormula("Acme Corp"), "Acme Corp");
    assert.equal(guardFormula("a=b"), "a=b");
    assert.equal(guardFormula(""), "");
  });

  it("guards the decided_by column too", () => {
    const rows = parse(changeLogCsv([{ ...base, decidedBy: "=cmd" }]));
    assert.equal(rows[1][10], "'=cmd");
  });

  it("writes empty cells for null and missing values", () => {
    const rows = parse(changeLogCsv([{ ...base, column: null, before: null, after: null, confidence: undefined }]));
    assert.equal(rows[1][1], "");
    assert.equal(rows[1][3], "");
    assert.equal(rows[1][4], "");
    assert.equal(rows[1][8], "");
    assert.equal(rows[1][10], "");
  });

  it("describes where a merge went", () => {
    const rows = parse(
      changeLogCsv([{ ...base, kind: "merge", column: null, before: null, after: null, mergeIntoRow: 3, ruleId: "dedupe_key" }]),
    );
    assert.equal(rows[1][2], "merge");
    assert.equal(rows[1][4], "merged into row 5");
  });

  it("writes confidence to two decimals and ends with CRLF", () => {
    const csv = changeLogCsv([{ ...base, confidence: 0.9 }]);
    assert.equal(parse(csv)[1][8], "0.90");
    assert.ok(csv.endsWith("\r\n"));
  });
});
