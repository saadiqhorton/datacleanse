/**
 * Helpers shared by the files and clean-job tests: a CRM fixture, a fake OpenAI-compatible
 * server, and a job context that behaves like the one the queue passes to handlers.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "../db";
import { runCleanJob } from "../jobs/handlers/clean";
import type { JobContext } from "../jobs/queue";
import type { FileRow } from "./repo";
import { createUpload, type UploadInput } from "./upload";

// ---------------------------------------------------------------------------
// CRM fixture
// ---------------------------------------------------------------------------

export const CRM_HEADER = "customer_id,first_name,last_name,email,phone,signup_date,country,company,amount";
/** Appears once, in data row 30 (sample row 30 is outside the 20-row AI sample). */
export const OUTSIDE_SAMPLE_MARKER = "Zephyr Marine Holdings";
/** Row 3 of the file (data row index 2), company misspelled. The AI should fix this one. */
export const TYPO_COMPANY = "Northwnd";

/** Deterministic CRM rows: mixed date layouts, email case, phone formats, country codes and names, one duplicate. */
export function crmCsv(rowCount = 40, eol = "\n"): string {
  const first = ["jane", "  maria ", "TOM", "ana", "li", "omar", "kim", "Luca"];
  const last = ["doe", "rossi", "lee", "silva", "wei", "haddad", "park", "bianchi"];
  const phones = ["(555) 010-2030", "555-010-2031", "5550102032", "+44 20 7946 0958", "555.010.2035"];
  const countries = ["US", "Germany", "GB", "United States", "France", "DE"];
  const companies = ["acme corp.", "northwind", "globex", "initech", "umbrella ag"];
  const lines = [CRM_HEADER];
  for (let i = 1; i <= rowCount; i++) {
    const f = first[i % first.length];
    const l = last[i % last.length];
    const email = i % 4 === 0 ? `${f.trim()}.${l}${i}@Example.ORG` : `${f.trim().toLowerCase()}.${l}${i}@example.org`;
    const date = i % 2 === 0 ? `03/${String((i % 27) + 1).padStart(2, "0")}/2026` : `2026-03-${String((i % 27) + 1).padStart(2, "0")}`;
    const company = i === 30 ? OUTSIDE_SAMPLE_MARKER : i === 3 ? TYPO_COMPANY : companies[i % companies.length];
    lines.push([1000 + i, f, l, email, phones[i % phones.length], date, countries[i % countries.length], company, (i * 1.5).toFixed(2)].join(","));
  }
  // The last row repeats row 1's email in other case, with a similar name: the email rule merges it (keep last).
  lines.push([9999, " Maria ", "Rossi", "Maria.Rossi1@example.org", "555-010-2031", "03/01/2026", "US", "northwind", "120.00"].join(","));
  return lines.join(eol) + eol;
}

// ---------------------------------------------------------------------------
// Fake OpenAI-compatible server
// ---------------------------------------------------------------------------

export interface FakeAI {
  baseURL: string;
  /** Content of the assistant message for each chat completion. Receives the parsed request body. */
  respond: (body: unknown) => string;
  requests: unknown[];
  close(): Promise<void>;
}

export async function startFakeAI(respond: FakeAI["respond"] = () => JSON.stringify({ suggestions: [] })): Promise<FakeAI> {
  const fake: FakeAI = { baseURL: "", respond, requests: [], close: async () => {} };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    const url = req.url ?? "";
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && url === "/v1/models") {
      res.end(JSON.stringify({ object: "list", data: [{ id: "test-model", object: "model" }] }));
      return;
    }
    if (req.method === "POST" && url === "/v1/chat/completions") {
      const body = JSON.parse(text) as unknown;
      fake.requests.push(body);
      res.end(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: fake.respond(body) }, finish_reason: "stop" }],
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  fake.baseURL = `http://127.0.0.1:${port}/v1`;
  fake.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return fake;
}

/** A base URL with nothing listening on it. */
export async function closedPortBaseURL(): Promise<string> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}/v1`;
}

// ---------------------------------------------------------------------------
// Job context
// ---------------------------------------------------------------------------

/** Marks a queued job as running, as the queue does before it calls a handler. */
export function startJob(jobId: string): void {
  db().prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'").run(Date.now(), jobId);
}

/**
 * The context a handler receives, backed by the jobs table the same way the queue is. `onProgress`
 * runs before each progress write, so a test can cancel the job at a chosen step.
 */
export function jobContextFor(jobId: string, onProgress?: (step: string, pct: number) => void): JobContext {
  const row = db().prepare("SELECT user_id, file_id, meta_json FROM jobs WHERE id = ?").get(jobId) as {
    user_id: string;
    file_id: string | null;
    meta_json: string;
  };
  const conn = db();
  return {
    jobId,
    userId: row.user_id,
    fileId: row.file_id,
    meta: JSON.parse(row.meta_json) as Record<string, unknown>,
    progress(step, pct) {
      onProgress?.(step, pct);
      conn
        .prepare("UPDATE jobs SET step = ?, progress = ? WHERE id = ? AND status = 'running'")
        .run(step, Math.max(0, Math.min(100, Math.round(pct))), jobId);
    },
    cancelled: () =>
      (conn.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId) as { status: string }).status === "cancelled",
  };
}

export function jobRow(jobId: string) {
  return db().prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as {
    id: string;
    status: string;
    step: string;
    progress: number;
    error: string | null;
    meta_json: string;
  };
}

export function fileRow(fileId: string): FileRow {
  return db().prepare("SELECT * FROM files WHERE id = ?").get(fileId) as FileRow;
}

export function changeCount(fileId: string, where = "1 = 1"): number {
  return (db().prepare(`SELECT COUNT(*) AS n FROM changes WHERE file_id = ? AND ${where}`).get(fileId) as { n: number }).n;
}

export function auditRows(fileId: string): { action: string; detail: string }[] {
  return db().prepare("SELECT action, detail FROM audit_log WHERE file_id = ? ORDER BY id").all(fileId) as {
    action: string;
    detail: string;
  }[];
}

/** Uploads and runs the clean job to completion, as the queue would. */
export async function uploadAndClean(
  userId: string,
  text: string | Uint8Array = crmCsv(),
  extra: Partial<UploadInput> = {},
  name = "crm_export_q3.csv",
): Promise<{ fileId: string; jobId: string }> {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  const ids = await createUpload(userId, { name, bytes, ...extra });
  startJob(ids.jobId);
  await runCleanJob(jobContextFor(ids.jobId));
  db()
    .prepare("UPDATE jobs SET status = 'done', progress = 100, finished_at = ? WHERE id = ? AND status = 'running'")
    .run(Date.now(), ids.jobId);
  return ids;
}
