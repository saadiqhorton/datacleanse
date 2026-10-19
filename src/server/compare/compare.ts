import type { CompareResult, Table } from "../types";

/** Cap on each detail list (changed entries, added rows, removed rows). Counts are never capped. */
export const MAX_DETAIL_ENTRIES = 5000;

export interface CompareOptions {
  leftName: string;
  rightName: string;
  /** Columns that identify a row. Auto-detected when omitted. Must exist in both files. */
  keyColumns?: string[];
}

/**
 * Compares two parsed tables row by row. Rows are matched on the key columns over the columns
 * both files have. If the key is not unique, the n-th row with a given key on the left is
 * matched with the n-th on the right; the rest count as added or removed.
 */
export function compareTables(left: Table, right: Table, opts: CompareOptions): CompareResult {
  const leftPos = firstPositions(left.headers);
  const rightPos = firstPositions(right.headers);
  const shared = [...leftPos.keys()].filter((h) => rightPos.has(h));
  const addedColumns = [...rightPos.keys()].filter((h) => !leftPos.has(h));
  const removedColumns = [...leftPos.keys()].filter((h) => !rightPos.has(h));

  const key = opts.keyColumns !== undefined
    ? explicitKey(opts.keyColumns, left, right, leftPos, rightPos, opts)
    : autoKey(left, right, shared, leftPos, rightPos);
  const keyColumns = key.columns;
  const keyLeft = keyColumns.map((c) => leftPos.get(c) as number);
  const keyRight = keyColumns.map((c) => rightPos.get(c) as number);
  const sharedCols = shared.map((name) => ({ name, l: leftPos.get(name) as number, r: rightPos.get(name) as number }));
  const compared = sharedCols.filter((col) => !keyColumns.includes(col.name));

  const pairs: [number, number][] = [];
  const removedRows: number[] = [];
  const rightMatched = new Array<boolean>(right.rows.length).fill(false);

  if (keyColumns.length > 0) {
    // Index right rows by key tuple, in file order, then pair left rows with them in order.
    const buckets = new Map<string, number[]>();
    right.rows.forEach((row, ri) => {
      const k = keyTuple(row, keyRight);
      const bucket = buckets.get(k);
      if (bucket) bucket.push(ri);
      else buckets.set(k, [ri]);
    });
    const taken = new Map<string, number>();
    left.rows.forEach((row, li) => {
      const k = keyTuple(row, keyLeft);
      const bucket = buckets.get(k);
      const n = taken.get(k) ?? 0;
      if (bucket && n < bucket.length) {
        pairs.push([li, bucket[n]]);
        rightMatched[bucket[n]] = true;
        taken.set(k, n + 1);
      } else {
        removedRows.push(li);
      }
    });
  } else {
    // No shared columns to match on: every row on each side is removed or added.
    left.rows.forEach((_, li) => removedRows.push(li));
  }

  const changed: CompareResult["changed"] = [];
  let changedRows = 0;
  for (const [li, ri] of pairs) {
    const leftRow = left.rows[li];
    const rightRow = right.rows[ri];
    let rowChanged = false;
    for (const col of compared) {
      const before = cell(leftRow, col.l);
      const after = cell(rightRow, col.r);
      if (before === after) continue;
      rowChanged = true;
      if (changed.length < MAX_DETAIL_ENTRIES) {
        changed.push({ key: displayKey(leftRow, keyLeft), column: col.name, before, after });
      }
    }
    if (rowChanged) changedRows++;
  }

  const added: CompareResult["added"] = [];
  let addedCount = 0;
  right.rows.forEach((row, ri) => {
    if (rightMatched[ri]) return;
    addedCount++;
    if (added.length < MAX_DETAIL_ENTRIES) {
      added.push({ key: displayKey(row, keyRight), row: rowRecord(row, rightPos) });
    }
  });

  const removed: CompareResult["removed"] = [];
  for (const li of removedRows) {
    if (removed.length >= MAX_DETAIL_ENTRIES) break;
    const row = left.rows[li];
    removed.push({ key: displayKey(row, keyLeft), row: rowRecord(row, leftPos) });
  }

  return {
    leftName: opts.leftName,
    rightName: opts.rightName,
    keyColumns,
    keyUnique: key.unique,
    columns: {
      added: addedColumns,
      removed: removedColumns,
      typeChanged: typeChanges(left, right, sharedCols),
    },
    counts: {
      added: addedCount,
      removed: removedRows.length,
      changed: changedRows,
      unchanged: pairs.length - changedRows,
    },
    changed,
    added,
    removed,
  };
}

interface KeyChoice {
  columns: string[];
  unique: boolean;
}

function explicitKey(
  columns: string[],
  left: Table,
  right: Table,
  leftPos: Map<string, number>,
  rightPos: Map<string, number>,
  opts: CompareOptions,
): KeyChoice {
  for (const name of columns) {
    if (!leftPos.has(name)) throw new Error(`Key column "${name}" is not in ${opts.leftName}.`);
    if (!rightPos.has(name)) throw new Error(`Key column "${name}" is not in ${opts.rightName}.`);
  }
  const unique =
    keyIsUnique(left, columns.map((c) => leftPos.get(c) as number), false) &&
    keyIsUnique(right, columns.map((c) => rightPos.get(c) as number), false);
  return { columns: [...columns], unique };
}

/** Lower is better: email, then id, then "<something>_id", then anything else. */
function keyRank(name: string): number {
  const n = name.toLowerCase();
  if (n === "email" || /(^|_)email$/.test(n)) return 0;
  if (n === "id") return 1;
  if (n.endsWith("_id")) return 2;
  return 3;
}

function autoKey(
  left: Table,
  right: Table,
  shared: string[],
  leftPos: Map<string, number>,
  rightPos: Map<string, number>,
): KeyChoice {
  if (shared.length === 0) return { columns: [], unique: false };

  const ranked = shared
    .map((name, order) => ({ name, rank: keyRank(name), order }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order);
  const uniqueAlone = (name: string) =>
    keyIsUnique(left, [leftPos.get(name) as number], true) &&
    keyIsUnique(right, [rightPos.get(name) as number], true);

  for (const c of ranked) {
    if (uniqueAlone(c.name)) return { columns: [c.name], unique: true };
  }

  // No single column identifies rows. Try pairs where one column is email-, id- or *_id-like.
  let best: { names: [string, string]; score: number } | null = null;
  const tried = new Set<string>();
  for (const a of ranked) {
    if (a.rank >= 3) continue;
    for (const b of ranked) {
      if (b.name === a.name) continue;
      const pairKey = [a.name, b.name].sort().join("\u0000");
      if (tried.has(pairKey)) continue;
      tried.add(pairKey);
      const score = a.rank + b.rank;
      if (best && score >= best.score) continue;
      const pair = [a.name, b.name] as [string, string];
      const unique =
        keyIsUnique(left, pair.map((c) => leftPos.get(c) as number), true) &&
        keyIsUnique(right, pair.map((c) => rightPos.get(c) as number), true);
      if (unique) best = { names: pair, score };
    }
  }
  if (best) return { columns: [...best.names], unique: true };

  // Nothing identifies rows. Use the best-ranked shared column and report that keys repeat.
  return { columns: [ranked[0].name], unique: false };
}

/** True when no two rows share the same key tuple. With requireNonEmpty, an empty key cell also fails. */
function keyIsUnique(table: Table, idxs: number[], requireNonEmpty: boolean): boolean {
  const seen = new Set<string>();
  for (const row of table.rows) {
    if (requireNonEmpty && idxs.some((i) => cell(row, i) === "")) return false;
    const k = keyTuple(row, idxs);
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

function keyTuple(row: string[], idxs: number[]): string {
  return JSON.stringify(idxs.map((i) => cell(row, i)));
}

function displayKey(row: string[], idxs: number[]): string {
  return idxs.map((i) => cell(row, i)).join(" | ");
}

function cell(row: string[], index: number): string {
  return row[index] ?? "";
}

/** Header name -> index of its first occurrence. Later duplicate headers are ignored. */
function firstPositions(headers: string[]): Map<string, number> {
  const positions = new Map<string, number>();
  headers.forEach((h, i) => {
    if (!positions.has(h)) positions.set(h, i);
  });
  return positions;
}

/** Object keyed by header. defineProperty keeps a header such as "__proto__" as plain data. */
function rowRecord(row: string[], positions: Map<string, number>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [name, i] of positions) {
    Object.defineProperty(record, name, { value: cell(row, i), enumerable: true, writable: true, configurable: true });
  }
  return record;
}

type ColumnType = "empty" | "number" | "text";

const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const LEADING_ZERO_PATTERN = /^[+-]?0\d/;

/** "number" only when every non-empty value is a number without leading zeros; "02134" is a code, so text. */
function inferType(values: string[]): ColumnType {
  let any = false;
  for (const v of values) {
    if (v === "") continue;
    any = true;
    if (!NUMBER_PATTERN.test(v) || LEADING_ZERO_PATTERN.test(v)) return "text";
  }
  return any ? "number" : "empty";
}

function typeChanges(
  left: Table,
  right: Table,
  compared: { name: string; l: number; r: number }[],
): CompareResult["columns"]["typeChanged"] {
  const out: CompareResult["columns"]["typeChanged"] = [];
  for (const col of compared) {
    const leftValues = left.rows.map((row) => cell(row, col.l));
    const rightValues = right.rows.map((row) => cell(row, col.r));
    const from = inferType(leftValues);
    const to = inferType(rightValues);
    if (from === to || from === "empty" || to === "empty") continue;

    const entry: CompareResult["columns"]["typeChanged"][number] = { column: col.name, from, to };
    if (from === "number" && rightValues.some((v) => LEADING_ZERO_PATTERN.test(v))) {
      entry.note = "leading zeros kept";
    } else if (to === "number" && leftValues.some((v) => LEADING_ZERO_PATTERN.test(v))) {
      entry.note = "leading zeros dropped";
    }
    out.push(entry);
  }
  return out;
}
