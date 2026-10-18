import { z } from "zod";
import { AIError, type AIProvider } from "./types";

/**
 * What the AI is allowed to see about a file: column names, summary statistics
 * and a small sample. Never the full file (see "What the AI saw" on Review).
 */
export const SAMPLE_ROW_LIMIT = 20;

export interface ColumnProfile {
  name: string;
  type: string;
  nullCount: number;
  distinctCount: number;
  /** Most common values, already truncated by the caller. */
  topValues?: string[];
}

export interface FileProfile {
  fileName: string;
  rowCount: number;
  columns: ColumnProfile[];
  sample: Record<string, string>[];
}

export const FixSuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      row: z.number().int().describe("1-based row number within the sample"),
      column: z.string(),
      before: z.string(),
      after: z.string(),
      reason: z.string().describe("Short, plain-language reason, e.g. 'Likely typo'"),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type FixSuggestion = z.infer<typeof FixSuggestionsSchema>["suggestions"][number];

export async function suggestFixes(ai: AIProvider, profile: FileProfile): Promise<FixSuggestion[]> {
  const result = await ai.generateObject({
    schemaName: "fix_suggestions",
    schema: FixSuggestionsSchema,
    system:
      "You review CSV data for a data-cleaning tool. Deterministic rules already handle date formats, " +
      "whitespace, casing and phone formats. Suggest fixes only for ambiguous values those rules can't " +
      "decide: likely typos, inconsistent category labels, values in the wrong column. Every suggestion " +
      "is shown to a person who approves or skips it, so give an honest confidence and skip anything " +
      "you are unsure is wrong. Return an empty list when nothing needs fixing.",
    prompt: JSON.stringify({
      file: profile.fileName,
      rowCount: profile.rowCount,
      columns: profile.columns,
      sample: profile.sample.slice(0, SAMPLE_ROW_LIMIT),
    }),
  });
  return result.suggestions;
}

export const QueryPlanSchema = z.object({
  sql: z.string().describe("One read-only SELECT statement (WITH ... SELECT allowed)"),
  explanation: z.string().describe("One or two sentences on how the query answers the question"),
});
export type QueryPlan = z.infer<typeof QueryPlanSchema>;

export interface TableProfile {
  alias: string;
  rowCount: number;
  columns: ColumnProfile[];
}

/** Ask your data: the AI writes a query; the app runs it on every row. */
export async function planQuery(
  ai: AIProvider,
  question: string,
  tables: TableProfile[],
): Promise<QueryPlan> {
  const plan = await ai.generateObject({
    schemaName: "query_plan",
    schema: QueryPlanSchema,
    system:
      "You translate questions about CSV files into a single read-only SQL query (DuckDB dialect). " +
      "Each file is a table named by its alias. You only see column names, types and summary " +
      "statistics, so never put literal answers in the query; the numbers must come from running it.",
    prompt: JSON.stringify({ question, tables }),
  });
  assertReadOnly(plan.sql);
  return plan;
}

const WRITE_KEYWORDS =
  /\b(insert|update|delete|merge|drop|create|alter|truncate|attach|detach|copy|export|import|install|load|pragma|set|call)\b/i;

/** Defence in depth: the query runner should also use a read-only connection. */
export function assertReadOnly(sql: string) {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (trimmed.includes(";")) throw new AIError("invalid_output", "Query must be a single statement.");
  if (!/^(select|with)\b/i.test(trimmed)) throw new AIError("invalid_output", "Query must be a SELECT.");
  if (WRITE_KEYWORDS.test(trimmed)) throw new AIError("invalid_output", "Query must be read-only.");
}
