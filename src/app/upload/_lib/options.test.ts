import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dateOrderFor, serializeOptions, toCleanOptions, type UploadValues } from "./options";

const base: UploadValues = {
  mode: "rules_ai",
  normalizeDates: true,
  dedupe: true,
  trimAndCase: true,
  fillMissing: false,
  dateChoice: "detect",
  ruleSetId: "",
};

describe("dateOrderFor", () => {
  it("maps the select values to the server's dateOrder", () => {
    assert.equal(dateOrderFor("detect"), "auto");
    assert.equal(dateOrderFor("month-day"), "mdy");
    assert.equal(dateOrderFor("day-month"), "dmy");
  });
});

describe("toCleanOptions", () => {
  it("uses the server's option names", () => {
    assert.deepEqual(toCleanOptions({ ...base, dateChoice: "day-month", fillMissing: true }), {
      normalizeDates: true,
      dedupe: true,
      trimAndCase: true,
      fillMissing: true,
      dateOrder: "dmy",
    });
  });
});

describe("serializeOptions", () => {
  it("is JSON the server parses into the same options", () => {
    const parsed = JSON.parse(serializeOptions({ ...base, normalizeDates: false }));
    assert.deepEqual(Object.keys(parsed).sort(), ["dateOrder", "dedupe", "fillMissing", "normalizeDates", "trimAndCase"]);
    assert.equal(parsed.normalizeDates, false);
    assert.equal(parsed.dateOrder, "auto");
  });
});
