import fs from "node:fs";
import path from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import type { QueryTable } from "../types";

/** Table aliases become SQL identifiers, so only a conservative shape is accepted. */
export const ALIAS_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/** Double-quoted SQL identifier. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Single-quoted SQL string literal. */
export function sqlString(value: string): string {
  if (value.includes("\0")) throw new Error("SQL string literals cannot contain NUL bytes.");
  return `'${value.replace(/'/g, "''")}'`;
}

/** Checks the table list before any file is opened. Throws plain Errors: these are caller bugs, not user SQL. */
export function validateTables(tables: QueryTable[]): void {
  if (tables.length === 0) throw new Error("At least one table is required.");
  const seen = new Set<string>();
  for (const table of tables) {
    if (!ALIAS_PATTERN.test(table.alias)) {
      throw new Error(`Invalid table alias "${table.alias}". Use lowercase letters, digits and underscores.`);
    }
    if (seen.has(table.alias)) throw new Error(`Duplicate table alias "${table.alias}".`);
    seen.add(table.alias);
    if (!path.isAbsolute(table.path) || table.path.includes("\0")) {
      throw new Error(`Table "${table.alias}" needs an absolute file path.`);
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(table.path);
    } catch {
      throw new Error(`Table "${table.alias}" file does not exist.`);
    }
    if (!stat.isFile()) throw new Error(`Table "${table.alias}" is not a file.`);
  }
}

export interface Session {
  connection: DuckDBConnection;
  /** Exact row count of each loaded table, keyed by alias. */
  rowCounts: Map<string, number>;
  close(): void;
}

/**
 * Fresh in-memory DuckDB with every CSV loaded as a table, then external access and
 * configuration locked. After this, SQL can only read the loaded tables.
 *
 * `onConnect` receives the connection as soon as it exists, so a caller can interrupt
 * a slow CSV load.
 */
export async function openSession(
  tables: QueryTable[],
  onConnect?: (connection: DuckDBConnection) => void,
): Promise<Session> {
  validateTables(tables);
  const instance = await DuckDBInstance.create(":memory:");
  let connection: DuckDBConnection | undefined;
  try {
    connection = await instance.connect();
    onConnect?.(connection);
    for (const table of tables) {
      try {
        await connection.run(
          `CREATE TABLE ${quoteIdent(table.alias)} AS SELECT * FROM read_csv(${sqlString(table.path)}, header = true, sample_size = -1)`,
        );
      } catch (err) {
        throw new Error(`Could not read "${table.alias}" as CSV: ${scrubPaths(err, tables)}`, { cause: err });
      }
    }
    // No spill files in the working directory, and nothing outside the loaded tables from here on.
    await connection.run("SET temp_directory = ''");
    await connection.run("SET enable_external_access = false");
    await connection.run("SET lock_configuration = true");

    const rowCounts = new Map<string, number>();
    for (const table of tables) {
      const reader = await connection.runAndReadAll(`SELECT COUNT(*) FROM ${quoteIdent(table.alias)}`);
      rowCounts.set(table.alias, Number(reader.getRowsJS()[0][0]));
    }
    const conn = connection;
    return {
      connection: conn,
      rowCounts,
      close() {
        conn.closeSync();
        instance.closeSync();
      },
    };
  } catch (err) {
    connection?.closeSync();
    instance.closeSync();
    throw err;
  }
}

/** Keeps server file paths out of error messages that may reach the browser. */
function scrubPaths(err: unknown, tables: QueryTable[]): string {
  let message = err instanceof Error ? err.message : String(err);
  for (const table of tables) message = message.split(table.path).join("<file>");
  return message.split("\n")[0].slice(0, 300);
}
