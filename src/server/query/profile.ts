import type { DuckDBConnection } from "@duckdb/node-api";
import type { ColumnProfile, TableProfile } from "../../lib/ai/tasks";
import type { JoinSuggestion, QueryTable } from "../types";
import { openSession, quoteIdent } from "./session";

const TOP_VALUE_COUNT = 10;
const TOP_VALUE_MAX_CHARS = 80;
/** Join suggestions below this share of matching left values are not shown. */
export const MIN_JOIN_MATCH_RATE = 0.5;

/**
 * Row counts, column types, null and distinct counts and most common values for each table.
 * Output has the shape of TableProfile (src/lib/ai/tasks.ts), so it can go to planQuery.
 */
export async function describeTables(tables: QueryTable[]): Promise<TableProfile[]> {
  const session = await openSession(tables);
  try {
    const profiles: TableProfile[] = [];
    for (const table of tables) {
      profiles.push({
        alias: table.alias,
        rowCount: session.rowCounts.get(table.alias) ?? 0,
        columns: await profileColumns(session.connection, table.alias),
      });
    }
    return profiles;
  } finally {
    session.close();
  }
}

/**
 * Suggests join keys between every ordered pair of tables. Candidate column pairs have the
 * same name, or one name is the other with a "<stem>_" prefix (customer_email <-> email,
 * order_id <-> id). matchRate is the share of non-null left values found in the right column.
 * Keeps the best candidate per direction with matchRate >= 0.5, highest rate first.
 */
export async function suggestJoins(tables: QueryTable[]): Promise<JoinSuggestion[]> {
  if (tables.length < 2) return [];
  const session = await openSession(tables);
  try {
    const conn = session.connection;
    const columns = new Map<string, string[]>();
    for (const table of tables) {
      columns.set(table.alias, (await listColumns(conn, table.alias)).map((c) => c.name));
    }

    const suggestions: JoinSuggestion[] = [];
    for (const left of tables) {
      for (const right of tables) {
        if (left.alias === right.alias) continue;
        const best = await bestJoinFor(conn, left.alias, columns.get(left.alias) ?? [], right.alias, columns.get(right.alias) ?? []);
        if (best && best.rate >= MIN_JOIN_MATCH_RATE) {
          suggestions.push({
            left: { alias: left.alias, column: best.leftColumn },
            right: { alias: right.alias, column: best.rightColumn },
            matchRate: roundRate(best.rate),
          });
        }
      }
    }
    suggestions.sort(
      (a, b) =>
        b.matchRate - a.matchRate ||
        a.left.alias.localeCompare(b.left.alias) ||
        a.right.alias.localeCompare(b.right.alias),
    );
    return suggestions;
  } finally {
    session.close();
  }
}

/**
 * Number of left rows with no match in the right table: a NULL key, or a value not found on the
 * right. (matchRate ignores NULL keys; this count does not.)
 */
export async function unmatchedCount(tables: QueryTable[], join: JoinSuggestion): Promise<number> {
  const session = await openSession(tables);
  try {
    const conn = session.connection;
    const leftAlias = join.left.alias;
    const rightAlias = join.right.alias;
    if (!session.rowCounts.has(leftAlias)) throw new Error(`Unknown table "${leftAlias}".`);
    if (!session.rowCounts.has(rightAlias)) throw new Error(`Unknown table "${rightAlias}".`);
    await requireColumn(conn, leftAlias, join.left.column);
    await requireColumn(conn, rightAlias, join.right.column);

    const l = quoteIdent(join.left.column);
    const r = quoteIdent(join.right.column);
    const reader = await conn.runAndReadAll(
      `SELECT COUNT(*) FILTER (WHERE ${l} IS NULL OR CAST(${l} AS VARCHAR) NOT IN ` +
        `(SELECT CAST(${r} AS VARCHAR) FROM ${quoteIdent(rightAlias)} WHERE ${r} IS NOT NULL)) AS n ` +
        `FROM ${quoteIdent(leftAlias)}`,
    );
    return Number(reader.getRowsJS()[0][0]);
  } finally {
    session.close();
  }
}

interface ColumnInfo {
  name: string;
  type: string;
}

async function listColumns(conn: DuckDBConnection, alias: string): Promise<ColumnInfo[]> {
  const reader = await conn.runAndReadAll(`DESCRIBE ${quoteIdent(alias)}`);
  return reader.getRowObjectsJS().map((row) => ({
    name: String(row.column_name),
    type: String(row.column_type),
  }));
}

async function requireColumn(conn: DuckDBConnection, alias: string, column: string): Promise<void> {
  const columns = await listColumns(conn, alias);
  if (!columns.some((c) => c.name === column)) throw new Error(`Unknown column "${column}" in "${alias}".`);
}

async function profileColumns(conn: DuckDBConnection, alias: string): Promise<ColumnProfile[]> {
  const columns = await listColumns(conn, alias);
  if (columns.length === 0) return [];
  const table = quoteIdent(alias);

  // One pass for null and distinct counts across all columns.
  const selects = columns
    .map((c, i) => {
      const col = quoteIdent(c.name);
      return `COUNT(*) FILTER (WHERE ${col} IS NULL) AS n${i}, COUNT(DISTINCT ${col}) AS d${i}`;
    })
    .join(", ");
  const counts = (await conn.runAndReadAll(`SELECT ${selects} FROM ${table}`)).getRowsJS()[0];

  const profiles: ColumnProfile[] = [];
  for (let i = 0; i < columns.length; i++) {
    const col = quoteIdent(columns[i].name);
    // Positional GROUP BY / ORDER BY so a column named "v" or "n" cannot clash with the aliases.
    const top = await conn.runAndReadAll(
      `SELECT CAST(${col} AS VARCHAR) AS v, COUNT(*) AS n FROM ${table} ` +
        `WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${TOP_VALUE_COUNT}`,
    );
    profiles.push({
      name: columns[i].name,
      type: columns[i].type,
      nullCount: Number(counts[i * 2]),
      distinctCount: Number(counts[i * 2 + 1]),
      topValues: top
        .getRowsJS()
        .map((row) => String(row[0]).slice(0, TOP_VALUE_MAX_CHARS)),
    });
  }
  return profiles;
}

interface BestJoin {
  leftColumn: string;
  rightColumn: string;
  rate: number;
}

async function bestJoinFor(
  conn: DuckDBConnection,
  leftAlias: string,
  leftColumns: string[],
  rightAlias: string,
  rightColumns: string[],
): Promise<BestJoin | null> {
  const candidates: { left: string; right: string; rank: number }[] = [];
  for (const left of leftColumns) {
    for (const right of rightColumns) {
      const rank = pairRank(left, right, leftAlias, rightAlias);
      if (rank !== null) candidates.push({ left, right, rank });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank);

  let best: BestJoin | null = null;
  for (const candidate of candidates) {
    const rate = await matchRate(conn, leftAlias, candidate.left, rightAlias, candidate.right);
    // Strictly better only, so on a tie the lower-ranked (more specific) candidate wins.
    if (best === null || rate > best.rate) {
      best = { leftColumn: candidate.left, rightColumn: candidate.right, rate };
    }
  }
  return best;
}

/**
 * 0 = same name. 1 = "<entity>_id" against the "id" of that table (orders.id <-> line_items.order_id).
 * 2 = one name is "<stem>_" plus the other (customer_email <-> email). "id" is only matched by
 * rule 0 or 1, so a stray "x_id" column does not pair with every "id" in the other table.
 */
function pairRank(left: string, right: string, leftAlias: string, rightAlias: string): number | null {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a === b) return 0;
  if (b === "id" && entityNames(rightAlias).some((n) => a === `${n}_id`)) return 1;
  if (a === "id" && entityNames(leftAlias).some((n) => b === `${n}_id`)) return 1;
  if (a === "id" || b === "id") return null;
  if (a.endsWith(`_${b}`) || b.endsWith(`_${a}`)) return 2;
  return null;
}

function singular(alias: string): string {
  if (alias.endsWith("ies")) return `${alias.slice(0, -3)}y`;
  if (alias.endsWith("s")) return alias.slice(0, -1);
  return alias;
}

/**
 * Names a table may go by in a "<name>_id" column: its singular alias and each trailing part of it,
 * so "orders" gives "order", and a file named "ca_orders.csv" (alias "ca_orders") gives "ca_order" and "order".
 */
function entityNames(alias: string): string[] {
  const parts = singular(alias).split("_");
  return parts.map((_, i) => parts.slice(i).join("_"));
}

async function matchRate(
  conn: DuckDBConnection,
  leftAlias: string,
  leftColumn: string,
  rightAlias: string,
  rightColumn: string,
): Promise<number> {
  const l = quoteIdent(leftColumn);
  const r = quoteIdent(rightColumn);
  const reader = await conn.runAndReadAll(
    `SELECT COUNT(*) FILTER (WHERE CAST(${l} AS VARCHAR) IN ` +
      `(SELECT CAST(${r} AS VARCHAR) FROM ${quoteIdent(rightAlias)} WHERE ${r} IS NOT NULL)) AS matched, ` +
      `COUNT(*) AS total FROM ${quoteIdent(leftAlias)} WHERE ${l} IS NOT NULL`,
  );
  const [matched, total] = reader.getRowsJS()[0];
  const totalCount = Number(total);
  return totalCount === 0 ? 0 : Number(matched) / totalCount;
}

function roundRate(rate: number): number {
  return Math.round(rate * 10_000) / 10_000;
}
