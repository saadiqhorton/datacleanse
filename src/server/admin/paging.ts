export interface Paged<T> {
  items: T[];
  /** Rows matching the query, across all pages. */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Reads a 1-based page number from a query string. Anything unusable becomes page 1. */
export function parsePage(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

/** Clamps a requested page to the pages that exist for `total` rows (an empty list has one page). */
export function resolvePage(requested: number, total: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requested), pageCount);
  return { page, pageCount, offset: (page - 1) * pageSize };
}

/** Escapes LIKE wildcards so user text is matched literally (use with ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Builds a Paged result from one page of rows. */
export function paged<T>(items: T[], total: number, page: number, pageSize: number): Paged<T> {
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
