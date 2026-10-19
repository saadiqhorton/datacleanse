"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getProviderForUser } from "@/server/ai";
import { requireUser } from "@/server/auth/session";
import { isValidId } from "@/server/files/storage";
import { runTracked } from "@/server/jobs/tracked";
import { AskError, CHAT_NOT_FOUND } from "@/server/ask/errors";
import { QUESTION_MAX_LENGTH } from "@/server/ask/copy";
import { answerQuestion, changeJoins, confirmJoins } from "@/server/ask/answer";
import { addFileToChat, createChat, getChatForUser, insertMessage, resolveChatTables } from "@/server/ask/repo";
import { AIError } from "@/lib/ai";
import { QueryRejectedError, QueryTimeoutError } from "@/server/query";

/** Every action returns this. Expected failures come back as { ok: false, error }. */
export type AskState = { ok: true } | { ok: false; error: string } | null;

const fail = (error: string): AskState => ({ ok: false, error });

const idField = (value: FormDataEntryValue | null) =>
  typeof value === "string" && isValidId(value) ? value : null;

const QuestionSchema = z
  .string()
  .trim()
  .min(1, "Type a question first.")
  .max(QUESTION_MAX_LENGTH, `Keep questions under ${QUESTION_MAX_LENGTH.toLocaleString("en-US")} characters.`);

/** Creates a chat from the checked files and opens it. */
export async function createChatAction(_prev: AskState, formData: FormData): Promise<AskState> {
  const { user } = await requireUser();
  const fileIds = formData.getAll("fileId").filter((v): v is string => typeof v === "string");
  let chatId: string;
  try {
    chatId = await createChat(user.id, fileIds);
  } catch (err) {
    if (err instanceof AskError) return fail(err.message);
    console.error("[ask] unexpected error", err);
    return fail("Something went wrong. Try again.");
  }
  redirect(`/ask/${chatId}`);
}

/** Adds a file to a chat under a unique alias. */
export async function addFileAction(_prev: AskState, formData: FormData): Promise<AskState> {
  const { user } = await requireUser();
  const chatId = idField(formData.get("chatId"));
  const fileId = idField(formData.get("fileId"));
  if (!chatId || !fileId) return fail("Choose a file to add.");
  try {
    await addFileToChat(user.id, chatId, fileId);
  } catch (err) {
    if (err instanceof AskError) return fail(err.message);
    throw err;
  }
  refresh();
  return { ok: true };
}

/**
 * Asks a question in a chat. The question is stored first. The answer, the confirmation card or an
 * error is then written as an assistant message, so the outcome is always in the chat.
 */
export async function askAction(_prev: AskState, formData: FormData): Promise<AskState> {
  const { user } = await requireUser();
  const chatId = idField(formData.get("chatId"));
  if (!chatId || !getChatForUser(user.id, chatId)) return fail(CHAT_NOT_FOUND);
  const parsed = QuestionSchema.safeParse(formData.get("question") ?? "");
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Type a question first.");
  const question = parsed.data;

  insertMessage({ chatId, role: "user", content: question, status: "done" });
  const ai = getProviderForUser(user.id).provider;
  const { files } = await resolveChatTables(user.id, chatId);
  try {
    await runTracked("ask", user.id, { fileCount: files.length }, () => answerQuestion(user.id, chatId, question, ai));
  } catch (err) {
    // The outcome is already in the chat. Only unexpected errors need a log line.
    if (!isReported(err)) console.error("[ask] unexpected error", err);
  }
  refresh();
  return { ok: true };
}

/** "Use these joins": confirms the card's joins and runs the planned query. */
export async function confirmJoinsAction(_prev: AskState, formData: FormData): Promise<AskState> {
  const { user } = await requireUser();
  const messageId = idField(formData.get("messageId"));
  if (!messageId) return fail("That answer could not be found. Refresh the page and try again.");
  const ai = getProviderForUser(user.id).provider;
  try {
    await runTracked("ask", user.id, { stage: "confirm_joins" }, () => confirmJoins(user.id, messageId, ai));
  } catch (err) {
    if (err instanceof AskError) return fail(err.message);
    if (!isReported(err)) console.error("[ask] unexpected error", err);
  }
  refresh();
  return { ok: true };
}

/** "Change": plans the question again with one of the listed column pairs. */
export async function changeJoinsAction(_prev: AskState, formData: FormData): Promise<AskState> {
  const { user } = await requireUser();
  const messageId = idField(formData.get("messageId"));
  const index = Number(formData.get("candidate"));
  if (!messageId) return fail("That answer could not be found. Refresh the page and try again.");
  const ai = getProviderForUser(user.id).provider;
  try {
    await changeJoins(user.id, messageId, index, ai);
  } catch (err) {
    if (err instanceof AskError) return fail(err.message);
    console.error("[ask] unexpected error", err);
    return fail("Something went wrong. Try again.");
  }
  refresh();
  return { ok: true };
}

function isReported(err: unknown): boolean {
  return err instanceof QueryRejectedError || err instanceof QueryTimeoutError || err instanceof AIError || err instanceof AskError;
}
