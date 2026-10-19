/**
 * Domain types shared by the server modules. Modules communicate only through these.
 */

/** A parsed CSV held in memory. Every cell is a string ("" for empty). */
export interface Table {
  headers: string[];
  rows: string[][];
}

export type InferredType = "empty" | "string" | "integer" | "number" | "boolean" | "date" | "email" | "phone";

export interface ColumnStats {
  name: string;
  /** Matches the AI layer's ColumnProfile.type. */
  type: InferredType;
  nullCount: number;
  distinctCount: number;
  /** Up to 10 most common non-empty values, each truncated to 80 chars. */
  topValues: string[];
  /** Share of non-empty values matching `type`, 0..1. */
  typeConfidence: number;
  /** Distinct date layouts seen, e.g. ["MM/DD/YY", "YYYY-MM-DD"]. Date columns only. */
  dateFormats?: string[];
  /** Likely personal data (email, phone, name, address...). */
  pii: boolean;
  min?: string;
  max?: string;
}

export interface FileProfileData {
  rowCount: number;
  columnCount: number;
  delimiter: "," | "\t" | ";" | "|";
  encoding: "utf-8" | "utf-8-bom";
  columns: ColumnStats[];
  /** First 20 data rows, as header->value maps (what AI may see). */
  sample: Record<string, string>[];
}

/** Options chosen on the Upload screen. */
export interface CleanOptions {
  normalizeDates: boolean;
  dedupe: boolean;
  trimAndCase: boolean;
  /** Flag-only by default: missing values become "flag" changes, not edits. */
  fillMissing: boolean;
  dateOrder: "auto" | "mdy" | "dmy";
}

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  normalizeDates: true,
  dedupe: true,
  trimAndCase: true,
  fillMissing: false,
  dateOrder: "auto",
};

export type RuleAction =
  | "normalize_date" //       params: { order?: "auto"|"mdy"|"dmy" }  -> YYYY-MM-DD
  | "trim_whitespace" //      trim + collapse runs of spaces
  | "title_case" //           "  acme corp. " -> "Acme Corp" (strips trailing punctuation)
  | "lowercase"
  | "phone_e164" //           params: { defaultCountry?: "US" }  -> "+1 555-0142"
  | "dedupe_key" //           rows with equal normalized value in column are duplicates;
  //                          params: { keep?: "first"|"last" }   (exact full-row dupes always merge)
  | "country_names" //        ISO-3166 alpha-2/3 codes -> English names; typo fix within edit distance
  | "map_values" //           params: { map: Record<string,string>, caseInsensitive?: boolean }
  | "fix_typos" //            snap rare values to a frequent value within params.maxDistance (default 2)
  | "flag_missing"; //        empty cells -> kind "flag" (no edit)

export interface RuleSpec {
  id: string;
  /** Glob over header names, case-insensitive: "*_date", "email", "*" (all columns). */
  columnPattern: string;
  action: RuleAction;
  params: Record<string, unknown>;
  /** What to do with low-confidence results (e.g. fuzzy typo fixes). */
  onLowConfidence: "review" | "apply" | "skip";
  enabled: boolean;
  description: string;
}

export type ChangeKind = "value" | "merge" | "flag";
export type ChangeSource = "rule" | "ai";
export type Decision = "approved" | "pending" | "skipped";

export interface ProposedChange {
  rowIndex: number; // 0-based data row
  column: string | null; // null for merges
  kind: ChangeKind;
  before: string | null;
  after: string | null;
  mergeIntoRow?: number; // kind "merge": index of the row that is kept
  source: ChangeSource;
  ruleId: string; // RuleSpec.id or RuleAction for built-ins, "ai" for AI
  reason: string; // short, user-facing: "Column is 98% MM/DD/YY"
  confidence?: number; // 0..1
  decision: Decision; // rules: approved unless low confidence + "review"; AI: pending
}

export interface CompareResult {
  leftName: string;
  rightName: string;
  keyColumns: string[];
  keyUnique: boolean;
  columns: {
    added: string[];
    removed: string[];
    typeChanged: { column: string; from: string; to: string; note?: string }[];
  };
  counts: { added: number; removed: number; changed: number; unchanged: number };
  /** Capped at 5,000 entries each. */
  changed: { key: string; column: string; before: string; after: string }[];
  added: { key: string; row: Record<string, string> }[];
  removed: { key: string; row: Record<string, string> }[];
}

export interface QueryTable {
  alias: string;
  /** Absolute path to the CSV on disk. */
  path: string;
}

export interface QueryResult {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  /** Total rows across the input tables. */
  rowsScanned: number;
  ms: number;
  truncated: boolean;
}

export interface JoinSuggestion {
  left: { alias: string; column: string };
  right: { alias: string; column: string };
  /** Share of left rows whose value appears in right, 0..1. */
  matchRate: number;
}
