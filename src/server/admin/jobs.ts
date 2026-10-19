import { audit } from "../audit";
import { db } from "../db";
import { cancelJob, type JobType } from "../jobs/queue";
import { AdminError } from "./errors";
import { assertAdminActor } from "./guard";
import { jobDurationMs, readFileCount, type JobStatus } from "./format";
import { paged, resolvePage, type Paged } from "./paging";

export const JOB_PAGE_SIZE = 25;

export interface AdminJob {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  step: string;
  error: string | null;
  userEmail: string | null;
  fileCount: number | null;
  createdAt: number;
  durationMs: number | null;
}

interface JobRow {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  step: string;
  error: string | null;
  meta_json: string;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  user_email: string | null;
}

/** Jobs newest first, optionally filtered to one status. */
export function listJobs(
  opts: { status?: JobStatus | null; page?: number; pageSize?: number } = {},
  now: number = Date.now(),
): Paged<AdminJob> {
  const conn = db();
  const pageSize = opts.pageSize ?? JOB_PAGE_SIZE;
  const where = opts.status ? "WHERE j.status = ?" : "";
  const args: string[] = opts.status ? [opts.status] : [];

  const { n: total } = conn.prepare(`SELECT COUNT(*) AS n FROM jobs j ${where}`).get(...args) as { n: number };
  const { page, offset } = resolvePage(opts.page ?? 1, total, pageSize);
  const rows = conn
    .prepare(
      `SELECT j.id, j.type, j.status, j.progress, j.step, j.error, j.meta_json,
              j.created_at, j.started_at, j.finished_at, u.email AS user_email
       FROM jobs j LEFT JOIN users u ON u.id = j.user_id
       ${where}
       ORDER BY j.created_at DESC, j.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, offset) as JobRow[];

  return paged(
    rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      progress: row.progress,
      step: row.step,
      error: row.error,
      userEmail: row.user_email,
      fileCount: readFileCount(row.meta_json),
      createdAt: row.created_at,
      durationMs: jobDurationMs({ status: row.status, startedAt: row.started_at, finishedAt: row.finished_at }, now),
    })),
    total,
    page,
    pageSize,
  );
}

/**
 * Cancels a queued or running job on behalf of an admin. The job runner stops it at its next check.
 * Throws AdminError when the job is missing, already finished, or the actor is not an active admin.
 */
export function cancelJobAsAdmin(actorId: string, jobId: string): void {
  assertAdminActor(actorId);
  const conn = db();
  const job = conn.prepare("SELECT id, type, status, file_id FROM jobs WHERE id = ?").get(jobId) as
    | { id: string; type: JobType; status: JobStatus; file_id: string | null }
    | undefined;
  if (!job) throw new AdminError("That job no longer exists.");
  if (job.status !== "queued" && job.status !== "running") {
    throw new AdminError("Only queued or running jobs can be cancelled.");
  }

  cancelJob(job.id);
  const after = conn.prepare("SELECT status FROM jobs WHERE id = ?").get(job.id) as { status: JobStatus };
  if (after.status !== "cancelled") throw new AdminError("This job finished before it could be cancelled.");

  audit("admin.job_cancelled", `Admin cancelled ${job.type} job ${job.id}.`, {
    actor: actorId,
    fileId: job.file_id,
  });
}
