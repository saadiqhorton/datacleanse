import { audit } from "../audit";
import { db } from "../db";
import { cancelJob } from "../jobs/queue";
import { stepViews, type StepView } from "./steps";
import { isValidId } from "./storage";

export interface JobView {
  id: string;
  type: "clean" | "ask" | "compare";
  status: string;
  step: string;
  progress: number;
  error: string | null;
  fileId: string | null;
  fileStatus: string | null;
  aiStatus: string | null;
  /** The six Processing steps for clean jobs; empty for other job types. */
  steps: StepView[];
}

/** A job the user owns, for the Processing page to poll. Null when it does not exist or is someone else's. */
export function getJobForUser(userId: string, jobId: string): JobView | null {
  if (!isValidId(jobId)) return null;
  const row = db()
    .prepare(
      `SELECT j.id, j.type, j.status, j.step, j.progress, j.error, j.meta_json, j.file_id,
              f.status AS file_status, f.ai_status AS ai_status
       FROM jobs j LEFT JOIN files f ON f.id = j.file_id AND f.user_id = j.user_id
       WHERE j.id = ? AND j.user_id = ?`,
    )
    .get(jobId, userId) as
    | {
        id: string;
        type: "clean" | "ask" | "compare";
        status: string;
        step: string;
        progress: number;
        error: string | null;
        meta_json: string;
        file_id: string | null;
        file_status: string | null;
        ai_status: string | null;
      }
    | undefined;
  if (!row) return null;
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(row.meta_json) as Record<string, unknown>;
  } catch {
    meta = {};
  }
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    step: row.step,
    progress: row.progress,
    error: row.error,
    fileId: row.file_id,
    fileStatus: row.file_status,
    aiStatus: row.ai_status,
    steps: row.type === "clean" ? stepViews(row.status, meta) : [],
  };
}

/**
 * Cancels a queued or running job the user owns. A file being cleaned is marked failed with
 * "Cancelled" straight away, because a queued job never starts. A cancelled AI retry returns the file
 * to review. Returns the job's status after the call.
 */
export function cancelJobForUser(userId: string, jobId: string): { status: string } | null {
  if (!isValidId(jobId)) return null;
  const conn = db();
  const job = conn
    .prepare("SELECT type, file_id, status, meta_json FROM jobs WHERE id = ? AND user_id = ?")
    .get(jobId, userId) as { type: string; file_id: string | null; status: string; meta_json: string } | undefined;
  if (!job) return null;
  if (job.status !== "queued" && job.status !== "running") return { status: job.status };

  cancelJob(jobId);
  if (job.type === "clean" && job.file_id) {
    const aiOnly = job.meta_json.includes('"aiOnly":true');
    const changed = aiOnly
      ? conn
          .prepare("UPDATE files SET status = 'needs_review', ai_status = 'unavailable' WHERE id = ? AND status = 'processing'")
          .run(job.file_id).changes
      : conn
          .prepare("UPDATE files SET status = 'failed', error = 'Cancelled' WHERE id = ? AND status = 'processing'")
          .run(job.file_id).changes;
    if (changed > 0) audit("file.cancelled", aiOnly ? "AI review cancelled" : "Cancelled", { actor: userId, fileId: job.file_id });
  }
  return { status: "cancelled" };
}
