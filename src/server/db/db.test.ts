import { test } from "node:test";
import assert from "node:assert/strict";
import { insertTestUser, setupTestEnv } from "../testing";

test("migrations create the schema and enforce foreign keys", () => {
  const { db } = setupTestEnv();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  for (const t of ["users", "sessions", "files", "changes", "jobs", "rules", "audit_log"]) {
    assert.ok(tables.some((r) => r.name === t), `missing table ${t}`);
  }
  insertTestUser(db);
  assert.throws(() =>
    db.prepare("INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES ('s', 'nope', 0, 0, 0)").run(),
  );
});
