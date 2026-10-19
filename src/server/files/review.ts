import { audit } from "../audit";
import { db } from "../db";
import { readCsvFile, CsvError, toCsv } from "../csv";
import { applyChanges } from "../cleaning";
import type { ProposedChange } from "../types";
import { FileError } from "./errors";
import { getFileRowForUser, type FileRow } from "./repo";
import { absoluteDataPath, writeCleaned } from "./storage";

const MAX_IDS_PER_CALL = 5000;

export type ReviewDecision = "approved" | "skipped";

function reviewableFile(userId: string, fileId: string): FileRow {
  const file = getFileRowForUser(userId, fileId);
  if (!file) throw new FileError("not_found", "File not found.");
  if (file.status !== "needs_review") {
    throw new FileError("conflict", "This file is not waiting for review.");
  }
  return file;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Approves or skips changes by id. Rule changes can be skipped, and a pending rule change can be
 * approved. AI changes can be set either way. Flags are informational and never toggle.
 * Ids that do not belong to this file, or that the rules above forbid, are ignored.
 */
export function setDecision(
  userId: string,
  fileId: string,
  changeIds: number[],
  decision: ReviewDecision,
): { updated: number; ignored: number } {
  const file = reviewableFile(userId, fileId);
  if (decision !== "approved" && decision !== "skipped") throw new FileError("invalid", "Choose approve or skip.");
  if (!Array.isArray(changeIds) || changeIds.length === 0) throw new FileError("invalid", "Choose at least one change.");
  if (changeIds.length > MAX_IDS_PER_CALL) throw new FileError("invalid", `Change at most ${MAX_IDS_PER_CALL} at a time.`);
  if (!changeIds.every((id) => Number.isInteger(id) && id > 0)) throw new FileError("invalid", "Change ids must be numbers.");

  const conn = db();
  const select = conn.prepare("SELECT id, source, kind, decision FROM changes WHERE id = ? AND file_id = ?");
  const update = conn.prepare("UPDATE changes SET decision = ?, decided_by = ?, decided_at = ? WHERE id = ? AND file_id = ?");
  const now = Date.now();
  let updated = 0;
  let ignored = 0;
  conn.transaction(() => {
    for (const id of changeIds) {
      const row = select.get(id, file.id) as
        | { id: number; source: "rule" | "ai"; kind: ProposedChange["kind"]; decision: string }
        | undefined;
      if (!row || row.kind === "flag" || row.decision === decision) {
        ignored++;
        continue;
      }
      // Any rule or AI change may be skipped or (re)approved; skipping a rule change can be undone.
      update.run(decision, userId, now, id, file.id);
      updated++;
    }
  })();

  if (updated > 0) {
    audit(decision === "approved" ? "file.approved" : "file.skipped", `${decision === "approved" ? "Approved" : "Skipped"} ${plural(updated, "change")}`, {
      actor: userId,
      fileId: file.id,
    });
  }
  return { updated, ignored };
}

/** Approves or skips every AI change in the file. */
export function decideAllAI(userId: string, fileId: string, decision: ReviewDecision): { updated: number } {
  const file = reviewableFile(userId, fileId);
  if (decision !== "approved" && decision !== "skipped") throw new FileError("invalid", "Choose approve or skip.");
  const updated = db()
    .prepare(
      `UPDATE changes SET decision = ?, decided_by = ?, decided_at = ?
       WHERE file_id = ? AND source = 'ai' AND decision <> ?`,
    )
    .run(decision, userId, Date.now(), file.id, decision).changes;
  if (updated > 0) {
    audit(
      decision === "approved" ? "file.approved" : "file.skipped",
      `${decision === "approved" ? "Approved" : "Skipped"} all ${plural(updated, "AI suggestion")}`,
      { actor: userId, fileId: file.id },
    );
  }
  return { updated };
}

/** Rules only for this file: every AI suggestion is skipped and no further AI calls are made for it. */
export function skipAIForFile(userId: string, fileId: string): { skipped: number } {
  const file = reviewableFile(userId, fileId);
  const conn = db();
  let skipped = 0;
  conn.transaction(() => {
    skipped = conn
      .prepare(
        `UPDATE changes SET decision = 'skipped', decided_by = ?, decided_at = ?
         WHERE file_id = ? AND source = 'ai' AND decision <> 'skipped'`,
      )
      .run(userId, Date.now(), file.id).changes;
    conn.prepare("UPDATE files SET mode = 'rules_only', ai_status = 'skipped' WHERE id = ?").run(file.id);
  })();
  audit("file.ai_skipped", `Rules only${skipped > 0 ? `; ${plural(skipped, "AI suggestion")} skipped` : ""}`, {
    actor: userId,
    fileId: file.id,
  });
  return { skipped };
}

export interface ApplyResult {
  rowsOut: number;
  applied: number;
  skippedAI: number;
}

/**
 * Writes cleaned.csv from the approved changes. Pending changes count as skipped. The file is in
 * "processing" while the copy is written, so decisions cannot change under it.
 */
export async function applyFile(userId: string, fileId: string): Promise<ApplyResult> {
  const file = reviewableFile(userId, fileId);
  if (!file.storage_path) throw new FileError("gone", "The original file is no longer available.");
  const conn = db();

  let parsed;
  try {
    parsed = await readCsvFile(absoluteDataPath(file.storage_path));
  } catch (err) {
    if (err instanceof CsvError) throw new FileError("invalid", err.message);
    throw err;
  }

  const prepared = conn.transaction(() => {
    const current = conn.prepare("SELECT status FROM files WHERE id = ?").get(file.id) as { status: string };
    if (current.status !== "needs_review") throw new FileError("conflict", "This file is not waiting for review.");
    conn.prepare("UPDATE files SET status = 'processing' WHERE id = ?").run(file.id);

    const approved = (conn
      .prepare(
        `SELECT row_index, column_name, kind, before, after, merge_into_row, source, rule_id, reason, decision
         FROM changes WHERE file_id = ? AND decision = 'approved' ORDER BY row_index, id`,
      )
      .all(file.id) as {
      row_index: number;
      column_name: string | null;
      kind: ProposedChange["kind"];
      before: string | null;
      after: string | null;
      merge_into_row: number | null;
      source: "rule" | "ai";
      rule_id: string | null;
      reason: string;
      decision: "approved";
    }[]).map<ProposedChange>((r) => ({
      rowIndex: r.row_index,
      column: r.column_name,
      kind: r.kind,
      before: r.before,
      after: r.after,
      ...(r.merge_into_row !== null ? { mergeIntoRow: r.merge_into_row } : {}),
      source: r.source,
      ruleId: r.rule_id ?? "",
      reason: r.reason,
      decision: r.decision,
    }));

    const applied = applyChanges(parsed.table, approved);
    const appliedEdits = approved.filter((c) => c.kind === "value" || c.kind === "merge").length;
    const delimiter = file.delimiter ?? parsed.delimiter;
    const bom = file.encoding === "utf-8-bom" ? "﻿" : "";
    const text = bom + toCsv(applied.table, { delimiter });
    return { text, rowsOut: applied.table.rows.length, appliedEdits };
  })();

  let cleanedPath: string;
  try {
    cleanedPath = await writeCleaned(file.user_id, file.id, prepared.text);
  } catch (err) {
    conn.prepare("UPDATE files SET status = 'needs_review' WHERE id = ? AND status = 'processing'").run(file.id);
    throw err;
  }

  return conn.transaction((): ApplyResult => {
    const now = Date.now();
    conn
      .prepare("UPDATE changes SET decision = 'skipped', decided_by = ?, decided_at = ? WHERE file_id = ? AND decision = 'pending'")
      .run(userId, now, file.id);
    const skippedAI = (conn
      .prepare("SELECT COUNT(*) AS n FROM changes WHERE file_id = ? AND source = 'ai' AND decision = 'skipped'")
      .get(file.id) as { n: number }).n;
    conn
      .prepare(
        `UPDATE files SET status = 'ready', cleaned_path = ?, rows_out = ?, applied_at = ?, approved_by = ?
         WHERE id = ?`,
      )
      .run(cleanedPath, prepared.rowsOut, now, userId, file.id);
    audit("file.applied", `Applied ${plural(prepared.appliedEdits, "change")}`, { actor: userId, fileId: file.id });
    if (skippedAI > 0) {
      audit("file.skipped_ai", `Skipped ${plural(skippedAI, "AI suggestion")}`, { actor: userId, fileId: file.id });
    }
    return { rowsOut: prepared.rowsOut, applied: prepared.appliedEdits, skippedAI };
  })();
}

