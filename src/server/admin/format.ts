import type { JobType } from "../jobs/queue";

export const JOB_STATUSES = ["queued", "running", "done", "failed", "blocked", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
  blocked: "Blocked query",
  cancelled: "Cancelled",
};

export function jobStatusLabel(status: JobStatus): string {
  return STATUS_LABELS[status];
}

/** Accepts only known statuses; anything else means "all". */
export function parseJobStatus(raw: string | null | undefined): JobStatus | null {
  return (JOB_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as JobStatus) : null;
}

const TYPE_LABELS: Record<JobType, string> = { clean: "Clean", ask: "Ask", compare: "Compare" };

/** "Ask · 3 files" when the job recorded its file count, otherwise just "Ask". */
export function jobTypeLabel(type: JobType, fileCount: number | null): string {
  const base = TYPE_LABELS[type];
  if (fileCount === null) return base;
  return `${base} · ${fileCount} ${fileCount === 1 ? "file" : "files"}`;
}

/** The fileCount a job stored in meta_json, or null when absent or malformed. */
export function readFileCount(metaJson: string): number | null {
  try {
    const meta = JSON.parse(metaJson) as unknown;
    if (meta && typeof meta === "object") {
      const count = (meta as { fileCount?: unknown }).fileCount;
      if (typeof count === "number" && Number.isInteger(count) && count >= 0) return count;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * How long a job ran. Running jobs count up to `now`. Jobs that never started (cancelled while
 * queued) have no duration.
 */
export function jobDurationMs(
  job: { status: JobStatus; startedAt: number | null; finishedAt: number | null },
  now: number,
): number | null {
  if (job.startedAt === null) return null;
  const end = job.finishedAt ?? (job.status === "running" ? now : null);
  return end === null ? null : Math.max(0, end - job.startedAt);
}

/** "0.4 s", "48 s", "3 min 5 s". Null (never ran) shows as a dash. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
