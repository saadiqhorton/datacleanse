import { SAMPLE_ROW_LIMIT } from "../../lib/ai/tasks";
import { db } from "../db";
import type { ChangeKind, ChangeSource, FileProfileData, RuleAction } from "../types";
import type { ChangeDecisionName, ChangeFilter } from "./repo";
import { assertId } from "./storage";

/** Changes per page on the Review screen. */
export const PAGE_SIZE = 50;

/** Filter pills on the Review screen, in display order. */
export const CHANGE_FILTERS: readonly ChangeFilter[] = ["all", "pending", "rule", "ai"];

const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Stat card bucketing
// ---------------------------------------------------------------------------

/** Rule actions that count as "Dates normalized", "Duplicates merged" and "Text cleaned" on the stat cards. */
const DATE_ACTION: RuleAction = "normalize_date";
const TEXT_ACTIONS: ReadonlySet<string> = new Set<string>([
  "trim_whitespace",
  "title_case",
  "lowercase",
  "phone_e164",
  "country_names",
  "map_values",
  "fix_typos",
]);

/** Every rule action, used to recognise the action inside a ruleId. */
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

/**
 * The rule action behind a change's ruleId: "trim_whitespace", "trim_whitespace_2",
 * "builtin:normalize_date:signup_date" and saved rules like "phone_e164:rule_x" all resolve.
 * Null for "ai" and anything unrecognised. Mirrors the private helper in reports/summary.ts.
 */
export function ruleActionOf(ruleId: string | null | undefined): RuleAction | null {
  if (!ruleId || ruleId === "ai") return null;
  let found: RuleAction | null = null;
  for (const segment of ruleId.split(":")) {
    for (const action of RULE_ACTIONS) {
      const matches = segment === action || segment.startsWith(`${action}_`);
      if (matches && (found === null || action.length > found.length)) found = action;
    }
    if (found) return found;
  }
  return found;
}

export type ReviewBucket = "dates" | "duplicates" | "text" | "other";

/**
 * Which stat card a change counts toward. Merges are duplicates. Rule value changes are dates or
 * text by their action. Flags, AI changes and anything unrecognised are "other" and have no card.
 */
export function bucketOf(change: { kind: ChangeKind; source: ChangeSource; ruleId: string | null }): ReviewBucket {
  if (change.kind === "merge") return "duplicates";
  if (change.kind !== "value" || change.source !== "rule") return "other";
  const action = ruleActionOf(change.ruleId);
  if (action === DATE_ACTION) return "dates";
  if (action !== null && TEXT_ACTIONS.has(action)) return "text";
  return "other";
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

/** One group of the changes table: rows sharing kind, source, rule and decision. */
export interface ChangeTally {
  kind: ChangeKind;
  source: ChangeSource;
  ruleId: string | null;
  decision: ChangeDecisionName;
  n: number;
}

export interface ReviewTotals {
  /** Every change in the file, flags included. Matches the "All" pill and the table's row count. */
  total: number;
  pending: number;
  approved: number;
  skipped: number;
  /** Rule-sourced and AI-sourced changes, all decisions. */
  rule: number;
  ai: number;
  /** AI changes not yet skipped (approved or pending). Drives "Reject all AI suggestions". */
  aiOpen: number;
  /** Approved value and merge changes: what Apply writes. Flags never count. */
  approvedEdits: number;
  /** Approved edits per stat card. */
  buckets: Record<Exclude<ReviewBucket, "other">, number>;
}

/** Totals from grouped counts. Pure, so the bucketing rules are tested without a database. */
export function tallyTotals(rows: ChangeTally[]): ReviewTotals {
  const totals: ReviewTotals = {
    total: 0,
    pending: 0,
    approved: 0,
    skipped: 0,
    rule: 0,
    ai: 0,
    aiOpen: 0,
    approvedEdits: 0,
    buckets: { dates: 0, duplicates: 0, text: 0 },
  };
  for (const row of rows) {
    const n = row.n;
    totals.total += n;
    if (row.decision === "pending") totals.pending += n;
    else if (row.decision === "approved") totals.approved += n;
    else totals.skipped += n;

    if (row.source === "rule") totals.rule += n;
    else totals.ai += n;
    if (row.source === "ai" && row.decision !== "skipped") totals.aiOpen += n;

    if (row.decision === "approved" && row.kind !== "flag") {
      totals.approvedEdits += n;
      const bucket = bucketOf(row);
      if (bucket !== "other") totals.buckets[bucket] += n;
    }
  }
  return totals;
}

/** Totals for one file, read from the changes table. The caller must have checked ownership. */
export function reviewTotals(fileId: string): ReviewTotals {
  const rows = db()
    .prepare(
      `SELECT kind, source, COALESCE(rule_id, '') AS rule_id, decision, COUNT(*) AS n
       FROM changes WHERE file_id = ?
       GROUP BY kind, source, rule_id, decision`,
    )
    .all(assertId(fileId)) as {
    kind: ChangeKind;
    source: ChangeSource;
    rule_id: string;
    decision: ChangeDecisionName;
    n: number;
  }[];
  return tallyTotals(rows.map((r) => ({ kind: r.kind, source: r.source, ruleId: r.rule_id, decision: r.decision, n: r.n })));
}

/** Count shown on a filter pill. */
export function filterCount(totals: ReviewTotals, filter: ChangeFilter): number {
  switch (filter) {
    case "pending":
      return totals.pending;
    case "rule":
      return totals.rule;
    case "ai":
      return totals.ai;
    default:
      return totals.total;
  }
}

// ---------------------------------------------------------------------------
// Query parameters and paging
// ---------------------------------------------------------------------------

/** A search parameter as one string: the first value when it was repeated, undefined otherwise. */
export function firstParam(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** ?filter= value. Anything unknown is "all". */
export function parseFilter(raw: string | string[] | undefined): ChangeFilter {
  const value = firstParam(raw);
  return (CHANGE_FILTERS as readonly string[]).includes(value ?? "") ? (value as ChangeFilter) : "all";
}

/** ?page= value: a whole number from 1. Anything else is page 1. */
export function parsePage(raw: string | string[] | undefined): number {
  const value = firstParam(raw);
  if (!value || !/^\d{1,6}$/.test(value)) return 1;
  const n = Number(value);
  return n >= 1 ? n : 1;
}

/** Number of pages for a total. An empty list still has one (empty) page. */
export function pageCount(total: number, size: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** The requested page, pulled back to the last page when it is past the end. */
export function clampPage(page: number, total: number, size: number = PAGE_SIZE): number {
  return Math.min(Math.max(1, page), pageCount(total, size));
}

/** "Showing from–to of total" for a 1-based page. from is 0 when there are no rows. */
export function pageSpan(page: number, total: number, size: number = PAGE_SIZE): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  const from = (page - 1) * size + 1;
  return { from, to: Math.min(total, page * size) };
}

/** Link to the Review screen keeping the filter; page 1 and "all" are left out of the URL. */
export function reviewHref(fileId: string, opts: { filter?: ChangeFilter; page?: number } = {}): string {
  const params: string[] = [];
  if (opts.filter && opts.filter !== "all") params.push(`filter=${opts.filter}`);
  if (opts.page && opts.page > 1) params.push(`page=${opts.page}`);
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  return `/review/${assertId(fileId)}${query}`;
}

// ---------------------------------------------------------------------------
// Row labels and copy
// ---------------------------------------------------------------------------

/**
 * Row label for a value or flag change, e.g. "#118 · signup_date". rowIndex is 0-based, so the
 * label is 1-based.
 */
export function rowLabel(rowIndex: number, column: string | null): string {
  return column ? `#${rowIndex + 1} · ${column}` : `#${rowIndex + 1}`;
}

/** Row label for a merge, e.g. "#87 + #402": the removed row and the row kept. */
export function mergeLabel(rowIndex: number, mergeIntoRow: number | null): string {
  return mergeIntoRow === null ? `#${rowIndex + 1}` : `#${rowIndex + 1} + #${mergeIntoRow + 1}`;
}

/** Whole-number confidence for "AI · 72%". Null when there is none. */
export function confidencePercent(confidence: number | null | undefined): number | null {
  if (confidence === null || confidence === undefined || !Number.isFinite(confidence)) return null;
  return Math.min(100, Math.max(0, Math.round(confidence * 100)));
}

/**
 * How long a file is kept, in the words the page uses: "24 hours", "1 hour", "7 days". Based on the
 * file's own created_at to expires_at span, so it stays right if the retention setting changes.
 */
export function retentionLabel(createdAt: number, expiresAt: number): string {
  const hours = Math.max(1, Math.round((expiresAt - createdAt) / HOUR_MS));
  if (hours === 1) return "1 hour";
  if (hours < 168) return `${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/** Columns the profile marked as likely personal data, in file order. */
export function piiColumnNames(profile: FileProfileData | null | undefined): string[] {
  return (profile?.columns ?? []).filter((c) => c.pii).map((c) => c.name);
}

/** How many rows of the file the AI was shown. Never more than the AI sample limit. */
export function aiSampleRowCount(profile: FileProfileData | null | undefined): number {
  if (!profile) return SAMPLE_ROW_LIMIT;
  return Math.min(profile.sample.length, SAMPLE_ROW_LIMIT);
}

/** "1 change", "214 changes". */
export function pluralize(n: number, word: string, plural = `${word}s`): string {
  return `${n} ${n === 1 ? word : plural}`;
}
