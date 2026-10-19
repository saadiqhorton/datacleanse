import { DuckDBTypeId, type DuckDBConnection, type JS } from "@duckdb/node-api";
import { assertReadOnly } from "../../lib/ai/tasks";
import type { QueryResult, QueryTable } from "../types";
import { openSession, type Session } from "./session";

const MAX_SQL_LENGTH = 20_000;
const MAX_ROWS_LIMIT = 100_000;

/** The user's SQL was refused: not a single read-only SELECT, reads outside the tables, or invalid SQL. */
export class QueryRejectedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "QueryRejectedError";
    this.reason = reason;
  }
}

/** The query did not finish within timeoutMs and was interrupted. */
export class QueryTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Query took longer than ${timeoutMs} ms and was stopped.`);
    this.name = "QueryTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export interface RunQueryOptions {
  /** CSV files to load as tables. Paths must be absolute and point at files the server controls. */
  tables: QueryTable[];
  sql: string;
  /** Budget for the whole call: loading the CSVs and running the query. Default 10 s. */
  timeoutMs?: number;
  /** Rows returned at most; one extra row is fetched to set `truncated`. Default 1,000. */
  maxRows?: number;
}

/**
 * Runs one read-only SELECT over the given CSV tables in a fresh in-memory DuckDB.
 *
 * Layers of defence: the text must pass assertReadOnly; DuckDB must parse it as a single
 * SELECT (json_serialize_sql); external access and configuration are locked after the
 * tables load, so the query cannot read other files, attach, install or change settings.
 * Rejections throw QueryRejectedError, timeouts throw QueryTimeoutError.
 */
export async function runReadOnlyQuery({
  tables,
  sql,
  timeoutMs = 10_000,
  maxRows = 1_000,
}: RunQueryOptions): Promise<QueryResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive number.");
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_ROWS_LIMIT) {
    throw new Error(`maxRows must be an integer from 1 to ${MAX_ROWS_LIMIT}.`);
  }
  const started = performance.now();

  // Cheap text checks run before any file is opened.
  if (sql.length > MAX_SQL_LENGTH) throw new QueryRejectedError("Query is too long.");
  try {
    assertReadOnly(sql);
  } catch (err) {
    throw new QueryRejectedError(err instanceof Error ? err.message : "Query rejected.");
  }
  const body = sql.trim().replace(/;\s*$/, "");

  let timedOut = false;
  let activeConnection: DuckDBConnection | undefined;
  let session: Session | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        activeConnection?.interrupt();
      } catch {
        // The connection may already be gone; the deadline below still settles the call.
      }
      reject(new QueryTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  const work = (async (): Promise<QueryResult> => {
    try {
      session = await openSession(tables, (connection) => {
        activeConnection = connection;
      });
    } catch (err) {
      if (timedOut) throw new QueryTimeoutError(timeoutMs);
      throw err;
    }
    if (timedOut) throw new QueryTimeoutError(timeoutMs);

    try {
      const conn = session.connection;
      await assertSingleSelect(conn, body);

      // The one extra row tells us whether the result was cut short. The newline keeps a
      // trailing "-- comment" in the user's SQL from swallowing the closing parenthesis.
      const reader = await conn.runAndReadAll(`SELECT * FROM (\n${body}\n) AS q LIMIT ${maxRows + 1}`);
      const columns = reader.columnNames();
      const typeIds = Array.from({ length: reader.columnCount }, (_, i) => reader.columnTypeId(i));
      const fetched = reader.getRowsJS();
      const truncated = fetched.length > maxRows;
      const rows = fetched
        .slice(0, maxRows)
        .map((row) => row.map((value, i) => toCell(value, typeIds[i])));

      let rowsScanned = 0;
      for (const count of session.rowCounts.values()) rowsScanned += count;
      return {
        columns,
        rows,
        rowsScanned,
        ms: Math.round(performance.now() - started),
        truncated,
      };
    } catch (err) {
      if (timedOut) throw new QueryTimeoutError(timeoutMs);
      if (err instanceof QueryRejectedError) throw err;
      throw rejectionFrom(err);
    }
  })();

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    // After a timeout the interrupted query may still be unwinding. Close the session only
    // once the work has settled, so the connection is never closed mid-query.
    void work.then(
      () => closeQuietly(session),
      () => closeQuietly(session),
    );
  }
}

function closeQuietly(session: Session | undefined) {
  try {
    session?.close();
  } catch {
    // Nothing useful to do; the instance is unreachable from here on.
  }
}

/** Parse-only check by DuckDB: exactly one statement, and it must be a SELECT. */
async function assertSingleSelect(conn: DuckDBConnection, sql: string): Promise<void> {
  const reader = await conn.runAndReadAll("SELECT json_serialize_sql(CAST(? AS VARCHAR)) AS j", [sql]);
  const raw = reader.getRowsJS()[0]?.[0];
  if (typeof raw !== "string") throw new QueryRejectedError("Query could not be checked.");

  let parsed: { error?: boolean; error_message?: string; statements?: unknown[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new QueryRejectedError("Query could not be checked.");
  }
  if (parsed.error) {
    // DuckDB reports "Only SELECT statements can be serialized" for anything that is not a SELECT.
    if (/only select/i.test(parsed.error_message ?? "")) throw new QueryRejectedError("Query must be a SELECT.");
    throw new QueryRejectedError(firstLine(parsed.error_message ?? "Query has a syntax error."));
  }
  const statements = parsed.statements ?? [];
  if (statements.length !== 1) throw new QueryRejectedError("Query must be a single statement.");
  const node = (statements[0] as { node?: { type?: string } }).node;
  if (node?.type !== "SELECT_NODE" && node?.type !== "SET_OPERATION_NODE") {
    throw new QueryRejectedError("Query must be a SELECT.");
  }
}

const FILE_ACCESS_ERROR =
  /Permission Error|external access|file system operations are disabled|configuration has been locked|locked by configuration/i;

function rejectionFrom(err: unknown): QueryRejectedError {
  const message = err instanceof Error ? err.message : String(err);
  if (FILE_ACCESS_ERROR.test(message)) {
    return new QueryRejectedError("Query tried to read a file outside the chat's tables.");
  }
  return new QueryRejectedError(firstLine(message));
}

function firstLine(message: string): string {
  return message.split("\n")[0].slice(0, 300);
}

/**
 * JSON-safe cell. BIGINT -> number when exact, else string. DECIMAL -> number. DATE -> YYYY-MM-DD,
 * TIMESTAMP -> ISO string. BLOB -> null. TIME -> HH:MM:SS[.ffffff]. Nested values -> JSON text.
 */
function toCell(value: JS, typeId: DuckDBTypeId | undefined): string | number | boolean | null {
  if (value === null || value === undefined) return null;

  switch (typeId) {
    case DuckDBTypeId.BLOB:
      return null;
    case DuckDBTypeId.DECIMAL: {
      if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
      const n = Number(String(value));
      return Number.isFinite(n) ? n : String(value);
    }
    case DuckDBTypeId.DATE:
      if (value instanceof Date) return isoOrNull(value)?.slice(0, 10) ?? null;
      break;
    case DuckDBTypeId.TIME:
      if (typeof value === "bigint") return formatTimeMicros(value);
      break;
  }

  if (value instanceof Uint8Array) return null;
  if (value instanceof Date) return isoOrNull(value);
  if (typeof value === "bigint") return safeInteger(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string" || typeof value === "boolean") return value;
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === "bigint") return safeInteger(v);
    if (v instanceof Uint8Array) return null;
    return v;
  });
}

function safeInteger(value: bigint): number | string {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : value.toString();
}

function isoOrNull(date: Date): string | null {
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function formatTimeMicros(micros: bigint): string {
  // BigInt(...) instead of 1_000_000n literals: the project targets ES2017.
  const perSecond = BigInt(1_000_000);
  const totalSeconds = micros / perSecond;
  const fraction = micros % perSecond;
  const hours = totalSeconds / BigInt(3600);
  const minutes = (totalSeconds % BigInt(3600)) / BigInt(60);
  const seconds = totalSeconds % BigInt(60);
  const pad = (n: bigint) => n.toString().padStart(2, "0");
  const base = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return fraction === BigInt(0) ? base : `${base}.${fraction.toString().padStart(6, "0")}`;
}
