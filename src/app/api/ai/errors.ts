import type { z } from "zod";
import { AIError, type AIErrorCode } from "@/lib/ai";

const STATUS: Record<AIErrorCode, number> = {
  unreachable: 503,
  auth: 502,
  rate_limited: 429,
  refused: 422,
  invalid_output: 502,
  other: 500,
};

/** Maps any error thrown by the AI layer to a JSON response with a stable code. */
export function aiErrorResponse(err: unknown): Response {
  if (err instanceof AIError) {
    return Response.json({ error: err.message, code: err.code }, { status: STATUS[err.code] });
  }
  // Anything else is an unexpected bug or config problem. Log it, don't leak internals.
  console.error("[ai] unexpected error", err);
  return Response.json({ error: "Unexpected AI error.", code: "other" }, { status: 500 });
}

/** Returned by the AI routes when AI_PROVIDER=off. */
export function aiOffResponse(): Response {
  return Response.json({ error: "AI is turned off. Rules-only mode." }, { status: 409 });
}

/** 400 for a body that is not JSON. */
export function invalidJsonResponse(): Response {
  return Response.json({ error: "Request body must be JSON.", code: "bad_request" }, { status: 400 });
}

/** 400 for a body that fails the route's zod schema. */
export function badRequestResponse(err: z.ZodError): Response {
  return Response.json({ error: "Invalid request.", code: "bad_request", issues: err.issues }, { status: 400 });
}
