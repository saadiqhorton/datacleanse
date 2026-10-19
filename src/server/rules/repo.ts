/**
 * Saved rule sets and their rules. Every function takes the user id and checks ownership in SQL,
 * so a rule set or rule that belongs to someone else reads as "not found".
 * Rules have no user_id of their own: they are owned through rule_sets.user_id.
 */

import { audit } from "../audit";
import { db } from "../db";
import { newId } from "../ids";
import type { RuleAction, RuleSpec } from "../types";
import { parseHeaderName, parseRuleInput, parseSetName, type RuleInput } from "./input";
import { ACTION_LABELS, parseStoredParams, type RuleView } from "./params";

/** A failure the person can read. Server actions show its message; anything else is a bug. */
export class RulesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RulesError";
  }
}

export const DEFAULT_RULE_SET_NAME = "CRM exports";
const MAX_HEADERS = 200;

/** The starting rules for a new account, from the design. Email needs two actions, so it has two rows. */
interface DefaultRule {
  columnPattern: string;
  action: RuleAction;
  params: Record<string, unknown>;
  onLowConfidence: RuleInput["onLowConfidence"];
  enabled: boolean;
  description: string;
}

export const DEFAULT_RULES: DefaultRule[] = [
  {
    columnPattern: "*_date",
    action: "normalize_date",
    params: { order: "auto" },
    onLowConfidence: "review",
    enabled: true,
    description: "Normalize to YYYY-MM-DD, detect day/month order per column",
  },
  {
    columnPattern: "email",
    action: "lowercase",
    params: {},
    onLowConfidence: "apply",
    enabled: true,
    description: "Lowercase email addresses",
  },
  {
    columnPattern: "email",
    action: "dedupe_key",
    params: { keep: "last" },
    onLowConfidence: "review",
    enabled: true,
    description: "Treat matching emails as duplicates, keep the newest row",
  },
  {
    columnPattern: "phone",
    action: "phone_e164",
    params: { defaultCountry: "US" },
    onLowConfidence: "review",
    enabled: true,
    description: "Format as E.164, default country US",
  },
  {
    columnPattern: "*",
    action: "trim_whitespace",
    params: {},
    onLowConfidence: "apply",
    enabled: false,
    description: "Trim whitespace, collapse double spaces",
  },
];

export interface RuleSetView {
  id: string;
  name: string;
  headerMatch: string[];
  ruleCount: number;
  createdAt: number;
  updatedAt: number;
}

interface SetRow {
  id: string;
  user_id: string;
  name: string;
  header_match_json: string;
  created_at: number;
  updated_at: number;
  rule_count?: number;
}

export interface RuleRow {
  id: string;
  rule_set_id: string;
  column_pattern: string;
  action: string;
  params_json: string;
  on_low_confidence: string;
  enabled: number;
  position: number;
  description: string;
}

interface RuleJoinRow extends RuleRow {
  set_name: string;
}

/** The pipeline's view of one stored rule. Bad params fall back to the action's defaults. */
export function toRuleSpec(row: RuleRow): RuleSpec {
  const action = row.action as RuleAction;
  return {
    id: row.id,
    columnPattern: row.column_pattern,
    action,
    params: parseStoredParams(action, row.params_json),
    onLowConfidence: row.on_low_confidence === "apply" || row.on_low_confidence === "skip" ? row.on_low_confidence : "review",
    enabled: row.enabled === 1,
    description: row.description,
  };
}

function toRuleView(row: RuleRow): RuleView {
  return { ...toRuleSpec(row), ruleSetId: row.rule_set_id, position: row.position };
}

function parseHeaderMatch(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
}

function toSetView(row: SetRow): RuleSetView {
  return {
    id: row.id,
    name: row.name,
    headerMatch: parseHeaderMatch(row.header_match_json),
    ruleCount: row.rule_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function orThrow<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new RulesError(result.error);
  return result.value;
}

function requireSet(userId: string, setId: string): SetRow {
  const row = db()
    .prepare("SELECT * FROM rule_sets WHERE id = ? AND user_id = ?")
    .get(setId, userId) as SetRow | undefined;
  if (!row) throw new RulesError("That rule set was not found.");
  return row;
}

function requireRule(userId: string, ruleId: string): RuleJoinRow {
  const row = db()
    .prepare(
      `SELECT r.*, s.name AS set_name FROM rules r
       JOIN rule_sets s ON s.id = r.rule_set_id
       WHERE r.id = ? AND s.user_id = ?`,
    )
    .get(ruleId, userId) as RuleJoinRow | undefined;
  if (!row) throw new RulesError("That rule was not found.");
  return row;
}

function assertNameFree(userId: string, name: string, exceptId: string | null) {
  const clash = db()
    .prepare("SELECT id FROM rule_sets WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?")
    .get(userId, name, exceptId ?? "");
  if (clash) throw new RulesError(`You already have a rule set named "${name}".`);
}

/** Rule sets for the user, oldest first. */
export function listRuleSets(userId: string): RuleSetView[] {
  const rows = db()
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM rules r WHERE r.rule_set_id = s.id) AS rule_count
       FROM rule_sets s WHERE s.user_id = ? ORDER BY s.created_at, s.id`,
    )
    .all(userId) as SetRow[];
  return rows.map(toSetView);
}

export function getRuleSet(userId: string, setId: string): RuleSetView | null {
  const row = db().prepare("SELECT * FROM rule_sets WHERE id = ? AND user_id = ?").get(setId, userId) as SetRow | undefined;
  return row ? toSetView(row) : null;
}

/** Rules in a set, in the order they run. An unknown or foreign set gives an empty list. */
export function listRules(userId: string, setId: string): RuleView[] {
  const rows = db()
    .prepare(
      `SELECT r.* FROM rules r JOIN rule_sets s ON s.id = r.rule_set_id
       WHERE r.rule_set_id = ? AND s.user_id = ? ORDER BY r.position, r.id`,
    )
    .all(setId, userId) as RuleRow[];
  return rows.map(toRuleView);
}

/**
 * The rules a pipeline run uses for one rule set, in order, including disabled ones (RuleSpec.enabled says
 * which). Not ownership-checked: the caller must already have checked that the set belongs to the file's owner.
 */
export function loadRuleSpecs(ruleSetId: string): RuleSpec[] {
  const rows = db()
    .prepare("SELECT * FROM rules WHERE rule_set_id = ? ORDER BY position, id")
    .all(ruleSetId) as RuleRow[];
  return rows.map(toRuleSpec);
}

export function createRuleSet(userId: string, rawName: unknown): string {
  const name = orThrow(parseSetName(rawName));
  return db().transaction(() => {
    assertNameFree(userId, name, null);
    const id = newId("rset");
    const now = Date.now();
    db()
      .prepare("INSERT INTO rule_sets (id, user_id, name, header_match_json, created_at, updated_at) VALUES (?, ?, ?, '[]', ?, ?)")
      .run(id, userId, name, now, now);
    audit("rules.updated", `Created rule set "${name}"`, { actor: userId });
    return id;
  })();
}

export function renameRuleSet(userId: string, setId: string, rawName: unknown): void {
  const name = orThrow(parseSetName(rawName));
  db().transaction(() => {
    const set = requireSet(userId, setId);
    if (set.name === name) return;
    assertNameFree(userId, name, setId);
    db().prepare("UPDATE rule_sets SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), setId);
    audit("rules.updated", `Renamed rule set "${set.name}" to "${name}"`, { actor: userId });
  })();
}

/** Deletes a set and its rules. Files that used it keep their cleaning results (files.rule_set_id is cleared). */
export function deleteRuleSet(userId: string, setId: string): void {
  db().transaction(() => {
    const set = requireSet(userId, setId);
    const { n } = db().prepare("SELECT COUNT(*) AS n FROM rules WHERE rule_set_id = ?").get(setId) as { n: number };
    db().prepare("DELETE FROM rule_sets WHERE id = ?").run(setId);
    audit("rules.updated", `Deleted rule set "${set.name}" with ${n} ${n === 1 ? "rule" : "rules"}`, { actor: userId });
  })();
}

/** Adds headers a set matches on. Case-insensitive duplicates are skipped. Returns how many were added. */
export function addHeaders(userId: string, setId: string, rawHeaders: unknown[]): number {
  const cleaned = rawHeaders.map((h) => orThrow(parseHeaderName(h)));
  return db().transaction(() => {
    const set = requireSet(userId, setId);
    const current = parseHeaderMatch(set.header_match_json);
    const seen = new Set(current.map((h) => h.toLowerCase()));
    const added: string[] = [];
    for (const header of cleaned) {
      const key = header.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(header);
    }
    if (added.length === 0) return 0;
    if (current.length + added.length > MAX_HEADERS) {
      throw new RulesError(`A rule set can match at most ${MAX_HEADERS} headers.`);
    }
    db()
      .prepare("UPDATE rule_sets SET header_match_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify([...current, ...added]), Date.now(), setId);
    const what = added.length === 1 ? `header "${added[0]}"` : `${added.length} headers`;
    audit("rules.updated", `Added ${what} to rule set "${set.name}"`, { actor: userId });
    return added.length;
  })();
}

export function removeHeader(userId: string, setId: string, rawHeader: unknown): void {
  const header = orThrow(parseHeaderName(rawHeader));
  db().transaction(() => {
    const set = requireSet(userId, setId);
    const current = parseHeaderMatch(set.header_match_json);
    const next = current.filter((h) => h.toLowerCase() !== header.toLowerCase());
    if (next.length === current.length) throw new RulesError("That header is not in this rule set.");
    db()
      .prepare("UPDATE rule_sets SET header_match_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(next), Date.now(), setId);
    audit("rules.updated", `Removed header "${header}" from rule set "${set.name}"`, { actor: userId });
  })();
}

function nextPosition(setId: string): number {
  const { next } = db()
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM rules WHERE rule_set_id = ?")
    .get(setId) as { next: number };
  return next;
}

/** Writes positions 0..n-1 in the given order. */
function writePositions(ids: string[]) {
  const update = db().prepare("UPDATE rules SET position = ? WHERE id = ?");
  ids.forEach((id, position) => update.run(position, id));
}

function ruleIdsInOrder(setId: string): string[] {
  return (db().prepare("SELECT id FROM rules WHERE rule_set_id = ? ORDER BY position, id").all(setId) as { id: string }[]).map(
    (r) => r.id,
  );
}

/** Adds a rule at the end of a set. Returns the new rule id. */
export function createRule(userId: string, setId: string, raw: unknown): string {
  const input = orThrow(parseRuleInput(raw));
  return db().transaction(() => {
    const set = requireSet(userId, setId);
    const id = newId("rule");
    db()
      .prepare(
        `INSERT INTO rules (id, rule_set_id, column_pattern, action, params_json, on_low_confidence, enabled, position, description)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        setId,
        input.columnPattern,
        input.action,
        JSON.stringify(input.params),
        input.onLowConfidence,
        nextPosition(setId),
        input.description,
      );
    audit("rules.updated", `Added rule "${input.columnPattern}" (${ACTION_LABELS[input.action]}) to "${set.name}"`, {
      actor: userId,
    });
    return id;
  })();
}

/** Replaces what a rule does. Its position and on/off state are kept. */
export function updateRule(userId: string, ruleId: string, raw: unknown): void {
  const input = orThrow(parseRuleInput(raw));
  db().transaction(() => {
    const rule = requireRule(userId, ruleId);
    db()
      .prepare(
        "UPDATE rules SET column_pattern = ?, action = ?, params_json = ?, on_low_confidence = ?, description = ? WHERE id = ?",
      )
      .run(input.columnPattern, input.action, JSON.stringify(input.params), input.onLowConfidence, input.description, ruleId);
    audit("rules.updated", `Edited rule "${input.columnPattern}" (${ACTION_LABELS[input.action]}) in "${rule.set_name}"`, {
      actor: userId,
    });
  })();
}

export function setRuleEnabled(userId: string, ruleId: string, enabled: boolean): void {
  db().transaction(() => {
    const rule = requireRule(userId, ruleId);
    db().prepare("UPDATE rules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, ruleId);
    audit("rules.updated", `Turned rule "${rule.column_pattern}" ${enabled ? "on" : "off"} in "${rule.set_name}"`, {
      actor: userId,
    });
  })();
}

export function deleteRule(userId: string, ruleId: string): void {
  db().transaction(() => {
    const rule = requireRule(userId, ruleId);
    db().prepare("DELETE FROM rules WHERE id = ?").run(ruleId);
    writePositions(ruleIdsInOrder(rule.rule_set_id));
    audit("rules.updated", `Deleted rule "${rule.column_pattern}" from "${rule.set_name}"`, { actor: userId });
  })();
}

/** Swaps a rule with its neighbour. Returns false when it is already first or last. */
export function moveRule(userId: string, ruleId: string, direction: "up" | "down"): boolean {
  return db().transaction(() => {
    const rule = requireRule(userId, ruleId);
    const ids = ruleIdsInOrder(rule.rule_set_id);
    const from = ids.indexOf(ruleId);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from === -1 || to < 0 || to >= ids.length) return false;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    writePositions(ids);
    audit("rules.updated", `Moved rule "${rule.column_pattern}" ${direction} in "${rule.set_name}"`, { actor: userId });
    return true;
  })();
}

/**
 * Creates the default "CRM exports" set the first time a user opens the Rules screen. Runs once per
 * user: the audit entry "rules.seeded" is the record that the check has happened, so deleting every set
 * later does not bring the defaults back. Returns true when a set was created.
 */
export function ensureDefaultRuleSet(userId: string): boolean {
  return db().transaction(() => {
    const checked = db()
      .prepare("SELECT 1 FROM audit_log WHERE actor_user_id = ? AND action = 'rules.seeded' LIMIT 1")
      .get(userId);
    if (checked) return false;

    const { n } = db().prepare("SELECT COUNT(*) AS n FROM rule_sets WHERE user_id = ?").get(userId) as { n: number };
    if (n > 0) {
      audit("rules.seeded", "Rule sets already existed; no default set added", { actor: userId });
      return false;
    }

    const setId = newId("rset");
    const now = Date.now();
    db()
      .prepare("INSERT INTO rule_sets (id, user_id, name, header_match_json, created_at, updated_at) VALUES (?, ?, ?, '[]', ?, ?)")
      .run(setId, userId, DEFAULT_RULE_SET_NAME, now, now);
    const insert = db().prepare(
      `INSERT INTO rules (id, rule_set_id, column_pattern, action, params_json, on_low_confidence, enabled, position, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    DEFAULT_RULES.forEach((rule, position) => {
      insert.run(
        newId("rule"),
        setId,
        rule.columnPattern,
        rule.action,
        JSON.stringify(rule.params),
        rule.onLowConfidence,
        rule.enabled ? 1 : 0,
        position,
        rule.description,
      );
    });
    audit("rules.seeded", `Created the default rule set "${DEFAULT_RULE_SET_NAME}"`, { actor: userId });
    return true;
  })();
}

export interface ProfiledFile {
  id: string;
  name: string;
  storagePath: string;
  headers: string[];
  /** Up to 10 top values per column, keyed by header. */
  sampleValues: Record<string, string[]>;
}

interface ProfileColumn {
  name: string;
  topValues: string[];
}

function parseProfileColumns(json: string): ProfileColumn[] | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const columns = (value as { columns?: unknown }).columns;
  if (!Array.isArray(columns)) return null;
  return columns
    .filter((c): c is { name: string; topValues?: unknown } => c !== null && typeof c === "object" && typeof (c as { name?: unknown }).name === "string")
    .map((c) => ({
      name: c.name,
      topValues: Array.isArray(c.topValues) ? c.topValues.filter((v): v is string => typeof v === "string").slice(0, 10) : [],
    }));
}

/** The user's newest files that have a profile and an original on disk, newest first. */
export function listProfiledFiles(userId: string, limit = 10): ProfiledFile[] {
  const rows = db()
    .prepare(
      `SELECT id, original_name, storage_path, profile_json FROM files
       WHERE user_id = ? AND deleted_at IS NULL AND status != 'deleted'
         AND storage_path IS NOT NULL AND profile_json IS NOT NULL
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(userId, limit) as { id: string; original_name: string; storage_path: string; profile_json: string }[];

  const out: ProfiledFile[] = [];
  for (const row of rows) {
    const columns = parseProfileColumns(row.profile_json);
    if (columns === null) continue;
    out.push({
      id: row.id,
      name: row.original_name,
      storagePath: row.storage_path,
      headers: columns.map((c) => c.name),
      sampleValues: Object.fromEntries(columns.map((c) => [c.name, c.topValues])),
    });
  }
  return out;
}

export function latestProfiledFile(userId: string): ProfiledFile | null {
  return listProfiledFiles(userId, 20)[0] ?? null;
}
