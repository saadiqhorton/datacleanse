import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CLEAN_OPTIONS, type CleanOptions, type ColumnStats } from "../types";
import { matchRuleSet, rulesFromOptions } from "./rules";

const HEADERS = ["first_name", "last_name", "email", "signup_date", "phone", "country", "company", "notes"];

function ids(rules: { id: string }[]): string[] {
  return rules.map((r) => r.id);
}

describe("rulesFromOptions", () => {
  it("builds the default rules for a typical CRM header set", () => {
    const rules = rulesFromOptions(DEFAULT_CLEAN_OPTIONS, HEADERS);
    const got = ids(rules);
    assert.ok(got.includes("builtin:trim_whitespace"));
    assert.ok(got.includes("builtin:title_case:first_name"));
    assert.ok(got.includes("builtin:title_case:last_name"));
    assert.ok(got.includes("builtin:title_case:company"));
    assert.ok(!got.includes("builtin:title_case:notes"));
    assert.ok(got.includes("builtin:lowercase:email"));
    assert.ok(got.includes("builtin:normalize_date:signup_date"));
    assert.ok(got.includes("builtin:phone_e164:phone"));
    assert.ok(got.includes("builtin:country_names:country"));
    assert.ok(got.includes("builtin:dedupe_key:email"));
    assert.ok(got.includes("builtin:dedupe_exact"));
    assert.ok(!got.includes("builtin:flag_missing"));
  });

  it("passes the date order through and defaults phones to US", () => {
    const rules = rulesFromOptions({ ...DEFAULT_CLEAN_OPTIONS, dateOrder: "dmy" }, ["signup_date"]);
    const date = rules.find((r) => r.action === "normalize_date");
    assert.deepEqual(date?.params, { order: "dmy" });
    const phones = rulesFromOptions(DEFAULT_CLEAN_OPTIONS, ["mobile"]).find((r) => r.action === "phone_e164");
    assert.deepEqual(phones?.params, { defaultCountry: "US" });
  });

  it("omits every option-driven rule when its option is off", () => {
    const off: CleanOptions = { normalizeDates: false, dedupe: false, trimAndCase: false, fillMissing: false, dateOrder: "auto" };
    const rules = rulesFromOptions(off, HEADERS);
    const actions = new Set(rules.map((r) => r.action));
    assert.equal(actions.has("trim_whitespace"), false);
    assert.equal(actions.has("title_case"), false);
    assert.equal(actions.has("normalize_date"), false);
    assert.equal(actions.has("dedupe_key"), false);
    // Phone and country rules have no Upload option of their own, so they stay on whenever the header matches.
    assert.equal(actions.has("phone_e164"), true);
  });

  it("adds a flag rule for every column when fillMissing is on", () => {
    const rules = rulesFromOptions({ ...DEFAULT_CLEAN_OPTIONS, fillMissing: true }, ["a"]);
    const flag = rules.find((r) => r.action === "flag_missing");
    assert.equal(flag?.columnPattern, "*");
  });

  it("uses column types when stats are supplied", () => {
    const columns: ColumnStats[] = [
      { name: "joined", type: "date", nullCount: 0, distinctCount: 1, topValues: [], typeConfidence: 1, pii: false },
      { name: "contact_address", type: "email", nullCount: 0, distinctCount: 1, topValues: [], typeConfidence: 1, pii: true },
    ];
    const got = ids(rulesFromOptions(DEFAULT_CLEAN_OPTIONS, ["joined", "contact_address"], columns));
    assert.ok(got.includes("builtin:normalize_date:joined"));
    assert.ok(got.includes("builtin:lowercase:contact_address"));
    assert.ok(got.includes("builtin:dedupe_key:contact_address"));
  });

  it("escapes header names so they match literally", () => {
    const rules = rulesFromOptions(DEFAULT_CLEAN_OPTIONS, ["signup_date*"]);
    const date = rules.find((r) => r.action === "normalize_date");
    assert.equal(date?.columnPattern, "signup_date\\*");
  });

  it("does not repeat a rule for a duplicated header", () => {
    const rules = rulesFromOptions(DEFAULT_CLEAN_OPTIONS, ["signup_date", "signup_date"]);
    assert.equal(rules.filter((r) => r.action === "normalize_date").length, 1);
  });
});

describe("matchRuleSet", () => {
  const sets = [
    { id: "crm", headerMatch: ["email", "phone"] },
    { id: "crm-full", headerMatch: ["email", "phone", "company"] },
    { id: "payroll", headerMatch: ["employee_id", "salary"] },
  ];

  it("matches headers case-insensitively when every name is present", () => {
    assert.equal(matchRuleSet(["Email", "PHONE", "Notes"], sets), "crm");
  });

  it("prefers the set with the most header names", () => {
    assert.equal(matchRuleSet(["email", "phone", "company"], sets), "crm-full");
  });

  it("returns null when no set matches", () => {
    assert.equal(matchRuleSet(["email"], sets), null);
    assert.equal(matchRuleSet(["x"], [{ id: "empty", headerMatch: [] }]), null);
  });
});
