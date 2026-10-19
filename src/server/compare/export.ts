import type { CompareResult } from "../types";

const HEADER = ["change_type", "key", "column", "before", "after"];

/**
 * Diff as CSV (RFC 4180, CRLF line ends): one row per changed cell, per added or removed cell,
 * and one per column or type change. Columns are change_type, key, column, before, after.
 * Only the entries kept in the result are exported, so the export may be shorter than the counts.
 */
export function compareToCsv(result: CompareResult): string {
  const lines: string[][] = [HEADER];

  for (const column of result.columns.added) lines.push(["column_added", "", column, "", ""]);
  for (const column of result.columns.removed) lines.push(["column_removed", "", column, "", ""]);
  for (const change of result.columns.typeChanged) {
    const to = change.note ? `${change.to} (${change.note})` : change.to;
    lines.push(["type_changed", "", change.column, change.from, to]);
  }
  for (const change of result.changed) {
    lines.push(["changed", change.key, change.column, change.before, change.after]);
  }
  for (const entry of result.removed) {
    for (const [column, value] of Object.entries(entry.row)) {
      lines.push(["removed", entry.key, column, value, ""]);
    }
  }
  for (const entry of result.added) {
    for (const [column, value] of Object.entries(entry.row)) {
      lines.push(["added", entry.key, column, "", value]);
    }
  }

  return lines.map((fields) => fields.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/**
 * Quotes a field when it holds a comma, quote or line break (RFC 4180). A leading = + - @ or tab
 * or CR gets a single quote in front, so spreadsheet apps show it as text, not a formula.
 */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
