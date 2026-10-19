import type { Table } from "../types";

export interface CsvWriteOptions {
  /** Single-character delimiter. Defaults to ",". */
  delimiter?: string;
}

/**
 * Serialize a table as RFC 4180 CSV with CRLF line endings. Fields are quoted only when they
 * contain the delimiter, a quote, or a line break. No formula guard: cleaned data must round-trip.
 */
export function toCsv(table: Table, opts: CsvWriteOptions = {}): string {
  const delimiter = opts.delimiter ?? ",";
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\r" || delimiter === "\n") {
    throw new Error("CSV delimiter must be a single character other than quote or a line break.");
  }
  // One compiled pattern for the whole table: a field needs quoting if it holds any of these.
  const needsQuote = new RegExp("[\"\\r\\n" + delimiter.replace(/[\\\]^-]/g, "\\$&") + "]");
  const lines: string[] = new Array(table.rows.length + 1);
  lines[0] = formatRecord(table.headers, delimiter, needsQuote);
  for (let i = 0; i < table.rows.length; i++) lines[i + 1] = formatRecord(table.rows[i], delimiter, needsQuote);
  return lines.join("\r\n") + "\r\n";
}

function formatRecord(fields: string[], delimiter: string, needsQuote: RegExp): string {
  const out = new Array<string>(fields.length);
  for (let i = 0; i < fields.length; i++) out[i] = formatField(fields[i], needsQuote);
  return out.join(delimiter);
}

function formatField(value: string, needsQuote: RegExp): string {
  if (value.length === 0 || !needsQuote.test(value)) return value;
  return '"' + value.replace(/"/g, '""') + '"';
}
