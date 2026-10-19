import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatCount } from "./format";

describe("formatBytes", () => {
  it("uses B, KB, MB and GB with one decimal for MB", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(1023), "1023 B");
    assert.equal(formatBytes(2048), "2 KB");
    assert.equal(formatBytes(Math.round(2.1 * 1024 * 1024)), "2.1 MB");
    assert.equal(formatBytes(200 * 1024 * 1024), "200 MB");
    assert.equal(formatBytes(1024 * 1024 * 1024), "1 GB");
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    assert.equal(formatCount(4812), "4,812");
    assert.equal(formatCount(7), "7");
  });
});
