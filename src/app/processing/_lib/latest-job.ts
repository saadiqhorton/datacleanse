import { db } from "@/server/db";
import { isValidId } from "@/server/files/storage";

export interface LatestCleanJob {
  id: string;
  /** Set by the clean handler when it switches to chunked proposals (files above 200k rows). */
  chunked: boolean;
}

/**
 * The newest clean job for a file the user owns, or null. The caller must have checked that the
 * file belongs to the user; the user id is still required so the query cannot cross accounts.
 */
export function latestCleanJob(userId: string, fileId: string): LatestCleanJob | null {
  if (!isValidId(userId) || !isValidId(fileId)) return null;
  const row = db()
    .prepare(
      `SELECT id, meta_json FROM jobs
       WHERE user_id = ? AND file_id = ? AND type = 'clean'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(userId, fileId) as { id: string; meta_json: string } | undefined;
  if (!row) return null;
  let chunked = false;
  try {
    chunked = (JSON.parse(row.meta_json) as { chunked?: unknown }).chunked === true;
  } catch {
    chunked = false;
  }
  return { id: row.id, chunked };
}
