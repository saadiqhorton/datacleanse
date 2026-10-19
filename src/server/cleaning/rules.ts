/**
 * Built-in rule sets derived from the Upload options, and header-based rule-set matching.
 */

import type { CleanOptions, ColumnStats, InferredType, RuleSpec } from "../types";
import { exactGlob, globMatch } from "./glob";
import { normalizeHeader } from "./text";

/** Name-like headers: "name", "first_name", "company_name", "city"... */
const NAME_WORDS = ["name", "company", "city", "contact"];

interface ColumnInfo {
  header: string;
  norm: string;
  type: InferredType | undefined;
}

function rule(
  id: string,
  columnPattern: string,
  action: RuleSpec["action"],
  params: Record<string, unknown>,
  onLowConfidence: RuleSpec["onLowConfidence"],
  description: string,
): RuleSpec {
  return { id, columnPattern, action, params, onLowConfidence, enabled: true, description };
}

function isNameColumn(norm: string): boolean {
  return NAME_WORDS.some((w) => norm === w || norm.endsWith("_" + w));
}

function isEmailColumn(c: ColumnInfo): boolean {
  return c.type === "email" || c.norm.includes("email") || c.norm.includes("e_mail");
}

function isPhoneColumn(c: ColumnInfo): boolean {
  return (
    c.type === "phone" ||
    c.norm.includes("phone") ||
    c.norm.includes("mobile") ||
    c.norm.includes("telephone") ||
    /(^|_)tel(_|$)/.test(c.norm)
  );
}

function isDateColumn(c: ColumnInfo): boolean {
  return (
    c.type === "date" ||
    globMatch("*date*", c.norm) ||
    globMatch("*_at", c.norm) ||
    c.norm === "dob"
  );
}

/**
 * The built-in rules for the Upload options, one set per column that needs them.
 * Ids look like "builtin:normalize_date:signup_date"; trim and flags apply to all columns.
 * Exact full-row duplicate removal is the dedupe_key rule with `params.exact === true`.
 */
export function rulesFromOptions(opts: CleanOptions, headers: string[], columns?: ColumnStats[]): RuleSpec[] {
  const types = new Map<string, InferredType>();
  for (const c of columns ?? []) types.set(c.name, c.type);

  const seen = new Set<string>();
  const cols: ColumnInfo[] = [];
  for (const header of headers) {
    if (seen.has(header)) continue;
    seen.add(header);
    cols.push({ header, norm: normalizeHeader(header), type: types.get(header) });
  }

  const rules: RuleSpec[] = [];

  if (opts.trimAndCase) {
    rules.push(rule("builtin:trim_whitespace", "*", "trim_whitespace", {}, "apply", "Trim whitespace in all columns"));
    for (const c of cols) {
      if (isNameColumn(c.norm)) {
        rules.push(
          rule(`builtin:title_case:${c.header}`, exactGlob(c.header), "title_case", {}, "apply", `Title case ${c.header}`),
        );
      }
    }
    for (const c of cols) {
      if (isEmailColumn(c)) {
        rules.push(
          rule(`builtin:lowercase:${c.header}`, exactGlob(c.header), "lowercase", {}, "apply", `Lowercase ${c.header}`),
        );
      }
    }
  }

  if (opts.normalizeDates) {
    for (const c of cols) {
      if (isDateColumn(c)) {
        rules.push(
          rule(
            `builtin:normalize_date:${c.header}`,
            exactGlob(c.header),
            "normalize_date",
            { order: opts.dateOrder },
            "review",
            `Normalize ${c.header} to YYYY-MM-DD`,
          ),
        );
      }
    }
  }

  for (const c of cols) {
    if (isPhoneColumn(c)) {
      rules.push(
        rule(`builtin:phone_e164:${c.header}`, exactGlob(c.header), "phone_e164", { defaultCountry: "US" }, "review", `Format ${c.header} as E.164`),
      );
    }
  }

  for (const c of cols) {
    if (c.norm.includes("country")) {
      rules.push(
        rule(
          `builtin:country_names:${c.header}`,
          exactGlob(c.header),
          "country_names",
          { maxDistance: 2 },
          "review",
          `Country codes to names in ${c.header}`,
        ),
      );
    }
  }

  if (opts.dedupe) {
    const email = cols.find(isEmailColumn);
    if (email !== undefined) {
      rules.push(
        rule(
          `builtin:dedupe_key:${email.header}`,
          exactGlob(email.header),
          "dedupe_key",
          { keep: "last" },
          "review",
          `Treat matching ${email.header} as duplicates, keep the newest row`,
        ),
      );
    }
    rules.push(
      rule("builtin:dedupe_exact", "*", "dedupe_key", { exact: true, keep: "last" }, "apply", "Remove exact duplicate rows"),
    );
  }

  if (opts.fillMissing) {
    rules.push(rule("builtin:flag_missing", "*", "flag_missing", {}, "apply", "Flag missing values"));
  }

  return rules;
}

/**
 * The rule set whose headerMatch names all appear in `headers` (case-insensitive).
 * When several match, the one with the most header names wins; ties go to the first.
 */
export function matchRuleSet(
  headers: string[],
  sets: { id: string; headerMatch: string[] }[],
): string | null {
  const present = new Set(headers.map((h) => h.trim().toLowerCase()));
  let bestId: string | null = null;
  let bestSize = 0;
  for (const set of sets) {
    const wanted = new Set(set.headerMatch.map((h) => h.trim().toLowerCase()));
    if (wanted.size === 0) continue;
    let all = true;
    for (const name of wanted) {
      if (!present.has(name)) {
        all = false;
        break;
      }
    }
    if (all && wanted.size > bestSize) {
      bestId = set.id;
      bestSize = wanted.size;
    }
  }
  return bestId;
}
