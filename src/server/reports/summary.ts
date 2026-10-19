import type { ProposedChange, RuleAction } from "../types";

export type ReportMethod = "Rule" | "AI" | "Rule + AI";

export interface ColumnSummary {
  column: string;
  issue: string;
  /** Approved value and merge changes. */
  fixed: number;
  /** All value and merge changes, including pending and skipped. */
  total: number;
  method: ReportMethod;
}

export interface ChangeSummary {
  /** Approved value and merge changes. Flags never count as applied. */
  applied: number;
  skipped: number;
  pending: number;
  /** Distinct rows removed by approved merges. */
  rowsRemoved: number;
  rowsOut: number;
  byColumn: ColumnSummary[];
}

/** Column label for merges whose reason does not name a column. */
export const ROWS_LABEL = "(rows)";

const RULE_ACTIONS: RuleAction[] = [
  "normalize_date",
  "trim_whitespace",
  "title_case",
  "lowercase",
  "phone_e164",
  "dedupe_key",
  "country_names",
  "map_values",
  "fix_typos",
  "flag_missing",
];

const ISSUE: Partial<Record<RuleAction, string>> = {
  trim_whitespace: "Whitespace, casing",
  title_case: "Whitespace, casing",
  lowercase: "Whitespace, casing",
  phone_e164: "Mixed formats",
  country_names: "Typos, codes vs names",
  fix_typos: "Typos, codes vs names",
  map_values: "Typos, codes vs names",
  dedupe_key: "Duplicate records",
  flag_missing: "Missing values",
};

/** Matches `column "email"` in a merge reason, e.g. `Duplicate of row 2, column "email"`. */
const COLUMN_IN_REASON = /\bcolumn\s+"([^"]{1,120})"/i;

/** Edit changes are the ones that alter or remove data. Flags only mark cells. */
function isEdit(c: ProposedChange): boolean {
  return c.kind === "value" || c.kind === "merge";
}

/** True for a value or merge change the user approved. */
export function isApplied(c: ProposedChange): boolean {
  return c.decision === "approved" && isEdit(c);
}

/** The built-in action behind a change, from its ruleId: "trim_whitespace", or "trim_whitespace_2" for a saved rule. */
function actionOf(ruleId: string): RuleAction | "ai" | null {
  if (ruleId === "ai") return "ai";
  let found: RuleAction | null = null;
  for (const action of RULE_ACTIONS) {
    const matches = ruleId === action || ruleId.startsWith(`${action}_`);
    if (matches && (found === null || action.length > found.length)) found = action;
  }
  return found;
}

/**
 * Layout signature of a date value: each digit run becomes "N" (or "NNNN" for a four-digit run,
 * so years stay distinct from days and months), each letter run becomes "A".
 * "03/14/2026" and "3/4/2026" share one layout; "2026-03-14" does not.
 */
function layoutOf(value: string): string {
  return value.replace(/\d+/g, (run) => (run.length === 4 ? "NNNN" : "N")).replace(/[A-Za-z]+/g, "A");
}

function dateLabel(layouts: number): string {
  if (layouts === 0) return "Date formats";
  if (layouts === 1) return "1 date format";
  return `${layouts} date formats`;
}

/** Issue label for one edit. `dateLayouts` is the distinct layout count for the column. */
function issueOf(c: ProposedChange, dateLayouts: number): string {
  if (c.kind === "merge") return "Duplicate records";
  const action = actionOf(c.ruleId);
  if (c.source === "ai" || action === "ai") return "Ambiguous values";
  if (action === null) return "Other fixes";
  if (action === "normalize_date") return dateLabel(dateLayouts);
  return ISSUE[action] ?? "Other fixes";
}

/** Column an edit is reported under. Merges have no column, so their reason is searched for one. */
export function changeColumn(c: ProposedChange): string {
  if (c.column) return c.column;
  if (c.kind === "merge") {
    const match = COLUMN_IN_REASON.exec(c.reason);
    if (match) return match[1];
    // The cleaning engine labels key-based merges "Same <column>".
    const same = /^Same (.+)$/.exec(c.reason);
    if (same) return same[1];
  }
  return ROWS_LABEL;
}

/**
 * Totals for the report. Value and merge changes are counted; flags are informational and are
 * excluded from every count. A merge removes its own row (`rowIndex`), so rows are counted by
 * distinct `rowIndex`.
 */
export function summarizeChanges(changes: ProposedChange[], opts: { rowsIn: number }): ChangeSummary {
  let applied = 0;
  let skipped = 0;
  let pending = 0;
  const removed = new Set<number>();
  const groups = new Map<string, ProposedChange[]>();

  for (const c of changes) {
    if (!isEdit(c)) continue;
    if (c.decision === "approved") {
      applied++;
      if (c.kind === "merge") removed.add(c.rowIndex);
    } else if (c.decision === "skipped") {
      skipped++;
    } else {
      pending++;
    }
    const key = changeColumn(c);
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]);
  }

  const byColumn: ColumnSummary[] = [];
  for (const [column, edits] of groups) {
    const layouts = new Set(
      edits
        .filter((c) => c.kind === "value" && actionOf(c.ruleId) === "normalize_date" && (c.before ?? "") !== "")
        .map((c) => layoutOf(c.before ?? "")),
    );

    const labels: string[] = [];
    for (const c of edits) {
      const label = issueOf(c, layouts.size);
      if (!labels.includes(label)) labels.push(label);
    }

    const hasRule = edits.some((c) => c.source === "rule");
    const hasAi = edits.some((c) => c.source === "ai");
    byColumn.push({
      column,
      issue: labels.join(", "),
      fixed: edits.filter((c) => c.decision === "approved").length,
      total: edits.length,
      method: hasRule && hasAi ? "Rule + AI" : hasAi ? "AI" : "Rule",
    });
  }

  return {
    applied,
    skipped,
    pending,
    rowsRemoved: removed.size,
    rowsOut: Math.max(0, opts.rowsIn - removed.size),
    byColumn,
  };
}
