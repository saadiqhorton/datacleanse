import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, insertTestUser } from "../testing";
import type { DB } from "../db";
import { createSessionRecord, sessionIdFromToken } from "../auth/sessions";
import { encrypt } from "../crypto";
import { setUserAISettings } from "../ai/config";
import { buildAccountExport, exportAccount } from "./export";

const API_KEY = "sk-live-do-not-export-123456";
const PASSWORD_HASH_MARKER = "scrypt$16384$8$1$";
const TOTP_SECRET = "JBSWY3DPEHPK3PXP";

let conn: DB;

beforeEach(() => {
  conn = setupTestEnv().db;
  insertTestUser(conn, "usr_maria", "maria@northwind.co");
  insertTestUser(conn, "usr_sam", "sam@northwind.co");
  conn
    .prepare("UPDATE users SET password_hash = ?, password_changed_at = 1, totp_secret = ?, totp_enabled = 1 WHERE id = 'usr_maria'")
    .run(`${PASSWORD_HASH_MARKER}c2FsdA$aGFzaA`, encrypt(TOTP_SECRET));
  setUserAISettings("usr_maria", {
    aiMode: "own_key",
    ownKey: { provider: "anthropic", model: "claude-opus-5-5", apiKey: API_KEY },
  });
  conn
    .prepare("INSERT INTO rule_sets (id, user_id, name, header_match_json, created_at, updated_at) VALUES ('rs_1','usr_maria','CRM',?,1,2)")
    .run('["email"]');
  conn
    .prepare("INSERT INTO rules (id, rule_set_id, column_pattern, action, params_json, position, description) VALUES ('r1','rs_1','email','lowercase','{}',0,'Lowercase')")
    .run();
  conn
    .prepare(
      `INSERT INTO files (id, user_id, original_name, alias, size_bytes, status, rule_set_id, created_at, expires_at)
       VALUES ('file_m','usr_maria','people.csv','people',12,'ready','rs_1',1,2)`,
    )
    .run();
  conn
    .prepare("INSERT INTO changes (file_id, row_index, kind, before, after, source, reason, decision) VALUES ('file_m',0,'value','A','a','rule','lower','approved')")
    .run();
  conn
    .prepare("INSERT INTO changes (file_id, row_index, kind, before, after, source, reason, decision) VALUES ('file_m',1,'value','B','b','ai','ai','pending')")
    .run();
  conn
    .prepare("INSERT INTO files (id, user_id, original_name, alias, size_bytes, status, created_at, expires_at) VALUES ('file_s','usr_sam','secret.csv','secret',1,'ready',1,2)")
    .run();
  conn.prepare("INSERT INTO audit_log (at, actor_user_id, file_id, action, detail) VALUES (5,'usr_maria','file_m','file.uploaded','people.csv')").run();
  conn.prepare("INSERT INTO audit_log (at, actor_user_id, action, detail) VALUES (6,'usr_sam','settings.updated','Profile updated.')").run();
});

describe("account export", () => {
  it("contains no secrets: no password hash, TOTP secret, API key or session id", () => {
    const token = createSessionRecord("usr_maria", { twoFactorPassed: true, userAgent: "ua" });
    const json = JSON.stringify(buildAccountExport("usr_maria"));
    assert.equal(json.includes(API_KEY), false);
    assert.equal(json.includes(PASSWORD_HASH_MARKER), false);
    assert.equal(json.includes(TOTP_SECRET), false);
    assert.equal(json.includes(sessionIdFromToken(token)), false);
    assert.equal(json.includes(token), false);
    assert.equal(json.includes("password_hash"), false);
    assert.equal(json.includes("own_key_secret"), false);
    assert.equal(json.includes("totp_secret"), false);
  });

  it("reports whether secrets are set, without their values", () => {
    const data = buildAccountExport("usr_maria");
    assert.equal(data.account.passwordSet, true);
    assert.equal(data.account.twoFactorEnabled, true);
    assert.deepEqual(data.settings.ownKey, {
      provider: "anthropic",
      model: "claude-opus-5-5",
      baseURL: null,
      keySaved: true,
    });
  });

  it("includes the user's rules, file metadata, change summary and audit entries only", () => {
    const data = buildAccountExport("usr_maria");
    assert.equal(data.ruleSets.length, 1);
    assert.equal(data.ruleSets[0].rules[0].columnPattern, "email");
    assert.deepEqual(data.ruleSets[0].headerMatch, ["email"]);
    assert.deepEqual(data.files.map((f) => f.originalName), ["people.csv"]);
    assert.equal(data.changeReports.length, 1);
    assert.equal(data.changeReports[0].total, 2);
    assert.deepEqual(data.changeReports[0].bySource, { rule: 1, ai: 1 });
    assert.deepEqual(data.changeReports[0].byDecision, { approved: 1, pending: 1 });
    // The fixture row is at t=5; the AI save above is stamped with the current time, so it comes last.
    assert.deepEqual(data.auditEntries.map((a) => a.action), ["file.uploaded", "user.ai_settings_changed"]);

    const json = JSON.stringify(data);
    assert.equal(json.includes("secret.csv"), false, "other users' files must not appear");
    assert.equal(json.includes("Profile updated."), false, "other users' audit entries must not appear");
  });

  it("writes an account.exported audit entry when the export is taken", () => {
    exportAccount("usr_maria", 1_700_000_000_000);
    const row = conn.prepare("SELECT actor_user_id FROM audit_log WHERE action = 'account.exported'").get() as
      | { actor_user_id: string }
      | undefined;
    assert.equal(row?.actor_user_id, "usr_maria");
  });
});
