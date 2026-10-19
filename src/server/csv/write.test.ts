import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseCsvText, toCsv } from "./index";
import type { Table } from "../types";

describe("toCsv", () => {
  test("quotes only fields that need it, doubles quotes, uses CRLF", () => {
    const table: Table = {
      headers: ["id", "name", "note"],
      rows: [
        ["1", "Ana", "plain"],
        ["2", "Bo, Jr.", 'said "hi"'],
        ["3", "Cy", "line1\nline2"],
        ["4", "Di", "cr\rhere"],
        ["5", "", ""],
      ],
    };
    assert.equal(
      toCsv(table),
      'id,name,note\r\n' +
        "1,Ana,plain\r\n" +
        '2,"Bo, Jr.","said ""hi"""\r\n' +
        '3,Cy,"line1\nline2"\r\n' +
        '4,Di,"cr\rhere"\r\n' +
        "5,,\r\n",
    );
  });

  test("custom delimiter", () => {
    // A comma is not special under a tab delimiter; a value containing a tab must be quoted.
    const table: Table = { headers: ["a", "b"], rows: [["x,y", "z\tw"]] };
    assert.equal(toCsv(table, { delimiter: "\t" }), 'a\tb\r\nx,y\t"z\tw"\r\n');
  });

  test("regex-special delimiters are quoted correctly", () => {
    const table: Table = { headers: ["a", "b"], rows: [["x^y", "z-w"]] };
    assert.equal(toCsv(table, { delimiter: "^" }), 'a^b\r\n"x^y"^z-w\r\n');
    assert.equal(toCsv(table, { delimiter: "-" }), 'a-b\r\nx^y-"z-w"\r\n');
  });

  test("rejects a delimiter that would corrupt the output", () => {
    const table: Table = { headers: ["a"], rows: [] };
    assert.throws(() => toCsv(table, { delimiter: '"' }));
    assert.throws(() => toCsv(table, { delimiter: "" }));
    assert.throws(() => toCsv(table, { delimiter: "::" }));
  });

  test("round-trips through parseCsvText with quotes, newlines, commas and padding", () => {
    const table: Table = {
      headers: ["id", "name", "note", "amount"],
      rows: [
        ["1", "Ana Silva", 'She said "hello", then left', "1200.50"],
        ["2", "Bo Chen", "first line\r\nsecond line", "-45"],
        ["3", "  padded  ", "trailing quote\"", "0"],
        ["4", "", ";|\t", "1,234"],
        ["5", "Ünïcödé 🎉", "", "7"],
      ],
    };
    const parsed = parseCsvText(toCsv(table));
    assert.deepEqual(parsed.table, table);
    assert.equal(parsed.delimiter, ",");
  });

  test("round-trips with a tab delimiter", () => {
    const table: Table = {
      headers: ["id", "name"],
      rows: [
        ["1", "a,b"],
        ["2", 'quote "x"'],
        ["3", "multi\nline"],
      ],
    };
    const parsed = parseCsvText(toCsv(table, { delimiter: "\t" }));
    assert.equal(parsed.delimiter, "\t");
    assert.deepEqual(parsed.table, table);
  });

  test("round-trips an empty table", () => {
    const table: Table = { headers: ["a", "b"], rows: [] };
    assert.deepEqual(parseCsvText(toCsv(table)).table, table);
  });
});
