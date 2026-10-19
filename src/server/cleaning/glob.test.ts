import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exactGlob, globMatch } from "./glob";

describe("globMatch", () => {
  it("matches every header with *", () => {
    assert.equal(globMatch("*", "anything"), true);
    assert.equal(globMatch("*", ""), true);
  });

  it("is case-insensitive", () => {
    assert.equal(globMatch("*_date", "Signup_DATE"), true);
    assert.equal(globMatch("EMAIL", "email"), true);
  });

  it("requires an exact match when there are no wildcards", () => {
    assert.equal(globMatch("email", "email"), true);
    assert.equal(globMatch("email", "email_2"), false);
    assert.equal(globMatch("email", "work email"), false);
  });

  it("treats ? as exactly one character", () => {
    assert.equal(globMatch("col?", "col1"), true);
    assert.equal(globMatch("col?", "col"), false);
    assert.equal(globMatch("col?", "col12"), false);
  });

  it("escapes regex metacharacters in patterns", () => {
    assert.equal(globMatch("a.b", "a.b"), true);
    assert.equal(globMatch("a.b", "axb"), false);
    assert.equal(globMatch("(x)", "(x)"), true);
  });

  it("exactGlob matches only the literal header, wildcards included", () => {
    assert.equal(globMatch(exactGlob("a*b"), "a*b"), true);
    assert.equal(globMatch(exactGlob("a*b"), "axxb"), false);
    assert.equal(globMatch(exactGlob("q?"), "q?"), true);
    assert.equal(globMatch(exactGlob("q?"), "qx"), false);
  });
});
