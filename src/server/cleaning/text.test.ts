import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { editDistance, isNameLike, normalizeHeader, titleCase, trimWhitespace } from "./text";

describe("titleCase", () => {
  it("trims, strips trailing punctuation and title-cases (design example)", () => {
    assert.equal(titleCase("  acme corp. "), "Acme Corp");
  });

  it("keeps known acronyms and short all-caps tokens in mixed-case values", () => {
    assert.equal(titleCase("IBM Corp"), "IBM Corp");
    assert.equal(titleCase("acme llc"), "Acme LLC");
    assert.equal(titleCase("ACME corp"), "ACME Corp");
  });

  it("title-cases an all-caps value", () => {
    assert.equal(titleCase("ACME CORP"), "Acme Corp");
    assert.equal(titleCase("JOHN SMITH"), "John Smith");
  });

  it("leaves already well-formed values alone", () => {
    assert.equal(titleCase("Jane Ortiz"), "Jane Ortiz");
    assert.equal(titleCase("McDonald"), "McDonald");
    assert.equal(titleCase("iPhone Repair"), "iPhone Repair");
  });

  it("handles O'Brien, D'Angelo, Mc prefixes and hyphens", () => {
    assert.equal(titleCase("o'brien"), "O'Brien");
    assert.equal(titleCase("d'angelo"), "D'Angelo");
    assert.equal(titleCase("mcdonald"), "McDonald");
    assert.equal(titleCase("jean-luc picard"), "Jean-Luc Picard");
  });

  it("keeps possessive s lowercase", () => {
    assert.equal(titleCase("mcdonald's, inc."), "McDonald's, Inc");
  });

  it("lowercases minor words except at the start", () => {
    assert.equal(titleCase("bank of america"), "Bank of America");
    assert.equal(titleCase("the bank"), "The Bank");
  });

  it("does not strip punctuation from values with digits", () => {
    assert.equal(titleCase("acme 2.0."), "Acme 2.0.");
  });

  it("returns empty for blank input", () => {
    assert.equal(titleCase("   "), "");
  });

  it("is idempotent", () => {
    for (const v of ["  acme corp. ", "IBM LLC", "o'brien-smith", "ACME CORP"]) {
      const once = titleCase(v);
      assert.equal(titleCase(once), once);
    }
  });
});

describe("trimWhitespace", () => {
  it("trims and collapses runs of spaces", () => {
    assert.equal(trimWhitespace("  a   b  "), "a b");
    assert.equal(trimWhitespace("x\t\ty"), "x y");
  });

  it("leaves clean text unchanged", () => {
    assert.equal(trimWhitespace("clean text"), "clean text");
  });
});

describe("editDistance", () => {
  it("counts a single insertion as 1", () => {
    assert.equal(editDistance("gemany", "germany", 2), 1);
  });

  it("counts an adjacent transposition as 1", () => {
    assert.equal(editDistance("ab", "ba", 2), 1);
    assert.equal(editDistance("germnay", "germany", 2), 1);
  });

  it("returns max + 1 when the distance exceeds the bound", () => {
    assert.equal(editDistance("abcdef", "uvwxyz", 2), 3);
    assert.equal(editDistance("a", "abcdef", 2), 3);
  });

  it("handles empty strings", () => {
    assert.equal(editDistance("", "ab", 2), 2);
    assert.equal(editDistance("", "", 2), 0);
  });
});

describe("normalizeHeader and isNameLike", () => {
  it("normalizes header spelling", () => {
    assert.equal(normalizeHeader(" First Name "), "first_name");
    assert.equal(normalizeHeader("Signup-Date"), "signup_date");
  });

  it("treats digits, @ and / as non-name", () => {
    assert.equal(isNameLike("Jane Ortiz"), true);
    assert.equal(isNameLike("jane@x.com"), false);
    assert.equal(isNameLike("Unit 4"), false);
  });
});
