import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env";
import { MIGRATIONS } from "./schema";

export type DB = Database.Database;

const globalForDb = globalThis as unknown as { __dcDb?: DB };

/** Shared connection. Tests call openDb(":memory:") directly instead. */
export function db(): DB {
  if (!globalForDb.__dcDb) {
    fs.mkdirSync(env.dataDir, { recursive: true });
    globalForDb.__dcDb = openDb(path.join(env.dataDir, "app.db"));
  }
  return globalForDb.__dcDb;
}

export function openDb(file: string): DB {
  const conn = new Database(file);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.pragma("busy_timeout = 5000");
  migrate(conn);
  return conn;
}

function migrate(conn: DB) {
  const current = conn.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    conn.transaction(() => {
      conn.exec(MIGRATIONS[v]);
      conn.pragma(`user_version = ${v + 1}`);
    })();
  }
}

/** Swap the shared connection (tests only). */
export function setDbForTests(conn: DB) {
  globalForDb.__dcDb = conn;
}
