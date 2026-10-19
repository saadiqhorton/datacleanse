import { createAnthropicProvider } from "./anthropic";
import { readAIConfig, type AIConfig } from "./config";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import type { AIProvider } from "./types";

export * from "./config";
export * from "./types";
export * from "./tasks";

/** Returns the configured provider, or null when AI is off (rules only). */
export function getAIProvider(config: AIConfig = readAIConfig()): AIProvider | null {
  switch (config.provider) {
    case "off":
      return null;
    case "anthropic":
      return createAnthropicProvider({ model: config.model, apiKey: config.apiKey, baseURL: config.baseURL });
    case "openai":
    case "local":
      return createOpenAICompatibleProvider(config);
  }
}
