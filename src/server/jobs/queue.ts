import { audit } from "../audit";
import { db } from "../db";
import { env } from "../env";
import { newId } from "../ids";

export type JobType = "clean" | "ask" | "compare";

export interface JobContext {
  jobId: string;
  userId: string;
  fileId: string | null;
  meta: Record<string, unknown>;
  /** Persist progress (0..100) and the current step label shown on Processing. */
  progress(step: string, pct: number): void;
  /** True once the user cancelled; handlers should check between steps and return. */
  cancelled(): boolean;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;

/** Thrown by a handler to end the job as "blocked" (e.g. a rejected query) rather than "failed". */
export class JobBlocked extends Error {}

const g = globalThis as unknown as {
  __dcJobs?: { handlers: Map<JobType, JobHandler>; running: number; started: boolean };
};
const state = (g.__dcJobs ??= { handlers: new Map(), running: 0, started: false });

export function registerJobHandler(type: JobType, handler: JobHandler) {
  state.handlers.set(type, handler);
}

export function enqueueJob(
  type: JobType,
  userId: string,
  opts: { fileId?: string | null; meta?: Record<string, unknown> } = {},
) {
  const id = newId("job", 6);
  db()
    .prepare(
      "INSERT INTO jobs (id, user_id, type, file_id, status, meta_json, created_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)",
    )
    .run(id, userId, type, opts.fileId ?? null, JSON.stringify(opts.meta ?? {}), Date.now());
  setImmediate(pump);
  return id;
}

export function cancelJob(jobId: string) {
  db()
    .prepare("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('queued','running')")
    .run(Date.now(), jobId);
}

/** Call once at server start (instrumentation.ts). Interrupted jobs are re-queued. */
export function startJobRunner() {
  if (state.started) return;
  state.started = true;
  db().prepare("UPDATE jobs SET status = 'queued', step = '', progress = 0 WHERE status = 'running'").run();
  setInterval(pump, 2000).unref();
  setImmediate(pump);
}

function pump() {
  while (state.running < env.jobConcurrency) {
    const job = claimNext();
    if (!job) return;
    state.running++;
    run(job).finally(() => {
      state.running--;
      setImmediate(pump);
    });
  }
}

interface JobRow {
  id: string;
  user_id: string;
  type: JobType;
  file_id: string | null;
  meta_json: string;
}

function claimNext(): JobRow | undefined {
  const conn = db();
  return conn.transaction(() => {
    const row = conn
      .prepare(
        `SELECT id, user_id, type, file_id, meta_json FROM jobs
         WHERE status = 'queued' AND type IN (${[...state.handlers.keys()].map(() => "?").join(",") || "''"})
         ORDER BY created_at LIMIT 1`,
      )
      .get(...state.handlers.keys()) as JobRow | undefined;
    if (row) {
      conn.prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?").run(Date.now(), row.id);
    }
    return row;
  })();
}

async function run(job: JobRow) {
  const conn = db();
  const handler = state.handlers.get(job.type)!;
  const statusOf = () =>
    (conn.prepare("SELECT status FROM jobs WHERE id = ?").get(job.id) as { status: string } | undefined)?.status;
  const ctx: JobContext = {
    jobId: job.id,
    userId: job.user_id,
    fileId: job.file_id,
    meta: JSON.parse(job.meta_json),
    progress(step, pct) {
      conn
        .prepare("UPDATE jobs SET step = ?, progress = ? WHERE id = ? AND status = 'running'")
        .run(step, Math.max(0, Math.min(100, Math.round(pct))), job.id);
    },
    cancelled: () => statusOf() === "cancelled",
  };
  try {
    await handler(ctx);
    conn
      .prepare("UPDATE jobs SET status = 'done', progress = 100, finished_at = ? WHERE id = ? AND status = 'running'")
      .run(Date.now(), job.id);
  } catch (err) {
    const blocked = err instanceof JobBlocked;
    const message = err instanceof Error ? err.message : String(err);
    conn
      .prepare("UPDATE jobs SET status = ?, error = ?, finished_at = ? WHERE id = ? AND status = 'running'")
      .run(blocked ? "blocked" : "failed", message, Date.now(), job.id);
    if (!blocked) {
      audit("job.failed", `${job.type} job ${job.id} failed: ${message}`, { fileId: job.file_id });
      console.error(`[jobs] ${job.id} failed`, err);
    }
  }
}
