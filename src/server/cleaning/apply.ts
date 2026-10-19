/**
 * Applies the approved changes to a table. Pure: the input table is never mutated.
 */

import type { ProposedChange, Table } from "../types";

function inRange(i: number, n: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < n;
}

/**
 * Apply approved value changes (rule or AI) and approved merges. Pending, skipped and
 * flag changes are ignored. A value change applies only when its cell still holds
 * `before`, so a stale or conflicting change is skipped rather than overwriting data.
 * A merge removes its row and fills the kept row's empty cells from it.
 */
export function applyChanges(table: Table, changes: ProposedChange[]): { table: Table; rowsRemoved: number } {
  const { headers, rows } = table;
  const width = headers.length;
  const n = rows.length;

  const columnIndexes = new Map<string, number[]>();
  headers.forEach((h, i) => {
    const list = columnIndexes.get(h);
    if (list) list.push(i);
    else columnIndexes.set(h, [i]);
  });

  // Copy-on-write: only rows that change are copied.
  const work = new Map<number, string[]>();
  const cellOf = (r: number, c: number): string => (work.get(r) ?? rows[r])[c] ?? "";
  const writable = (r: number): string[] => {
    let w = work.get(r);
    if (w === undefined) {
      w = rows[r].slice();
      while (w.length < width) w.push("");
      work.set(r, w);
    }
    return w;
  };

  for (const ch of changes) {
    if (ch.kind !== "value" || ch.decision !== "approved" || ch.column === null || ch.after === null) continue;
    if (!inRange(ch.rowIndex, n)) continue;
    const candidates = columnIndexes.get(ch.column);
    if (candidates === undefined) continue;
    for (const c of candidates) {
      if (ch.before !== null && cellOf(ch.rowIndex, c) !== ch.before) continue;
      writable(ch.rowIndex)[c] = ch.after;
      break;
    }
  }

  const mergedInto = new Map<number, number>();
  for (const ch of changes) {
    if (ch.kind !== "merge" || ch.decision !== "approved" || ch.mergeIntoRow === undefined) continue;
    const r = ch.rowIndex;
    const k = ch.mergeIntoRow;
    if (!inRange(r, n) || !inRange(k, n) || r === k || mergedInto.has(r)) continue;
    mergedInto.set(r, k);
  }

  // Follow chains (A into B, B into C) to the row that survives.
  const rootOf = (r: number): number => {
    let x = r;
    for (let i = 0; i <= mergedInto.size && mergedInto.has(x); i++) {
      x = mergedInto.get(x) as number;
    }
    return x;
  };

  for (const r of mergedInto.keys()) {
    const root = rootOf(r);
    if (root === r || mergedInto.has(root)) continue;
    const dst = writable(root);
    for (let c = 0; c < width; c++) {
      const src = cellOf(r, c);
      if (src !== "" && (dst[c] ?? "").trim() === "") dst[c] = src;
    }
  }

  const outRows: string[][] = [];
  let rowsRemoved = 0;
  for (let r = 0; r < n; r++) {
    if (mergedInto.has(r)) {
      rowsRemoved++;
      continue;
    }
    outRows.push((work.get(r) ?? rows[r]).slice());
  }

  return { table: { headers: headers.slice(), rows: outRows }, rowsRemoved };
}
