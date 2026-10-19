"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { checkAIConnection } from "@/server/admin/config";
import { AdminError } from "@/server/admin/errors";
import { cancelJobAsAdmin } from "@/server/admin/jobs";
import { setUserDisabled, setUserRole } from "@/server/admin/users";
import { AISettingsError, INSTANCE_PROVIDERS, setInstanceAIConfig } from "@/server/ai";
import { requireAdmin } from "@/server/auth/session";

/** Result shown by a form through useActionState. Never contains keys or passwords. */
export type ActionState = { error?: string; message?: string } | null;
export type ConnectionTestState = { ok: boolean; message: string } | null;

const ID_PATTERN = /^[a-z0-9_]{1,64}$/;
/** Better Auth user ids are random mixed-case alphanumerics. */
const USER_ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function cancelJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireAdmin();
  const parsed = z.string().regex(ID_PATTERN).safeParse(text(formData, "jobId"));
  if (!parsed.success) return { error: "That job id is not valid." };
  try {
    cancelJobAsAdmin(user.id, parsed.data);
  } catch (err) {
    if (err instanceof AdminError) return { error: err.message };
    throw err;
  }
  refresh();
  return { message: "Job cancelled." };
}

const MANAGE_OPS = ["promote", "demote", "disable", "enable"] as const;
const MANAGE_MESSAGES: Record<(typeof MANAGE_OPS)[number], string> = {
  promote: "Now an admin.",
  demote: "Now a regular user.",
  disable: "Disabled. Their sessions are signed out.",
  enable: "Enabled.",
};

export async function manageUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireAdmin();
  const userId = z.string().regex(USER_ID_PATTERN).safeParse(text(formData, "userId"));
  const op = z.enum(MANAGE_OPS).safeParse(text(formData, "op"));
  if (!userId.success || !op.success) return { error: "That request is not valid." };

  try {
    switch (op.data) {
      case "promote":
        setUserRole(user.id, userId.data, "admin");
        break;
      case "demote":
        setUserRole(user.id, userId.data, "user");
        break;
      case "disable":
        setUserDisabled(user.id, userId.data, true);
        break;
      case "enable":
        setUserDisabled(user.id, userId.data, false);
        break;
    }
  } catch (err) {
    if (err instanceof AdminError) return { error: err.message };
    throw err;
  }
  refresh();
  return { message: MANAGE_MESSAGES[op.data] };
}

const PROVIDER_NAMES: Record<(typeof INSTANCE_PROVIDERS)[number], string> = {
  local: "local model",
  anthropic: "Anthropic",
  openai: "OpenAI-compatible API",
  off: "off",
};

export async function saveAIConfigAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireAdmin();
  const parsed = z
    .object({
      provider: z.enum(INSTANCE_PROVIDERS),
      model: z.string().max(200),
      baseURL: z.string().max(2048),
      apiKey: z.string().max(500),
      clearKey: z.boolean(),
    })
    .safeParse({
      provider: text(formData, "provider"),
      model: text(formData, "model"),
      baseURL: text(formData, "baseURL"),
      apiKey: text(formData, "apiKey"),
      clearKey: formData.get("clearKey") === "on",
    });
  if (!parsed.success) return { error: "Choose a provider and check the other fields." };

  const { provider, model, baseURL, apiKey, clearKey } = parsed.data;
  // Blank keeps the saved key. "Clear saved key" removes it. Anything else replaces it.
  const key = clearKey ? "" : apiKey.trim() === "" ? undefined : apiKey;

  try {
    const saved = setInstanceAIConfig({ provider, model, baseURL, apiKey: key }, user.id);
    refresh();
    return { message: `Saved. AI provider is now ${PROVIDER_NAMES[saved.provider]}.` };
  } catch (err) {
    if (err instanceof AISettingsError) return { error: err.message };
    throw err;
  }
}

export async function testAIConnectionAction(): Promise<ConnectionTestState> {
  await requireAdmin();
  const result = await checkAIConnection();
  return result.ok ? { ok: true, message: result.message } : { ok: false, message: result.error };
}
