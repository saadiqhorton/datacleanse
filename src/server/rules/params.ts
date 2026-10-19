/**
 * Rule actions as the Rules screen and the rule store see them: friendly labels, the params each
 * action takes (zod schemas that fill defaults and drop unknown keys), and plain-English descriptions.
 * Pure: no database, so client components can import it too.
 */

import { z } from "zod";
import type { RuleAction, RuleSpec } from "../types";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const ACTION_LABELS: Record<RuleAction, string> = {
  normalize_date: "Normalize dates",
  trim_whitespace: "Trim whitespace",
  title_case: "Title case",
  lowercase: "Lowercase",
  phone_e164: "Format phone numbers",
  dedupe_key: "Find duplicates",
  country_names: "Country names",
  map_values: "Replace values from a list",
  fix_typos: "Fix typos",
  flag_missing: "Flag empty cells",
};

export const RULE_ACTIONS = Object.keys(ACTION_LABELS) as [RuleAction, ...RuleAction[]];

export function isRuleAction(value: unknown): value is RuleAction {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ACTION_LABELS, value);
}

export const DATE_ORDER_LABELS = {
  auto: "Detect for each column",
  mdy: "Month first (MM/DD)",
  dmy: "Day first (DD/MM)",
} as const;
export type DateOrder = keyof typeof DATE_ORDER_LABELS;

export const KEEP_LABELS = { last: "Keep the last row", first: "Keep the first row" } as const;
export type KeepRow = keyof typeof KEEP_LABELS;

export const LOW_CONFIDENCE_LABELS = { review: "Ask for review", apply: "Apply it", skip: "Skip it" } as const;
export type LowConfidence = keyof typeof LOW_CONFIDENCE_LABELS;

export const MAX_DISTANCE = 3;
export const DEFAULT_DISTANCE = 2;
export const MAX_MAP_ENTRIES = 500;

const DISTANCE_MESSAGE = "Typo tolerance must be a whole number from 0 to 3.";
const MAP_EMPTY_MESSAGE = "Add at least one old value and its new value.";

/** A rule's params after defaults are filled in. Shared by the form, the list and the pipeline. */
export interface ReadParams {
  order: DateOrder;
  defaultCountry: string;
  keep: KeepRow;
  maxDistance: number;
  map: Record<string, string>;
  caseInsensitive: boolean;
}

/** A rule as the screen shows it: the pipeline's RuleSpec plus its set and position. */
export interface RuleView extends RuleSpec {
  ruleSetId: string;
  position: number;
}

const countryCode = z
  .string({ error: "Enter a two-letter country code, such as US." })
  .trim()
  .regex(/^[A-Za-z]{2}$/, "Use a two-letter country code, such as US.")
  .transform((s) => s.toUpperCase());

const distance = z
  .number({ error: DISTANCE_MESSAGE })
  .int(DISTANCE_MESSAGE)
  .min(0, DISTANCE_MESSAGE)
  .max(3, DISTANCE_MESSAGE);

const mapEntries = z
  .record(
    z.string().max(200, "Keep each old value under 200 characters."),
    z.string({ error: "Each new value must be text." }).max(200, "Keep each new value under 200 characters."),
    { error: MAP_EMPTY_MESSAGE },
  )
  .superRefine((m, ctx) => {
    const keys = Object.keys(m);
    if (keys.length === 0) ctx.addIssue({ code: "custom", message: MAP_EMPTY_MESSAGE });
    else if (keys.some((k) => k.trim() === "")) ctx.addIssue({ code: "custom", message: "Each old value needs text." });
    else if (keys.length > MAX_MAP_ENTRIES) {
      ctx.addIssue({ code: "custom", message: `Use at most ${MAX_MAP_ENTRIES} replacements.` });
    }
  });

type ParamSchema = z.ZodType<Record<string, unknown>>;

const PARAM_SCHEMAS: Record<RuleAction, ParamSchema> = {
  normalize_date: z.object({
    order: z.enum(["auto", "mdy", "dmy"], { error: "Choose how day and month are ordered." }).default("auto"),
  }),
  phone_e164: z.object({ defaultCountry: countryCode.default("US") }),
  dedupe_key: z.object({
    keep: z.enum(["first", "last"], { error: "Choose which duplicate to keep." }).default("last"),
  }),
  country_names: z.object({ maxDistance: distance.default(DEFAULT_DISTANCE) }),
  fix_typos: z.object({ maxDistance: distance.default(DEFAULT_DISTANCE) }),
  map_values: z.object({
    map: mapEntries,
    caseInsensitive: z.boolean({ error: "Ignore case is on or off." }).default(false),
  }),
  trim_whitespace: z.object({}),
  title_case: z.object({}),
  lowercase: z.object({}),
  flag_missing: z.object({}),
};

/** Validates params for an action. Unknown keys are dropped and missing ones take their defaults. */
export function parseRuleParams(action: unknown, raw: unknown): Parsed<Record<string, unknown>> {
  if (!isRuleAction(action)) return { ok: false, error: "Choose an action." };
  const result = PARAM_SCHEMAS[action].safeParse(raw ?? {});
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? "Check the rule's settings." };
  }
  return { ok: true, value: result.data };
}

/**
 * Params as stored in rules.params_json. Unreadable JSON falls back to the action's defaults. An action
 * whose params cannot be defaulted (map_values without a valid map) gets {}.
 */
export function parseStoredParams(action: unknown, json: string): Record<string, unknown> {
  let raw: unknown = {};
  try {
    raw = JSON.parse(json);
  } catch {
    raw = {};
  }
  const parsed = parseRuleParams(action, raw);
  if (parsed.ok) return parsed.value;
  const defaults = parseRuleParams(action, {});
  return defaults.ok ? defaults.value : {};
}

/** Typed view of a params object, with defaults for anything missing. */
export function readParams(params: Record<string, unknown>): ReadParams {
  const order = params.order;
  const keep = params.keep;
  const map: Record<string, string> = {};
  if (params.map !== null && typeof params.map === "object" && !Array.isArray(params.map)) {
    for (const [k, v] of Object.entries(params.map as Record<string, unknown>)) {
      if (typeof v === "string") map[k] = v;
    }
  }
  return {
    order: order === "mdy" || order === "dmy" ? order : "auto",
    defaultCountry: typeof params.defaultCountry === "string" ? params.defaultCountry : "US",
    keep: keep === "first" ? "first" : "last",
    maxDistance: typeof params.maxDistance === "number" ? params.maxDistance : DEFAULT_DISTANCE,
    map,
    caseInsensitive: params.caseInsensitive === true,
  };
}

const DATE_ORDER_TEXT: Record<DateOrder, string> = {
  auto: "day/month order detected per column",
  mdy: "month first",
  dmy: "day first",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Short description for a rule that has none of its own. Written once, when the rule is saved. */
export function ruleSummary(action: RuleAction, params: Record<string, unknown>): string {
  const p = readParams(params);
  switch (action) {
    case "normalize_date":
      return `Normalize to YYYY-MM-DD, ${DATE_ORDER_TEXT[p.order]}`;
    case "trim_whitespace":
      return "Trim whitespace, collapse double spaces";
    case "title_case":
      return "Title case, strip trailing punctuation";
    case "lowercase":
      return "Lowercase";
    case "phone_e164":
      return `Format as E.164, default country ${p.defaultCountry}`;
    case "dedupe_key":
      return `Treat matching values as duplicates, keep the ${p.keep} row`;
    case "country_names":
      return "Country codes to English names, fix typos";
    case "map_values":
      return `Replace ${plural(Object.keys(p.map).length, "listed value")}`;
    case "fix_typos":
      return "Snap rare typos to the common spelling";
    case "flag_missing":
      return "Flag empty cells for review";
  }
}

/** The lines the Rules screen shows under "Draft rule", in the same order as the design. */
export interface RuleLines {
  column: string;
  does: string;
  /** Only for actions that fix typos. */
  typos: string | null;
  lowConfidence: string;
}

export function describeRule(spec: Pick<RuleSpec, "columnPattern" | "action" | "params" | "onLowConfidence">): RuleLines {
  const p = readParams(spec.params);
  let does: string;
  let typos: string | null = null;
  switch (spec.action) {
    case "normalize_date":
      does = `normalize dates to YYYY-MM-DD (${DATE_ORDER_TEXT[p.order]})`;
      break;
    case "trim_whitespace":
      does = "trim whitespace and collapse double spaces";
      break;
    case "title_case":
      does = "title-case text and strip trailing punctuation";
      break;
    case "lowercase":
      does = "lowercase text";
      break;
    case "phone_e164":
      does = `format phone numbers as E.164, default country ${p.defaultCountry}`;
      break;
    case "dedupe_key":
      does = `treat matching values as duplicates, keep the ${p.keep} row`;
      break;
    case "country_names":
      does = "map ISO-3166 codes → English names";
      typos = `edit distance ${p.maxDistance}`;
      break;
    case "map_values":
      does = `replace ${plural(Object.keys(p.map).length, "listed value")} with new ones`;
      break;
    case "fix_typos":
      does = "snap rare values to a frequent value they are close to";
      typos = `edit distance ${p.maxDistance}`;
      break;
    case "flag_missing":
      does = "flag empty cells without editing them";
      break;
  }
  return {
    column: spec.columnPattern,
    does,
    typos,
    lowConfidence: LOW_CONFIDENCE_LABELS[spec.onLowConfidence].toLowerCase(),
  };
}
