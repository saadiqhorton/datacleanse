import type { z } from "zod";
import type { ProviderId } from "./config";

export interface GenerateObjectRequest<T extends z.ZodType> {
  system: string;
  prompt: string;
  schema: T;
  /** Short identifier for the schema, required by OpenAI-compatible json_schema. */
  schemaName: string;
  maxTokens?: number;
}

export interface AIProvider {
  id: Exclude<ProviderId, "off">;
  model: string;
  /** Generate a JSON object validated against `schema`. Throws AIError on failure. */
  generateObject<T extends z.ZodType>(req: GenerateObjectRequest<T>): Promise<z.infer<T>>;
  /** Cheap reachability check for the settings page. */
  check(): Promise<{ ok: true } | { ok: false; error: string }>;
}

export type AIErrorCode = "unreachable" | "auth" | "refused" | "invalid_output" | "rate_limited" | "other";

export class AIError extends Error {
  constructor(
    public code: AIErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AIError";
  }
}
