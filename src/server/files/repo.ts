import { db } from "../db";
import type { CleanOptions, FileProfileData, ProposedChange } from "../types";
import { DEFAULT_CLEAN_OPTIONS } from "../types";
import { summarizeChanges, type ChangeSummary } from "../reports/summary";
import type { ChangeLogEntry } from "../reports/csv";
import { assertId, isValidId } from "./storage";

export type FileStatus = "uploaded" | "processing" | "needs_review" | "ready" | "failed" | "deleted";
export type AIStatus = "none" | "pending" | "done" | "unavailable" | "skipped";
export type CleaningMode = "rules_ai" | "rules_only";
export type ChangeSourceName = "rule" | "ai";
export type ChangeDecisionName = "approved" | "pending" | "skipped";

/** Raw files row joined with the approver's name. */
export interface FileRow {
  id: string;
  user_id: string;
  original_name: string;
  alias: string;
  size_bytes: number;
  delimiter: string | null;
  encoding: string | null;
  row_count: number | null;
  column_count: number | null;
  storage_path: string | null;
  cleaned_path: string | null;
  status: FileStatus;
  error: string | null;
  mode: CleaningMode;
  options_json: string;
  rule_set_id: string | null;
  profile_json: string | null;
  ai_status: AIStatus;
  rows_out: number | null;
  approved_by: string | null;
  applied_at: number | null;
  created_at: number;
  expires_at: number;
  deleted_at: number | null;
  approver_name: string | null;
  approver_email: string | null;
}

const FILE_SELECT = `
  SELECT f.*, ap.name AS approver_name, ap.email AS approver_email
  FROM files f LEFT JOIN users ap ON ap.id = f.approved_by`;

export interface ChangeCounts {
  total: number;
  approved: number;
  pending: number;
  skipped: number;
  bySource: Record<ChangeSourceName, Record<ChangeDecisionName, number>>;
}

export interface FileRecord {
  id: string;
  name: string;
  alias: string;
  sizeBytes: number;
  delimiter: string | null;
  encoding: string | null;
  rowCount: number | null;
  columnCount: number | null;
  status: FileStatus;
  error: string | null;
  mode: CleaningMode;
  options: CleanOptions;
  ruleSetId: string | null;
  profile: FileProfileData | null;
  aiStatus: AIStatus;
  rowsOut: number | null;
  approvedByName: string | null;
  appliedAt: number | null;
  createdAt: number;
  expiresAt: number;
  deletedAt: number | null;
  /** Ms until the original and cleaned copies are removed. Null once deleted. */
  deletesInMs: number | null;
  /** The original and cleaned copies are still on the server (status is not deleted). */
  hasOriginal: boolean;
  hasCleaned: boolean;
}

export interface FileDetail extends FileRecord {
  counts: ChangeCounts;
}

export interface FileListItem extends FileRecord {
  changeCount: number;
  pendingCount: number;
}

/** Lenient parse of options_json: unknown keys dropped, bad values fall back to defaults. */
export function readCleanOptions(json: string | null | undefined): CleanOptions {
  const out: CleanOptions = { ...DEFAULT_CLEAN_OPTIONS };
  try {
    const raw = JSON.parse(json ?? "{}") as Record<string, unknown>;
    if (typeof raw.normalizeDates === "boolean") out.normalizeDates = raw.normalizeDates;
    if (typeof raw.dedupe === "boolean") out.dedupe = raw.dedupe;
    if (typeof raw.trimAndCase === "boolean") out.trimAndCase = raw.trimAndCase;
    if (typeof raw.fillMissing === "boolean") out.fillMissing = raw.fillMissing;
    if (raw.dateOrder === "auto" || raw.dateOrder === "mdy" || raw.dateOrder === "dmy") out.dateOrder = raw.dateOrder;
  } catch {
    // Keep defaults.
  }
  return out;
}

function readProfile(json: string | null): FileProfileData | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as FileProfileData;
  } catch {
    return null;
  }
}

function emptyCounts(): ChangeCounts {
  const bucket = () => ({ approved: 0, pending: 0, skipped: 0 });
  return { total: 0, approved: 0, pending: 0, skipped: 0, bySource: { rule: bucket(), ai: bucket() } };
}

function countsFrom(rows: { source: ChangeSourceName; decision: ChangeDecisionName; n: number }[]): ChangeCounts {
  const counts = emptyCounts();
  for (const r of rows) {
    counts.total += r.n;
    counts[r.decision] += r.n;
    counts.bySource[r.source][r.decision] += r.n;
  }
  return counts;
}

function toRecord(row: FileRow, now: number): FileRecord {
  const deleted = row.status === "deleted" || row.deleted_at !== null;
  return {
    id: row.id,
    name: row.original_name,
    alias: row.alias,
    sizeBytes: row.size_bytes,
    delimiter: row.delimiter,
    encoding: row.encoding,
    rowCount: row.row_count,
    columnCount: row.column_count,
    status: row.status,
    error: row.error,
    mode: row.mode,
    options: readCleanOptions(row.options_json),
    ruleSetId: row.rule_set_id,
    profile: readProfile(row.profile_json),
    aiStatus: row.ai_status,
    rowsOut: row.rows_out,
    approvedByName: row.approver_name ?? row.approver_email ?? null,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    deletedAt: row.deleted_at,
    deletesInMs: deleted ? null : Math.max(0, row.expires_at - now),
    hasOriginal: !deleted && row.storage_path !== null,
    hasCleaned: !deleted && row.cleaned_path !== null,
  };
}

/** The files row for one user, or null when it does not exist or belongs to someone else. */
export function getFileRowForUser(userId: string, fileId: string): FileRow | null {
  if (!isValidId(fileId) || !isValidId(userId)) return null;
  return (
    (db()
      .prepare(`${FILE_SELECT} WHERE f.id = ? AND f.user_id = ?`)
      .get(fileId, userId) as FileRow | undefined) ?? null
  );
}

/** One file with its profile, options and change counts. Ownership is enforced. */
export function getFileForUser(userId: string, fileId: string, now = Date.now()): FileDetail | null {
  const row = getFileRowForUser(userId, fileId);
  if (!row) return null;
  const rows = db()
    .prepare("SELECT source, decision, COUNT(*) AS n FROM changes WHERE file_id = ? GROUP BY source, decision")
    .all(row.id) as { source: ChangeSourceName; decision: ChangeDecisionName; n: number }[];
  return { ...toRecord(row, now), counts: countsFrom(rows) };
}

export interface FileListFilter {
  /** A status, or "active" for everything not deleted. Omitted means all. */
  status?: FileStatus | "active";
  /** Case-insensitive match on the file name. */
  q?: string;
  limit?: number;
}

/** The user's files, newest first. */
export function listFilesForUser(userId: string, filter: FileListFilter = {}, now = Date.now()): FileListItem[] {
  if (!isValidId(userId)) return [];
  const where: string[] = ["f.user_id = ?"];
  const args: (string | number)[] = [userId];
  if (filter.status === "active") {
    where.push("f.status <> 'deleted'");
  } else if (filter.status) {
    where.push("f.status = ?");
    args.push(filter.status);
  }
  const q = filter.q?.trim();
  if (q) {
    where.push("instr(lower(f.original_name), lower(?)) > 0");
    args.push(q);
  }
  const limit = Math.min(Math.max(1, Math.trunc(filter.limit ?? 200)), 500);
  const rows = db()
    .prepare(
      `${FILE_SELECT.replace(
        "FROM files f",
        `, (SELECT COUNT(*) FROM changes c WHERE c.file_id = f.id) AS change_count,
           (SELECT COUNT(*) FROM changes c WHERE c.file_id = f.id AND c.decision = 'pending') AS pending_count
         FROM files f`,
      )}
       WHERE ${where.join(" AND ")}
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT ?`,
    )
    .all(...args, limit) as (FileRow & { change_count: number; pending_count: number })[];
  return rows.map((r) => ({
    ...toRecord(r, now),
    changeCount: r.change_count,
    pendingCount: r.pending_count,
  }));
}

export type ChangeFilter = "all" | "pending" | "rule" | "ai";

export interface ChangeRecord {
  id: number;
  rowIndex: number;
  /** Spreadsheet row in the original file (header is row 1). */
  rowNumber: number;
  column: string | null;
  kind: ProposedChange["kind"];
  before: string | null;
  after: string | null;
  mergeIntoRow: number | null;
  source: ChangeSourceName;
  ruleId: string | null;
  reason: string;
  confidence: number | null;
  decision: ChangeDecisionName;
  decidedByName: string | null;
  decidedAt: number | null;
}

interface ChangeRow {
  id: number;
  row_index: number;
  column_name: string | null;
  kind: ProposedChange["kind"];
  before: string | null;
  after: string | null;
  merge_into_row: number | null;
  source: ChangeSourceName;
  rule_id: string | null;
  reason: string;
  confidence: number | null;
  decision: ChangeDecisionName;
  decided_at: number | null;
  decider_name: string | null;
  decider_email: string | null;
}

function changeWhere(filter: ChangeFilter): string {
  switch (filter) {
    case "pending":
      return "c.decision = 'pending'";
    case "rule":
      return "c.source = 'rule'";
    case "ai":
      return "c.source = 'ai'";
    default:
      return "1 = 1";
  }
}

/**
 * One page of a file's changes in row order. The caller must have checked that the file belongs
 * to the user (getFileRowForUser); this function does not know the user.
 */
export function listChanges(
  fileId: string,
  opts: { filter?: ChangeFilter; offset?: number; limit?: number } = {},
): { total: number; items: ChangeRecord[] } {
  assertId(fileId);
  const where = `c.file_id = ? AND ${changeWhere(opts.filter ?? "all")}`;
  const conn = db();
  const { n } = conn.prepare(`SELECT COUNT(*) AS n FROM changes c WHERE ${where}`).get(fileId) as { n: number };
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? 100)), 500);
  const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
  const rows = conn
    .prepare(
      `SELECT c.id, c.row_index, c.column_name, c.kind, c.before, c.after, c.merge_into_row, c.source, c.rule_id,
              c.reason, c.confidence, c.decision, c.decided_at, u.name AS decider_name, u.email AS decider_email
       FROM changes c LEFT JOIN users u ON u.id = c.decided_by
       WHERE ${where}
       ORDER BY c.row_index, c.id
       LIMIT ? OFFSET ?`,
    )
    .all(fileId, limit, offset) as ChangeRow[];
  return {
    total: n,
    items: rows.map((r) => ({
      id: r.id,
      rowIndex: r.row_index,
      rowNumber: r.row_index + 2,
      column: r.column_name,
      kind: r.kind,
      before: r.before,
      after: r.after,
      mergeIntoRow: r.merge_into_row,
      source: r.source,
      ruleId: r.rule_id,
      reason: r.reason,
      confidence: r.confidence,
      decision: r.decision,
      decidedByName: r.decider_name ?? r.decider_email ?? null,
      decidedAt: r.decided_at,
    })),
  };
}

export interface ActivityItem {
  id: number;
  at: number;
  action: string;
  detail: string;
  actorName: string | null;
}

/** Audit entries for one file, oldest first. */
export function fileActivity(fileId: string): ActivityItem[] {
  assertId(fileId);
  const rows = db()
    .prepare(
      `SELECT a.id, a.at, a.action, a.detail, u.name AS actor_name, u.email AS actor_email
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.file_id = ? ORDER BY a.at, a.id`,
    )
    .all(fileId) as {
    id: number;
    at: number;
    action: string;
    detail: string;
    actor_name: string | null;
    actor_email: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    detail: r.detail,
    actorName: r.actor_name || r.actor_email || null,
  }));
}

interface AllChangeRow {
  id: number;
  row_index: number;
  column_name: string | null;
  kind: ProposedChange["kind"];
  before: string | null;
  after: string | null;
  merge_into_row: number | null;
  source: ChangeSourceName;
  rule_id: string | null;
  reason: string;
  confidence: number | null;
  decision: ChangeDecisionName;
  decider_name: string | null;
  decider_email: string | null;
}

/** Every change of a file as engine-shaped objects, in row order. Used for reports and the change log. */
export function allChanges(fileId: string): { changes: ProposedChange[]; decidedBy: (string | null)[] } {
  assertId(fileId);
  const changes: ProposedChange[] = [];
  const decidedBy: (string | null)[] = [];
  const stmt = db().prepare(
    `SELECT c.id, c.row_index, c.column_name, c.kind, c.before, c.after, c.merge_into_row, c.source, c.rule_id,
            c.reason, c.confidence, c.decision, u.name AS decider_name, u.email AS decider_email
     FROM changes c LEFT JOIN users u ON u.id = c.decided_by
     WHERE c.file_id = ? ORDER BY c.row_index, c.id`,
  );
  for (const r of stmt.iterate(fileId) as IterableIterator<AllChangeRow>) {
    changes.push({
      rowIndex: r.row_index,
      column: r.column_name,
      kind: r.kind,
      before: r.before,
      after: r.after,
      ...(r.merge_into_row !== null ? { mergeIntoRow: r.merge_into_row } : {}),
      source: r.source,
      ruleId: r.rule_id ?? "",
      reason: r.reason,
      ...(r.confidence !== null ? { confidence: r.confidence } : {}),
      decision: r.decision,
    });
    decidedBy.push(r.decider_name || r.decider_email || null);
  }
  return { changes, decidedBy };
}

/** Totals for the report. rowsIn is the file's row_count. */
export function summaryForReport(fileId: string): { summary: ChangeSummary; changes: ProposedChange[] } {
  const row = db().prepare("SELECT row_count FROM files WHERE id = ?").get(assertId(fileId)) as
    | { row_count: number | null }
    | undefined;
  const { changes } = allChanges(fileId);
  return { summary: summarizeChanges(changes, { rowsIn: row?.row_count ?? 0 }), changes };
}

/** The change log rows, with who decided each one. */
export function changeLogEntries(fileId: string): ChangeLogEntry[] {
  const { changes, decidedBy } = allChanges(fileId);
  return changes.map((c, i) => ({ ...c, decidedBy: decidedBy[i] }));
}

