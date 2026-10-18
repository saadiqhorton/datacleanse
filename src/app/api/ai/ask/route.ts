import { z } from "zod";
import { getAIProvider, planQuery, readAIConfig, type TableProfile } from "@/lib/ai";
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

const TableProfileSchema = z.object({
  alias: text,
  rowCount: z.number().int().nonnegative(),
  columns: z.array(ColumnSchema).max(MAX_COLUMNS),
});

const AskBodySchema = z.object({
  question: z.string().trim().min(1).max(2000),
  tables: z.array(TableProfileSchema),
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

    const parsed = AskBodySchema.safeParse(body);
    if (!parsed.success) return badRequestResponse(parsed.error);
    const { question, tables }: { question: string; tables: TableProfile[] } = parsed.data;

    const plan = await planQuery(ai, question, tables);
    return Response.json(plan);
  } catch (err) {
    return aiErrorResponse(err);
  }
}
