import type { AskResult } from "./types";

/** Values a spreadsheet app would run as a formula. Tab and CR are included because they can hide one. */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/** Prefixes a single quote to text that a spreadsheet would read as a formula (CSV injection). */
export function guardCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  if (typeof value !== "string") return String(value);
  if (FORMULA_START.test(value) && !PLAIN_NUMBER.test(value)) return `'${value}`;
  return value;
}

function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The stored result as CSV with CRLF line endings, a UTF-8 BOM so Excel reads accents, and
 * formula-guarded cells. Only the rows held in the result are written.
 */
export function resultCsv(result: Pick<AskResult, "columns" | "rows">): string {
  const lines = [result.columns.map((c) => field(guardCell(c)))];
  for (const row of result.rows) lines.push(row.map((cell) => field(guardCell(cell))));
  return "﻿" + lines.map((cols) => cols.join(",")).join("\r\n") + "\r\n";
}
