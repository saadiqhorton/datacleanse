import { getAIProvider, readAIConfig, type AIConfig } from "../../lib/ai";
import { describeInstanceAI, getInstanceAIConfig, type InstanceAIDescription } from "../ai";
import { db } from "../db";

const CHECK_TIMEOUT_MS = 15_000;

export interface AIAdminView {
  /** The effective instance configuration, with no key material. Null when it cannot be read. */
  effective: InstanceAIDescription | null;
  effectiveError: string | null;
  /** Which settings have a value saved on this page. The rest come from environment variables. */
  saved: { provider: boolean; model: boolean; baseURL: boolean; apiKey: boolean };
  /** What the environment alone would use (the defaults). */
  envDefaults: { provider: AIConfig["provider"]; model: string; baseURL: string | null } | null;
  envError: string | null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function getAIAdminView(env: NodeJS.ProcessEnv = process.env): AIAdminView {
  const keys = new Set(
    (
      db()
        .prepare("SELECT key FROM app_config WHERE key IN ('ai.provider', 'ai.model', 'ai.base_url', 'ai.api_key')")
        .all() as { key: string }[]
    ).map((row) => row.key),
  );

  let effective: InstanceAIDescription | null = null;
  let effectiveError: string | null = null;
  try {
    effective = describeInstanceAI(env);
  } catch (err) {
    effectiveError = messageOf(err);
  }

  let envDefaults: AIAdminView["envDefaults"] = null;
  let envError: string | null = null;
  try {
    const config = readAIConfig(env);
    envDefaults = { provider: config.provider, model: config.model, baseURL: config.baseURL ?? null };
  } catch (err) {
    envError = messageOf(err);
  }

  return {
    effective,
    effectiveError,
    saved: {
      provider: keys.has("ai.provider"),
      model: keys.has("ai.model"),
      baseURL: keys.has("ai.base_url"),
      apiKey: keys.has("ai.api_key"),
    },
    envDefaults,
    envError,
  };
}

export type AICheckResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Tests the saved instance configuration (not unsaved form values): builds the provider the
 * same way the app does and asks it to check reachability. Never throws.
 */
export async function checkAIConnection(env: NodeJS.ProcessEnv = process.env): Promise<AICheckResult> {
  let config: AIConfig;
  try {
    config = getInstanceAIConfig(env);
  } catch (err) {
    return { ok: false, error: `The saved AI settings could not be read. ${messageOf(err)}` };
  }
  if (config.provider === "off") return { ok: false, error: "AI is off, so there is no connection to test." };

  try {
    const provider = getAIProvider(config);
    if (!provider) return { ok: false, error: "AI is off, so there is no connection to test." };
    const result = await withTimeout(provider.check(), CHECK_TIMEOUT_MS);
    return result.ok ? { ok: true, message: `Connected. ${config.model} answered.` } : { ok: false, error: result.error };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer after ${ms / 1000} seconds.`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
