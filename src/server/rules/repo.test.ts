import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { insertTestUser, setupTestEnv } from "../testing";
import type { DB } from "../db";
import {
  DEFAULT_RULE_SET_NAME,
  RulesError,
  addHeaders,
  createRule,
  createRuleSet,
  deleteRule,
  deleteRuleSet,
  ensureDefaultRuleSet,
  getRuleSet,
  latestProfiledFile,
  listProfiledFiles,
  listRuleSets,
  listRules,
  loadRuleSpecs,
  moveRule,
  removeHeader,
  renameRuleSet,
  setRuleEnabled,
  toRuleSpec,
  updateRule,
  type RuleRow,
} from "./repo";

let conn: DB;
const ALICE = "usr_alice";
const BOB = "usr_bob";

beforeEach(() => {
  conn = setupTestEnv().db;
  insertTestUser(conn, ALICE, "alice@northwind.co");
  insertTestUser(conn, BOB, "bob@example.com");
});

const dateRule = { columnPattern: "*_date", action: "normalize_date", params: { order: "dmy" }, onLowConfidence: "review" };
const phoneRule = { columnPattern: "phone", action: "phone_e164", params: { defaultCountry: "GB" }, onLowConfidence: "review" };
const trimRule = { columnPattern: "*", action: "trim_whitespace", params: {}, onLowConfidence: "apply" };

function auditCount(action: string, actor: string | null = null): number {
  const sql = actor
    ? "SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND actor_user_id = ?"
    : "SELECT COUNT(*) AS n FROM audit_log WHERE action = ?";
  const args = actor ? [action, actor] : [action];
  return (conn.prepare(sql).get(...args) as { n: number }).n;
}

function positions(setId: string): number[] {
  return (conn.prepare("SELECT position FROM rules WHERE rule_set_id = ? ORDER BY position").all(setId) as { position: number }[]).map(
    (r) => r.position,
  );
}

function rulesIn(setId: string): string[] {
  return listRules(ALICE, setId).map((r) => r.columnPattern);
}

describe("rule sets", () => {
  it("creates a set with a trimmed name and no header match, and lists it for its owner", () => {
    const id = createRuleSet(ALICE, "  Payroll  ");
    const set = getRuleSet(ALICE, id);
    assert.equal(set?.name, "Payroll");
    assert.deepEqual(set?.headerMatch, []);
    assert.equal(set?.ruleCount, 0);
    assert.deepEqual(
      listRuleSets(ALICE).map((s) => s.id),
      [id],
    );
  });

  it("rejects blank, overlong and duplicate names, and allows the same name for another user", () => {
    assert.throws(() => createRuleSet(ALICE, "   "), RulesError);
    assert.throws(() => createRuleSet(ALICE, "x".repeat(81)), RulesError);
    createRuleSet(ALICE, "Payroll");
    assert.throws(() => createRuleSet(ALICE, "payroll"), /already have a rule set named/);
    assert.doesNotThrow(() => createRuleSet(BOB, "Payroll"));
  });

  it("renames a set, allows keeping its own name, and refuses a name another set already has", () => {
    const a = createRuleSet(ALICE, "Payroll");
    createRuleSet(ALICE, "Vendors");
    renameRuleSet(ALICE, a, "Payroll");
    renameRuleSet(ALICE, a, "Payroll 2026");
    assert.equal(getRuleSet(ALICE, a)?.name, "Payroll 2026");
    assert.throws(() => renameRuleSet(ALICE, a, "vendors"), RulesError);
  });

  it("deletes a set together with its rules", () => {
    const id = createRuleSet(ALICE, "Payroll");
    createRule(ALICE, id, dateRule);
    createRule(ALICE, id, phoneRule);
    deleteRuleSet(ALICE, id);
    assert.equal(getRuleSet(ALICE, id), null);
    assert.equal((conn.prepare("SELECT COUNT(*) AS n FROM rules").get() as { n: number }).n, 0);
  });

  it("writes a rules.updated audit entry, attributed to the user, for every change", () => {
    const id = createRuleSet(ALICE, "Payroll");
    renameRuleSet(ALICE, id, "Pay");
    addHeaders(ALICE, id, ["name"]);
    const rule = createRule(ALICE, id, dateRule);
    updateRule(ALICE, rule, { ...dateRule, params: { order: "mdy" } });
    setRuleEnabled(ALICE, rule, false);
    deleteRule(ALICE, rule);
    deleteRuleSet(ALICE, id);
    assert.equal(auditCount("rules.updated", ALICE), 8);
    assert.equal(auditCount("rules.updated", BOB), 0);
  });
});

describe("ownership", () => {
  let setId = "";
  let ruleId = "";

  beforeEach(() => {
    setId = createRuleSet(ALICE, "Payroll");
    ruleId = createRule(ALICE, setId, dateRule);
    addHeaders(ALICE, setId, ["hire_date"]);
  });

  it("hides another user's sets and rules from listings", () => {
    assert.deepEqual(listRuleSets(BOB), []);
    assert.equal(getRuleSet(BOB, setId), null);
    assert.deepEqual(listRules(BOB, setId), []);
  });

  it("refuses every change to another user's set or rule, and leaves it alone", () => {
    assert.throws(() => renameRuleSet(BOB, setId, "Mine now"), /not found/);
    assert.throws(() => deleteRuleSet(BOB, setId), /not found/);
    assert.throws(() => createRule(BOB, setId, phoneRule), /not found/);
    assert.throws(() => updateRule(BOB, ruleId, phoneRule), /not found/);
    assert.throws(() => setRuleEnabled(BOB, ruleId, false), /not found/);
    assert.throws(() => deleteRule(BOB, ruleId), /not found/);
    assert.throws(() => moveRule(BOB, ruleId, "down"), /not found/);
    assert.throws(() => addHeaders(BOB, setId, ["email"]), /not found/);
    assert.throws(() => removeHeader(BOB, setId, "hire_date"), /not found/);

    assert.equal(getRuleSet(ALICE, setId)?.name, "Payroll");
    assert.deepEqual(getRuleSet(ALICE, setId)?.headerMatch, ["hire_date"]);
    assert.equal(listRules(ALICE, setId)[0].enabled, true);
    assert.equal(auditCount("rules.updated", BOB), 0);
  });

  it("still lets the pipeline load the set's rules by set id", () => {
    assert.equal(loadRuleSpecs(setId).length, 1);
  });
});

describe("rules", () => {
  it("adds rules at the end of the set, with a generated description when none is given", () => {
    const setId = createRuleSet(ALICE, "Payroll");
    createRule(ALICE, setId, dateRule);
    createRule(ALICE, setId, { ...phoneRule, description: "Phones in the UK" });
    const rules = listRules(ALICE, setId);
    assert.deepEqual(rules.map((r) => r.position), [0, 1]);
    assert.equal(rules[0].description, "Normalize to YYYY-MM-DD, day first");
    assert.equal(rules[1].description, "Phones in the UK");
  });

  it("validates input: unknown action, bad country code, out-of-range distance, empty map", () => {
    const setId = createRuleSet(ALICE, "Payroll");
    assert.throws(() => createRule(ALICE, setId, { ...trimRule, action: "explode" }), RulesError);
    assert.throws(() => createRule(ALICE, setId, { ...phoneRule, params: { defaultCountry: "USA" } }), /two-letter/);
    assert.throws(
      () => createRule(ALICE, setId, { columnPattern: "city", action: "fix_typos", params: { maxDistance: 5 }, onLowConfidence: "review" }),
      /whole number from 0 to 3/,
    );
    assert.throws(
      () => createRule(ALICE, setId, { columnPattern: "x", action: "map_values", params: { map: {} }, onLowConfidence: "review" }),
      /at least one/,
    );
    assert.throws(() => createRule(ALICE, setId, { ...trimRule, columnPattern: "  " }), /column name or pattern/);
    assert.equal(listRules(ALICE, setId).length, 0);
  });

  it("drops params an action does not take and fills defaults for the ones it does", () => {
    const setId = createRuleSet(ALICE, "Payroll");
    const id = createRule(ALICE, setId, {
      columnPattern: "email",
      action: "dedupe_key",
      params: { junk: true },
      onLowConfidence: "review",
    });
    assert.deepEqual(toRuleSpec(rowOf(id)).params, { keep: "last" });
  });

  it("updates what a rule does but keeps its position and on/off state", () => {
    const setId = createRuleSet(ALICE, "Payroll");
    const first = createRule(ALICE, setId, dateRule);
    const second = createRule(ALICE, setId, trimRule);
    setRuleEnabled(ALICE, second, false);
    updateRule(ALICE, second, { ...phoneRule, description: "Phones" });
    const rules = listRules(ALICE, setId);
    assert.equal(rules[1].id, second);
    assert.equal(rules[1].action, "phone_e164");
    assert.equal(rules[1].enabled, false);
    assert.equal(rules[1].description, "Phones");
    assert.equal(rules[0].id, first);
  });

  it("turns rules on and off", () => {
    const setId = createRuleSet(ALICE, "Payroll");
    const id = createRule(ALICE, setId, trimRule);
    setRuleEnabled(ALICE, id, false);
    assert.equal(listRules(ALICE, setId)[0].enabled, false);
    setRuleEnabled(ALICE, id, true);
    assert.equal(listRules(ALICE, setId)[0].enabled, true);
  });
});

describe("reordering", () => {
  it("swaps a rule with its neighbour and keeps positions 0..n-1", () => {
    const setId = createRuleSet(ALICE, "Payroll");
    const a = createRule(ALICE, setId, { ...dateRule, columnPattern: "a" });
    const b = createRule(ALICE, setId, { ...dateRule, columnPattern: "b" });
    const c = createRule(ALICE, setId, { ...dateRule, columnPattern: "c" });

    assert.equal(moveRule(ALICE, c, "up"), true);
    assert.deepEqual(rulesIn(setId), ["a", "c", "b"]);
    assert.deepEqual(positions(setId), [0, 1, 2]);

    assert.equal(moveRule(ALICE, a, "down"), true);
    assert.deepEqual(rulesIn(setId), ["c", "a", "b"]);
    assert.deepEqual(loadRuleSpecs(setId).map((r) => r.id), [c, a, b]);
  });

  it("does nothing at the top or bottom of the list", () => {
    const setId = createRuleSet(ALICE, "Payroll");
    const a = createRule(ALICE, setId, { ...dateRule, columnPattern: "a" });
    const b = createRule(ALICE, setId, { ...dateRule, columnPattern: "b" });
    assert.equal(moveRule(ALICE, a, "up"), false);
    assert.equal(moveRule(ALICE, b, "down"), false);
    assert.deepEqual(rulesIn(setId), ["a", "b"]);
  });

  it("renumbers positions after a delete", () => {
    const setId = createRuleSet(ALICE, "Payroll");
    createRule(ALICE, setId, { ...dateRule, columnPattern: "a" });
    const b = createRule(ALICE, setId, { ...dateRule, columnPattern: "b" });
    createRule(ALICE, setId, { ...dateRule, columnPattern: "c" });
    deleteRule(ALICE, b);
    assert.deepEqual(rulesIn(setId), ["a", "c"]);
    assert.deepEqual(positions(setId), [0, 1]);
  });
});

describe("header match", () => {
  it("adds headers once, ignoring case and repeats, and keeps their order", () => {
    const setId = createRuleSet(ALICE, "Contacts");
    assert.equal(addHeaders(ALICE, setId, ["Email", "phone"]), 2);
    assert.equal(addHeaders(ALICE, setId, ["email", "Phone", "name"]), 1);
    assert.equal(addHeaders(ALICE, setId, ["NAME"]), 0);
    assert.deepEqual(getRuleSet(ALICE, setId)?.headerMatch, ["Email", "phone", "name"]);
  });

  it("removes a header regardless of case, and refuses one that is not in the set", () => {
    const setId = createRuleSet(ALICE, "Contacts");
    addHeaders(ALICE, setId, ["Email"]);
    removeHeader(ALICE, setId, "email");
    assert.deepEqual(getRuleSet(ALICE, setId)?.headerMatch, []);
    assert.throws(() => removeHeader(ALICE, setId, "email"), /not in this rule set/);
  });

  it("refuses more than 200 headers and empty header names", () => {
    const setId = createRuleSet(ALICE, "Wide");
    const many = Array.from({ length: 200 }, (_, i) => `col_${i}`);
    addHeaders(ALICE, setId, many);
    assert.throws(() => addHeaders(ALICE, setId, ["one_more"]), /at most 200/);
    assert.throws(() => addHeaders(ALICE, setId, [" "]), /Enter a header name/);
  });
});

describe("seeding the default set", () => {
  it("creates CRM exports with the design's rules on the first visit", () => {
    assert.equal(ensureDefaultRuleSet(ALICE), true);
    const [set] = listRuleSets(ALICE);
    assert.equal(set.name, DEFAULT_RULE_SET_NAME);
    assert.deepEqual(set.headerMatch, []);
    const rules = listRules(ALICE, set.id);
    assert.deepEqual(
      rules.map((r) => [r.columnPattern, r.action, r.enabled]),
      [
        ["*_date", "normalize_date", true],
        ["email", "lowercase", true],
        ["email", "dedupe_key", true],
        ["phone", "phone_e164", true],
        ["*", "trim_whitespace", false],
      ],
    );
    assert.deepEqual(rules[0].params, { order: "auto" });
    assert.deepEqual(rules[2].params, { keep: "last" });
    assert.deepEqual(rules[3].params, { defaultCountry: "US" });
  });

  it("seeds only once: a second visit changes nothing", () => {
    ensureDefaultRuleSet(ALICE);
    assert.equal(ensureDefaultRuleSet(ALICE), false);
    assert.equal(listRuleSets(ALICE).length, 1);
    assert.equal(listRules(ALICE, listRuleSets(ALICE)[0].id).length, 5);
  });

  it("does not bring the defaults back after the user deletes every set", () => {
    ensureDefaultRuleSet(ALICE);
    for (const set of listRuleSets(ALICE)) deleteRuleSet(ALICE, set.id);
    assert.equal(ensureDefaultRuleSet(ALICE), false);
    assert.deepEqual(listRuleSets(ALICE), []);
  });

  it("adds nothing for a user who already has a set, and never seeds them later", () => {
    const own = createRuleSet(ALICE, "Vendors");
    assert.equal(ensureDefaultRuleSet(ALICE), false);
    deleteRuleSet(ALICE, own);
    assert.equal(ensureDefaultRuleSet(ALICE), false);
    assert.deepEqual(listRuleSets(ALICE), []);
  });

  it("seeds each user separately", () => {
    ensureDefaultRuleSet(ALICE);
    assert.equal(ensureDefaultRuleSet(BOB), true);
    assert.equal(listRuleSets(BOB).length, 1);
    assert.equal(listRules(BOB, listRuleSets(BOB)[0].id).length, 5);
  });
});

describe("toRuleSpec", () => {
  function row(overrides: Partial<RuleRow>): RuleRow {
    return {
      id: "rule_1",
      rule_set_id: "rset_1",
      column_pattern: "*_date",
      action: "normalize_date",
      params_json: "{}",
      on_low_confidence: "review",
      enabled: 1,
      position: 0,
      description: "Dates",
      ...overrides,
    };
  }

  it("maps a stored row to the pipeline's RuleSpec", () => {
    assert.deepEqual(toRuleSpec(row({ on_low_confidence: "apply", enabled: 0 })), {
      id: "rule_1",
      columnPattern: "*_date",
      action: "normalize_date",
      params: { order: "auto" },
      onLowConfidence: "apply",
      enabled: false,
      description: "Dates",
    });
  });

  it("reads params_json, keeping known keys and dropping unknown ones", () => {
    assert.deepEqual(toRuleSpec(row({ params_json: '{"order":"dmy","extra":1}' })).params, { order: "dmy" });
  });

  it("falls back to the action's defaults when params_json is not valid", () => {
    assert.deepEqual(toRuleSpec(row({ action: "dedupe_key", params_json: "{not json" })).params, { keep: "last" });
    assert.deepEqual(toRuleSpec(row({ action: "dedupe_key", params_json: "[1,2]" })).params, { keep: "last" });
    assert.deepEqual(toRuleSpec(row({ action: "map_values", params_json: '{"map":{"a":1}}' })).params, {});
  });

  it("treats an unknown low-confidence policy as review", () => {
    assert.equal(toRuleSpec(row({ on_low_confidence: "maybe" })).onLowConfidence, "review");
  });
});

describe("profiled files for headers and previews", () => {
  function addFile(id: string, name: string, opts: { createdAt: number; profile?: string | null; storage?: string | null; deleted?: boolean; user?: string }) {
    conn
      .prepare(
        `INSERT INTO files (id, user_id, original_name, alias, size_bytes, status, storage_path, profile_json, created_at, expires_at, deleted_at)
         VALUES (?, ?, ?, ?, 10, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        opts.user ?? ALICE,
        name,
        id,
        opts.deleted ? "deleted" : "ready",
        opts.storage === undefined ? `files/${id}/original.csv` : opts.storage,
        opts.profile === undefined
          ? JSON.stringify({ columns: [{ name: "email", topValues: ["a@x.co"] }, { name: "country", topValues: ["US", "FR"] }] })
          : opts.profile,
        opts.createdAt,
        opts.createdAt + 1000,
        opts.deleted ? opts.createdAt : null,
      );
  }

  it("picks the user's newest usable file, skipping deleted, unprofiled, malformed and other users' files", () => {
    addFile("file_old", "old.csv", { createdAt: 1 });
    addFile("file_new", "new.csv", { createdAt: 3 });
    addFile("file_deleted", "gone.csv", { createdAt: 9, deleted: true });
    addFile("file_unprofiled", "raw.csv", { createdAt: 8, profile: null });
    addFile("file_malformed", "bad.csv", { createdAt: 7, profile: "{oops" });
    addFile("file_nostore", "lost.csv", { createdAt: 6, storage: null });
    addFile("file_bob", "bob.csv", { createdAt: 10, user: BOB });

    const latest = latestProfiledFile(ALICE);
    assert.equal(latest?.name, "new.csv");
    assert.deepEqual(latest?.headers, ["email", "country"]);
    assert.deepEqual(latest?.sampleValues, { email: ["a@x.co"], country: ["US", "FR"] });
    assert.deepEqual(
      listProfiledFiles(ALICE).map((f) => f.name),
      ["new.csv", "old.csv"],
    );
  });

  it("returns null when the user has no usable file", () => {
    assert.equal(latestProfiledFile(ALICE), null);
  });
});

function rowOf(id: string): RuleRow {
  return conn.prepare("SELECT * FROM rules WHERE id = ?").get(id) as RuleRow;
}
