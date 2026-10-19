import { aiCallsSince } from "../ai";
import { db } from "../db";

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface OverviewStats {
  /** Jobs created in the last 24 hours. */
  jobsToday: number;
  /** Jobs created in the last 24 hours that failed. */
  failedToday: number;
  /** Queued and running jobs right now. */
  queueDepth: number;
  /** AI calls made in the last 24 hours. */
  aiCallsToday: number;
}

export function getOverviewStats(now: number = Date.now()): OverviewStats {
  const conn = db();
  const since = now - DAY_MS;
  const today = conn
    .prepare(
      `SELECT COUNT(*) AS jobs,
              COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
       FROM jobs WHERE created_at >= ?`,
    )
    .get(since) as { jobs: number; failed: number };
  const queue = conn
    .prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued', 'running')")
    .get() as { n: number };
  return {
    jobsToday: today.jobs,
    failedToday: today.failed,
    queueDepth: queue.n,
    aiCallsToday: aiCallsSince(since),
  };
}
