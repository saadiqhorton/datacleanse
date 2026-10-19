import { connection } from "next/server";
import { env } from "@/server/env";
import { FileError } from "@/server/files/errors";
import { apiSession } from "@/server/files/api";
import { assertUploadable, createUpload, sanitizeFileName } from "@/server/files/upload";
import type { CleaningMode } from "@/server/files/repo";
import type { CleanOptions } from "@/server/types";

const MAX_FILES = 20;
/** Room for multipart boundaries and form fields on top of the file limit. */
const MULTIPART_ALLOWANCE = 1024 * 1024;

/** Uploads one or more files. Each becomes a file row and a queued clean job. */
export async function POST(request: Request) {
  await connection();
  const auth = await apiSession();
  if (auth instanceof Response) return auth;

  // formData() buffers the whole body, so the size must be known before reading it.
  const header = request.headers.get("content-length");
  if (header === null) {
    return Response.json({ error: "The upload must state its size.", code: "length_required" }, { status: 411 });
  }
  if (Number(header) > env.maxUploadBytes + MULTIPART_ALLOWANCE) return tooLarge();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Could not read the upload.", code: "bad_request" }, { status: 400 });
  }

  const files = form.getAll("file").filter((v): v is File => v instanceof File);
  if (files.length === 0) return Response.json({ error: "Choose a file to upload.", code: "bad_request" }, { status: 400 });
  if (files.length > MAX_FILES) {
    return Response.json({ error: `Upload at most ${MAX_FILES} files at a time.`, code: "bad_request" }, { status: 400 });
  }

  const modeField = form.get("mode");
  const mode = typeof modeField === "string" && modeField !== "" ? (modeField as CleaningMode) : undefined;

  let options: Partial<CleanOptions> | undefined;
  const optionsField = form.get("options");
  if (typeof optionsField === "string" && optionsField.trim() !== "") {
    try {
      options = JSON.parse(optionsField) as Partial<CleanOptions>;
    } catch {
      return Response.json({ error: "Options must be valid JSON.", code: "bad_request" }, { status: 400 });
    }
  }

  const ruleSetField = form.get("ruleSetId");
  const ruleSetId = typeof ruleSetField === "string" && ruleSetField.trim() !== "" ? ruleSetField.trim() : null;

  try {
    // Check every file before creating any, so a bad name or size creates nothing.
    for (const file of files) assertUploadable(file.name, file.size);

    const created: { fileId: string; jobId: string; name: string }[] = [];
    for (const file of files) {
      const result = await createUpload(auth.user.id, {
        name: file.name,
        bytes: file.stream(),
        mode,
        options,
        ruleSetId,
      });
      created.push({ fileId: result.fileId, jobId: result.jobId, name: sanitizeFileName(file.name) });
    }
    return Response.json({ files: created }, { status: 201 });
  } catch (err) {
    if (err instanceof FileError) {
      if (err.code === "too_large") return tooLarge();
      return Response.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error("[upload] failed", err);
    return Response.json({ error: "Upload failed. Try again.", code: "other" }, { status: 500 });
  }
}

function tooLarge() {
  const mb = env.maxUploadBytes / (1024 * 1024);
  return Response.json(
    { error: `This upload is larger than the ${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB limit.`, code: "too_large" },
    { status: 413 },
  );
}
