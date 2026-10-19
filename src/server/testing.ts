import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, setDbForTests, type DB } from "./db";

/** Fresh in-memory database + temp DATA_DIR for a test file. Call in a before() hook. */
export function setupTestEnv(): { db: DB; dataDir: string } {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "datacleanse-test-"));
  process.env.DATA_DIR = dataDir;
  const conn = openDb(":memory:");
  setDbForTests(conn);
  return { db: conn, dataDir };
}

/** Insert a user row directly (tests only). */
export function insertTestUser(conn: DB, id = "user_test", email = "maria@northwind.co", role: "user" | "admin" = "user") {
  conn
    .prepare("INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, email, "Maria Rossi", role, Date.now());
  return id;
}
