import path from "node:path";
import { audit } from "../audit";
import { db } from "../db";
import { env } from "../env";
import { newId } from "../ids";
import { enqueueJob } from "../jobs/queue";
import { getPrivacySettings, getRetentionHours, CLEANING_MODES, type CleaningMode } from "../settings/privacy";
import { DEFAULT_CLEAN_OPTIONS, type CleanOptions } from "../types";
import { FileError } from "./errors";
import { getFileRowForUser, type FileRow } from "./repo";
import { assertId, removeFileDir, storedFileExists, writeOriginal } from "./storage";

export const ALLOWED_EXTENSIONS = [".csv", ".tsv", ".txt"] as const;
const MAX_NAME_LENGTH = 200;
const MAX_ALIAS_LENGTH = 63;
const OPTION_KEYS = Object.keys(DEFAULT_CLEAN_OPTIONS) as (keyof CleanOptions)[];

export type UploadSource = Uint8Array | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

export interface UploadInput {
  name: string;
  bytes: UploadSource;
  mode?: CleaningMode;
  options?: Partial<CleanOptions>;
  ruleSetId?: string | null;
}

export interface UploadResult {
  fileId: string;
  jobId: string;
}

/**
 * The display name: the last path segment, control characters removed, at most 200 characters
 * (the extension is kept). Throws for unsupported extensions.
 */
export function sanitizeFileName(raw: string): string {
  const base = String(raw ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const ext = path.extname(clean);
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext.toLowerCase())) {
    throw new FileError("unsupported", "Upload a .csv, .tsv or .txt file.");
  }
  const stem = (clean.slice(0, clean.length - ext.length).trim() || "upload").slice(0, MAX_NAME_LENGTH - ext.length);
  return `${stem}${ext}`;
}

/** Lowercase snake_case SQL alias from a file name, e.g. "CRM Export (Q3).csv" -> "crm_export_q3". */
export function aliasFromName(name: string): string {
  const stem = name.replace(/\.[^.]*$/, "");
  let s = stem
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (s === "") s = "file";
  if (!/^[a-z_]/.test(s)) s = `f_${s}`;
  return s.slice(0, MAX_ALIAS_LENGTH - 8);
}

/** The base alias, or the first free "_2", "_3", ... variant of it. */
export function uniqueAlias(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let k = 2; ; k++) {
    const suffix = `_${k}`;
    const candidate = base.slice(0, MAX_ALIAS_LENGTH - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Options from the Upload form. Unknown keys and wrong types are rejected, not ignored. */
export function validateOptionsInput(raw: Partial<CleanOptions> | undefined | null): CleanOptions {
  const out: CleanOptions = { ...DEFAULT_CLEAN_OPTIONS };
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new FileError("invalid", "Options must be an object.");
  for (const key of Object.keys(raw)) {
    if (!(OPTION_KEYS as string[]).includes(key)) throw new FileError("invalid", `Unknown option "${key}".`);
  }
  const value = raw as Record<string, unknown>;
  for (const key of ["normalizeDates", "dedupe", "trimAndCase", "fillMissing"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "boolean") throw new FileError("invalid", `Option "${key}" must be true or false.`);
    out[key] = value[key] as boolean;
  }
  if (value.dateOrder !== undefined) {
    if (value.dateOrder !== "auto" && value.dateOrder !== "mdy" && value.dateOrder !== "dmy") {
      throw new FileError("invalid", "Date order must be auto, mdy or dmy.");
    }
    out.dateOrder = value.dateOrder;
  }
  return out;
}

function resolveMode(userId: string, mode: unknown): CleaningMode {
  if (mode === undefined || mode === null || mode === "") return getPrivacySettings(userId).defaultMode;
  if (!(CLEANING_MODES as readonly string[]).includes(mode as string)) {
    throw new FileError("invalid", "Choose Rules + AI or Rules only.");
  }
  return mode as CleaningMode;
}

/** The rule set must belong to the user. Ids from the client are never trusted on their own. */
function checkRuleSet(userId: string, ruleSetId: string): string {
  const row = db()
    .prepare("SELECT id FROM rule_sets WHERE id = ? AND user_id = ?")
    .get(ruleSetId, userId) as { id: string } | undefined;
  if (!row) throw new FileError("not_found", "That rule set could not be found.");
  return row.id;
}

/** Checks a file name and size before anything is written, so a bad request creates nothing. */
export function assertUploadable(name: string, size: number): void {
  sanitizeFileName(name);
  if (size > env.maxUploadBytes) throw tooLarge();
}

function tooLarge(): FileError {
  const mb = env.maxUploadBytes / (1024 * 1024);
  return new FileError("too_large", `This file is larger than the ${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB limit.`);
}

/**
 * Stores an upload and queues its clean job. The original is written first; the files row, the
 * audit entry and the job are inserted in one transaction. On failure the stored copy is removed.
 */
export async function createUpload(userId: string, input: UploadInput): Promise<UploadResult> {
  assertId(userId);
  const name = sanitizeFileName(input.name);
  const stem = name.slice(0, name.length - path.extname(name).length);
  const mode = resolveMode(userId, input.mode);
  const options = validateOptionsInput(input.options);
  const ruleSetId = input.ruleSetId ? checkRuleSet(userId, input.ruleSetId) : null;
  if (input.bytes instanceof Uint8Array && input.bytes.byteLength > env.maxUploadBytes) throw tooLarge();

  const fileId = newId("file");
  const written = await writeOriginal(userId, fileId, input.bytes, env.maxUploadBytes);
  const now = Date.now();
  const expiresAt = now + getRetentionHours(userId) * 60 * 60 * 1000;

  const conn = db();
  try {
    const jobId = conn.transaction(() => {
      const taken = new Set(
        (conn.prepare("SELECT alias FROM files WHERE user_id = ?").all(userId) as { alias: string }[]).map((r) => r.alias),
      );
      const alias = uniqueAlias(aliasFromName(stem), taken);
      conn
        .prepare(
          `INSERT INTO files (id, user_id, original_name, alias, size_bytes, storage_path, status, mode, options_json,
             rule_set_id, ai_status, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, 'none', ?, ?)`,
        )
        .run(fileId, userId, name, alias, written.size, written.rel, mode, JSON.stringify(options), ruleSetId, now, expiresAt);
      audit("file.uploaded", "Uploaded", { actor: userId, fileId });
      return enqueueJob("clean", userId, { fileId, meta: { fileCount: 1, mode } });
    })();
    return { fileId, jobId };
  } catch (err) {
    await removeFileDir(userId, fileId).catch(() => {});
    throw err;
  }
}

function fileForUser(userId: string, fileId: string): FileRow {
  const row = getFileRowForUser(userId, fileId);
  if (!row) throw new FileError("not_found", "File not found.");
  return row;
}

function assertNoActiveJob(fileId: string) {
  const active = db()
    .prepare("SELECT 1 FROM jobs WHERE file_id = ? AND status IN ('queued', 'running') LIMIT 1")
    .get(fileId);
  if (active) throw new FileError("conflict", "This file is already being processed.");
}

/** Re-runs the whole pipeline for a failed file whose original copy still exists. */
export async function retryFile(userId: string, fileId: string): Promise<{ jobId: string }> {
  const file = fileForUser(userId, fileId);
  if (file.status !== "failed") throw new FileError("conflict", "Only files that failed can be retried.");
  if (!(await storedFileExists(file.storage_path))) {
    throw new FileError("gone", "The original file is no longer available. Upload it again.");
  }
  assertNoActiveJob(file.id);

  const conn = db();
  return {
    jobId: conn.transaction(() => {
      conn.prepare("DELETE FROM changes WHERE file_id = ?").run(file.id);
      conn
        .prepare(
          `UPDATE files SET status = 'processing', error = NULL, ai_status = 'none', profile_json = NULL,
             row_count = NULL, column_count = NULL, delimiter = NULL, encoding = NULL, rows_out = NULL,
             cleaned_path = NULL, approved_by = NULL, applied_at = NULL
           WHERE id = ?`,
        )
        .run(file.id);
      audit("file.retried", "Retry requested", { actor: userId, fileId: file.id });
      return enqueueJob("clean", userId, { fileId: file.id, meta: { fileCount: 1, mode: file.mode } });
    })(),
  };
}

/** "Wait for AI": asks the AI again for a file that needs review and whose AI step was unavailable. */
export function retryAi(userId: string, fileId: string): { jobId: string } {
  const file = fileForUser(userId, fileId);
  if (file.status !== "needs_review" || file.ai_status !== "unavailable") {
    throw new FileError("conflict", "AI is not waiting to be retried for this file.");
  }
  if (file.mode !== "rules_ai") throw new FileError("conflict", "This file was cleaned with rules only.");
  assertNoActiveJob(file.id);

  const conn = db();
  return {
    jobId: conn.transaction(() => {
      conn.prepare("UPDATE files SET status = 'processing', ai_status = 'pending' WHERE id = ?").run(file.id);
      audit("file.ai_retry", "AI review requested again", { actor: userId, fileId: file.id });
      return enqueueJob("clean", userId, { fileId: file.id, meta: { aiOnly: true, fileCount: 1 } });
    })(),
  };
}

