import { db } from "../db";
import { allChanges, fileActivity, getFileForUser, type ActivityItem, type FileDetail, type FileRecord, type FileStatus } from "../files/repo";
import { isValidId } from "../files/storage";
import { formatCount } from "./format";
import { summarizeChanges, type ChangeSummary, type ColumnSummary } from "./summary";

/** Status names the UI badge understands (see components/ui/Badge.tsx). */
export type ReportBadgeStatus = "ready" | "review" | "deleted";

/** The report page's data: the file, its totals over every change, and its activity newest first. */
export interface ReportLoad {
  file: FileDetail;
  summary: ChangeSummary;
  activity: ActivityItem[];
}

/**
 * One file's change report for its owner, or null when the file does not exist or belongs to someone
 * else. Totals come from every change, as the report PDF does. Synchronous: call `connection()` first
 * in a page that renders it.
 */
export function loadReportForUser(userId: string, fileId: string, now = Date.now()): ReportLoad | null {
  const file = getFileForUser(userId, fileId, now);
  if (!file) return null;
  const { changes } = allChanges(file.id);
  return {
    file,
    summary: summarizeChanges(changes, { rowsIn: file.rowCount ?? 0 }),
    activity: newestFirst(fileActivity(file.id)),
  };
}

/** Activity sorted newest first. Does not change the input. */
export function newestFirst<T extends { at: number; id: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.at - a.at || b.id - a.id);
}

/** The header badge: Applied once changes were applied, otherwise Not applied yet. */
export function reportBadge(file: Pick<FileRecord, "status" | "appliedAt">): { label: string; status: ReportBadgeStatus } {
  if (file.appliedAt !== null) return { label: "Applied", status: "ready" };
  if (file.status === "deleted") return { label: "Not applied yet", status: "deleted" };
  return { label: "Not applied yet", status: "review" };
}

/** Link back to review for a file that still waits for decisions. Null otherwise. */
export function reviewHref(file: Pick<FileRecord, "id" | "status" | "appliedAt">): string | null {
  return file.appliedAt === null && file.status === "needs_review" ? `/review/${file.id}` : null;
}

/** The four totals in the design's order. */
export function reportStats(summary: ChangeSummary): { label: string; value: string }[] {
  return [
    { label: "Applied", value: formatCount(summary.applied) },
    { label: "Skipped", value: formatCount(summary.skipped) },
    { label: "Rows removed", value: formatCount(summary.rowsRemoved) },
    { label: "Rows out", value: formatCount(summary.rowsOut) },
  ];
}

/** "96 / 96": approved edits over all edits in the column. */
export function fixedLabel(column: Pick<ColumnSummary, "fixed" | "total">): string {
  return `${formatCount(column.fixed)} / ${formatCount(column.total)}`;
}

/**
 * Whether the cleaned CSV can still be downloaded. A deleted file keeps its report, so the page
 * shows the deletion date instead.
 */
export type CleanedState = { kind: "available" } | { kind: "deleted"; at: number | null } | { kind: "none" };

export function cleanedState(file: Pick<FileRecord, "status" | "appliedAt" | "hasCleaned" | "deletedAt">): CleanedState {
  if (file.hasCleaned) return { kind: "available" };
  if (file.appliedAt !== null && file.status === "deleted") return { kind: "deleted", at: file.deletedAt };
  return { kind: "none" };
}

/** "21 hours", "1 hour", "7 days", "5 minutes", "less than a minute". */
export function timeLeftLabel(ms: number): string {
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (!Number.isFinite(ms) || ms < minute) return "less than a minute";
  if (ms >= 2 * day) return plural(Math.floor(ms / day), "day");
  if (ms >= hour) return plural(Math.floor(ms / hour), "hour");
  return plural(Math.floor(ms / minute), "minute");
}

/**
 * The footer note under the downloads. Once the files are gone (`deletesInMs` is null) only the
 * link note is left.
 */
export function downloadNote(deletesInMs: number | null): string {
  const links = "Download links expire after 15 minutes.";
  return deletesInMs === null ? links : `${links} Files are deleted in ${timeLeftLabel(deletesInMs)}.`;
}

/** One activity line: the event, then who did it when known. */
export function activityText(item: Pick<ActivityItem, "detail" | "action" | "actorName">): string {
  const text = item.detail || item.action;
  return item.actorName ? `${text} · ${item.actorName}` : text;
}

/** A report row on the list page. */
export interface ReportListItem {
  id: string;
  name: string;
  status: FileStatus;
  appliedAt: number | null;
  deletedAt: number | null;
  rowsOut: number | null;
  /** Approved and skipped edits. Flags never count. */
  applied: number;
  skipped: number;
}

/**
 * The user's files that were applied or have edits proposed, including deleted ones, newest first.
 * Flags are informational and do not put a file on the list.
 */
export function listReportsForUser(userId: string, limit = 200): ReportListItem[] {
  if (!isValidId(userId)) return [];
  const max = Math.min(Math.max(1, Math.trunc(limit)), 500);
  const rows = db()
    .prepare(
      `SELECT f.id, f.original_name AS name, f.status, f.applied_at AS appliedAt, f.deleted_at AS deletedAt,
              f.rows_out AS rowsOut,
              (SELECT COUNT(*) FROM changes c WHERE c.file_id = f.id AND c.kind <> 'flag' AND c.decision = 'approved') AS applied,
              (SELECT COUNT(*) FROM changes c WHERE c.file_id = f.id AND c.kind <> 'flag' AND c.decision = 'skipped') AS skipped
       FROM files f
       WHERE f.user_id = ?
         AND (f.applied_at IS NOT NULL
              OR EXISTS (SELECT 1 FROM changes c WHERE c.file_id = f.id AND c.kind <> 'flag'))
       ORDER BY COALESCE(f.applied_at, f.created_at) DESC, f.id DESC
       LIMIT ?`,
    )
    .all(userId, max) as ReportListItem[];
  return rows;
}

/** The list's status badge. Deleted wins over applied, as on the files page. */
export function reportListStatus(item: Pick<ReportListItem, "status" | "appliedAt">): { label: string; status: ReportBadgeStatus } {
  if (item.status === "deleted") return { label: "Deleted", status: "deleted" };
  if (item.appliedAt !== null) return { label: "Applied", status: "ready" };
  return { label: "Not applied yet", status: "review" };
}
