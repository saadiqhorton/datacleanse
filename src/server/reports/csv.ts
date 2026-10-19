import type { ProposedChange } from "../types";

export type ChangeLogEntry = ProposedChange & { decidedBy?: string | null };

const COLUMNS = [
  "row",
  "column",
  "change",
  "before",
  "after",
  "source",
  "rule",
  "reason",
  "confidence",
  "decision",
  "decided_by",
];

/** Values that a spreadsheet app reads as a formula. Tab and CR are included because they can hide one. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Prefixes a single quote when the value would be read as a formula (CSV injection).
 * Leading spaces are skipped before the check, so "  =1+1" is caught too.
 */
export function guardFormula(value: string): string {
  return FORMULA_START.test(value.replace(/^ +/, "")) ? `'${value}` : value;
}

/** One RFC 4180 field: guarded against formulas, then quoted if it holds a comma, quote or line break. */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = guardFormula(String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The change log as CSV, one line per change in the order given.
 * `row` is the spreadsheet row in the original file: the header is row 1, so data row index 0 is row 2.
 * A merge's `after` says which row it was merged into, using the same numbering.
 */
export function changeLogCsv(changes: ChangeLogEntry[]): string {
  const lines = [COLUMNS.join(",")];
  for (const c of changes) {
    const after =
      c.after ??
      (c.kind === "merge" && c.mergeIntoRow !== undefined ? `merged into row ${c.mergeIntoRow + 2}` : null);
    lines.push(
      [
        c.rowIndex + 2,
        c.column,
        c.kind,
        c.before,
        after,
        c.source,
        c.ruleId,
        c.reason,
        c.confidence !== undefined && Number.isFinite(c.confidence) ? c.confidence.toFixed(2) : "",
        c.decision,
        c.decidedBy,
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
