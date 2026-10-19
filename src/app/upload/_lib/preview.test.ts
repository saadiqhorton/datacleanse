import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_COLUMNS, PREVIEW_ROWS, detectDelimiter, parseSample, rowCountLabel } from "./preview";

const enc = (s: string) => new TextEncoder().encode(s);

describe("parseSample", () => {
  it("reads a whole small comma file exactly", () => {
    const text = "name,email\nJane,jane@acme.io\nLee,\n";
    const result = parseSample(enc(text), enc(text).length);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.preview.delimiter, ",");
    assert.equal(result.preview.delimiterName, "comma-separated");
    assert.equal(result.preview.encoding, "UTF-8");
    assert.deepEqual(result.preview.headers, ["name", "email"]);
    assert.deepEqual(result.preview.rows, [
      ["Jane", "jane@acme.io"],
      ["Lee", ""],
    ]);
    assert.deepEqual(result.preview.rowCount, { value: 2, exact: true });
  });

  it("detects tab, semicolon and pipe delimiters and keeps quoted delimiters together", () => {
    assert.equal(detectDelimiter("a\tb\n1\t2\n3\t4\n"), "\t");
    assert.equal(detectDelimiter("a;b;c\n1;2;3\n"), ";");
    assert.equal(detectDelimiter("a|b\n1|2\n"), "|");
    assert.equal(detectDelimiter('"x,y",z\n"1,2",3\n'), ",");
  });

  it("returns the first columns and rows only", () => {
    const header = Array.from({ length: 9 }, (_, i) => `c${i}`).join(",");
    const rows = Array.from({ length: 30 }, (_, r) => Array.from({ length: 9 }, () => `v${r}`).join(",")).join("\n");
    const text = `${header}\n${rows}\n`;
    const result = parseSample(enc(text.slice(0, 2048)), 10_000);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.preview.headers.length, PREVIEW_COLUMNS);
    assert.equal(result.preview.columnCount, 9);
    assert.equal(result.preview.rows.length, PREVIEW_ROWS);
    assert.ok(result.preview.rows.every((r) => r.length === PREVIEW_COLUMNS));
  });

  it("drops the cut-off last line of a partial sample and estimates the row count", () => {
    const line = "1,alpha,beta\n"; // 13 bytes
    const body = line.repeat(200); // 2600 bytes
    const sample = enc(body).subarray(0, 2048); // cut mid-line
    const result = parseSample(sample, enc(body).length + enc("h1,h2,h3\n").length);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.preview.rowCount.exact, false);
    // Header line is not counted as a row, so estimate ~200 for a 200-row body.
    assert.ok(Math.abs(result.preview.rowCount.value - 200) <= 2, `got ${result.preview.rowCount.value}`);
    assert.ok(result.preview.rows.every((r) => r.join(",") === "1,alpha,beta"));
  });

  it("strips a BOM and says so", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("a,b\n1,2\n")]);
    const result = parseSample(bytes, bytes.length);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.preview.encoding, "UTF-8 with BOM");
      assert.deepEqual(result.preview.headers, ["a", "b"]);
    }
  });

  it("explains empty, binary and non-UTF-8 files", () => {
    assert.deepEqual(parseSample(new Uint8Array(), 0), { ok: false, message: "The file is empty." });
    const binary = parseSample(new Uint8Array([97, 0, 98]), 3);
    assert.deepEqual(binary, { ok: false, message: "This looks like a binary file, not CSV text." });
    const latin1 = parseSample(new Uint8Array([97, 44, 0xe9, 10]), 4);
    assert.equal(latin1.ok, false);
    if (!latin1.ok) assert.match(latin1.message, /not UTF-8/);
  });
});

describe("rowCountLabel", () => {
  it("prefixes estimates with a tilde", () => {
    assert.equal(rowCountLabel({ value: 4812, exact: true }), "4,812 rows");
    assert.equal(rowCountLabel({ value: 1, exact: true }), "1 row");
    assert.equal(rowCountLabel({ value: 4800, exact: false }), "~4,800 rows");
  });
});
