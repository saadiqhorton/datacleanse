"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { RuleDraft } from "@/lib/ai";
import { requireUser } from "@/server/auth/session";
import { draftRuleForUser, type DraftPreview } from "@/server/rules/draft";
import {
  RulesError,
  addHeaders,
  createRule,
  createRuleSet,
  deleteRule,
  deleteRuleSet,
  moveRule,
  removeHeader,
  renameRuleSet,
  setRuleEnabled,
  updateRule,
} from "@/server/rules/repo";

/** Every action returns this instead of throwing for expected failures. */
export type RulesResult = { ok: true; message?: string } | { ok: false; error: string };
export type DraftResult = { ok: true; draft: RuleDraft; preview: DraftPreview } | { ok: false; error: string };

const NOT_FOUND: RulesResult = { ok: false, error: "That item could not be found. Refresh the page and try again." };
const ID = z.string().regex(/^[a-z0-9_]{1,64}$/);

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** An id from the form, or null when it is not shaped like one of ours. */
function idField(formData: FormData, name: string): string | null {
  const parsed = ID.safeParse(text(formData, name));
  return parsed.success ? parsed.data : null;
}

/** Runs a write, refreshes the page on success and turns RulesError into a message. */
function attempt(fn: () => string | void): RulesResult {
  try {
    const message = fn();
    refresh();
    return message ? { ok: true, message } : { ok: true };
  } catch (err) {
    if (err instanceof RulesError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function createRuleSetAction(formData: FormData): Promise<RulesResult> {
  const { user } = await requireUser();
  let id = "";
  const result = attempt(() => {
    id = createRuleSet(user.id, text(formData, "name"));
    return "Rule set created.";
  });
  if (!result.ok) return result;
  redirect(`/rules?set=${id}`);
}

export async function renameRuleSetAction(formData: FormData): Promise<RulesResult> {
  const { user } = await requireUser();
  const setId = idField(formData, "setId");
  if (!setId) return NOT_FOUND;
  return attempt(() => {
    renameRuleSet(user.id, setId, text(formData, "name"));
    return "Renamed.";
  });
}

export async function deleteRuleSetAction(formData: FormData): Promise<RulesResult> {
  const { user } = await requireUser();
  const setId = idField(formData, "setId");
  if (!setId) return NOT_FOUND;
  const result = attempt(() => {
    deleteRuleSet(user.id, setId);
    return "Rule set deleted.";
  });
  if (!result.ok) return result;
  redirect("/rules");
}

export async function addHeadersAction(formData: FormData): Promise<RulesResult> {
  const { user } = await requireUser();
  const setId = idField(formData, "setId");
  if (!setId) return NOT_FOUND;
  const headers = formData.getAll("header");
  return attempt(() => {
    const added = addHeaders(user.id, setId, headers);
    if (added === 0) throw new RulesError("Those headers are already in this rule set.");
    return added === 1 ? "Header added." : `${added} headers added.`;
  });
}

export async function removeHeaderAction(formData: FormData): Promise<RulesResult> {
  const { user } = await requireUser();
  const setId = idField(formData, "setId");
  if (!setId) return NOT_FOUND;
  return attempt(() => {
    removeHeader(user.id, setId, text(formData, "header"));
    return "Header removed.";
  });
}

/** Parses the JSON params field. An empty field means no params. */
function paramsField(formData: FormData): { ok: true; value: unknown } | { ok: false } {
  const raw = text(formData, "params").trim();
  if (raw === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Creates a rule in a set, or updates one when ruleId is sent. Used by the editor and by a saved draft. */
export async function saveRuleAction(formData: FormData): Promise<RulesResult> {
  const { user } = await requireUser();
  const editing = text(formData, "ruleId") !== "";
  const ruleId = editing ? idField(formData, "ruleId") : null;
  const setId = idField(formData, "setId");
  if (editing ? ruleId === null : setId === null) return NOT_FOUND;

  const params = paramsField(formData);
  if (!params.ok) return { ok: false, error: "The rule's settings could not be read. Check them and try again." };

  const raw = {
    columnPattern: text(formData, "columnPattern"),
    action: text(formData, "action"),
    onLowConfidence: text(formData, "onLowConfidence") || undefined,
    description: text(formData, "description"),
    params: params.value,
  };
  return attempt(() => {
    if (ruleId !== null) {
      updateRule(user.id, ruleId, raw);
      return "Rule saved.";
    }
    createRule(user.id, setId ?? "", raw);
    return "Rule added.";
  });
}

export async function toggleRuleAction(formData: FormData): Promise<RulesResult> {
  const { user } = await requireUser();
  const ruleId = idField(formData, "ruleId");
  if (!ruleId) return NOT_FOUND;
  const enabled = text(formData, "enabled") === "true";
  return attempt(() => {
    setRuleEnabled(user.id, ruleId, enabled);
    return enabled ? "Rule turned on." : "Rule turned off.";
  });
}

export async function moveRuleAction(formData: FormData): Promise<RulesResult> {
  const { user } = await requireUser();
  const ruleId = idField(formData, "ruleId");
  if (!ruleId) return NOT_FOUND;
  const direction = text(formData, "direction");
  if (direction !== "up" && direction !== "down") return { ok: false, error: "Choose up or down." };
  return attempt(() => {
    if (!moveRule(user.id, ruleId, direction)) return "That rule is already in that position.";
    return "Rule moved.";
  });
}

export async function deleteRuleAction(formData: FormData): Promise<RulesResult> {
  const { user } = await requireUser();
  const ruleId = idField(formData, "ruleId");
  if (!ruleId) return NOT_FOUND;
  return attempt(() => {
    deleteRule(user.id, ruleId);
    return "Rule deleted.";
  });
}

/** Drafts a rule from a sentence and previews it. Saves nothing. */
export async function draftRuleAction(formData: FormData): Promise<DraftResult> {
  const { user } = await requireUser();
  const description = text(formData, "description").trim();
  if (description === "") return { ok: false, error: "Describe the rule in a sentence first." };
  if (description.length > 500) return { ok: false, error: "Keep the description under 500 characters." };
  return draftRuleForUser(user.id, description);
}
