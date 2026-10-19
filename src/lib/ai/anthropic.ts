import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { AIError, type AIProvider, type GenerateObjectRequest } from "./types";

export interface AnthropicProviderOptions {
  model: string;
  /** Explicit key (e.g. a user's own key or an admin-set key). Omit to use the env/profile default. */
  apiKey?: string;
  /** Custom Anthropic-compatible endpoint. Omit for api.anthropic.com. */
  baseURL?: string;
}

/**
 * Accepts a bare model id (the original signature) or explicit options.
 * Without an apiKey the SDK resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
 */
export function createAnthropicProvider(options: string | AnthropicProviderOptions): AIProvider {
  const { model, apiKey, baseURL } =
    typeof options === "string" ? { model: options, apiKey: undefined, baseURL: undefined } : options;
  const client = new Anthropic({
    ...(apiKey ? { apiKey } : {}),
    ...(baseURL ? { baseURL } : {}),
  });

  return {
    id: "anthropic",
    model,

    async generateObject<T extends z.ZodType>(req: GenerateObjectRequest<T>) {
      let response;
      try {
        response = await client.beta.messages.parse({
          model,
          max_tokens: req.maxTokens ?? 16000,
          system: req.system,
          messages: [{ role: "user", content: req.prompt }],
          output_config: { effort: "medium", format: betaZodOutputFormat(req.schema) },
          // On a policy decline, retry server-side on the model's default fallback.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        });
      } catch (err) {
        throw toAIError(err);
      }

      if (response.stop_reason === "refusal") {
        throw new AIError("refused", "The model declined this request.");
      }
      if (response.stop_reason === "max_tokens") {
        throw new AIError("invalid_output", "The model's answer was cut off (max_tokens).");
      }
      if (response.parsed_output == null) {
        throw new AIError("invalid_output", "The model's answer did not match the expected format.");
      }
      return response.parsed_output as z.infer<T>;
    },

    async check() {
      try {
        await client.models.retrieve(model);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: toAIError(err).message };
      }
    },
  };
}

function toAIError(err: unknown): AIError {
  if (err instanceof AIError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AIError("auth", "Anthropic rejected the API key.", { cause: err });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AIError("rate_limited", "Anthropic rate limit reached. Try again shortly.", { cause: err });
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AIError("other", "Model not found. Check AI_MODEL.", { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AIError("unreachable", "Could not reach the Anthropic API.", { cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    return new AIError("other", `Anthropic API error ${err.status ?? ""}: ${err.message}`, { cause: err });
  }
  return new AIError("other", err instanceof Error ? err.message : String(err), { cause: err });
}
