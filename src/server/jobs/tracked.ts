import { audit } from "../audit";
import { db } from "../db";
import { newId } from "../ids";
import { QueryRejectedError } from "../query";
import { JobBlocked } from "./queue";

export type TrackedJobType = "ask" | "compare";

/**
 * Runs a synchronous-feeling server operation (an Ask query, a comparison) inline while recording a
 * jobs row, so it shows in the admin Jobs list. Ends as done, failed, or blocked. A rejected query is
 * blocked and audited as ask.query_rejected. The error is rethrown so the caller can show it.
 */
export async function runTracked<T>(
  type: TrackedJobType,
  userId: string,
  meta: Record<string, unknown>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const conn = db();
  const id = newId("job", 6);
  const fileId = typeof meta.fileId === "string" && isFileOf(userId, meta.fileId) ? meta.fileId : null;
  conn
    .prepare(
      `INSERT INTO jobs (id, user_id, type, file_id, status, step, progress, meta_json, created_at, started_at)
       VALUES (?, ?, ?, ?, 'running', '', 0, ?, ?, ?)`,
    )
    .run(id, userId, type, fileId, JSON.stringify(meta), Date.now(), Date.now());

  const finish = (status: "done" | "failed" | "blocked", error: string | null) => {
    conn
      .prepare("UPDATE jobs SET status = ?, progress = ?, error = ?, finished_at = ? WHERE id = ?")
      .run(status, status === "done" ? 100 : 0, error, Date.now(), id);
  };

  try {
    const result = await fn();
    finish("done", null);
    return result;
  } catch (err) {
    if (err instanceof QueryRejectedError) {
      finish("blocked", err.reason);
      audit("ask.query_rejected", err.reason, { actor: userId, fileId });
      throw err;
    }
    if (err instanceof JobBlocked) {
      finish("blocked", err.message);
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    finish("failed", message);
    audit("job.failed", `${type} job ${id} failed: ${message}`, { actor: userId, fileId });
    throw err;
  }
}

function isFileOf(userId: string, fileId: string): boolean {
  return Boolean(db().prepare("SELECT 1 FROM files WHERE id = ? AND user_id = ?").get(fileId, userId));
}
