import { z } from "zod";
import { DEFAULT_MODELS } from "../../lib/ai/config";
import {
  AISettingsError,
  describeInstanceAI,
  getUserAISettings,
  setUserAISettings,
  type InstanceAIDescription,
  type UserAISettings,
} from "../ai/config";
import { getProviderForUser } from "../ai/resolve";
import { SettingsError, firstIssue } from "./errors";

export const aiFormSchema = z.object({
  aiMode: z.enum(["instance", "own_key", "off"], { error: "Choose Instance model, Your API key or Off." }),
  ownProvider: z.enum(["anthropic", "openai"], { error: "Choose Anthropic or OpenAI-compatible." }).optional(),
  ownModel: z.string().max(200, "The model name is too long.").optional(),
  ownBaseURL: z.string().max(2048, "The base URL is too long.").optional(),
  /** Blank means "keep the saved key". */
  ownApiKey: z.string().max(500, "The API key is too long.").optional(),
});

/** Raw form values. aiFormSchema validates them. */
export type AIFormInput = { aiMode?: unknown; ownProvider?: unknown; ownModel?: unknown; ownBaseURL?: unknown; ownApiKey?: unknown };

export interface InstanceAIView {
  description: InstanceAIDescription;
  /** Provider and model, e.g. "Local model · llama3.1". */
  label: string;
  /** Origin and path of the endpoint, never credentials or query strings. Null for Anthropic. */
  endpoint: string | null;
}

export interface AISettingsView {
  /** Null when the instance configuration cannot be read (see AI_PROVIDER in .env.local). */
  instance: InstanceAIView | null;
  user: UserAISettings;
}

export function instanceLabel(d: InstanceAIDescription): string {
  if (d.provider === "off") return "AI off";
  const name = d.provider === "anthropic" ? "Anthropic" : d.local ? "Local model" : "OpenAI-compatible API";
  return `${name} · ${d.model}`;
}

/** Display endpoint: origin and path only. */
export function displayEndpoint(baseURL: string): string {
  const url = new URL(baseURL);
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** What the AI section shows. Never includes a key. */
export function getAISettingsView(userId: string): AISettingsView {
  let instance: InstanceAIView | null = null;
  try {
    const description = describeInstanceAI();
    instance = {
      description,
      label: instanceLabel(description),
      endpoint:
        description.provider !== "off" && description.provider !== "anthropic" && description.baseURL
          ? displayEndpoint(description.baseURL)
          : null,
    };
  } catch {
    instance = null;
  }
  return { instance, user: getUserAISettings(userId) };
}

/**
 * Saves the user's AI mode. The own-key fields are only read when aiMode is "own_key", so picking
 * "Instance model" or "Off" keeps a saved key without re-checking the other fields.
 */
export function saveUserAI(userId: string, raw: AIFormInput): UserAISettings {
  const parsed = aiFormSchema.safeParse(raw);
  if (!parsed.success) throw new SettingsError(firstIssue(parsed.error));
  const f = parsed.data;

  try {
    if (f.aiMode !== "own_key") {
      return setUserAISettings(userId, { aiMode: f.aiMode });
    }
    const provider = f.ownProvider ?? "anthropic";
    const apiKey = f.ownApiKey?.trim() ? f.ownApiKey.trim() : undefined;
    return setUserAISettings(userId, {
      aiMode: "own_key",
      ownKey: {
        provider,
        model: f.ownModel?.trim() || DEFAULT_MODELS[provider],
        // Only OpenAI-compatible endpoints have a base URL. Blank falls back to the default.
        baseURL: provider === "openai" && f.ownBaseURL?.trim() ? f.ownBaseURL.trim() : undefined,
        apiKey,
      },
    });
  } catch (err) {
    if (err instanceof AISettingsError) throw new SettingsError(err.message);
    throw err;
  }
}

export interface AIConnectionResult {
  ok: boolean;
  /** Provider and model the check ran against, e.g. "Your API key · claude-opus-5-5". */
  label: string;
  error?: string;
}

/**
 * Checks the user's effective provider (instance or own key, per their saved mode). Uses the saved
 * settings, not unsaved form values.
 */
export async function testUserAIConnection(userId: string): Promise<AIConnectionResult> {
  const resolved = getProviderForUser(userId);
  if (!resolved.provider) {
    return {
      ok: false,
      label: resolved.label,
      error: resolved.source === "off" ? "AI is off for your account." : "No working provider. Check the settings above.",
    };
  }
  try {
    const check = await resolved.provider.check();
    return check.ok
      ? { ok: true, label: resolved.label }
      : { ok: false, label: resolved.label, error: check.error };
  } catch {
    return { ok: false, label: resolved.label, error: "The connection check failed unexpectedly." };
  }
}
