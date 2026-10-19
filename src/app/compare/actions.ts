"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { createAskChat } from "@/server/comparisons/ask";
import { CompareError } from "@/server/comparisons/errors";
import { runComparison, sharedColumns } from "@/server/comparisons/run";

/** Form result: null until an action fails. A successful action redirects. */
export type CompareState = { error: string } | null;
export type SharedColumnsResult = { ok: true; columns: string[] } | { ok: false; error: string };

const ID = z.string().max(64).regex(/^[a-z]+_[a-z0-9x]+$/, "Not a valid id.");

const PairSchema = z.object({
  left: ID,
  right: ID,
  useCleaned: z.boolean(),
});

const RunSchema = PairSchema.extend({
  keyColumn: z.string().max(256),
});

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Runs a comparison of two of the user's files, then opens its result. */
export async function runCompareAction(_prev: CompareState, formData: FormData): Promise<CompareState> {
  const { user } = await requireUser();
  const parsed = RunSchema.safeParse({
    left: text(formData, "left"),
    right: text(formData, "right"),
    useCleaned: formData.get("useCleaned") === "on",
    keyColumn: text(formData, "keyColumn"),
  });
  if (!parsed.success) return { error: "Choose two files to compare." };

  let id: string;
  try {
    id = await runComparison(user.id, {
      leftId: parsed.data.left,
      rightId: parsed.data.right,
      useCleaned: parsed.data.useCleaned,
      keyColumn: parsed.data.keyColumn,
    });
  } catch (err) {
    if (err instanceof CompareError) return { error: err.message };
    throw err;
  }
  redirect(`/compare/${id}`);
}

/** The columns both files share, for the key picker. */
export async function sharedColumnsAction(left: string, right: string, useCleaned: boolean): Promise<SharedColumnsResult> {
  const { user } = await requireUser();
  const parsed = PairSchema.safeParse({ left, right, useCleaned });
  if (!parsed.success) return { ok: false, error: "Choose two files first." };
  try {
    const columns = await sharedColumns(user.id, parsed.data.left, parsed.data.right, parsed.data.useCleaned);
    return { ok: true, columns };
  } catch (err) {
    if (err instanceof CompareError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Starts an Ask chat over the two files of a comparison, then opens it. */
export async function askAboutComparisonAction(_prev: CompareState, formData: FormData): Promise<CompareState> {
  const { user } = await requireUser();
  const parsed = ID.safeParse(text(formData, "compareId"));
  if (!parsed.success) return { error: "Comparison not found." };

  let chatId: string;
  try {
    chatId = createAskChat(user.id, parsed.data);
  } catch (err) {
    if (err instanceof CompareError) return { error: err.message };
    throw err;
  }
  redirect(`/ask/${chatId}`);
}
