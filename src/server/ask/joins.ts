import type { JoinPair } from "./types";
import type { JoinSuggestion } from "../types";

/**
 * Code with string literals and comments removed, so words inside them never count as SQL.
 * Double-quoted identifiers are kept.
 */
export function codeOf(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * The chat aliases a query refers to, in the order given. An alias counts when it appears as a
 * name in the query (FROM, JOIN, or a qualifier such as orders.id). Names are compared without case.
 */
export function referencedAliases(sql: string, aliases: string[]): string[] {
  const names = new Set(
    (codeOf(sql).match(/"[^"]+"|[A-Za-z_][A-Za-z0-9_]*/g) ?? []).map((t) => t.replace(/^"|"$/g, "").toLowerCase()),
  );
  return aliases.filter((alias) => names.has(alias.toLowerCase()));
}

/** True when the query keeps unmatched rows of a join (LEFT, RIGHT or FULL OUTER JOIN). */
export function hasOuterJoin(sql: string): boolean {
  return /\b(left|right|full)\s+(outer\s+)?join\b/i.test(codeOf(sql));
}

export function sameTables(a: string[], b: string[]): boolean {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Same two columns in either direction. */
export function samePair(a: JoinPair, b: JoinPair): boolean {
  const key = (p: JoinPair) =>
    [`${p.left.alias}.${p.left.column}`, `${p.right.alias}.${p.right.column}`].sort().join("|");
  return key(a) === key(b);
}

/** Columns that could join: same name, or one name is the other with a "<stem>_" prefix. */
export function candidateNamesMatch(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.endsWith(`_${y}`) || y.endsWith(`_${x}`);
}

/**
 * Every column pair that could join two of the given tables, for the "Change" picker. Pairs are
 * ordered so the left alias comes first in the list. Capped at `limit`.
 */
export function sharedNameCandidates(
  tables: { alias: string; columns: { name: string }[] }[],
  limit = 60,
): JoinPair[] {
  const out: JoinPair[] = [];
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      for (const a of tables[i].columns) {
        for (const b of tables[j].columns) {
          if (!candidateNamesMatch(a.name, b.name)) continue;
          out.push({
            left: { alias: tables[i].alias, column: a.name },
            right: { alias: tables[j].alias, column: b.name },
            matchRate: null,
          });
          if (out.length >= limit) return out;
        }
      }
    }
  }
  return out;
}

/**
 * The proposed joins among the referenced tables: one per pair of tables. For each pair the direction
 * whose left table has more rows wins (the "many" side reads naturally: "76% of orders match"), then
 * the higher match rate. Highest match rate first.
 */
export function proposedJoins(
  suggestions: JoinSuggestion[],
  referenced: string[],
  rowCounts: Record<string, number> = {},
): JoinPair[] {
  const best = new Map<string, { join: JoinPair; manySide: boolean }>();
  for (const s of suggestions) {
    if (!referenced.includes(s.left.alias) || !referenced.includes(s.right.alias)) continue;
    const key = [s.left.alias, s.right.alias].sort().join("|");
    const manySide = (rowCounts[s.left.alias] ?? 0) >= (rowCounts[s.right.alias] ?? 0);
    const candidate = { join: { left: s.left, right: s.right, matchRate: s.matchRate }, manySide };
    const current = best.get(key);
    if (!current || better(candidate, current)) best.set(key, candidate);
  }
  return [...best.values()].map((v) => v.join).sort((a, b) => (b.matchRate ?? 0) - (a.matchRate ?? 0));
}

function better(
  a: { join: JoinPair; manySide: boolean },
  b: { join: JoinPair; manySide: boolean },
): boolean {
  if (a.manySide !== b.manySide) return a.manySide;
  return (a.join.matchRate ?? 0) > (b.join.matchRate ?? 0);
}

/** Text the planner sees so the query joins on the columns the user confirmed. */
export function withJoinHint(question: string, joins: JoinPair[]): string {
  if (joins.length === 0) return question;
  const on = joins.map((j) => `${j.left.alias}.${j.left.column} = ${j.right.alias}.${j.right.column}`).join(", ");
  return `${question}\n\nWhen a query uses more than one table, join them on: ${on}.`;
}
