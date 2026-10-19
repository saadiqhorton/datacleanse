import type { UploadValues } from "./options";
import { serializeOptions } from "./options";

export interface UploadedFile {
  fileId: string;
  jobId: string;
  name: string;
}

export type UploadOutcome = { ok: true; files: UploadedFile[] } | { ok: false; message: string };

/** The multipart body POST /api/files reads: one `file` field per file, then mode, options and ruleSetId. */
export function buildUploadForm(files: File[], values: UploadValues): FormData {
  const form = new FormData();
  for (const file of files) form.append("file", file, file.name);
  form.append("mode", values.mode);
  form.append("options", serializeOptions(values));
  if (values.ruleSetId !== "") form.append("ruleSetId", values.ruleSetId);
  return form;
}

/** Reads the route's JSON answer: 201 with `files`, or an `error` message the person can read. */
export function parseUploadResponse(status: number, body: string): UploadOutcome {
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  if (status === 201 && isRecord(json) && Array.isArray(json.files)) {
    const files: UploadedFile[] = [];
    for (const item of json.files) {
      if (!isRecord(item) || typeof item.fileId !== "string" || typeof item.jobId !== "string") {
        return { ok: false, message: "The server sent an unexpected answer. Try again." };
      }
      files.push({
        fileId: item.fileId,
        jobId: item.jobId,
        name: typeof item.name === "string" ? item.name : "",
      });
    }
    if (files.length > 0) return { ok: true, files };
  }
  if (isRecord(json) && typeof json.error === "string" && json.error !== "") {
    return { ok: false, message: json.error };
  }
  return { ok: false, message: "Upload failed. Try again." };
}

/** Where to go after a successful upload: one file opens its progress page, several go to the list. */
export function destinationFor(files: UploadedFile[]): string {
  if (files.length === 1) return `/processing/${encodeURIComponent(files[0].fileId)}`;
  return "/files";
}

/**
 * POSTs the selection to /api/files. XMLHttpRequest is used because fetch has no upload progress.
 * The browser sets Content-Length for a FormData body, which the route requires (411 without it).
 */
export function sendUpload(
  files: File[],
  values: UploadValues,
  onProgress: (percent: number) => void,
): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.floor((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => resolve(parseUploadResponse(xhr.status, xhr.responseText));
    xhr.onerror = () => resolve({ ok: false, message: "Upload failed. Check your connection and try again." });
    xhr.onabort = () => resolve({ ok: false, message: "Upload cancelled." });
    xhr.send(buildUploadForm(files, values));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
