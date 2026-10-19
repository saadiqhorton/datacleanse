import type { CompareResult } from "../types";

/** Entries per page in the changes table. */
export const PAGE_SIZE = 50;

export const TABS = ["changed", "added", "removed"] as const;
export type CompareTab = (typeof TABS)[number];

export function parseTab(raw: string | string[] | undefined): CompareTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (TABS as readonly string[]).includes(value ?? "") ? (value as CompareTab) : "changed";
}

/** A 1-based page number from a query value. Anything unusable is page 1. */
export function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export interface Page<T> {
  items: T[];
  /** The page shown, clamped to the last page that exists. */
  page: number;
  pageCount: number;
  total: number;
  /** 1-based position of the first and last item shown; 0 when there are none. */
  from: number;
  to: number;
}

export function pageOf<T>(all: T[], requested: number, size = PAGE_SIZE): Page<T> {
  const total = all.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Math.trunc(requested)), pageCount);
  const start = (page - 1) * size;
  const items = all.slice(start, start + size);
  return {
    items,
    page,
    pageCount,
    total,
    from: items.length ? start + 1 : 0,
    to: start + items.length,
  };
}

/** Number of rows (not cells) a tab reports on its label. */
export function tabCount(result: CompareResult, tab: CompareTab): number {
  if (tab === "added") return result.counts.added;
  if (tab === "removed") return result.counts.removed;
  return result.counts.changed;
}

/** "customers_sept.csv" + "customers_oct.csv" -> "customers_sept_vs_customers_oct.diff.csv". */
export function exportFileName(leftName: string, rightName: string): string {
  return `${stem(leftName)}_vs_${stem(rightName)}.diff.csv`;
}

function stem(name: string): string {
  return name.replace(/\.[^.]*$/, "").replace(/["\\\r\n/]/g, "_") || "file";
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}
