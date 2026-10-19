import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_LABELS,
  RULE_ACTIONS,
  describeRule,
  parseRuleParams,
  parseStoredParams,
  readParams,
  ruleSummary,
  type RuleView,
} from "./params";
import {
  fieldsFromRule,
  formatMapText,
  paramsFromFields,
  parseHeaderName,
  parseMapText,
  parseRuleInput,
  parseSetName,
  emptyRuleFields,
  type RuleFields,
} from "./input";

function fieldsFor(action: RuleFields["action"], overrides: Partial<RuleFields> = {}): RuleFields {
  return { ...emptyRuleFields(), action, ...overrides };
}

describe("action metadata", () => {
  it("has a friendly label for every action", () => {
    assert.equal(RULE_ACTIONS.length, 10);
    for (const action of RULE_ACTIONS) assert.ok(ACTION_LABELS[action].length > 0, action);
  });
});

describe("parseRuleParams", () => {
  it("fills defaults for missing params", () => {
    assert.deepEqual(parseRuleParams("normalize_date", undefined), { ok: true, value: { order: "auto" } });
    assert.deepEqual(parseRuleParams("phone_e164", {}), { ok: true, value: { defaultCountry: "US" } });
    assert.deepEqual(parseRuleParams("dedupe_key", {}), { ok: true, value: { keep: "last" } });
    assert.deepEqual(parseRuleParams("fix_typos", {}), { ok: true, value: { maxDistance: 2 } });
    assert.deepEqual(parseRuleParams("country_names", {}), { ok: true, value: { maxDistance: 2 } });
    assert.deepEqual(parseRuleParams("map_values", { map: { UK: "United Kingdom" } }), {
      ok: true,
      value: { map: { UK: "United Kingdom" }, caseInsensitive: false },
    });
  });

  it("accepts the values each action takes and upper-cases the country code", () => {
    assert.deepEqual(parseRuleParams("normalize_date", { order: "dmy" }), { ok: true, value: { order: "dmy" } });
    assert.deepEqual(parseRuleParams("phone_e164", { defaultCountry: "gb" }), { ok: true, value: { defaultCountry: "GB" } });
    assert.deepEqual(parseRuleParams("dedupe_key", { keep: "first" }), { ok: true, value: { keep: "first" } });
    assert.deepEqual(parseRuleParams("fix_typos", { maxDistance: 0 }), { ok: true, value: { maxDistance: 0 } });
  });

  it("rejects values outside what the action takes, with a message for the person", () => {
    const bad: [string, unknown, RegExp][] = [
      ["normalize_date", { order: "ymd" }, /day and month/],
      ["phone_e164", { defaultCountry: "USA" }, /two-letter country code/],
      ["phone_e164", { defaultCountry: "1" }, /two-letter country code/],
      ["dedupe_key", { keep: "middle" }, /which duplicate/],
      ["fix_typos", { maxDistance: 4 }, /whole number from 0 to 3/],
      ["fix_typos", { maxDistance: 1.5 }, /whole number from 0 to 3/],
      ["fix_typos", { maxDistance: Number.NaN }, /whole number from 0 to 3/],
      ["map_values", { map: {} }, /at least one/],
      ["map_values", { map: { "": "x" } }, /needs text/],
      ["map_values", { map: { a: 1 } }, /must be text/],
    ];
    for (const [action, params, message] of bad) {
      const result = parseRuleParams(action, params);
      assert.equal(result.ok, false, `${action} ${JSON.stringify(params)}`);
      if (!result.ok) assert.match(result.error, message);
    }
  });

  it("refuses an unknown action", () => {
    assert.deepEqual(parseRuleParams("explode", {}), { ok: false, error: "Choose an action." });
    assert.deepEqual(parseRuleParams("__proto__", {}), { ok: false, error: "Choose an action." });
  });

  it("drops keys an action does not take", () => {
    assert.deepEqual(parseRuleParams("lowercase", { anything: 1 }), { ok: true, value: {} });
  });
});

describe("parseStoredParams", () => {
  it("returns the stored values, filled with defaults, and falls back to defaults for bad JSON", () => {
    assert.deepEqual(parseStoredParams("dedupe_key", '{"keep":"first"}'), { keep: "first" });
    assert.deepEqual(parseStoredParams("dedupe_key", "{nope"), { keep: "last" });
    assert.deepEqual(parseStoredParams("dedupe_key", '"text"'), { keep: "last" });
    assert.deepEqual(parseStoredParams("map_values", "{}"), {});
    assert.deepEqual(parseStoredParams("explode", "{}"), {});
  });
});

describe("readParams", () => {
  it("gives typed values with defaults for anything missing or wrong", () => {
    assert.deepEqual(readParams({}), {
      order: "auto",
      defaultCountry: "US",
      keep: "last",
      maxDistance: 2,
      map: {},
      caseInsensitive: false,
    });
    assert.deepEqual(readParams({ order: "dmy", keep: "first", map: ["x"], caseInsensitive: "yes" }).map, {});
    assert.equal(readParams({ order: "mdy" }).order, "mdy");
  });
});

describe("summaries and draft lines", () => {
  it("writes the default description for a date rule the way the design does", () => {
    assert.equal(ruleSummary("normalize_date", { order: "auto" }), "Normalize to YYYY-MM-DD, day/month order detected per column");
  });

  it("describes a country rule with its typo tolerance and low-confidence policy", () => {
    const lines = describeRule({
      columnPattern: "country",
      action: "country_names",
      params: { maxDistance: 2 },
      onLowConfidence: "review",
    });
    assert.deepEqual(lines, {
      column: "country",
      does: "map ISO-3166 codes → English names",
      typos: "edit distance 2",
      lowConfidence: "ask for review",
    });
  });

  it("gives no typo line for actions that do not fix typos", () => {
    const lines = describeRule({ columnPattern: "*", action: "trim_whitespace", params: {}, onLowConfidence: "skip" });
    assert.equal(lines.typos, null);
    assert.equal(lines.lowConfidence, "skip it");
  });
});

describe("map text", () => {
  it("parses one 'old -> new' pair per line, with either arrow and blank lines ignored", () => {
    assert.deepEqual(parseMapText("UK -> United Kingdom\n\n  USA → United States  \n"), {
      ok: true,
      value: { UK: "United Kingdom", USA: "United States" },
    });
  });

  it("explains a line it cannot read, by line number", () => {
    assert.deepEqual(parseMapText("UK -> United Kingdom\nFrance"), {
      ok: false,
      error: 'Line 2 needs the form "old value -> new value".',
    });
    assert.deepEqual(parseMapText(" -> Nowhere"), { ok: false, error: "Line 1 is missing the old value." });
  });

  it("refuses a repeated old value and an empty list", () => {
    assert.equal(parseMapText("a -> 1\na -> 2").ok, false);
    assert.equal(parseMapText("\n  \n").ok, false);
  });

  it("keeps keys such as __proto__ as ordinary entries", () => {
    const parsed = parseMapText("__proto__ -> safe");
    assert.ok(parsed.ok);
    assert.deepEqual(Object.keys(parsed.value), ["__proto__"]);
  });

  it("round-trips through formatMapText", () => {
    const map = { "N/A": "", UK: "United Kingdom" };
    assert.deepEqual(parseMapText(formatMapText(map)), { ok: true, value: map });
  });
});

describe("editor fields", () => {
  it("builds the params for each action from the fields", () => {
    assert.deepEqual(paramsFromFields(fieldsFor("normalize_date", { order: "mdy" })), { ok: true, value: { order: "mdy" } });
    assert.deepEqual(paramsFromFields(fieldsFor("phone_e164", { defaultCountry: "de" })), {
      ok: true,
      value: { defaultCountry: "DE" },
    });
    assert.deepEqual(paramsFromFields(fieldsFor("dedupe_key", { keep: "first" })), { ok: true, value: { keep: "first" } });
    assert.deepEqual(paramsFromFields(fieldsFor("country_names", { maxDistance: "3" })), { ok: true, value: { maxDistance: 3 } });
    assert.deepEqual(
      paramsFromFields(fieldsFor("map_values", { mapText: "a -> b", caseInsensitive: true })),
      { ok: true, value: { map: { a: "b" }, caseInsensitive: true } },
    );
    assert.deepEqual(paramsFromFields(fieldsFor("trim_whitespace")), { ok: true, value: {} });
  });

  it("reports a blank or out-of-range typo tolerance and a bad map", () => {
    assert.equal(paramsFromFields(fieldsFor("fix_typos", { maxDistance: "" })).ok, false);
    assert.equal(paramsFromFields(fieldsFor("fix_typos", { maxDistance: "7" })).ok, false);
    const badMap = paramsFromFields(fieldsFor("map_values", { mapText: "no arrow here" }));
    assert.equal(badMap.ok, false);
  });

  it("round-trips a saved rule through the editor without changing its params", () => {
    const rule: RuleView = {
      id: "rule_1",
      ruleSetId: "rset_1",
      position: 0,
      columnPattern: "city",
      action: "map_values",
      params: { map: { NYC: "New York", "L.A.": "Los Angeles" }, caseInsensitive: true },
      onLowConfidence: "skip",
      enabled: true,
      description: "City names",
    };
    const fields: RuleFields = fieldsFromRule(rule);
    assert.equal(fields.mapText, "NYC -> New York\nL.A. -> Los Angeles");
    assert.deepEqual(paramsFromFields(fields), { ok: true, value: rule.params });
  });
});

describe("parseRuleInput", () => {
  it("accepts a complete rule and fills the description from the action when it is blank", () => {
    const result = parseRuleInput({
      columnPattern: "  phone ",
      action: "phone_e164",
      onLowConfidence: "apply",
      description: "",
      params: { defaultCountry: "GB" },
    });
    assert.deepEqual(result, {
      ok: true,
      value: {
        columnPattern: "phone",
        action: "phone_e164",
        onLowConfidence: "apply",
        description: "Format as E.164, default country GB",
        params: { defaultCountry: "GB" },
      },
    });
  });

  it("defaults the low-confidence policy to review", () => {
    const result = parseRuleInput({ columnPattern: "x", action: "lowercase", params: {} });
    assert.ok(result.ok);
    assert.equal(result.value.onLowConfidence, "review");
  });

  it("rejects bad columns, actions, policies, long descriptions and bad params", () => {
    const base = { columnPattern: "x", action: "lowercase", onLowConfidence: "review", description: "", params: {} };
    const cases: [object, RegExp][] = [
      [{ ...base, columnPattern: "" }, /column name or pattern/],
      [{ ...base, columnPattern: "a\nb" }, /line breaks/],
      [{ ...base, columnPattern: "x".repeat(101) }, /under 100/],
      [{ ...base, action: "nope" }, /Choose an action/],
      [{ ...base, onLowConfidence: "maybe" }, /low confidence/],
      [{ ...base, description: "x".repeat(201) }, /under 200/],
      [{ ...base, action: "phone_e164", params: { defaultCountry: "USA" } }, /two-letter/],
    ];
    for (const [input, message] of cases) {
      const result = parseRuleInput(input);
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, message);
    }
    assert.equal(parseRuleInput(null).ok, false);
  });
});

describe("set names and header names", () => {
  it("trims and bounds set names", () => {
    assert.deepEqual(parseSetName("  Payroll "), { ok: true, value: "Payroll" });
    assert.equal(parseSetName("   ").ok, false);
    assert.equal(parseSetName("x".repeat(81)).ok, false);
    assert.equal(parseSetName(42).ok, false);
  });

  it("trims and bounds header names", () => {
    assert.deepEqual(parseHeaderName(" email "), { ok: true, value: "email" });
    assert.equal(parseHeaderName("").ok, false);
    assert.equal(parseHeaderName("x".repeat(101)).ok, false);
  });
});
