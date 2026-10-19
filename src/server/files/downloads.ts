import { stat } from "node:fs/promises";
import { sign, verify } from "../crypto";
import { reportPdf } from "../reports";
import { changeLogCsv } from "../reports/csv";
import { FileError } from "./errors";
import { changeLogEntries, fileActivity, getFileRowForUser, summaryForReport, type FileRow } from "./repo";
import { absoluteDataPath, storedFileExists } from "./storage";

export const DOWNLOAD_TTL_MS = 15 * 60 * 1000;
export const DOWNLOAD_KINDS = ["cleaned", "original", "report_pdf", "changes_csv"] as const;
export type DownloadKind = (typeof DOWNLOAD_KINDS)[number];

const UTF8_BOM = "\uFEFF";
const DOWNLOAD_PATH = (fileId: string) => `/api/files/${fileId}/download`;

export function isDownloadKind(value: unknown): value is DownloadKind {
  return typeof value === "string" && (DOWNLOAD_KINDS as readonly string[]).includes(value);
}

function tokenPayload(userId: string, fileId: string, kind: DownloadKind): string {
  return `${fileId}|${kind}|${userId}`;
}

/**
 * A download URL for one file and kind, valid for 15 minutes and for this user only. The token is
 * signed with APP_SECRET and names the file, the kind and the user; the route checks all three.
 */
export function downloadLink(userId: string, fileId: string, kind: DownloadKind): string {
  if (!getFileRowForUser(userId, fileId)) throw new FileError("not_found", "File not found.");
  if (!isDownloadKind(kind)) throw new FileError("invalid", "Unknown download.");
  const token = sign(tokenPayload(userId, fileId, kind), DOWNLOAD_TTL_MS);
  return `${DOWNLOAD_PATH(fileId)}?kind=${kind}&token=${encodeURIComponent(token)}`;
}

export type PreparedDownload =
  | {
      ok: true;
      contentType: string;
      filename: string;
      body: { type: "file"; path: string; size: number } | { type: "text"; text: string } | { type: "bytes"; bytes: Uint8Array };
    }
  | { ok: false; status: number; code: string; error: string };

function fail(status: number, code: string, error: string): PreparedDownload {
  return { ok: false, status, code, error };
}

/** Name without its extension, e.g. "crm_export_q3". */
function stemOf(name: string): string {
  const stem = name.replace(/\.[^.]*$/, "");
  return stem.replace(/["\\\r\n/]/g, "_") || "file";
}

function extOf(name: string): string {
  const m = /\.(csv|tsv|txt)$/i.exec(name);
  return m ? m[0].toLowerCase() : ".csv";
}

/**
 * Checks the token, the ownership and the file state, then describes the response. The route turns
 * the result into an HTTP response. Deleted files keep their report and change log; their copies are gone.
 */
export async function prepareDownload(
  userId: string,
  fileId: string,
  rawKind: unknown,
  token: string | null,
): Promise<PreparedDownload> {
  if (!isDownloadKind(rawKind)) return fail(400, "bad_request", "Unknown download.");
  const kind = rawKind;
  const payload = token ? verify(token) : null;
  if (payload === null || payload !== tokenPayload(userId, fileId, kind)) {
    return fail(403, "link_expired", "This download link has expired. Start the download again.");
  }

  const file = getFileRowForUser(userId, fileId);
  if (!file) return fail(404, "not_found", "File not found.");
  const base = stemOf(file.original_name);

  switch (kind) {
    case "original":
      return original(file, base);
    case "cleaned":
      return cleaned(file, base);
    case "report_pdf":
      return report(file, base);
    case "changes_csv":
      return changes(file, base);
  }
}

async function original(file: FileRow, base: string): Promise<PreparedDownload> {
  if (file.status === "deleted" || !(await storedFileExists(file.storage_path))) {
    return fail(410, "gone", "This file was deleted. Upload it again to download it.");
  }
  const path = absoluteDataPath(file.storage_path as string);
  const { size } = await stat(path);
  return {
    ok: true,
    contentType: "text/csv; charset=utf-8",
    filename: file.original_name || `${base}.csv`,
    body: { type: "file", path, size },
  };
}

async function cleaned(file: FileRow, base: string): Promise<PreparedDownload> {
  if (file.status === "deleted") return fail(410, "gone", "This file was deleted. Upload it again to get a cleaned copy.");
  if (file.status !== "ready") return fail(409, "not_ready", "Apply the changes first to get the cleaned file.");
  if (!(await storedFileExists(file.cleaned_path))) {
    return fail(410, "gone", "The cleaned file is no longer available.");
  }
  const path = absoluteDataPath(file.cleaned_path as string);
  const { size } = await stat(path);
  return {
    ok: true,
    contentType: "text/csv; charset=utf-8",
    filename: `${base}.cleaned${extOf(file.original_name)}`,
    body: { type: "file", path, size },
  };
}

async function report(file: FileRow, base: string): Promise<PreparedDownload> {
  if (file.applied_at === null) return fail(409, "not_ready", "Apply the changes first to create the report.");
  const { summary, changes: all } = summaryForReport(file.id);
  const activity = fileActivity(file.id).map((a) => ({
    at: new Date(a.at),
    detail: a.actorName ? `${a.detail || a.action} · ${a.actorName}` : a.detail || a.action,
  }));
  const pdf = await reportPdf({
    fileName: file.original_name,
    approvedBy: file.approver_name || file.approver_email || "Unknown",
    appliedAt: new Date(file.applied_at),
    summary,
    activity,
    changes: all,
  });
  return {
    ok: true,
    contentType: "application/pdf",
    filename: `${base}.report.pdf`,
    body: { type: "bytes", bytes: pdf },
  };
}

function changes(file: FileRow, base: string): PreparedDownload {
  if (file.status === "uploaded" || file.status === "processing") {
    return fail(409, "not_ready", "This file is still being processed.");
  }
  // UTF-8 BOM so Excel reads accented names correctly.
  return {
    ok: true,
    contentType: "text/csv; charset=utf-8",
    filename: `${base}.changes.csv`,
    body: { type: "text", text: UTF8_BOM + changeLogCsv(changeLogEntries(file.id)) },
  };
}

/** Content-Disposition with an ASCII fallback and an RFC 5987 UTF-8 name. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
