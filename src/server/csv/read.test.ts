import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CsvError, parseCsvText, readCsvFile } from "./index";

let dir: string;
let counter = 0;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-read-test-"));
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeBytes(bytes: Buffer | string): string {
  const file = path.join(dir, `f${counter++}.csv`);
  fs.writeFileSync(file, bytes);
  return file;
}

async function expectCsvError(promise: Promise<unknown>, code: CsvError["code"]): Promise<CsvError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof CsvError, `expected CsvError, got ${String(err)}`);
    assert.equal(err.code, code);
    return err;
  }
  assert.fail(`expected CsvError ${code}`);
}

describe("delimiter detection", () => {
  test("comma", () => {
    const r = parseCsvText("name,email,city\nAna,ana@x.co,Lisbon\nBo,bo@x.co,Oslo\n");
    assert.equal(r.delimiter, ",");
    assert.deepEqual(r.table.headers, ["name", "email", "city"]);
    assert.deepEqual(r.table.rows, [
      ["Ana", "ana@x.co", "Lisbon"],
      ["Bo", "bo@x.co", "Oslo"],
    ]);
  });

  test("tab", () => {
    const r = parseCsvText("name\tcity\nAna\tLisbon\nBo\tOslo\n");
    assert.equal(r.delimiter, "\t");
    assert.deepEqual(r.table.headers, ["name", "city"]);
  });

  test("semicolon wins over comma when commas are decimal marks", () => {
    const r = parseCsvText("name;amount\nAna;1,5\nBo;2,25\nCy;3,75\n");
    assert.equal(r.delimiter, ";");
    assert.deepEqual(r.table.rows[1], ["Bo", "2,25"]);
  });

  test("pipe with quoted pipes inside values", () => {
    const r = parseCsvText('id|note|city\n1|"a|b"|Oslo\n2|"c|d|e"|Rome\n3|plain|Bern\n');
    assert.equal(r.delimiter, "|");
    assert.deepEqual(r.table.rows, [
      ["1", "a|b", "Oslo"],
      ["2", "c|d|e", "Rome"],
      ["3", "plain", "Bern"],
    ]);
  });

  test("quoted commas do not split a tab-separated file", () => {
    const r = parseCsvText('a\tb\n"x,y,z"\t2\n"p,q"\t3\n');
    assert.equal(r.delimiter, "\t");
    assert.deepEqual(r.table.rows[0], ["x,y,z", "2"]);
  });

  test("single header line falls back to comma", () => {
    const r = parseCsvText("just_one_column\n");
    assert.equal(r.delimiter, ",");
    assert.deepEqual(r.table.headers, ["just_one_column"]);
    assert.deepEqual(r.table.rows, []);
  });
});

describe("encoding", () => {
  test("UTF-8 BOM is stripped and reported", async () => {
    const file = writeBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("name,email\nAna,a@x.co\n")]));
    const r = await readCsvFile(file);
    assert.equal(r.encoding, "utf-8-bom");
    assert.deepEqual(r.table.headers, ["name", "email"]);
    assert.deepEqual(r.table.rows, [["Ana", "a@x.co"]]);
  });

  test("string input with a BOM", () => {
    const r = parseCsvText("﻿name,email\nAna,a@x.co\n");
    assert.equal(r.encoding, "utf-8-bom");
    assert.deepEqual(r.table.headers, ["name", "email"]);
  });

  test("plain UTF-8 with multi-byte characters is accepted", async () => {
    const file = writeBytes("name,city\nJosé,Zürich\nÅsa,東京\n🎉,Oslo\n");
    const r = await readCsvFile(file);
    assert.equal(r.encoding, "utf-8");
    assert.deepEqual(r.table.rows[1], ["Åsa", "東京"]);
    assert.deepEqual(r.table.rows[2], ["🎉", "Oslo"]);
  });

  test("invalid UTF-8 reports the 1-based line of the first bad byte", async () => {
    const lines: string[] = ["id,note"];
    for (let i = 2; i < 1204; i++) lines.push(`${i},ok`);
    // Line 1,204 carries a lone 0xFF byte.
    const bad = Buffer.concat([Buffer.from(lines.join("\n") + "\n1204,"), Buffer.from([0xff]), Buffer.from("\n")]);
    const file = writeBytes(bad);
    const err = await expectCsvError(readCsvFile(file), "not_utf8");
    assert.equal(err.line, 1204);
    assert.equal(err.message, 'Line 1,204 isn\'t valid UTF-8. Re-export from your tool as "CSV UTF-8" and try again.');
  });

  test("truncated multi-byte sequence and surrogate code points are invalid", async () => {
    const truncated = writeBytes(Buffer.from([0x61, 0x2c, 0x62, 0x0a, 0x31, 0x2c, 0xe2, 0x82, 0x0a]));
    const e1 = await expectCsvError(readCsvFile(truncated), "not_utf8");
    assert.equal(e1.line, 2);

    const surrogate = writeBytes(Buffer.from([0x61, 0x0a, 0x62, 0x0a, 0xed, 0xa0, 0x80, 0x0a]));
    const e2 = await expectCsvError(readCsvFile(surrogate), "not_utf8");
    assert.equal(e2.line, 3);
  });

  test("line numbers count CRLF once", async () => {
    const file = writeBytes(Buffer.from("a,b\r\n1,2\r\n3,\xff\r\n", "latin1"));
    const err = await expectCsvError(readCsvFile(file), "not_utf8");
    assert.equal(err.line, 3);
  });
});

describe("binary and empty input", () => {
  test("NUL bytes are rejected as binary", async () => {
    const file = writeBytes(Buffer.from("a,b\n1,2\0\0\n"));
    const err = await expectCsvError(readCsvFile(file), "binary");
    assert.equal(err.message, "This doesn't look like a CSV file.");
  });

  test("a PNG header is rejected as binary", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
    await expectCsvError(readCsvFile(writeBytes(png)), "binary");
  });

  test("zero-byte file is empty", async () => {
    const err = await expectCsvError(readCsvFile(writeBytes("")), "empty");
    assert.equal(err.message, "This file is empty.");
  });

  test("whitespace-only and delimiter-only files are empty", () => {
    assert.throws(() => parseCsvText("\n \n\t\n"), (e: unknown) => e instanceof CsvError && e.code === "empty");
    assert.throws(() => parseCsvText(",,\n,,\n"), (e: unknown) => e instanceof CsvError && e.code === "empty");
  });

  test("a blank header row above data is no_header", () => {
    assert.throws(() => parseCsvText(",,\n1,2\n"), (e: unknown) => e instanceof CsvError && e.code === "no_header");
  });
});

describe("size limit", () => {
  test("files over maxBytes are rejected before parsing", async () => {
    const file = writeBytes("a,b\n" + "1,2\n".repeat(100));
    await expectCsvError(readCsvFile(file, { maxBytes: 50 }), "too_large");
  });

  test("text over maxBytes is rejected", () => {
    assert.throws(() => parseCsvText("a,b\n1,2\n", { maxBytes: 4 }), (e: unknown) => e instanceof CsvError && e.code === "too_large");
  });

  test("a file exactly at the limit is accepted", async () => {
    const content = "a,b\n1,2\n";
    const file = writeBytes(content);
    const r = await readCsvFile(file, { maxBytes: Buffer.byteLength(content) });
    assert.deepEqual(r.table.rows, [["1", "2"]]);
  });
});

describe("headers", () => {
  test("headers are trimmed, blanks become column_N, duplicates become unique with a warning", () => {
    const r = parseCsvText("email,,email, Name \na@x.co,1,b@x.co,Ana\n");
    assert.deepEqual(r.table.headers, ["email", "column_2", "email_2", "Name"]);
    assert.deepEqual(r.table.rows, [["a@x.co", "1", "b@x.co", "Ana"]]);
    assert.ok(r.warnings.some((w) => w.includes("column_2")), r.warnings.join("|"));
    assert.ok(r.warnings.some((w) => w.includes('"email" is now "email_2"')), r.warnings.join("|"));
  });

  test("a generated name is not reused when a real header already has it", () => {
    const r = parseCsvText("column_2,,x\n1,2,3\n");
    assert.deepEqual(r.table.headers, ["column_2", "column_2_2", "x"]);
  });

  test("strictHeaders turns duplicate names into duplicate_headers", () => {
    assert.throws(
      () => parseCsvText("email,email\n1,2\n", { strictHeaders: true }),
      (e: unknown) => e instanceof CsvError && e.code === "duplicate_headers" && e.message.includes('"email"'),
    );
  });

  test("no warnings for clean headers", () => {
    const r = parseCsvText("a,b\n1,2\n");
    assert.deepEqual(r.warnings, []);
  });
});

describe("rows", () => {
  test("short rows are padded, extra trailing blanks dropped, extra values kept under generated headers", () => {
    const r = parseCsvText("a,b,c\n1,2\n4,5,6,,\n7,8,9,10,11\n");
    assert.deepEqual(r.table.headers, ["a", "b", "c", "column_4", "column_5"]);
    assert.deepEqual(r.table.rows, [
      ["1", "2", "", "", ""],
      ["4", "5", "6", "", ""],
      ["7", "8", "9", "10", "11"],
    ]);
    assert.ok(r.warnings.some((w) => w.includes("more values than the header") && w.includes("column_4")));
    assert.ok(r.warnings.some((w) => w.includes("fewer values")));
  });

  test("extra empty trailing fields produce no warning", () => {
    const r = parseCsvText("a,b\n1,2,,\n");
    assert.deepEqual(r.table.headers, ["a", "b"]);
    assert.deepEqual(r.table.rows, [["1", "2"]]);
    assert.deepEqual(r.warnings, []);
  });

  test("blank lines are skipped and cells stay strings", () => {
    const r = parseCsvText("a,b\n\n1,2\n   \n3,\n,\n");
    assert.deepEqual(r.table.rows, [
      ["1", "2"],
      ["3", ""],
    ]);
  });

  test("header-only file has zero rows", () => {
    const r = parseCsvText("a,b\n");
    assert.deepEqual(r.table, { headers: ["a", "b"], rows: [] });
  });

  test("CRLF with embedded newlines and escaped quotes", () => {
    const r = parseCsvText('id,note\r\n1,"line one\r\nline two"\r\n2,"quote ""inside"""\r\n');
    assert.deepEqual(r.table.rows, [
      ["1", "line one\r\nline two"],
      ["2", 'quote "inside"'],
    ]);
  });

  test("mixed CRLF and LF line endings leave no stray carriage returns", () => {
    const r = parseCsvText("a,b\n1,2\r\n3,4\n5,6\r\n");
    assert.deepEqual(r.table.rows, [
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ]);
  });

  test("an unclosed quote is kept and warned about", () => {
    const r = parseCsvText('a,b\n1,"open\n2,3\n');
    assert.ok(r.warnings.some((w) => w.includes("quoted")), r.warnings.join("|"));
  });
});
