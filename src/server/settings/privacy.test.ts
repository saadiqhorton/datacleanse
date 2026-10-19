import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, insertTestUser } from "../testing";
import type { DB } from "../db";
import { SettingsError } from "./errors";
import { getPrivacySettings, getRetentionHours, updatePrivacySettings } from "./privacy";

let conn: DB;
const USER = "usr_maria";

beforeEach(() => {
  conn = setupTestEnv().db;
  insertTestUser(conn, USER, "maria@northwind.co");
});

function auditCount(action: string): number {
  return (conn.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = ?").get(action) as { n: number }).n;
}

describe("retention and default cleaning mode", () => {
  it("defaults to 24 hours and rules + AI when the user has no settings row", () => {
    assert.deepEqual(getPrivacySettings(USER), { retentionHours: 24, defaultMode: "rules_ai" });
    assert.equal(getRetentionHours(USER), 24);
  });

  it("accepts 1, 24 and 168 hours, including values sent as form strings", () => {
    for (const value of ["1", "168", 24]) {
      updatePrivacySettings(USER, { retentionHours: value as never });
      assert.equal(getRetentionHours(USER), Number(value));
    }
  });

  it("rejects any other retention value and stores nothing", () => {
    for (const bad of ["2", "0", "-24", "1.5", "week", "", 720]) {
      assert.throws(() => updatePrivacySettings(USER, { retentionHours: bad as never }), SettingsError, String(bad));
    }
    assert.equal(getRetentionHours(USER), 24);
    assert.equal(auditCount("settings.updated"), 0);
  });

  it("rejects an unknown cleaning mode", () => {
    assert.throws(() => updatePrivacySettings(USER, { defaultMode: "ai_only" as never }), SettingsError);
  });

  it("rejects an empty update", () => {
    assert.throws(() => updatePrivacySettings(USER, {}), { message: "Nothing to save." });
  });

  it("saves one field without touching the other, and audits the change", () => {
    updatePrivacySettings(USER, { defaultMode: "rules_only" });
    assert.deepEqual(getPrivacySettings(USER), { retentionHours: 24, defaultMode: "rules_only" });

    updatePrivacySettings(USER, { retentionHours: "168" as never });
    assert.deepEqual(getPrivacySettings(USER), { retentionHours: 168, defaultMode: "rules_only" });
    assert.equal(auditCount("settings.updated"), 2);
  });

  it("does not write an audit entry when nothing changed", () => {
    updatePrivacySettings(USER, { retentionHours: 24 });
    assert.equal(auditCount("settings.updated"), 0);
  });
});
