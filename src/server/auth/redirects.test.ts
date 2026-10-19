import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "./redirects";

test("same-origin relative paths are kept", () => {
  assert.equal(safeNext("/files"), "/files");
  assert.equal(safeNext("/files/abc?tab=review"), "/files/abc?tab=review");
  assert.equal(safeNext("/"), "/");
});

test("absolute, protocol-relative and tricky URLs fall back to /files", () => {
  for (const bad of [
    "https://evil.example/",
    "http://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "files",
    "/files\nSet-Cookie: x=1",
    "/files\u0000",
    "",
    " /files",
  ]) {
    assert.equal(safeNext(bad), "/files", `expected fallback for ${JSON.stringify(bad)}`);
  }
});

test("missing or non-string values fall back", () => {
  assert.equal(safeNext(undefined), "/files");
  assert.equal(safeNext(null), "/files");
  assert.equal(safeNext(42 as unknown as string), "/files");
  assert.equal(safeNext("/" + "a".repeat(3000)), "/files", "overlong input rejected");
});
