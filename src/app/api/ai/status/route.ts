import { connection } from "next/server";
import { getAIProvider, isLocal, readAIConfig } from "@/lib/ai";
import { aiErrorResponse } from "../errors";

export async function GET() {
  // Config comes from env and the provider is checked live, so this must run per request.
  // Waiting on connection() keeps the route out of prerendering.
  await connection();

  try {
    const config = readAIConfig();
    if (config.provider === "off") {
      return Response.json({ provider: "off", ok: true });
    }

    const provider = getAIProvider(config);
    if (!provider) {
      return Response.json({ provider: "off", ok: true });
    }

    // Never include config.apiKey in the response.
    const check = await provider.check();
    return Response.json({
      provider: config.provider,
      model: config.model,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      local: isLocal(config),
      ok: check.ok,
      ...(check.ok ? {} : { error: check.error }),
    });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
