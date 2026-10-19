"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { FileError } from "@/server/files/errors";
import { retryAi, retryFile } from "@/server/files/upload";

/** A new job the Processing page starts polling, or the reason it could not start. */
export type RetryResult = { ok: true; jobId: string } | { ok: false; error: string };

const FILE_ID = z.string().regex(/^[a-z]+_[a-z0-9x]+$/).max(64);
const NOT_FOUND: RetryResult = { ok: false, error: "File not found." };

async function attempt(
  fileId: string,
  run: (userId: string, id: string) => { jobId: string } | Promise<{ jobId: string }>,
): Promise<RetryResult> {
  const { user } = await requireUser();
  const parsed = FILE_ID.safeParse(fileId);
  if (!parsed.success) return NOT_FOUND;
  try {
    const { jobId } = await run(user.id, parsed.data);
    refresh();
    return { ok: true, jobId };
  } catch (err) {
    if (err instanceof FileError) return { ok: false, error: err.message };
    throw err;
  }
}

/** "Wait for AI": asks the AI again for a file whose AI step was unavailable. */
export async function waitForAiAction(fileId: string): Promise<RetryResult> {
  return attempt(fileId, (userId, id) => retryAi(userId, id));
}

/** "Try again": re-runs the whole pipeline for a failed file whose original still exists. */
export async function tryAgainAction(fileId: string): Promise<RetryResult> {
  return attempt(fileId, (userId, id) => retryFile(userId, id));
}
