/**
 * Validation for rule input, and conversion between the editor's fields and a rule's params.
 * Pure: the client uses it to build the form, and the server re-validates everything it receives.
 */

import { z } from "zod";
import type { RuleAction } from "../types";
import {
  DEFAULT_DISTANCE,
  LOW_CONFIDENCE_LABELS,
  RULE_ACTIONS,
  readParams,
  parseRuleParams,
  ruleSummary,
  type DateOrder,
  type KeepRow,
  type LowConfidence,
  type Parsed,
  type RuleView,
} from "./params";

/** Editor state. Numbers stay as text until they are validated. */
export interface RuleFields {
  action: RuleAction;
  columnPattern: string;
  onLowConfidence: LowConfidence;
  description: string;
  order: DateOrder;
  defaultCountry: string;
  keep: KeepRow;
  maxDistance: string;
  mapText: string;
  caseInsensitive: boolean;
}

export interface RuleInput {
  columnPattern: string;
  action: RuleAction;
  onLowConfidence: LowConfidence;
  description: string;
  params: Record<string, unknown>;
}

const CONTROL_CHARS = /\p{Cc}/u;
const ARROW = /\s*(->|→)\s*/;

export function emptyRuleFields(): RuleFields {
  return {
    action: "normalize_date",
    columnPattern: "",
    onLowConfidence: "review",
    description: "",
    order: "auto",
    defaultCountry: "US",
    keep: "last",
    maxDistance: String(DEFAULT_DISTANCE),
    mapText: "",
    caseInsensitive: false,
  };
}

/** Editor state for an existing rule, so Edit starts from what is saved. */
export function fieldsFromRule(rule: RuleView): RuleFields {
  const p = readParams(rule.params);
  return {
    action: rule.action,
    columnPattern: rule.columnPattern,
    onLowConfidence: rule.onLowConfidence,
    description: rule.description,
    order: p.order,
    defaultCountry: p.defaultCountry,
    keep: p.keep,
    maxDistance: String(p.maxDistance),
    mapText: formatMapText(p.map),
    caseInsensitive: p.caseInsensitive,
  };
}

/** Parses "old value -> new value" lines, one per line. Blank lines are ignored. */
export function parseMapText(text: string): Parsed<Record<string, string>> {
  const pairs = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    const arrow = ARROW.exec(line);
    if (arrow === null) {
      return { ok: false, error: `Line ${i + 1} needs the form "old value -> new value".` };
    }
    const from = line.slice(0, arrow.index).trim();
    const to = line.slice(arrow.index + arrow[0].length).trim();
    if (from === "") return { ok: false, error: `Line ${i + 1} is missing the old value.` };
    if (pairs.has(from)) return { ok: false, error: `"${from}" is listed more than once.` };
    pairs.set(from, to);
  }
  if (pairs.size === 0) return { ok: false, error: "Add at least one line like old value -> new value." };
  return { ok: true, value: Object.fromEntries(pairs) };
}

export function formatMapText(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([from, to]) => `${from} -> ${to}`)
    .join("\n");
}

/** The editor's fields as the params object its action takes. Validation errors are shown to the user. */
export function paramsFromFields(fields: RuleFields): Parsed<Record<string, unknown>> {
  switch (fields.action) {
    case "normalize_date":
      return parseRuleParams(fields.action, { order: fields.order });
    case "phone_e164":
      return parseRuleParams(fields.action, { defaultCountry: fields.defaultCountry });
    case "dedupe_key":
      return parseRuleParams(fields.action, { keep: fields.keep });
    case "country_names":
    case "fix_typos":
      return parseRuleParams(fields.action, {
        maxDistance: fields.maxDistance.trim() === "" ? Number.NaN : Number(fields.maxDistance),
      });
    case "map_values": {
      const map = parseMapText(fields.mapText);
      if (!map.ok) return map;
      return parseRuleParams(fields.action, { map: map.value, caseInsensitive: fields.caseInsensitive });
    }
    default:
      return parseRuleParams(fields.action, {});
  }
}

const baseSchema = z.object({
  columnPattern: z
    .string({ error: "Enter the column name or pattern to match." })
    .trim()
    .min(1, "Enter the column name or pattern to match.")
    .max(100, "Keep the column pattern under 100 characters.")
    .refine((s) => !CONTROL_CHARS.test(s), "Column patterns can't contain line breaks."),
  action: z.enum(RULE_ACTIONS, { error: "Choose an action." }),
  onLowConfidence: z
    .enum(Object.keys(LOW_CONFIDENCE_LABELS) as [LowConfidence, ...LowConfidence[]], {
      error: "Choose what to do on low confidence.",
    })
    .default("review"),
  description: z.string().trim().max(200, "Keep the description under 200 characters.").default(""),
});

/**
 * Validates a rule from untrusted input. `raw.params` is the action's params object. An empty
 * description is replaced by a summary of the action.
 */
export function parseRuleInput(raw: unknown): Parsed<RuleInput> {
  const base = baseSchema.safeParse(raw);
  if (!base.success) {
    return { ok: false, error: base.error.issues[0]?.message ?? "Check the rule and try again." };
  }
  const params = parseRuleParams(base.data.action, (raw as { params?: unknown }).params);
  if (!params.ok) return params;
  const { action, columnPattern, onLowConfidence, description } = base.data;
  return {
    ok: true,
    value: {
      columnPattern,
      action,
      onLowConfidence,
      description: description || ruleSummary(action, params.value),
      params: params.value,
    },
  };
}

const SET_NAME_MAX = 80;
const HEADER_MAX = 100;

/** A rule set name: trimmed, 1 to 80 characters, no line breaks. */
export function parseSetName(raw: unknown): Parsed<string> {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name === "") return { ok: false, error: "Give the rule set a name." };
  if (name.length > SET_NAME_MAX) return { ok: false, error: `Keep the name under ${SET_NAME_MAX} characters.` };
  if (CONTROL_CHARS.test(name)) return { ok: false, error: "The name can't contain line breaks." };
  return { ok: true, value: name };
}

/** A header name a rule set matches on: trimmed, 1 to 100 characters. */
export function parseHeaderName(raw: unknown): Parsed<string> {
  const header = typeof raw === "string" ? raw.trim() : "";
  if (header === "") return { ok: false, error: "Enter a header name." };
  if (header.length > HEADER_MAX) return { ok: false, error: `Keep header names under ${HEADER_MAX} characters.` };
  if (CONTROL_CHARS.test(header)) return { ok: false, error: "Header names can't contain line breaks." };
  return { ok: true, value: header };
}
