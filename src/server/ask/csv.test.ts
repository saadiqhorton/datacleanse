import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guardCell, resultCsv } from "./csv";

describe("guardCell", () => {
  it("prefixes text that a spreadsheet would run as a formula", () => {
    assert.equal(guardCell("=HYPERLINK(\"http://x\")"), "'=HYPERLINK(\"http://x\")");
    assert.equal(guardCell("+1 555 0100"), "'+1 555 0100");
    assert.equal(guardCell("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(guardCell("\tcmd"), "'\tcmd");
  });

  it("leaves numbers, plain text and nulls alone", () => {
    assert.equal(guardCell(-5), "-5");
    assert.equal(guardCell("-5"), "-5");
    assert.equal(guardCell("-12.50"), "-12.50");
    assert.equal(guardCell("Acme Corp"), "Acme Corp");
    assert.equal(guardCell(null), "");
    assert.equal(guardCell(true), "true");
  });
});

describe("resultCsv", () => {
  it("writes a BOM, CRLF line endings, quoted fields and guarded cells", () => {
    const csv = resultCsv({
      columns: ["company", "total, USD"],
      rows: [
        ["Acme \"Corp\"", 175],
        ["=cmd|' /C calc'!A0", null],
        ["Line\nbreak", -3],
      ],
    });
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.equal(
      csv.slice(1),
      'company,"total, USD"\r\n"Acme ""Corp""",175\r\n\'=cmd|\' /C calc\'!A0,\r\n"Line\nbreak",-3\r\n',
    );
  });
});
