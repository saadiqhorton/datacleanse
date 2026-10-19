import { db } from "../db";
import { newId } from "../ids";
import { isValidId } from "../files/storage";
import type { CompareResult } from "../types";

/** A saved comparison with its stored result. Null result when the stored JSON cannot be read. */
export interface ComparisonRecord {
  id: string;
  leftFileId: string | null;
  rightFileId: string | null;
  keyColumns: string[];
  createdAt: number;
  result: CompareResult | null;
}

/** Summary for the recent list. Read from the stored JSON in SQL, so the full result is not parsed. */
export interface ComparisonSummary {
  id: string;
  leftName: string;
  rightName: string;
  keyColumns: string[];
  keyUnique: boolean;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  createdAt: number;
}

interface CompareRow {
  id: string;
  left_file_id: string | null;
  right_file_id: string | null;
  key_columns_json: string;
  result_json: string | null;
  created_at: number;
}

/** Saves a finished comparison and returns its id. The caller has checked both files belong to the user. */
export function saveComparison(userId: string, leftFileId: string, rightFileId: string, result: CompareResult): string {
  const id = newId("cmp");
  db()
    .prepare(
      `INSERT INTO compares (id, user_id, left_file_id, right_file_id, key_columns_json, result_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, leftFileId, rightFileId, JSON.stringify(result.keyColumns), JSON.stringify(result), Date.now());
  return id;
}

/** One comparison the user owns, or null when it does not exist or belongs to someone else. */
export function getComparisonForUser(userId: string, id: string): ComparisonRecord | null {
  if (!isValidId(id) || !isValidId(userId)) return null;
  const row = db()
    .prepare(
      `SELECT id, left_file_id, right_file_id, key_columns_json, result_json, created_at
       FROM compares WHERE id = ? AND user_id = ?`,
    )
    .get(id, userId) as CompareRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    leftFileId: row.left_file_id,
    rightFileId: row.right_file_id,
    keyColumns: parseKeyColumns(row.key_columns_json),
    createdAt: row.created_at,
    result: parseStoredResult(row.result_json),
  };
}

/** The two file ids of an owned comparison, without parsing the result. Null when not owned. */
export function comparisonFileIds(userId: string, id: string): { leftFileId: string | null; rightFileId: string | null } | null {
  if (!isValidId(id) || !isValidId(userId)) return null;
  const row = db()
    .prepare("SELECT left_file_id, right_file_id FROM compares WHERE id = ? AND user_id = ?")
    .get(id, userId) as { left_file_id: string | null; right_file_id: string | null } | undefined;
  return row ? { leftFileId: row.left_file_id, rightFileId: row.right_file_id } : null;
}

/** The user's most recent comparisons, newest first. */
export function listComparisonsForUser(userId: string, limit = 10): ComparisonSummary[] {
  if (!isValidId(userId)) return [];
  const cap = Math.min(Math.max(1, Math.trunc(limit)), 100);
  const rows = db()
    .prepare(
      `SELECT id, key_columns_json, created_at,
              json_extract(result_json, '$.leftName') AS left_name,
              json_extract(result_json, '$.rightName') AS right_name,
              json_extract(result_json, '$.keyUnique') AS key_unique,
              json_extract(result_json, '$.counts.added') AS added,
              json_extract(result_json, '$.counts.removed') AS removed,
              json_extract(result_json, '$.counts.changed') AS changed,
              json_extract(result_json, '$.counts.unchanged') AS unchanged
       FROM compares
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(userId, cap) as {
    id: string;
    key_columns_json: string;
    created_at: number;
    left_name: string | null;
    right_name: string | null;
    key_unique: number | null;
    added: number | null;
    removed: number | null;
    changed: number | null;
    unchanged: number | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    leftName: r.left_name ?? "Deleted comparison",
    rightName: r.right_name ?? "",
    keyColumns: parseKeyColumns(r.key_columns_json),
    keyUnique: r.key_unique === 1,
    added: r.added ?? 0,
    removed: r.removed ?? 0,
    changed: r.changed ?? 0,
    unchanged: r.unchanged ?? 0,
    createdAt: r.created_at,
  }));
}

/** Parses a stored CompareResult. Returns null for anything that is not shaped like one. */
export function parseStoredResult(json: string | null): CompareResult | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  return isCompareResult(raw) ? raw : null;
}

function isCompareResult(value: unknown): value is CompareResult {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  const counts = r.counts as Record<string, unknown> | null | undefined;
  const columns = r.columns as Record<string, unknown> | null | undefined;
  return (
    typeof r.leftName === "string" &&
    typeof r.rightName === "string" &&
    Array.isArray(r.keyColumns) &&
    typeof r.keyUnique === "boolean" &&
    typeof counts === "object" && counts !== null &&
    typeof columns === "object" && columns !== null &&
    Array.isArray(r.changed) &&
    Array.isArray(r.added) &&
    Array.isArray(r.removed)
  );
}

function parseKeyColumns(json: string): string[] {
  try {
    const raw = JSON.parse(json) as unknown;
    return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}
