import { z } from "zod";
import {
  getAIProvider,
  readAIConfig,
  SAMPLE_ROW_LIMIT,
  suggestFixes,
  type FileProfile,
} from "@/lib/ai";
import { aiErrorResponse, aiOffResponse, badRequestResponse, invalidJsonResponse } from "../errors";

const MAX_COLUMNS = 500;
const MAX_STRING = 1000;

const text = z.string().max(MAX_STRING);

const ColumnSchema = z.object({
  name: text,
  type: text,
  nullCount: z.number().int().nonnegative(),
  distinctCount: z.number().int().nonnegative(),
  topValues: z.array(text).optional(),
});

const FileProfileSchema = z.object({
  fileName: text,
  rowCount: z.number().int().nonnegative(),
  columns: z.array(ColumnSchema).max(MAX_COLUMNS),
  // Drop rows beyond the sample limit before validating them.
  sample: z.preprocess(
    (rows) => (Array.isArray(rows) ? rows.slice(0, SAMPLE_ROW_LIMIT) : rows),
    z.array(z.record(text, text)),
  ),
});

export async function POST(request: Request) {
  try {
    const ai = getAIProvider(readAIConfig());
    if (!ai) return aiOffResponse();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return invalidJsonResponse();
    }

    const parsed = FileProfileSchema.safeParse(body);
    if (!parsed.success) return badRequestResponse(parsed.error);
    const profile: FileProfile = parsed.data;

    const suggestions = await suggestFixes(ai, profile);
    return Response.json({ suggestions });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
