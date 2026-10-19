"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { FileError } from "@/server/files/errors";
import { applyFile, decideAllAI, setDecision, skipAIForFile } from "@/server/files/review";
import { isValidId } from "@/server/files/storage";
import { retryAi } from "@/server/files/upload";

/** Result shown under a control through useActionState. Never contains secrets. */
export type ReviewState = { error?: string; message?: string } | null;

const fileIdSchema = z.string().refine(isValidId, "That file id is not valid.");
const changeIdSchema = z.number().int().positive();
const decisionSchema = z.enum(["approved", "skipped"]);

function fileIdFrom(formData: FormData): string | null {
  const parsed = fileIdSchema.safeParse(formData.get("fileId"));
  return parsed.success ? parsed.data : null;
}

/** Keep (approved) or Skip (skipped) for one change. Rule changes can only be skipped once approved. */
export async function setDecisionAction(input: {
  fileId: string;
  changeId: number;
  decision: "approved" | "skipped";
}): Promise<{ error?: string; updated?: number }> {
  const { user } = await requireUser();
  const fileId = fileIdSchema.safeParse(input.fileId);
  const changeId = changeIdSchema.safeParse(input.changeId);
  const decision = decisionSchema.safeParse(input.decision);
  if (!fileId.success || !changeId.success || !decision.success) return { error: "That change could not be updated." };

  try {
    const { updated } = setDecision(user.id, fileId.data, [changeId.data], decision.data);
    if (updated === 0) return { error: "That change could not be updated. Reload the page and try again." };
    refresh();
    return { updated };
  } catch (err) {
    if (err instanceof FileError) return { error: err.message };
    throw err;
  }
}

/** "Reject all AI suggestions": every AI change in the file is skipped. */
export async function decideAllAIAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const { user } = await requireUser();
  const fileId = fileIdFrom(formData);
  if (!fileId) return { error: "That file id is not valid." };
  try {
    const { updated } = decideAllAI(user.id, fileId, "skipped");
    refresh();
    return { message: updated === 0 ? "No AI suggestions were open." : `Skipped ${updated} AI suggestion${updated === 1 ? "" : "s"}.` };
  } catch (err) {
    if (err instanceof FileError) return { error: err.message };
    throw err;
  }
}

/** "What the AI saw": rules only for this file. One way: AI suggestions are skipped and no AI calls follow. */
export async function skipAIForFileAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const { user } = await requireUser();
  const fileId = fileIdFrom(formData);
  if (!fileId) return { error: "That file id is not valid." };
  try {
    skipAIForFile(user.id, fileId);
    refresh();
    return { message: "Rules only for this file." };
  } catch (err) {
    if (err instanceof FileError) return { error: err.message };
    throw err;
  }
}

/** Writes the cleaned copy from the approved changes, then opens the change report. */
export async function applyFileAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const { user } = await requireUser();
  const fileId = fileIdFrom(formData);
  if (!fileId) return { error: "That file id is not valid." };
  try {
    await applyFile(user.id, fileId);
  } catch (err) {
    if (err instanceof FileError) return { error: err.message };
    throw err;
  }
  redirect(`/report/${fileId}`);
}

/** "Try AI again" after the AI step was unavailable. Goes back to Processing while it runs. */
export async function retryAiAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const { user } = await requireUser();
  const fileId = fileIdFrom(formData);
  if (!fileId) return { error: "That file id is not valid." };
  try {
    retryAi(user.id, fileId);
  } catch (err) {
    if (err instanceof FileError) return { error: err.message };
    throw err;
  }
  redirect(`/processing/${fileId}`);
}
