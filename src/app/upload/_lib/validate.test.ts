import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_FILES, checkBatch, checkFile, extensionOf, fileKey, splitSelection } from "./validate";

const MB = 1024 * 1024;

describe("extensionOf", () => {
  it("lowercases the last extension and ignores dotfiles", () => {
    assert.equal(extensionOf("Export.CSV"), ".csv");
    assert.equal(extensionOf("a.b.tsv"), ".tsv");
    assert.equal(extensionOf("noext"), "");
    assert.equal(extensionOf(".csv"), "");
  });
});

describe("checkFile", () => {
  it("accepts csv, tsv and txt", () => {
    for (const name of ["a.csv", "a.tsv", "a.txt", "A.CSV"]) assert.equal(checkFile({ name, size: 10 }, 200 * MB), null);
  });

  it("rejects other extensions", () => {
    assert.match(checkFile({ name: "book.xlsx", size: 10 }, 200 * MB) ?? "", /book\.xlsx is not a \.csv, \.tsv or \.txt file/);
    assert.notEqual(checkFile({ name: "noext", size: 10 }, 200 * MB), null);
  });

  it("rejects empty files and files over the limit", () => {
    assert.equal(checkFile({ name: "a.csv", size: 0 }, 200 * MB), "a.csv is empty.");
    assert.equal(
      checkFile({ name: "big.csv", size: 201 * MB }, 200 * MB),
      "big.csv is 201 MB. The limit is 200 MB.",
    );
    assert.equal(checkFile({ name: "edge.csv", size: 200 * MB }, 200 * MB), null);
  });
});

describe("splitSelection", () => {
  it("keeps good files and explains the rest", () => {
    const files = [
      { name: "ok.csv", size: 5 },
      { name: "bad.pdf", size: 5 },
      { name: "empty.tsv", size: 0 },
    ];
    const { valid, rejected } = splitSelection(files, 200 * MB);
    assert.deepEqual(valid, [{ name: "ok.csv", size: 5 }]);
    assert.deepEqual(
      rejected.map((r) => r.name),
      ["bad.pdf", "empty.tsv"],
    );
  });
});

describe("checkBatch", () => {
  it("passes a small batch", () => {
    assert.equal(checkBatch([{ name: "a.csv", size: MB }, { name: "b.csv", size: MB }], 200 * MB), null);
  });

  it("caps the number of files", () => {
    const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ name: `f${i}.csv`, size: 1 }));
    assert.equal(checkBatch(many, 200 * MB), `Choose at most ${MAX_FILES} files at a time.`);
  });

  it("caps the total size, because the server reads the whole request against one limit", () => {
    const files = [
      { name: "a.csv", size: 150 * MB },
      { name: "b.csv", size: 80 * MB },
    ];
    assert.equal(
      checkBatch(files, 200 * MB),
      "These files add up to 230 MB. Upload at most 200 MB at once.",
    );
  });
});

describe("fileKey", () => {
  it("is equal for the same file and different for a changed one", () => {
    const a = { name: "a.csv", size: 3, lastModified: 1 };
    assert.equal(fileKey(a), fileKey({ ...a }));
    assert.notEqual(fileKey(a), fileKey({ ...a, lastModified: 2 }));
  });
});
