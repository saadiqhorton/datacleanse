/**
 * Picks the AI provider for one user and records every call in ai_calls.
 */
import type { z } from "zod";
import { getAIProvider, isLocal, type AIConfig, type AIProvider, type GenerateObjectRequest } from "../../lib/ai";
import { db } from "../db";
import { getInstanceAIConfig, getUserAIConfig, getUserAISettings } from "./config";

export type AISource = "instance" | "own_key" | "off";

export interface ResolvedAIProvider {
  /** Null when AI is off or unavailable; callers fall back to rules only. */
  provider: AIProvider | null;
  source: AISource;
  /** User-facing, e.g. "Local model · llama3.1", "Anthropic · claude-opus-5-5", "Your API key · gpt-4o-mini", "Off". */
  label: string;
}

/**
 * The provider a user's AI calls should use, based on their ai_mode.
 * Never throws for a bad configuration: it returns provider null and a label that says what is wrong.
 */
export function getProviderForUser(userId: string): ResolvedAIProvider {
  const { aiMode } = getUserAISettings(userId);
  if (aiMode === "off") return OFF;
  if (aiMode === "own_key") return resolveOwnKey(userId);
  return resolveInstance(userId);
}

const OFF: ResolvedAIProvider = { provider: null, source: "off", label: "Off" };

function resolveInstance(userId: string): ResolvedAIProvider {
  let config: AIConfig;
  try {
    config = getInstanceAIConfig();
  } catch {
    return { provider: null, source: "instance", label: "Instance AI · configuration unavailable" };
  }
  if (config.provider === "off") return OFF;

  const base = getAIProvider(config);
  if (!base) return { provider: null, source: "instance", label: "Instance AI · configuration unavailable" };
  return {
    provider: recordCalls(base, userId),
    source: "instance",
    label: `${describeProvider(config)} · ${config.model}`,
  };
}

function resolveOwnKey(userId: string): ResolvedAIProvider {
  let config: AIConfig | null;
  try {
    config = getUserAIConfig(userId);
  } catch {
    return { provider: null, source: "own_key", label: "Your API key · saved key could not be read" };
  }
  if (!config) return { provider: null, source: "own_key", label: "Your API key · no key saved" };

  const base = getAIProvider(config);
  if (!base) return { provider: null, source: "own_key", label: "Your API key · no key saved" };
  return {
    provider: recordCalls(base, userId),
    source: "own_key",
    label: `Your API key · ${config.model}`,
  };
}

function describeProvider(config: AIConfig): string {
  if (config.provider === "anthropic") return "Anthropic";
  if (isLocal(config)) return "Local model";
  return "OpenAI-compatible API";
}

/** Wraps a provider so each generateObject call writes one ai_calls row, on success and on failure. */
function recordCalls(base: AIProvider, userId: string): AIProvider {
  return {
    id: base.id,
    model: base.model,

    async generateObject<T extends z.ZodType>(req: GenerateObjectRequest<T>): Promise<z.infer<T>> {
      const started = Date.now();
      let ok = false;
      try {
        const result = await base.generateObject(req);
        ok = true;
        return result;
      } finally {
        writeCallRow({
          userId,
          provider: base.id,
          model: base.model,
          purpose: req.schemaName,
          ok,
          ms: Date.now() - started,
        });
      }
    },

    check: () => base.check(),
  };
}

function writeCallRow(row: {
  userId: string;
  provider: string;
  model: string;
  purpose: string;
  ok: boolean;
  ms: number;
}) {
  try {
    db()
      .prepare("INSERT INTO ai_calls (at, user_id, provider, model, purpose, ok, ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(Date.now(), row.userId, row.provider, row.model, row.purpose, row.ok ? 1 : 0, row.ms);
  } catch {
    // Logging must never fail the AI call itself. The row is simply missing.
  }
}

/** Number of AI calls made at or after `ts` (epoch ms), for the admin dashboard. */
export function aiCallsSince(ts: number): number {
  const row = db().prepare("SELECT COUNT(*) AS n FROM ai_calls WHERE at >= ?").get(ts) as { n: number };
  return row.n;
}
