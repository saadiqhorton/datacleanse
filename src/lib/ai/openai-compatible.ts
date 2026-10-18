import { z } from "zod";
import type { AIConfig } from "./config";
import { AIError, type AIProvider, type GenerateObjectRequest } from "./types";

/**
 * Any server that speaks the OpenAI Chat Completions API: Ollama, LM Studio,
 * llama.cpp, vLLM locally, or OpenAI / OpenRouter / Groq in the cloud.
 * Uses `response_format: json_schema` and always re-validates with zod, since
 * smaller local models don't all enforce the schema.
 */
export function createOpenAICompatibleProvider(config: AIConfig): AIProvider {
  const { baseURL, apiKey, model } = config;
  const id = config.provider === "openai" ? "openai" : "local";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  async function call(path: string, init?: RequestInit) {
    let res: Response;
    try {
      res = await fetch(`${baseURL}${path}`, { ...init, headers });
    } catch (err) {
      throw new AIError(
        "unreachable",
        id === "local"
          ? `Could not reach the local model server at ${baseURL}. Is Ollama or LM Studio running?`
          : `Could not reach ${baseURL}.`,
        { cause: err },
      );
    }
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new AIError("auth", "The model server rejected the API key (AI_API_KEY).");
    }
    if (res.status === 429) throw new AIError("rate_limited", "Rate limit reached. Try again shortly.");
    if (res.status === 404) throw new AIError("other", `Model "${model}" or endpoint not found at ${baseURL}.`);
    throw new AIError("other", `Model server error ${res.status}: ${body.slice(0, 300)}`);
  }

  return {
    id,
    model,

    async generateObject<T extends z.ZodType>(req: GenerateObjectRequest<T>) {
      const res = await call("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens ?? 4096,
          temperature: 0,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: req.schemaName, strict: true, schema: z.toJSONSchema(req.schema) },
          },
        }),
      });
      const data = (await res.json()) as {
        choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
      };
      const choice = data.choices?.[0];
      if (choice?.message?.refusal) throw new AIError("refused", "The model declined this request.");
      if (choice?.finish_reason === "length") {
        throw new AIError("invalid_output", "The model's answer was cut off (max_tokens).");
      }
      const text = choice?.message?.content ?? "";

      let json: unknown;
      try {
        json = JSON.parse(stripCodeFence(text));
      } catch (err) {
        throw new AIError("invalid_output", "The model did not return valid JSON.", { cause: err });
      }
      const parsed = req.schema.safeParse(json);
      if (!parsed.success) {
        throw new AIError("invalid_output", "The model's answer did not match the expected format.", {
          cause: parsed.error,
        });
      }
      return parsed.data;
    },

    async check() {
      try {
        await call("/models");
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/** Some local models wrap JSON in ```json fences despite response_format. */
function stripCodeFence(text: string) {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : text;
}
