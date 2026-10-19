"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { FileError, NOT_FOUND_MESSAGE } from "@/server/files/errors";
import { ID_PATTERN } from "@/server/files/storage";
import { deleteFileForUser } from "@/server/files/list-view";
import { retryFile } from "@/server/files/upload";

/** What a row's button shows after a failed or finished action. */
export type FileActionState = { error: string } | { message: string } | null;

const FILE_ID = z.string().max(64).regex(ID_PATTERN);

function fileIdField(formData: FormData): string | null {
  const parsed = FILE_ID.safeParse(formData.get("fileId"));
  return parsed.success ? parsed.data : null;
}

/** Re-runs a failed file's pipeline, then opens its progress page. */
export async function retryFileAction(_prev: FileActionState, formData: FormData): Promise<FileActionState> {
  const { user } = await requireUser();
  const fileId = fileIdField(formData);
  if (!fileId) return { error: NOT_FOUND_MESSAGE };
  try {
    await retryFile(user.id, fileId);
  } catch (err) {
    if (err instanceof FileError) return { error: err.message };
    throw err;
  }
  redirect(`/processing/${fileId}`);
}

/** Deletes a file's copies now. The row stays as Deleted so its report is kept. */
export async function deleteFileAction(_prev: FileActionState, formData: FormData): Promise<FileActionState> {
  const { user } = await requireUser();
  const fileId = fileIdField(formData);
  if (!fileId) return { error: NOT_FOUND_MESSAGE };
  try {
    await deleteFileForUser(user.id, fileId);
  } catch (err) {
    if (err instanceof FileError) return { error: err.message };
    throw err;
  }
  refresh();
  return { message: "File deleted." };
}
