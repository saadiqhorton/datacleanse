import { test } from "node:test";
import assert from "node:assert/strict";
import { insertTestUser, setupTestEnv } from "../testing";

test("migrations create the schema and enforce foreign keys", () => {
  const { db } = setupTestEnv();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  for (const t of ["users", "files", "changes", "jobs", "rules", "audit_log"]) {
    assert.ok(tables.some((r) => r.name === t), `missing table ${t}`);
  }
  insertTestUser(db);
  assert.throws(() =>
    db.prepare("INSERT INTO user_settings (user_id, updated_at) VALUES ('nope', 0)").run(),
  );
});
