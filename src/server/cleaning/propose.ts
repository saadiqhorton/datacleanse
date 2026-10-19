/**
 * Proposes cell-level changes by running a rule set over a table. Pure: the input
 * table is never mutated. Value rules chain per cell; row removals (merges) are
 * decided afterwards on the cleaned values.
 */

import { detectColumnOrder, parseDate, toIsoDate, type DateOrder } from "../dates";
import type { Decision, ProposedChange, RuleSpec, Table } from "../types";
import { canonicalCountryName, countryFromCode, nearestCountryName } from "./countries";
import { globMatch } from "./glob";
import { formatPhone } from "./phone";
import { editDistance, normalizeHeader, titleCase, trimWhitespace } from "./text";

const VALUE_ACTIONS = new Set<string>([
  "trim_whitespace",
  "title_case",
  "lowercase",
  "normalize_date",
  "phone_e164",
  "country_names",
  "fix_typos",
  "map_values",
]);

/** Confidence below this is "low": it goes to the rule's onLowConfidence policy. */
const CONFIDENCE_OK = 0.9;
/** Per-column cache of value -> outcome. Above this many distinct values, results are recomputed. */
const CACHE_LIMIT = 50_000;
/** Most frequent values considered as typo targets. */
const POOL_LIMIT = 5_000;
/** A value with a time of day is left alone by normalize_date, so no data is lost. */
const TIME_RE = /\d[T ]\d{1,2}:\d{2}/;
const MIN_TYPO_LENGTH = 4;
/** A value that reads only in the other day/month order is proposed at this confidence. */
const OTHER_ORDER_CONFIDENCE = 0.6;
const OTHER_ORDER_LABEL = "Day/month order differs from the rest of the column";
/** A column at least this percent dates (of its non-empty values) has its non-date values flagged. */
const DATE_COLUMN_PERCENT = 80;

interface StepResult {
  value: string;
  label: string;
  confidence: number;
}
type StepFn = (value: string) => StepResult | null;
interface Step {
  rule: RuleSpec;
  run: StepFn;
}
interface Outcome {
  after: string;
  ruleId: string;
  reason: string;
  confidence: number;
  decision: Decision;
}
interface DateFlag {
  rule: RuleSpec;
  /** Distinct non-empty values that parse as no date in either order. */
  notDates: Set<string>;
}
interface ColumnPlan {
  steps: Step[];
  flag: RuleSpec | null;
  /** Set when the column is mostly dates: its non-date values are flagged for review. */
  dateFlag: DateFlag | null;
  /** Cache outcomes per distinct value only when some step is costly enough to repay the lookup. */
  cacheable: boolean;
  cache: Map<string, Outcome | null>;
}
interface DateColumn {
  run: StepFn | null;
  notDates: Set<string> | null;
}

const COSTLY_ACTIONS = new Set<string>([
  "title_case",
  "normalize_date",
  "phone_e164",
  "country_names",
  "fix_typos",
  "map_values",
]);

/** Lazily built, cached column arrays. */
class ColumnValues {
  private readonly cache = new Map<number, string[]>();

  constructor(private readonly table: Table) {}

  values(c: number): string[] {
    let v = this.cache.get(c);
    if (v === undefined) {
      v = this.table.rows.map((r) => r[c] ?? "");
      this.cache.set(c, v);
    }
    return v;
  }
}

function intParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 5) : fallback;
}

/** Decision for one result with confidence `c` under a rule's low-confidence policy. */
function decisionFor(confidence: number, rule: RuleSpec): Decision | "skip" {
  if (confidence >= CONFIDENCE_OK) return "approved";
  switch (rule.onLowConfidence) {
    case "apply":
      return "approved";
    case "skip":
      return "skip";
    default:
      return "pending";
  }
}

/** Run the column's value steps in order on one cell. Null when the cell does not change. */
function runChain(steps: Step[], original: string): Outcome | null {
  let cur = original;
  let ruleId: string | null = null;
  const labels: string[] = [];
  let confidence = 1;
  let review = false;

  for (const step of steps) {
    const out = step.run(cur);
    if (out === null || out.value === cur) continue;
    if (out.confidence < CONFIDENCE_OK) {
      if (step.rule.onLowConfidence === "skip") continue;
      if (step.rule.onLowConfidence !== "apply") review = true;
    }
    cur = out.value;
    if (ruleId === null) ruleId = step.rule.id;
    if (out.label !== "" && labels.indexOf(out.label) === -1) labels.push(out.label);
    if (out.confidence < confidence) confidence = out.confidence;
  }

  if (ruleId === null || cur === original) return null;
  return {
    after: cur,
    ruleId,
    reason: labels.length > 0 ? labels.join(" + ") : ruleId,
    confidence,
    decision: review ? "pending" : "approved",
  };
}

function outcomeFor(plan: ColumnPlan, value: string): Outcome | null {
  if (plan.steps.length === 0) return null;
  if (!plan.cacheable) return runChain(plan.steps, value);
  const hit = plan.cache.get(value);
  if (hit !== undefined) return hit;
  const out = runChain(plan.steps, value);
  if (plan.cache.size < CACHE_LIMIT) plan.cache.set(value, out);
  return out;
}

function compileStep(rule: RuleSpec, c: number, columns: ColumnValues): StepFn | null {
  const p = rule.params ?? {};
  switch (rule.action) {
    case "trim_whitespace":
      return (v) => {
        const t = trimWhitespace(v);
        return t === v ? null : { value: t, label: "Trim", confidence: 1 };
      };
    case "title_case":
      return (v) => {
        const t = titleCase(v);
        return t === v ? null : { value: t, label: "title case", confidence: 1 };
      };
    case "lowercase":
      return (v) => {
        const t = v.toLowerCase();
        return t === v ? null : { value: t, label: "lowercase", confidence: 1 };
      };
    case "phone_e164": {
      const country = typeof p.defaultCountry === "string" ? p.defaultCountry : "US";
      return (v) => {
        const f = formatPhone(v, country);
        return f === null || f === v ? null : { value: f, label: "E.164 phone format", confidence: 1 };
      };
    }
    case "country_names":
      return countryStep(p);
    case "fix_typos":
      return typoStep(p, columns.values(c));
    case "map_values":
      return mapStep(p);
    default:
      return null;
  }
}

/**
 * normalize_date for one column. The order is detected from the column when "auto";
 * the reason states how many values share the dominant layout. A value that reads only
 * in the other order is still converted, at low confidence. When the column is mostly
 * dates, its non-date values are returned as `notDates` so they can be flagged.
 */
function dateStep(p: Record<string, unknown>, values: string[]): DateColumn {
  const requested = p.order === "mdy" || p.order === "dmy" ? p.order : "auto";
  let order: DateOrder;
  let detected = 1;
  if (requested === "auto") {
    const d = detectColumnOrder(values);
    order = d.order;
    detected = d.confidence;
  } else {
    order = requested;
  }
  const other: DateOrder = order === "mdy" ? "dmy" : "mdy";

  const layouts = new Map<string, number>();
  let parsed = 0; // reads in the column's order
  let dates = 0; // reads in either order
  let nonEmpty = 0; // not blank and not time-stamped (those are left alone)
  for (const v of values) {
    if (v.trim() === "" || TIME_RE.test(v)) continue;
    nonEmpty++;
    const d = parseDate(v, order);
    if (d !== null) {
      parsed++;
      dates++;
      layouts.set(d.layout, (layouts.get(d.layout) ?? 0) + 1);
    } else if (parseDate(v, other) !== null) {
      dates++;
    }
  }

  let label = "";
  if (parsed > 0) {
    let layout = "";
    let best = -1;
    for (const [name, n] of layouts) {
      if (n > best || (n === best && name < layout)) {
        best = n;
        layout = name;
      }
    }
    label = `Column is ${Math.round((best / parsed) * 100)}% ${layout}`;
  }

  const run: StepFn | null = dates === 0 ? null : (v) => {
    if (TIME_RE.test(v)) return null;
    const d = parseDate(v, order);
    if (d !== null) {
      const iso = toIsoDate(d.parts);
      if (iso === v) return null;
      return { value: iso, label, confidence: d.ambiguous && requested === "auto" ? detected : 1 };
    }
    const swapped = parseDate(v, other);
    if (swapped === null) return null;
    return { value: toIsoDate(swapped.parts), label: OTHER_ORDER_LABEL, confidence: OTHER_ORDER_CONFIDENCE };
  };

  let notDates: Set<string> | null = null;
  if (nonEmpty > 0 && dates * 100 >= nonEmpty * DATE_COLUMN_PERCENT) {
    notDates = new Set<string>();
    for (const v of values) {
      if (v.trim() === "" || TIME_RE.test(v)) continue;
      if (parseDate(v, order) === null && parseDate(v, other) === null) notDates.add(v);
    }
  }
  return { run, notDates };
}

function countryStep(p: Record<string, unknown>): StepFn {
  const maxDistance = intParam(p.maxDistance, 2);
  return (v) => {
    const t = v.trim();
    if (t === "") return null;
    const byCode = countryFromCode(t);
    if (byCode !== null) {
      return byCode === v ? null : { value: byCode, label: "ISO code → country name", confidence: 1 };
    }
    const canonical = canonicalCountryName(t);
    if (canonical !== null) {
      return canonical === v ? null : { value: canonical, label: "Standard country name", confidence: 1 };
    }
    const near = nearestCountryName(t, maxDistance);
    if (near !== null) {
      return { value: near.name, label: "Likely typo", confidence: 1 - near.distance / t.length };
    }
    return null;
  };
}

/** Snap rare values (at most 1% of rows) to a value seen at least 10 times as often, within maxDistance. */
function typoStep(p: Record<string, unknown>, values: string[]): StepFn {
  const maxDistance = intParam(p.maxDistance, 2);
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const total = values.length;

  const byLength = new Map<number, [string, number][]>();
  const frequent = [...counts].filter(([, n]) => n >= 10).sort((a, b) => b[1] - a[1]).slice(0, POOL_LIMIT);
  for (const entry of frequent) {
    const len = entry[0].length;
    const bucket = byLength.get(len);
    if (bucket) bucket.push(entry);
    else byLength.set(len, [entry]);
  }

  return (v) => {
    const t = v.trim();
    if (t.length < MIN_TYPO_LENGTH) return null;
    const n = counts.get(v) ?? 0;
    if (n > total * 0.01) return null;
    const need = 10 * Math.max(1, n);

    let best: string | null = null;
    let bestDistance = maxDistance + 1;
    let bestCount = 0;
    for (let len = t.length - maxDistance; len <= t.length + maxDistance; len++) {
      const bucket = byLength.get(len);
      if (bucket === undefined) continue;
      for (const [cand, cn] of bucket) {
        if (cn < need || cand === t) continue;
        const d = editDistance(t, cand, maxDistance);
        if (d === 0 || d > maxDistance) continue;
        if (d < bestDistance || (d === bestDistance && cn > bestCount)) {
          best = cand;
          bestDistance = d;
          bestCount = cn;
        }
      }
    }
    if (best === null) return null;
    return { value: best, label: "Likely typo", confidence: 1 - bestDistance / t.length };
  };
}

function mapStep(p: Record<string, unknown>): StepFn | null {
  const ci = p.caseInsensitive === true;
  const lookup = new Map<string, string>();
  const raw = p.map;
  if (raw !== null && typeof raw === "object") {
    for (const [key, to] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof to !== "string") continue;
      lookup.set(ci ? key.trim().toLowerCase() : key.trim(), to);
    }
  }
  if (lookup.size === 0) return null;
  return (v) => {
    const key = ci ? v.trim().toLowerCase() : v.trim();
    const to = lookup.get(key);
    return to === undefined || to === v ? null : { value: to, label: "Mapped value", confidence: 1 };
  };
}

function normKey(value: string): string | null {
  const t = value.trim().toLowerCase();
  return t === "" ? null : t;
}

/** Hash of every cell of a row (FNV-1a). Equal hashes are verified with rowsEqual. */
function rowHash(row: string[]): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < row.length; i++) {
    const cell = row[i];
    for (let j = 0; j < cell.length; j++) {
      h ^= cell.charCodeAt(j);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193);
  }
  return h ^ row.length;
}

function rowsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Short label for a row: its first two non-empty values. */
function labelOf(row: string[]): string {
  const parts: string[] = [];
  for (const v of row) {
    const t = v.trim();
    if (t !== "") {
      parts.push(t);
      if (parts.length === 2) break;
    }
  }
  return parts.length > 0 ? parts.join(" ") : "(blank row)";
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[.,'"_()-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Same person, loosely: equal, same surname with a prefix first name ("J" / "Jane"), or a near-miss spelling. */
function namesSimilar(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (x === "" || y === "") return false;
  if (x === y) return true;
  const xt = x.split(" ");
  const yt = y.split(" ");
  if (xt[xt.length - 1] === yt[yt.length - 1] && (xt[0].startsWith(yt[0]) || yt[0].startsWith(xt[0]))) {
    return true;
  }
  const max = Math.min(2, Math.floor(Math.min(x.length, y.length) / 5));
  return max > 0 && editDistance(x, y, max) <= max;
}

function rowNameOf(row: string[], nameCols: number[]): string {
  let s = "";
  for (const c of nameCols) {
    const v = row[c];
    if (v !== undefined && v.trim() !== "") s += (s === "" ? "" : " ") + v;
  }
  return s;
}

/**
 * For exact duplicates: keepOf[r] is the row that survives for r's group (-1 when r has no
 * group). Hash buckets are verified with rowsEqual, so collisions never merge distinct rows.
 */
function exactKeepers(finals: string[][], removed: Uint8Array, keepFirst: boolean): Int32Array {
  const n = finals.length;
  const keepOf = new Int32Array(n).fill(-1);
  const groupOf = new Int32Array(n).fill(-1);
  const keeper = new Int32Array(n).fill(-1);
  const nextRep = new Int32Array(n).fill(-1);
  const headByHash = new Map<number, number>();
  for (let r = 0; r < n; r++) {
    if (removed[r] === 1) continue;
    const row = finals[r];
    const h = rowHash(row);
    let group = -1;
    for (let x = headByHash.get(h) ?? -1; x !== -1; x = nextRep[x]) {
      if (rowsEqual(finals[x], row)) {
        group = x;
        break;
      }
    }
    if (group === -1) {
      // r starts a new group; its representative is r itself.
      nextRep[r] = headByHash.get(h) ?? -1;
      headByHash.set(h, r);
      groupOf[r] = r;
      keeper[r] = r;
    } else {
      groupOf[r] = group;
      if (!keepFirst) keeper[group] = r;
    }
  }
  for (let r = 0; r < n; r++) {
    if (groupOf[r] !== -1) keepOf[r] = keeper[groupOf[r]];
  }
  return keepOf;
}

/** For one key column: keepOf[r] is the keeper row of r's key group (-1 when r has no key). */
function keyKeepers(finals: string[][], removed: Uint8Array, c: number, keepFirst: boolean): Int32Array {
  const n = finals.length;
  const keys: (string | null)[] = new Array<string | null>(n);
  const keeper = new Map<string, number>();
  for (let r = 0; r < n; r++) {
    if (removed[r] === 1) {
      keys[r] = null;
      continue;
    }
    const key = normKey(finals[r][c] ?? "");
    keys[r] = key;
    if (key === null) continue;
    if (keepFirst) {
      if (!keeper.has(key)) keeper.set(key, r);
    } else {
      keeper.set(key, r);
    }
  }
  const keepOf = new Int32Array(n).fill(-1);
  for (let r = 0; r < n; r++) {
    const key = keys[r];
    if (key === null) continue;
    const k = keeper.get(key);
    if (k !== undefined) keepOf[r] = k;
  }
  return keepOf;
}

/**
 * Duplicate merges, decided on the cleaned values. `rules` are the enabled dedupe_key rules.
 * Within one pass, rows a rule removes are not used as keepers by that rule.
 */
function proposeMerges(finals: string[][], headers: string[], rules: RuleSpec[]): ProposedChange[] {
  const n = finals.length;
  const removed = new Uint8Array(n);
  const nameCols: number[] = [];
  headers.forEach((h, c) => {
    if (normalizeHeader(h).includes("name")) nameCols.push(c);
  });
  const merges: ProposedChange[] = [];

  for (const rule of rules) {
    const keepFirst = rule.params?.keep === "first";
    const exact = rule.params?.exact === true;
    const targets = exact
      ? [-1]
      : headers.map((h, c) => (globMatch(rule.columnPattern, h) ? c : -1)).filter((c) => c >= 0);

    for (const c of targets) {
      const keepOf = exact ? exactKeepers(finals, removed, keepFirst) : keyKeepers(finals, removed, c, keepFirst);
      for (let r = 0; r < n; r++) {
        const keep = keepOf[r];
        if (keep < 0 || keep === r || removed[r] === 1) continue;

        const similar =
          !exact && nameCols.length > 0 && namesSimilar(rowNameOf(finals[r], nameCols), rowNameOf(finals[keep], nameCols));
        const confidence = exact ? 1 : similar ? 0.95 : 0.8;
        const decision = decisionFor(confidence, rule);
        if (decision === "skip") continue;

        removed[r] = 1;
        merges.push({
          rowIndex: r,
          column: null,
          kind: "merge",
          before: labelOf(finals[r]),
          after: labelOf(finals[keep]),
          mergeIntoRow: keep,
          source: "rule",
          ruleId: rule.id,
          reason: exact ? "Exact duplicate" : `Same ${headers[c]}`,
          confidence,
          decision,
        });
      }
    }
  }

  merges.sort((a, b) => a.rowIndex - b.rowIndex);
  return merges;
}

/** Merge two row-ordered change lists; on equal rowIndex, value and flag changes come first. */
function interleave(a: ProposedChange[], b: ProposedChange[]): ProposedChange[] {
  if (b.length === 0) return a;
  const out = new Array<ProposedChange>(a.length + b.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && a[i].rowIndex <= b[j].rowIndex)) out[k++] = a[i++];
    else out[k++] = b[j++];
  }
  return out;
}

/** Changes the rules propose for this table, in row order. Does not mutate `table`. */
export function proposeChanges(table: Table, rules: RuleSpec[]): ProposedChange[] {
  const { headers, rows } = table;
  const enabled = rules.filter((r) => r.enabled);
  const valueRules = enabled.filter((r) => VALUE_ACTIONS.has(r.action));
  const flagRules = enabled.filter((r) => r.action === "flag_missing");
  const dedupeRules = enabled.filter((r) => r.action === "dedupe_key");
  const columns = new ColumnValues(table);

  const plans = headers.map((header, c): ColumnPlan | null => {
    const steps: Step[] = [];
    let dateFlag: DateFlag | null = null;
    for (const rule of valueRules) {
      if (!globMatch(rule.columnPattern, header)) continue;
      if (rule.action === "normalize_date") {
        const date = dateStep(rule.params ?? {}, columns.values(c));
        if (date.run !== null) steps.push({ rule, run: date.run });
        if (dateFlag === null && date.notDates !== null) dateFlag = { rule, notDates: date.notDates };
        continue;
      }
      const run = compileStep(rule, c, columns);
      if (run !== null) steps.push({ rule, run });
    }
    const flag = flagRules.find((r) => globMatch(r.columnPattern, header)) ?? null;
    if (steps.length === 0 && flag === null && dateFlag === null) return null;
    const cacheable = steps.some((s) => COSTLY_ACTIONS.has(s.rule.action));
    return { steps, flag, dateFlag, cacheable, cache: new Map<string, Outcome | null>() };
  });

  // Cleaned rows, used by the dedupe pass. Only built when a dedupe rule is enabled.
  const needFinals = dedupeRules.length > 0;
  const finals = needFinals ? rows.slice() : [];
  const valueChanges: ProposedChange[] = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let copy: string[] | null = null;
    for (let c = 0; c < headers.length; c++) {
      const plan = plans[c];
      if (plan === null) continue;
      const before = row[c] ?? "";
      const outcome = outcomeFor(plan, before);
      let after = before;
      if (outcome !== null) {
        after = outcome.after;
        if (needFinals) {
          if (copy === null) {
            copy = row.slice();
            while (copy.length < headers.length) copy.push("");
          }
          copy[c] = after;
        }
        valueChanges.push({
          rowIndex: r,
          column: headers[c],
          kind: "value",
          before,
          after,
          source: "rule",
          ruleId: outcome.ruleId,
          reason: outcome.reason,
          confidence: outcome.confidence,
          decision: outcome.decision,
        });
      }
      if (plan.dateFlag !== null && plan.dateFlag.notDates.has(before)) {
        valueChanges.push({
          rowIndex: r,
          column: headers[c],
          kind: "flag",
          before,
          after: null,
          source: "rule",
          ruleId: plan.dateFlag.rule.id,
          reason: "Not a recognisable date",
          confidence: 1,
          decision: "approved",
        });
      }
      if (plan.flag !== null && after.trim() === "") {
        valueChanges.push({
          rowIndex: r,
          column: headers[c],
          kind: "flag",
          before: "",
          after: null,
          source: "rule",
          ruleId: plan.flag.id,
          reason: "Missing value",
          confidence: 1,
          decision: "approved",
        });
      }
    }
    if (copy !== null) finals[r] = copy;
  }

  const merges = needFinals ? proposeMerges(finals, headers, dedupeRules) : [];
  return interleave(valueChanges, merges);
}

/** How many changes a single rule would propose, and the first few. Its enabled flag is ignored. */
export function previewRule(
  table: Table,
  rule: RuleSpec,
  limit = 5,
): { matches: number; examples: ProposedChange[] } {
  const changes = proposeChanges(table, [{ ...rule, enabled: true }]);
  return { matches: changes.length, examples: changes.slice(0, Math.max(0, limit)) };
}
