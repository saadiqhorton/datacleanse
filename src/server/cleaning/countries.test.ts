import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalCountryName, countryFromCode, nearestCountryName } from "./countries";

describe("country lookup", () => {
  it("maps alpha-2 and alpha-3 codes to English names, any case", () => {
    assert.equal(countryFromCode("DE"), "Germany");
    assert.equal(countryFromCode("de"), "Germany");
    assert.equal(countryFromCode("DEU"), "Germany");
    assert.equal(countryFromCode("usa"), "United States");
    assert.equal(countryFromCode("GB"), "United Kingdom");
    assert.equal(countryFromCode("UK"), "United Kingdom");
  });

  it("returns null for values that are not codes", () => {
    assert.equal(countryFromCode("Germany"), null);
    assert.equal(countryFromCode("XQ"), null);
    assert.equal(countryFromCode("D3"), null);
  });

  it("canonicalizes the case of a known name", () => {
    assert.equal(canonicalCountryName("germany"), "Germany");
    assert.equal(canonicalCountryName("  NEW ZEALAND "), "New Zealand");
    assert.equal(canonicalCountryName("Gemany"), null);
  });

  it("finds the one name within the edit distance (typo 'Gemany')", () => {
    assert.deepEqual(nearestCountryName("Gemany", 2), { name: "Germany", distance: 1 });
  });

  it("returns null for short values, far values and ties", () => {
    assert.equal(nearestCountryName("Oman", 2), null);
    assert.equal(nearestCountryName("Zzzzzzz", 2), null);
  });
});
