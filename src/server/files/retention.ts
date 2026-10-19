import { audit } from "../audit";
import { db } from "../db";
import { removeFileDir } from "./storage";

export interface SweepResult {
  deletedFiles: number;
  deletedSessions: number;
  deletedTokens: number;
  reconciledFiles: number;
}

/**
 * Deletes files past their expiry: the directory goes, the row stays (status deleted, paths cleared)
 * and its changes are kept, so the report and change log remain available. Files with a queued or
 * running job are left until that job ends. Also clears expired Better Auth sessions and verification
 * tokens (password reset links), and fixes files left in processing with no job behind them.
 */
export async function sweepExpiredFiles(now: number = Date.now()): Promise<SweepResult> {
  const conn = db();
  const expired = conn
    .prepare(
      `SELECT f.id, f.user_id FROM files f
       WHERE f.deleted_at IS NULL AND f.expires_at <= ?
         AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.file_id = f.id AND j.status IN ('queued', 'running'))`,
    )
    .all(now) as { id: string; user_id: string }[];

  let deletedFiles = 0;
  for (const file of expired) {
    try {
      await removeFileDir(file.user_id, file.id);
    } catch (err) {
      console.error(`[retention] could not remove files for ${file.id}`, err);
      continue;
    }
    conn
      .prepare("UPDATE files SET status = 'deleted', storage_path = NULL, cleaned_path = NULL, deleted_at = ? WHERE id = ?")
      .run(now, file.id);
    deletedFiles++;
  }
  if (deletedFiles > 0) {
    audit("retention.deleted", `Retention job deleted ${deletedFiles} ${deletedFiles === 1 ? "file" : "files"}`, {
      actor: null,
    });
  }

  const reconciledFiles = reconcileStuckFiles();

  const deletedSessions = deleteExpired("auth_session", now);
  const deletedTokens = deleteExpired("auth_verification", now);

  return { deletedFiles, deletedSessions, deletedTokens, reconciledFiles };
}

/**
 * Files still marked processing with no queued or running job: their job was cancelled from the admin
 * console or lost. A cancelled AI retry returns to review; anything else becomes failed.
 */
export function reconcileStuckFiles(): number {
  const conn = db();
  const stuck = conn
    .prepare(
      `SELECT f.id,
              (SELECT j.status FROM jobs j WHERE j.file_id = f.id AND j.type = 'clean' ORDER BY j.created_at DESC LIMIT 1) AS last_status,
              (SELECT j.meta_json FROM jobs j WHERE j.file_id = f.id AND j.type = 'clean' ORDER BY j.created_at DESC LIMIT 1) AS last_meta
       FROM files f
       WHERE f.status = 'processing'
         AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.file_id = f.id AND j.status IN ('queued', 'running'))`,
    )
    .all() as { id: string; last_status: string | null; last_meta: string | null }[];

  for (const file of stuck) {
    const aiOnly = (file.last_meta ?? "").includes('"aiOnly":true');
    if (aiOnly) {
      conn.prepare("UPDATE files SET status = 'needs_review', ai_status = 'unavailable' WHERE id = ?").run(file.id);
    } else {
      const message = file.last_status === "cancelled" ? "Cancelled" : "Processing was interrupted. Retry to process it again.";
      conn.prepare("UPDATE files SET status = 'failed', error = ? WHERE id = ?").run(message, file.id);
    }
  }
  return stuck.length;
}

/** Deletes rows of a Better Auth table whose expiresAt has passed. The table exists once auth has started. */
function deleteExpired(table: "auth_session" | "auth_verification", now: number): number {
  const conn = db();
  if (!conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) return 0;
  const rows = conn.prepare(`SELECT id, expiresAt FROM ${table}`).all() as { id: string; expiresAt: string | number }[];
  const remove = conn.prepare(`DELETE FROM ${table} WHERE id = ?`);
  let n = 0;
  conn.transaction(() => {
    for (const r of rows) if (new Date(r.expiresAt).getTime() < now) n += remove.run(r.id).changes;
  })();
  return n;
}
