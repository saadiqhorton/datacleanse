/**
 * AI provider configuration, read from environment variables on the server.
 *
 *   AI_PROVIDER   anthropic | openai | local | off
 *                 Defaults to "anthropic" when ANTHROPIC_API_KEY is set, else "local".
 *   AI_MODEL      Model id. Defaults per provider (see DEFAULT_MODELS).
 *   AI_BASE_URL   OpenAI-compatible base URL (".../v1"). Used by "openai" and "local".
 *   AI_API_KEY    Key for the OpenAI-compatible endpoint. Optional for "local".
 *   ANTHROPIC_API_KEY  Key for "anthropic" (the SDK also accepts an `ant auth login` profile).
 *
 * "local" talks to any OpenAI-compatible server on your machine: Ollama, LM Studio,
 * llama.cpp server, vLLM. "openai" is any hosted OpenAI-compatible API (OpenAI,
 * OpenRouter, Groq, Together...).
 */

export type ProviderId = "anthropic" | "openai" | "local" | "off";

export interface AIConfig {
  provider: ProviderId;
  model: string;
  baseURL?: string;
  apiKey?: string;
}

export const DEFAULT_MODELS: Record<Exclude<ProviderId, "off">, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-4o-mini",
  local: "llama3.1",
};

export const DEFAULT_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  // Ollama's OpenAI-compatible endpoint. LM Studio uses http://localhost:1234/v1.
  local: "http://localhost:11434/v1",
};

const PROVIDERS: ProviderId[] = ["anthropic", "openai", "local", "off"];

export function readAIConfig(env: NodeJS.ProcessEnv = process.env): AIConfig {
  const raw = env.AI_PROVIDER?.trim().toLowerCase();
  if (raw && !PROVIDERS.includes(raw as ProviderId)) {
    throw new Error(`AI_PROVIDER must be one of ${PROVIDERS.join(", ")}; got "${raw}"`);
  }
  const provider = (raw as ProviderId | undefined) ?? (env.ANTHROPIC_API_KEY ? "anthropic" : "local");

  if (provider === "off") return { provider, model: "" };
  if (provider === "anthropic") {
    return { provider, model: env.AI_MODEL || DEFAULT_MODELS.anthropic };
  }
  return {
    provider,
    model: env.AI_MODEL || DEFAULT_MODELS[provider],
    baseURL: (env.AI_BASE_URL || DEFAULT_BASE_URLS[provider]).replace(/\/+$/, ""),
    apiKey: env.AI_API_KEY || undefined,
  };
}

/** Whether data sent to the model leaves this machine. Shown in the UI. */
export function isLocal(config: AIConfig) {
  if (config.provider === "local") return true;
  if (!config.baseURL) return false;
  const host = new URL(config.baseURL).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}
