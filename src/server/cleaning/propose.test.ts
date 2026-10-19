import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ProposedChange, RuleSpec, Table } from "../types";
import { DEFAULT_CLEAN_OPTIONS } from "../types";
import { previewRule, proposeChanges } from "./propose";
import { rulesFromOptions } from "./rules";

function tbl(headers: string[], rows: string[][]): Table {
  return { headers, rows };
}

function rule(
  action: RuleSpec["action"],
  columnPattern: string,
  params: Record<string, unknown> = {},
  extra: Partial<RuleSpec> = {},
): RuleSpec {
  return {
    id: `test:${action}:${columnPattern}`,
    columnPattern,
    action,
    params,
    onLowConfidence: "review",
    enabled: true,
    description: action,
    ...extra,
  };
}

/** Cell changes only (no merges or flags). */
function valueChanges(changes: ProposedChange[]): ProposedChange[] {
  return changes.filter((c) => c.kind === "value");
}

function find(changes: ProposedChange[], rowIndex: number, column: string | null): ProposedChange {
  const hit = changes.find((c) => c.rowIndex === rowIndex && c.column === column);
  assert.ok(hit, `no change for row ${rowIndex} column ${column}`);
  return hit;
}

function defaults(t: Table): ProposedChange[] {
  return proposeChanges(t, rulesFromOptions(DEFAULT_CLEAN_OPTIONS, t.headers));
}

describe("design examples", () => {
  it("dates: '03/04/22' -> '2022-03-04', reason states the column layout share", () => {
    const rows: string[][] = [["03/04/22"], ["03/25/22"]];
    for (let i = 0; i < 96; i++) rows.push([`0${(i % 9) + 1}/1${i % 10}/22`]);
    rows.push(["2022-01-01"], ["2022-01-02"]);
    const changes = valueChanges(defaults(tbl(["signup_date"], rows)));
    const c = find(changes, 0, "signup_date");
    assert.equal(c.before, "03/04/22");
    assert.equal(c.after, "2022-03-04");
    assert.equal(c.reason, "Column is 98% MM/DD/YY");
    assert.equal(c.ruleId, "builtin:normalize_date:signup_date");
    assert.equal(c.decision, "approved");
  });

  it("company: '  acme corp. ' -> 'Acme Corp' with reason 'Trim + title case'", () => {
    const c = find(valueChanges(defaults(tbl(["company"], [["  acme corp. "]]))), 0, "company");
    assert.equal(c.after, "Acme Corp");
    assert.equal(c.reason, "Trim + title case");
    assert.equal(c.ruleId, "builtin:trim_whitespace");
    assert.equal(c.decision, "approved");
  });

  it("phone: '(555)0142 x' -> '+1 555-0142' with reason 'E.164 phone format'", () => {
    const c = find(valueChanges(defaults(tbl(["phone"], [["(555)0142 x"]]))), 0, "phone");
    assert.equal(c.after, "+1 555-0142");
    assert.equal(c.reason, "E.164 phone format");
    assert.equal(c.decision, "approved");
  });

  it("country typo: 'Gemany' -> 'Germany' is a likely typo and needs review", () => {
    const c = find(valueChanges(defaults(tbl(["country"], [["Gemany"]]))), 0, "country");
    assert.equal(c.after, "Germany");
    assert.equal(c.reason, "Likely typo");
    assert.equal(c.decision, "pending");
    assert.ok(c.confidence !== undefined && Math.abs(c.confidence - (1 - 1 / 6)) < 1e-9);
  });

  it("merge: 'J. Ortiz' into 'Jane Ortiz' for the same email, keeping the newer row", () => {
    const changes = defaults(tbl(["name", "email"], [["J. Ortiz", "jane@x.com"], ["Jane Ortiz", "jane@x.com"]]));
    const m = changes.find((c) => c.kind === "merge");
    assert.ok(m);
    assert.equal(m.rowIndex, 0);
    assert.equal(m.mergeIntoRow, 1);
    assert.equal(m.reason, "Same email");
    assert.equal(m.column, null);
    assert.equal(m.before, "J. Ortiz jane@x.com");
    assert.equal(m.after, "Jane Ortiz jane@x.com");
    assert.equal(m.confidence, 0.95);
    assert.equal(m.decision, "approved");
  });
});

describe("chaining and reasons", () => {
  it("emits one change per cell and joins the unique labels", () => {
    const changes = valueChanges(defaults(tbl(["email"], [[" A@B.com "]])));
    assert.equal(changes.length, 1);
    assert.equal(changes[0].after, "a@b.com");
    assert.equal(changes[0].reason, "Trim + lowercase");
  });

  it("names the first rule that changed the cell", () => {
    const c = find(valueChanges(defaults(tbl(["email"], [["A@B.com"]]))), 0, "email");
    assert.equal(c.reason, "lowercase");
    assert.equal(c.ruleId, "builtin:lowercase:email");
  });

  it("chain confidence is the lowest step confidence", () => {
    // Ambiguous dates with no evidence (confidence 0.5) plus surrounding spaces.
    const c = find(valueChanges(defaults(tbl(["signup_date"], [[" 03/04/22 "], ["05/06/22"]]))), 0, "signup_date");
    assert.equal(c.after, "2022-03-04");
    assert.equal(c.confidence, 0.5);
    assert.equal(c.decision, "pending");
  });

  it("a skipped low-confidence step is ignored while the other steps still apply", () => {
    const rules = [
      rule("trim_whitespace", "*", {}, { id: "t", onLowConfidence: "apply" }),
      rule("country_names", "country", { maxDistance: 2 }, { id: "c", onLowConfidence: "skip" }),
    ];
    const changes = valueChanges(proposeChanges(tbl(["country"], [["  Gemany "]]), rules));
    assert.equal(changes.length, 1);
    assert.equal(changes[0].after, "Gemany");
    assert.equal(changes[0].reason, "Trim");
    assert.equal(changes[0].decision, "approved");
  });
});

describe("date order and confidence", () => {
  it("uses dmy evidence in the column to read ambiguous dates as day-first", () => {
    const c = find(valueChanges(defaults(tbl(["signup_date"], [["13/02/2022"], ["03/04/2022"]]))), 1, "signup_date");
    assert.equal(c.after, "2022-04-03");
    assert.equal(c.confidence, 1);
    assert.equal(c.decision, "approved");
  });

  it("ambiguous dates with no evidence are pending at confidence 0.5", () => {
    const c = find(valueChanges(defaults(tbl(["signup_date"], [["03/04/22"], ["05/06/22"]]))), 0, "signup_date");
    assert.equal(c.after, "2022-03-04");
    assert.equal(c.confidence, 0.5);
    assert.equal(c.decision, "pending");
  });

  it("an explicit order is used as chosen and counts as confident", () => {
    const rules = rulesFromOptions({ ...DEFAULT_CLEAN_OPTIONS, dateOrder: "mdy" }, ["signup_date"]);
    const c = find(valueChanges(proposeChanges(tbl(["signup_date"], [["03/04/2022"]]), rules)), 0, "signup_date");
    assert.equal(c.after, "2022-03-04");
    assert.equal(c.confidence, 1);
    assert.equal(c.decision, "approved");
  });

  it("values with a time of day and ISO dates are left unchanged", () => {
    const changes = valueChanges(defaults(tbl(["created_at"], [["2022-03-04 10:00"], ["03/04/22 10:30"], ["2022-03-04"]])));
    assert.equal(changes.length, 0);
  });
});

describe("low-confidence policy", () => {
  it("'apply' approves a low-confidence result", () => {
    const rules = [rule("country_names", "country", {}, { onLowConfidence: "apply" })];
    const c = valueChanges(proposeChanges(tbl(["country"], [["Gemany"]]), rules))[0];
    assert.equal(c.after, "Germany");
    assert.equal(c.decision, "approved");
  });

  it("'skip' emits nothing for a low-confidence result", () => {
    const rules = [rule("country_names", "country", {}, { onLowConfidence: "skip" })];
    assert.equal(proposeChanges(tbl(["country"], [["Gemany"]]), rules).length, 0);
  });
});

describe("country and phone variants", () => {
  it("maps codes to names with the ISO label", () => {
    const c = find(valueChanges(defaults(tbl(["country"], [["DE"]]))), 0, "country");
    assert.equal(c.after, "Germany");
    assert.equal(c.reason, "ISO code → country name");
    assert.equal(c.decision, "approved");
  });

  it("standardizes the case of a known country name", () => {
    const c = find(valueChanges(defaults(tbl(["country"], [["germany"]]))), 0, "country");
    assert.equal(c.after, "Germany");
    assert.equal(c.reason, "Standard country name");
  });

  it("formats phones with the rule's default country", () => {
    const rules = [rule("phone_e164", "phone", { defaultCountry: "GB" })];
    const c = valueChanges(proposeChanges(tbl(["phone"], [["020 7946 0958"]]), rules))[0];
    assert.equal(c.after, "+44 2079460958");
  });
});

describe("title case and lowercase", () => {
  it("title-cases name columns and leaves other columns alone", () => {
    const changes = valueChanges(defaults(tbl(["name", "notes"], [["jane ORTIZ", "jane ORTIZ"]])));
    assert.equal(changes.length, 1);
    assert.equal(changes[0].column, "name");
    assert.equal(changes[0].after, "Jane Ortiz");
    assert.equal(changes[0].reason, "title case");
  });
});

describe("map_values and fix_typos", () => {
  it("maps values through the table, case-insensitively when asked", () => {
    const rules = [rule("map_values", "status", { map: { "n/a": "", yes: "Yes" }, caseInsensitive: true })];
    const changes = valueChanges(proposeChanges(tbl(["status"], [["YES"], ["N/A"], ["no"]]), rules));
    assert.equal(changes.length, 2);
    assert.equal(changes[0].after, "Yes");
    assert.equal(changes[0].reason, "Mapped value");
    assert.equal(changes[1].after, "");
  });

  it("snaps a rare value to a value seen at least 10x as often", () => {
    const rows: string[][] = [];
    for (let i = 0; i < 100; i++) rows.push(["Springfield"]);
    rows.push(["Springfeld"]);
    const rules = [rule("fix_typos", "city")];
    const changes = valueChanges(proposeChanges(tbl(["city"], rows), rules));
    assert.equal(changes.length, 1);
    assert.equal(changes[0].rowIndex, 100);
    assert.equal(changes[0].after, "Springfield");
    assert.equal(changes[0].reason, "Likely typo");
  });
});

describe("exact and key duplicates", () => {
  it("removes exact full-row duplicates, keeping the last row", () => {
    const changes = defaults(tbl(["a", "b"], [["x", "y"], ["x", "y"]]));
    const m = changes.find((c) => c.kind === "merge");
    assert.ok(m);
    assert.equal(m.rowIndex, 0);
    assert.equal(m.mergeIntoRow, 1);
    assert.equal(m.reason, "Exact duplicate");
    assert.equal(m.confidence, 1);
    assert.equal(m.decision, "approved");
    assert.equal(m.ruleId, "builtin:dedupe_exact");
  });

  it("finds exact duplicates after value changes", () => {
    const changes = defaults(tbl(["a"], [["  x  "], ["x"]]));
    const m = changes.find((c) => c.kind === "merge");
    assert.ok(m);
    assert.equal(m.rowIndex, 0);
    assert.equal(m.mergeIntoRow, 1);
  });

  it("keeps the newest row for a key group, and the first with keep 'first'", () => {
    const t = tbl(["email"], [["a@x.com"], ["a@x.com"], ["a@x.com"]]);
    const last = proposeChanges(t, [rule("dedupe_key", "email", { keep: "last" }, { onLowConfidence: "apply" })]);
    assert.deepEqual(last.map((c) => [c.rowIndex, c.mergeIntoRow]), [[0, 2], [1, 2]]);
    const first = proposeChanges(t, [rule("dedupe_key", "email", { keep: "first" }, { onLowConfidence: "apply" })]);
    assert.deepEqual(first.map((c) => [c.rowIndex, c.mergeIntoRow]), [[1, 0], [2, 0]]);
    assert.equal(last[0].reason, "Same email");
  });

  it("dissimilar names give a 0.8 merge that waits for review", () => {
    const changes = defaults(tbl(["name", "email"], [["Bob Smith", "x@y.com"], ["Robert Jones", "x@y.com"]]));
    const m = changes.find((c) => c.kind === "merge");
    assert.ok(m);
    assert.equal(m.confidence, 0.8);
    assert.equal(m.decision, "pending");
    assert.equal(m.rowIndex, 0);
  });

  it("a close spelling of the same name counts as similar (0.95)", () => {
    const changes = defaults(tbl(["name", "email"], [["Jon Smith", "x@y.com"], ["John Smith", "x@y.com"]]));
    const m = changes.find((c) => c.kind === "merge");
    assert.equal(m?.confidence, 0.95);
    assert.equal(m?.decision, "approved");
  });

  it("does not merge rows with blank keys", () => {
    const changes = proposeChanges(tbl(["email", "id"], [["", "1"], ["", "2"]]), [rule("dedupe_key", "email", {}, { onLowConfidence: "apply" })]);
    assert.equal(changes.length, 0);
  });
});

describe("flags", () => {
  it("flags empty cells after value rules, with before '' and after null", () => {
    const changes = proposeChanges(tbl(["a"], [[""], ["x"], ["  "]]), [rule("flag_missing", "*", {}, { id: "flag" })]);
    const flags = changes.filter((c) => c.kind === "flag");
    assert.deepEqual(flags.map((c) => c.rowIndex), [0, 2]);
    assert.equal(flags[0].before, "");
    assert.equal(flags[0].after, null);
    assert.equal(flags[0].reason, "Missing value");
    assert.equal(flags[0].decision, "approved");
  });

  it("a whitespace-only cell gets its trim change and then the flag", () => {
    const changes = proposeChanges(
      tbl(["a"], [["  "]]),
      [rule("trim_whitespace", "*"), rule("flag_missing", "*", {}, { id: "flag" })],
    );
    assert.equal(changes[0].kind, "value");
    assert.equal(changes[0].after, "");
    assert.equal(changes[1].kind, "flag");
  });

  it("pads short rows so missing cells can be flagged", () => {
    const changes = proposeChanges(tbl(["x", "y"], [["a"]]), [rule("flag_missing", "*", {}, { id: "flag" })]);
    assert.deepEqual(changes.map((c) => [c.kind, c.column]), [["flag", "y"]]);
  });
});

describe("previewRule, disabled rules and purity", () => {
  it("previewRule counts matches and returns the first examples", () => {
    const t = tbl(["name"], [["a b"], ["c d"], ["Ok"], ["e f"]]);
    const preview = previewRule(t, rule("title_case", "name"), 2);
    assert.equal(preview.matches, 3);
    assert.equal(preview.examples.length, 2);
    assert.equal(preview.examples[0].after, "A B");
  });

  it("previewRule works on a disabled draft rule", () => {
    const preview = previewRule(tbl(["email"], [[" A@x.com "]]), rule("lowercase", "email", {}, { enabled: false }));
    assert.equal(preview.matches, 1);
  });

  it("disabled rules propose nothing", () => {
    const changes = proposeChanges(tbl(["name"], [["jane"]]), [rule("title_case", "name", {}, { enabled: false })]);
    assert.equal(changes.length, 0);
  });

  it("never mutates the input table", () => {
    const t = tbl(["name", "email", "phone", "signup_date"], [
      ["  jane  ", " JANE@X.com ", "(555)0142 x", "03/04/22"],
      ["jane", "jane@x.com", "", "13/02/2022"],
    ]);
    const before = JSON.stringify(t);
    defaults(t);
    assert.equal(JSON.stringify(t), before);
  });

  it("returns changes in row order", () => {
    const changes = defaults(tbl(["name"], [["a"], ["b"], ["c"]]));
    const rows = changes.map((c) => c.rowIndex);
    assert.deepEqual(rows, [...rows].sort((x, y) => x - y));
  });
});
