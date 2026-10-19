import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv } from "../testing";
import type { DB } from "../db";
import { authReady, getAuth } from "../auth/better-auth";
import { setUserAISettings } from "../ai/config";
import { buildAccountExport, exportAccount } from "./export";

const API_KEY = "sk-live-do-not-export-123456";
const PASSWORD = "correct-horse-battery";

let conn: DB;
let maria: string;
let sam: string;
let passwordHash: string;
let sessionToken: string;

beforeEach(async () => {
  process.env.ALLOW_SIGNUPS = "1";
  conn = setupTestEnv().db;
  await authReady();
  maria = (await getAuth().api.signUpEmail({ body: { name: "Maria Rossi", email: "maria@northwind.co", password: PASSWORD } })).user.id;
  sam = (await getAuth().api.signUpEmail({ body: { name: "Sam Park", email: "sam@northwind.co", password: PASSWORD } })).user.id;
  passwordHash = (
    conn.prepare("SELECT password FROM auth_account WHERE userId = ? AND providerId = 'credential'").get(maria) as {
      password: string;
    }
  ).password;
  // Sign in once so a session row exists to check against.
  await getAuth().api.signInEmail({ body: { email: "maria@northwind.co", password: PASSWORD } });
  sessionToken = (conn.prepare("SELECT token FROM auth_session WHERE userId = ?").get(maria) as { token: string }).token;

  setUserAISettings(maria, {
    aiMode: "own_key",
    ownKey: { provider: "anthropic", model: "claude-opus-5-5", apiKey: API_KEY },
  });
  conn
    .prepare("INSERT INTO rule_sets (id, user_id, name, header_match_json, created_at, updated_at) VALUES ('rs_1', ?, 'CRM', ?, 1, 2)")
    .run(maria, '["email"]');
  conn
    .prepare(
      `INSERT INTO rules (id, rule_set_id, column_pattern, action, params_json, position, description)
       VALUES ('r1', 'rs_1', 'email', 'lowercase', '{}', 0, 'Lowercase')`,
    )
    .run();
  conn
    .prepare(
      `INSERT INTO files (id, user_id, original_name, alias, size_bytes, status, rule_set_id, created_at, expires_at)
       VALUES ('file_m', ?, 'people.csv', 'people', 12, 'ready', 'rs_1', 1, 2)`,
    )
    .run(maria);
  conn
    .prepare("INSERT INTO changes (file_id, row_index, kind, before, after, source, reason, decision) VALUES ('file_m',0,'value','A','a','rule','lower','approved')")
    .run();
  conn
    .prepare("INSERT INTO changes (file_id, row_index, kind, before, after, source, reason, decision) VALUES ('file_m',1,'value','B','b','ai','ai','pending')")
    .run();
  conn
    .prepare("INSERT INTO files (id, user_id, original_name, alias, size_bytes, status, created_at, expires_at) VALUES ('file_s', ?, 'secret.csv', 'secret', 1, 'ready', 1, 2)")
    .run(sam);
  conn.prepare("INSERT INTO audit_log (at, actor_user_id, file_id, action, detail) VALUES (5, ?, 'file_m', 'file.uploaded', 'people.csv')").run(maria);
  conn.prepare("INSERT INTO audit_log (at, actor_user_id, action, detail) VALUES (6, ?, 'settings.updated', 'Profile updated.')").run(sam);
});

describe("account export", () => {
  it("contains no secrets: no password hash, session token, API key or auth column names", () => {
    const json = JSON.stringify(buildAccountExport(maria));
    assert.equal(json.includes(API_KEY), false);
    assert.equal(json.includes(passwordHash), false);
    assert.equal(json.includes(sessionToken), false);
    assert.equal(json.includes("password_hash"), false);
    assert.equal(json.includes("own_key_secret"), false);
    assert.equal(json.includes("totp"), false);
    assert.equal(json.includes("accessToken"), false);
  });

  it("reports whether a password is set and when it was set, without their values", () => {
    const data = buildAccountExport(maria);
    assert.equal(data.account.passwordSet, true);
    assert.match(data.account.passwordChangedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
    assert.equal("twoFactorEnabled" in data.account, false);
    assert.deepEqual(data.settings.ownKey, {
      provider: "anthropic",
      model: "claude-opus-5-5",
      baseURL: null,
      keySaved: true,
    });
  });

  it("includes the user's rules, file metadata, change summary and audit entries only", () => {
    const data = buildAccountExport(maria);
    assert.equal(data.ruleSets.length, 1);
    assert.equal(data.ruleSets[0].rules[0].columnPattern, "email");
    assert.deepEqual(data.ruleSets[0].headerMatch, ["email"]);
    assert.deepEqual(data.files.map((f) => f.originalName), ["people.csv"]);
    assert.equal(data.changeReports.length, 1);
    assert.equal(data.changeReports[0].total, 2);
    assert.deepEqual(data.changeReports[0].bySource, { rule: 1, ai: 1 });
    assert.deepEqual(data.changeReports[0].byDecision, { approved: 1, pending: 1 });
    // The fixture row is at t=5; sign-up and the AI save are stamped with the current time, in that order.
    assert.deepEqual(data.auditEntries.map((a) => a.action), ["file.uploaded", "auth.signed_up", "user.ai_settings_changed"]);

    const json = JSON.stringify(data);
    assert.equal(json.includes("secret.csv"), false, "other users' files must not appear");
    assert.equal(json.includes("Profile updated."), false, "other users' audit entries must not appear");
  });

  it("writes an account.exported audit entry when the export is taken", () => {
    exportAccount(maria, 1_700_000_000_000);
    const row = conn.prepare("SELECT actor_user_id FROM audit_log WHERE action = 'account.exported'").get() as
      | { actor_user_id: string }
      | undefined;
    assert.equal(row?.actor_user_id, maria);
  });
});
