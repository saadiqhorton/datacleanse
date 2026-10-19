import { audit } from "../audit";
import { db } from "../db";
import { FileError, NOT_FOUND_MESSAGE } from "./errors";
import { getFileRowForUser, listFilesForUser, type FileListItem, type FileStatus } from "./repo";
import { originalRel, removeFileDir, storedFileExists } from "./storage";

/** The status a file shows as on the Files list. Matches the UI badge statuses. */
export type ListStatus = "review" | "processing" | "ready" | "failed" | "deleted";

export const FILES_TABS = ["all", "review", "ready", "processing", "failed"] as const;
export type FilesTab = (typeof FILES_TABS)[number];

export const TAB_LABELS: Record<FilesTab, string> = {
  all: "All",
  review: "Needs review",
  ready: "Ready",
  processing: "Processing",
  failed: "Failed",
};

export const MAX_SEARCH_LENGTH = 200;
/** The most files one list shows (the repo layer caps a query at 500). */
const MAX_LIST = 500;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const BUSY_MESSAGE = "This file is still being processed. You can delete it when processing finishes.";

/** The ?status= value, or "all" for anything unknown. */
export function parseTab(raw: unknown): FilesTab {
  return (FILES_TABS as readonly unknown[]).includes(raw) ? (raw as FilesTab) : "all";
}

/** The ?q= value: trimmed and capped. Empty when absent. */
export function parseSearch(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, MAX_SEARCH_LENGTH) : "";
}

/** Link to the Files list that keeps the given tab and search. */
export function filesHref(opts: { tab?: FilesTab; q?: string } = {}): string {
  const params = new URLSearchParams();
  if (opts.tab && opts.tab !== "all") params.set("status", opts.tab);
  if (opts.q) params.set("q", opts.q);
  const query = params.toString();
  return query ? `/files?${query}` : "/files";
}

export function listStatusOf(status: FileStatus): ListStatus {
  switch (status) {
    case "deleted":
      return "deleted";
    case "needs_review":
      return "review";
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    case "uploaded":
    case "processing":
      return "processing";
  }
}

export function tabMatches(tab: FilesTab, status: ListStatus): boolean {
  return tab === "all" || tab === status;
}

/** 4812 -> "4,812". Done by hand so the output does not depend on the server's locale. */
export function formatCount(n: number): string {
  return Math.trunc(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Time left before the copies are removed: "45 min", "21 h", "7 d". Null (deleted files) shows a dash.
 * Under a minute, including files the sweep is about to remove, reads "< 1 min".
 */
export function formatDeletesIn(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < MINUTE) return "< 1 min";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < 2 * DAY) return `${Math.floor(ms / HOUR)} h`;
  return `${Math.floor(ms / DAY)} d`;
}

export function processingLabel(progress: number): string {
  return `Processing · ${Math.round(Math.max(0, Math.min(100, progress)))}%`;
}

export type ChangesTone = "normal" | "muted" | "error";

export interface FileListRow {
  id: string;
  name: string;
  status: ListStatus;
  statusLabel: string;
  /** Job progress 0..100 for processing files, otherwise null. */
  progress: number | null;
  rowsLabel: string;
  changesLabel: string;
  changesTone: ChangesTone;
  deletesLabel: string;
  /** A failed file whose original copy is still on the server: "Try again" can re-run it. */
  canRetry: boolean;
}

export interface FilesView {
  /** Rows in the requested tab, newest first. */
  rows: FileListRow[];
  /** Live pill counts for the search text (the tab is not applied). */
  counts: Record<FilesTab, number>;
  /** Every file that matches the search text, whatever the tab. */
  total: number;
}

/** Latest clean job's progress for each of the user's processing files. */
function processingProgress(userId: string): Map<string, number> {
  const rows = db()
    .prepare(
      `SELECT file_id, progress FROM (
         SELECT j.file_id, j.progress,
                ROW_NUMBER() OVER (PARTITION BY j.file_id ORDER BY j.created_at DESC, j.rowid DESC) AS rn
         FROM jobs j
         WHERE j.type = 'clean'
           AND j.file_id IN (SELECT id FROM files WHERE user_id = ? AND status = 'processing'))
       WHERE rn = 1`,
    )
    .all(userId) as { file_id: string; progress: number }[];
  return new Map(rows.map((r) => [r.file_id, r.progress]));
}

/** Applied (approved) changes for each of the user's ready files. */
function appliedCounts(userId: string): Map<string, number> {
  const rows = db()
    .prepare(
      `SELECT c.file_id AS file_id, COUNT(*) AS n
       FROM changes c JOIN files f ON f.id = c.file_id
       WHERE f.user_id = ? AND f.status = 'ready' AND c.decision = 'approved'
       GROUP BY c.file_id`,
    )
    .all(userId) as { file_id: string; n: number }[];
  return new Map(rows.map((r) => [r.file_id, r.n]));
}

function changesFor(
  item: FileListItem,
  status: ListStatus,
  applied: number,
): { label: string; tone: ChangesTone } {
  switch (status) {
    case "review":
      return item.changeCount === 0
        ? { label: "No changes", tone: "normal" }
        : { label: `${formatCount(item.changeCount)} · ${formatCount(item.pendingCount)} pending`, tone: "normal" };
    case "ready":
      return { label: `${formatCount(applied)} applied`, tone: "normal" };
    case "failed":
      return { label: item.error || "Failed", tone: "error" };
    case "deleted":
      return { label: "Report kept", tone: "muted" };
    case "processing":
      return { label: "—", tone: "muted" };
  }
}

function statusLabelFor(status: ListStatus, progress: number): string {
  switch (status) {
    case "review":
      return "Needs review";
    case "processing":
      return processingLabel(progress);
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    case "deleted":
      return "Deleted";
  }
}

/** The Files list for one user: rows for the tab, pill counts for the search, newest first. */
export async function filesView(
  userId: string,
  opts: { tab?: FilesTab; q?: string } = {},
  now = Date.now(),
): Promise<FilesView> {
  const tab = opts.tab ?? "all";
  const items = listFilesForUser(userId, { q: opts.q || undefined, limit: MAX_LIST }, now);
  const progress = processingProgress(userId);
  const applied = appliedCounts(userId);

  const all: FileListRow[] = [];
  for (const item of items) {
    const status = listStatusOf(item.status);
    const pct = progress.get(item.id) ?? 0;
    const changes = changesFor(item, status, applied.get(item.id) ?? 0);
    const canRetry = status === "failed" ? await storedFileExists(originalRel(userId, item.id)) : false;
    all.push({
      id: item.id,
      name: item.name,
      status,
      statusLabel: statusLabelFor(status, pct),
      progress: status === "processing" ? pct : null,
      rowsLabel: item.rowCount === null ? "—" : formatCount(item.rowCount),
      changesLabel: changes.label,
      changesTone: changes.tone,
      deletesLabel: formatDeletesIn(item.deletesInMs),
      canRetry,
    });
  }

  const counts: Record<FilesTab, number> = { all: all.length, review: 0, ready: 0, processing: 0, failed: 0 };
  for (const row of all) {
    if (row.status !== "deleted") counts[row.status]++;
  }

  return {
    rows: all.filter((r) => tabMatches(tab, r.status)),
    counts,
    total: all.length,
  };
}

/** A file is busy while a job is queued or running, or while its cleaned copy is being written. */
function isBusy(fileId: string, status: FileStatus): boolean {
  if (status === "processing") return true;
  const active = db()
    .prepare("SELECT 1 FROM jobs WHERE file_id = ? AND status IN ('queued', 'running') LIMIT 1")
    .get(fileId);
  return active !== undefined;
}

/**
 * Deletes a file now, as retention does at expiry: the directory goes, the row stays with status
 * deleted and its changes are kept, so the report and change log remain. Refuses files that are
 * still being processed. Ownership is enforced; another user's file reads as not found.
 */
export async function deleteFileForUser(userId: string, fileId: string, now = Date.now()): Promise<void> {
  const row = getFileRowForUser(userId, fileId);
  if (!row) throw new FileError("not_found", NOT_FOUND_MESSAGE);
  if (row.status === "deleted" || row.deleted_at !== null) {
    throw new FileError("conflict", "This file was already deleted.");
  }
  if (isBusy(row.id, row.status)) throw new FileError("conflict", BUSY_MESSAGE);

  await removeFileDir(userId, row.id);
  db()
    .prepare(
      "UPDATE files SET status = 'deleted', storage_path = NULL, cleaned_path = NULL, deleted_at = ? WHERE id = ? AND user_id = ?",
    )
    .run(now, row.id, userId);
  audit("file.deleted", "Deleted by you", { actor: userId, fileId: row.id });
}
