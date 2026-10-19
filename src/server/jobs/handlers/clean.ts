import { audit } from "../../audit";
import { getProviderForUser, type ResolvedAIProvider } from "../../ai";
import { matchRuleSet, proposeChanges, rulesFromOptions } from "../../cleaning";
import { CsvError, profileTable, readCsvFile, scanFile, type CsvReadResult } from "../../csv";
import { formatCount } from "../../csv/errors";
import { db } from "../../db";
import { AIError, SAMPLE_ROW_LIMIT, suggestFixes, type ColumnProfile, type FixSuggestion } from "../../../lib/ai";
import { absoluteDataPath } from "../../files/storage";
import { loadRuleSpecs } from "../../rules/repo";
import { getFileRowForUser, readCleanOptions, type FileRow } from "../../files/repo";
import { EMPTY_STEP_STATE, stepLabel, type StepState } from "../../files/steps";
import { registerJobHandler, type JobContext, type JobHandler } from "../queue";
import type { ColumnStats, FileProfileData, ProposedChange, RuleSpec, Table } from "../../types";

/** Files above this many rows are proposed in chunks, so the progress bar moves and memory stays bounded. */
export const CHUNK_THRESHOLD_ROWS = 200_000;
export const CHUNK_ROWS = 50_000;

/** Reason string the built-in scanner uses when clamd is configured but unreachable. */
const SCANNER_UNAVAILABLE = "Malware scanner unavailable";
const UNEXPECTED_FAILURE = "Something went wrong while cleaning this file. Try again.";

export function registerCleanHandler(): void {
  registerJobHandler("clean", runCleanJob);
}

/**
 * Runs the cleaning pipeline for one file. Failures that the user can act on end the job as
 * "failed" with a message and return normally. Anything unexpected is recorded on the file and
 * rethrown, so the queue fails the job and writes its audit entry.
 */
export const runCleanJob: JobHandler = async (ctx: JobContext) => {
  const file = ctx.fileId ? getFileRowForUser(ctx.userId, ctx.fileId) : null;
  const aiOnly = ctx.meta.aiOnly === true;
  if (!file) return endJob(ctx.jobId, "This file no longer exists.");
  if (file.status === "deleted" || file.storage_path === null) {
    return endJob(ctx.jobId, "This file was deleted before it was processed.");
  }
  if (ctx.cancelled()) return markCancelled(file, aiOnly);

  try {
    if (aiOnly) await runAiOnly(ctx, file);
    else await runFullClean(ctx, file);
  } catch (err) {
    if (aiOnly) restoreReview(file.id);
    else failFileQuietly(file.id, UNEXPECTED_FAILURE);
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

async function runFullClean(ctx: JobContext, file: FileRow): Promise<void> {
  const state: StepState = { ...EMPTY_STEP_STATE };
  const abs = absoluteDataPath(file.storage_path as string);
  resetForRun(file.id);

  // a: format and size
  writeStep(ctx, 0, state, 5);
  let parsed: CsvReadResult;
  try {
    parsed = await readCsvFile(abs);
  } catch (err) {
    if (err instanceof CsvError) return failWith(ctx, file, err.message);
    throw err;
  }
  if (ctx.cancelled()) return markCancelled(file, false);

  // b: malware scan
  writeStep(ctx, 1, state, 12);
  const scan = await scanFile(abs);
  if (ctx.cancelled()) return markCancelled(file, false);
  if (!scan.ok) {
    if (scan.reason === SCANNER_UNAVAILABLE) {
      return failWith(ctx, file, "The malware scanner is unavailable. Try again shortly.");
    }
    return failWith(ctx, file, "This file was blocked by the malware scan.", scan.reason);
  }

  // c: profile
  writeStep(ctx, 2, state, 25);
  const profile = profileTable(parsed.table);
  const profileData: FileProfileData = { ...profile, delimiter: parsed.delimiter, encoding: parsed.encoding };
  state.columns = profile.columnCount;
  recordProfile(file.id, profileData, parsed.warnings);
  if (ctx.cancelled()) return markCancelled(file, false);

  // d: rules
  writeStep(ctx, 3, state, 40);
  const rules = rulesFor(file, parsed.table, profileData.columns);
  const proposed = proposeAll(ctx, parsed.table, rules);
  if (proposed === null || ctx.cancelled()) return markCancelled(file, false);
  insertChanges(file.id, proposed);
  state.changes = proposed.length;
  writeStep(ctx, 4, state, 82);

  // e: AI
  await runAiStep(ctx, file, parsed.table, profileData, state);
  if (ctx.cancelled()) return markCancelled(file, false);

  // f: report
  writeStep(ctx, 5, state, 97);
  finishReview(ctx, file.id);
}

/** "Wait for AI": re-runs only the AI step on a file that is already profiled and reviewed by rules. */
async function runAiOnly(ctx: JobContext, file: FileRow): Promise<void> {
  if (!file.profile_json) return returnToReview(ctx, file.id, "This file has not been checked yet.");
  const profile = JSON.parse(file.profile_json) as FileProfileData;
  if (file.mode !== "rules_ai") {
    setAiStatus(file.id, "skipped");
    db().prepare("UPDATE files SET status = 'needs_review' WHERE id = ? AND status = 'processing'").run(file.id);
    return endJob(ctx.jobId, null, true);
  }

  const conn = db();
  const state: StepState = {
    ...EMPTY_STEP_STATE,
    columns: profile.columnCount,
    changes: (conn.prepare("SELECT COUNT(*) AS n FROM changes WHERE file_id = ? AND source = 'rule'").get(file.id) as { n: number }).n,
  };
  writeStep(ctx, 4, state, 60);

  let parsed: CsvReadResult;
  try {
    parsed = await readCsvFile(absoluteDataPath(file.storage_path as string));
  } catch (err) {
    if (err instanceof CsvError) return returnToReview(ctx, file.id, err.message);
    throw err;
  }
  if (ctx.cancelled()) return markCancelled(file, true);

  conn.prepare("DELETE FROM changes WHERE file_id = ? AND source = 'ai'").run(file.id);
  await runAiStep(ctx, file, parsed.table, profile, state);
  if (ctx.cancelled()) return markCancelled(file, true);

  writeStep(ctx, 5, state, 97);
  finishReview(ctx, file.id);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** Sets the active step, stores all six labels on the job (for the Processing page), and updates progress. */
function writeStep(ctx: JobContext, active: number, state: StepState, pct: number): void {
  const steps = [0, 1, 2, 3, 4, 5].map((i) => stepLabel(i, state));
  db()
    .prepare("UPDATE jobs SET meta_json = json_patch(meta_json, ?) WHERE id = ?")
    .run(JSON.stringify({ steps, activeStep: active }), ctx.jobId);
  ctx.progress(steps[active], pct);
}

function resetForRun(fileId: string): void {
  const conn = db();
  conn.transaction(() => {
    conn.prepare("DELETE FROM changes WHERE file_id = ?").run(fileId);
    conn
      .prepare(
        `UPDATE files SET status = 'processing', error = NULL, ai_status = 'none', profile_json = NULL,
           row_count = NULL, column_count = NULL, delimiter = NULL, encoding = NULL, rows_out = NULL,
           cleaned_path = NULL, approved_by = NULL, applied_at = NULL
         WHERE id = ?`,
      )
      .run(fileId);
  })();
}

function recordProfile(fileId: string, profile: FileProfileData, warnings: string[]): void {
  const conn = db();
  conn.transaction(() => {
    conn
      .prepare("UPDATE files SET profile_json = ?, row_count = ?, column_count = ?, delimiter = ?, encoding = ? WHERE id = ?")
      .run(JSON.stringify(profile), profile.rowCount, profile.columnCount, profile.delimiter, profile.encoding, fileId);
    conn
      .prepare("UPDATE audit_log SET detail = ? WHERE file_id = ? AND action = 'file.uploaded'")
      .run(`Uploaded · ${formatCount(profile.rowCount)} rows`, fileId);
    if (warnings.length > 0) audit("file.checked", warnings.join(" "), { fileId });
  })();
}

/** Rules for the file: its explicit rule set, else the user's set whose headers match, else the Upload options. */
function rulesFor(file: FileRow, table: Table, columns: ColumnStats[]): RuleSpec[] {
  const conn = db();
  if (file.rule_set_id) {
    const owned = conn.prepare("SELECT 1 FROM rule_sets WHERE id = ? AND user_id = ?").get(file.rule_set_id, file.user_id);
    if (owned) return savedRules(file.rule_set_id);
  }
  const sets = (conn.prepare("SELECT id, header_match_json FROM rule_sets WHERE user_id = ?").all(file.user_id) as {
    id: string;
    header_match_json: string;
  }[]).map((s) => ({ id: s.id, headerMatch: parseStringArray(s.header_match_json) }));
  const matched = matchRuleSet(table.headers, sets);
  if (matched) {
    conn.prepare("UPDATE files SET rule_set_id = ? WHERE id = ?").run(matched, file.id);
    return savedRules(matched);
  }
  return rulesFromOptions(readCleanOptions(file.options_json), table.headers, columns);
}

function parseStringArray(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** All changes for the table. Above the threshold, value rules run per chunk and dedupe runs once on the cleaned rows. */
function proposeAll(ctx: JobContext, table: Table, rules: RuleSpec[]): ProposedChange[] | null {
  if (table.rows.length <= CHUNK_THRESHOLD_ROWS) return proposeChanges(table, rules);
  return proposeChunked(ctx, table, rules);
}

function proposeChunked(ctx: JobContext, table: Table, rules: RuleSpec[]): ProposedChange[] | null {
  const n = table.rows.length;
  const headers = table.headers;
  const columnIndex = new Map(headers.map((h, i) => [h, i]));
  const valueRules = rules.filter((r) => r.action !== "dedupe_key");
  const dedupeRules = rules.filter((r) => r.action === "dedupe_key" && r.enabled);
  // Cleaned copies of the rows that changed, so dedupe compares cleaned values as the single-pass path does.
  const finals = dedupeRules.length > 0 ? table.rows.slice() : null;
  const copied = finals ? new Uint8Array(n) : null;
  const out: ProposedChange[] = [];

  db().prepare("UPDATE jobs SET meta_json = json_patch(meta_json, '{\"chunked\":true}') WHERE id = ?").run(ctx.jobId);
  for (let start = 0; start < n; start += CHUNK_ROWS) {
    if (ctx.cancelled()) return null;
    const end = Math.min(n, start + CHUNK_ROWS);
    const part = proposeChanges({ headers, rows: table.rows.slice(start, end) }, valueRules);
    for (const ch of part) {
      ch.rowIndex += start;
      out.push(ch);
      if (finals && copied && ch.kind === "value" && ch.column !== null && ch.after !== null) {
        const c = columnIndex.get(ch.column);
        if (c !== undefined) {
          if (copied[ch.rowIndex] === 0) {
            const row = table.rows[ch.rowIndex].slice();
            while (row.length < headers.length) row.push("");
            finals[ch.rowIndex] = row;
            copied[ch.rowIndex] = 1;
          }
          finals[ch.rowIndex][c] = ch.after;
        }
      }
    }
    ctx.progress(`Applying cleaning rules · ${formatCount(end)} of ${formatCount(n)} rows`, 40 + (40 * end) / n);
  }

  if (finals) {
    out.push(...proposeChanges({ headers, rows: finals }, dedupeRules));
    out.sort((a, b) => a.rowIndex - b.rowIndex || Number(a.kind === "merge") - Number(b.kind === "merge"));
  }
  return out;
}

const CHANGE_COLUMNS = "(file_id, row_index, column_name, kind, before, after, merge_into_row, source, rule_id, reason, confidence, decision)";
const CHANGE_PARAMS = 12;
/** Rows per multi-row INSERT. 500 rows x 12 values stays well under SQLite's variable limit. */
const INSERT_BATCH_ROWS = 500;

function insertSql(rows: number): string {
  const group = `(${Array(CHANGE_PARAMS).fill("?").join(", ")})`;
  return `INSERT INTO changes ${CHANGE_COLUMNS} VALUES ${Array(rows).fill(group).join(", ")}`;
}

/** Inserts changes in one transaction, 500 rows per statement. Fast enough for 500k changes (about 2 s). */
export function insertChanges(fileId: string, changes: ProposedChange[]): void {
  const conn = db();
  const full = conn.prepare(insertSql(INSERT_BATCH_ROWS));
  conn.transaction(() => {
    let i = 0;
    while (i < changes.length) {
      const size = Math.min(INSERT_BATCH_ROWS, changes.length - i);
      const stmt = size === INSERT_BATCH_ROWS ? full : conn.prepare(insertSql(size));
      const args: unknown[] = [];
      for (let k = 0; k < size; k++) {
        const c = changes[i + k];
        args.push(
          fileId,
          c.rowIndex,
          c.column,
          c.kind,
          c.before,
          c.after,
          c.mergeIntoRow ?? null,
          c.source,
          c.ruleId,
          c.reason,
          c.confidence ?? null,
          c.decision,
        );
      }
      stmt.run(...args);
      i += size;
    }
  })();
}

/**
 * The AI step. Sends the column summaries and the 20-row sample only, never the rest of the file.
 * Suggestions are kept only when they point at a real sample cell whose current value matches `before`.
 */
async function runAiStep(
  ctx: JobContext,
  file: FileRow,
  table: Table,
  profile: FileProfileData,
  state: StepState,
): Promise<void> {
  const conn = db();
  if (file.mode === "rules_only") {
    state.aiSkipped = true;
    setAiStatus(file.id, "skipped");
    writeStep(ctx, 4, state, 90);
    return;
  }
  let resolved: ResolvedAIProvider;
  try {
    resolved = getProviderForUser(file.user_id);
  } catch {
    resolved = { provider: null, source: "instance", label: "configuration unavailable" };
  }

  if (resolved.provider === null && resolved.source === "off") {
    state.aiSkipped = true;
    setAiStatus(file.id, "skipped");
    writeStep(ctx, 4, state, 90);
    return;
  }

  const ambiguous = (conn
    .prepare("SELECT COUNT(*) AS n FROM changes WHERE file_id = ? AND source = 'rule' AND decision = 'pending'")
    .get(file.id) as { n: number }).n;
  state.ambiguous = ambiguous;
  writeStep(ctx, 4, state, 84);

  if (resolved.provider === null) {
    setAiStatus(file.id, "unavailable");
    audit("ai.unavailable", `AI unavailable: ${resolved.label}`, { fileId: file.id });
    return;
  }
  const provider = resolved.provider;
  setAiStatus(file.id, "pending");

  const sample = profile.sample.slice(0, SAMPLE_ROW_LIMIT);
  const alreadyChanged = (conn
    .prepare("SELECT row_index, column_name FROM changes WHERE file_id = ? AND source = 'rule' AND kind = 'value' AND row_index < ?")
    .all(file.id, sample.length) as { row_index: number; column_name: string | null }[])
    .map((r) => ({ row: r.row_index + 1, column: r.column_name ?? "" }));

  try {
    const suggestions = await suggestFixes(
      provider,
      { fileName: file.original_name, rowCount: profile.rowCount, columns: aiColumns(profile.columns), sample },
      { alreadyChanged },
    );
    const accepted = acceptSuggestions(table, suggestions, sample.length, alreadyChanged);
    insertChanges(file.id, accepted);
    setAiStatus(file.id, "done");
    audit("ai.reviewed", `AI reviewed ${sample.length}-row sample`, { fileId: file.id });
  } catch (err) {
    const message = err instanceof AIError ? err.message : "Unexpected error.";
    if (!(err instanceof AIError)) console.error("[clean] AI step failed", err);
    setAiStatus(file.id, "unavailable");
    audit("ai.unavailable", `AI unavailable: ${message}`, { fileId: file.id });
  }
}

/** Column summaries for the AI. Top values are left out: they would expose values beyond the sample. */
function aiColumns(columns: ColumnStats[]): ColumnProfile[] {
  return columns.map((c) => ({ name: c.name, type: c.type, nullCount: c.nullCount, distinctCount: c.distinctCount }));
}

/** Keeps only suggestions that point at a real sample cell whose current value matches `before`. */
export function acceptSuggestions(
  table: Table,
  suggestions: FixSuggestion[],
  sampleRows: number,
  alreadyChanged: { row: number; column: string }[],
): ProposedChange[] {
  const columnIndex = new Map(table.headers.map((h, i) => [h, i]));
  const skip = new Set(alreadyChanged.map((c) => `${c.row}\u0000${c.column}`));
  const seen = new Set<string>();
  const out: ProposedChange[] = [];
  for (const s of suggestions) {
    if (!Number.isInteger(s.row) || s.row < 1 || s.row > sampleRows) continue;
    const c = columnIndex.get(s.column);
    if (c === undefined) continue;
    const key = `${s.row}\u0000${s.column}`;
    if (seen.has(key) || skip.has(key)) continue;
    const rowIndex = s.row - 1;
    const actual = table.rows[rowIndex]?.[c] ?? "";
    if (s.before !== actual || s.after === actual) continue;
    seen.add(key);
    out.push({
      rowIndex,
      column: s.column,
      kind: "value",
      before: actual,
      after: s.after,
      source: "ai",
      ruleId: "ai",
      reason: s.reason.trim().slice(0, 300) || "AI suggestion",
      confidence: Math.min(1, Math.max(0, s.confidence)),
      decision: "pending",
    });
  }
  return out;
}

function setAiStatus(fileId: string, status: FileRow["ai_status"]): void {
  db().prepare("UPDATE files SET ai_status = ? WHERE id = ?").run(status, fileId);
}

/** Last step: the file is ready for review. Only a file still in processing moves on. */
function finishReview(ctx: JobContext, fileId: string): void {
  db().prepare("UPDATE files SET status = 'needs_review' WHERE id = ? AND status = 'processing'").run(fileId);
  ctx.progress("Building change report", 100);
}

// ---------------------------------------------------------------------------
// Ending the job
// ---------------------------------------------------------------------------

/** Records a file failure with its user-facing message, then ends the job as failed. */
function failWith(ctx: JobContext, file: FileRow, message: string, detail?: string): void {
  failFileQuietly(file.id, message, detail);
  endJob(ctx.jobId, message);
}

function failFileQuietly(fileId: string, message: string, detail?: string): void {
  const conn = db();
  conn.transaction(() => {
    conn.prepare("UPDATE files SET status = 'failed', error = ? WHERE id = ? AND status = 'processing'").run(message, fileId);
    audit("file.failed", detail ? `${message} Reason: ${detail}` : message, { fileId });
  })();
}

/** Ends a running job as failed (or done). Only a job still marked running is changed. */
function endJob(jobId: string, error: string | null, done = false): void {
  db()
    .prepare("UPDATE jobs SET status = ?, error = ?, finished_at = ? WHERE id = ? AND status = 'running'")
    .run(done ? "done" : "failed", error, Date.now(), jobId);
}

/** A cancelled full run ends as failed with "Cancelled"; a cancelled AI retry returns to review. */
function markCancelled(file: FileRow, aiOnly: boolean): void {
  const conn = db();
  const changed = aiOnly
    ? conn
        .prepare("UPDATE files SET status = 'needs_review', ai_status = 'unavailable' WHERE id = ? AND status = 'processing'")
        .run(file.id).changes
    : conn.prepare("UPDATE files SET status = 'failed', error = 'Cancelled' WHERE id = ? AND status = 'processing'").run(file.id)
        .changes;
  if (changed > 0) audit("file.cancelled", aiOnly ? "AI review cancelled" : "Cancelled", { fileId: file.id });
}

function restoreReview(fileId: string): void {
  db()
    .prepare("UPDATE files SET status = 'needs_review', ai_status = 'unavailable' WHERE id = ? AND status = 'processing'")
    .run(fileId);
}

function returnToReview(ctx: JobContext, fileId: string, message: string): void {
  restoreReview(fileId);
  endJob(ctx.jobId, message);
}

/** Saved rules, with ids prefixed by their action so reports can label the change ("phone_e164:rule_x"). */
function savedRules(ruleSetId: string) {
  return loadRuleSpecs(ruleSetId).map((r) => ({ ...r, id: `${r.action}:${r.id}` }));
}
