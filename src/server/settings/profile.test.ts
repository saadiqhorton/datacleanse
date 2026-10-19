import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv } from "../testing";
import type { DB } from "../db";
import { authReady, getAuth } from "../auth/better-auth";
import { SettingsError } from "./errors";
import { getProfile, updateProfile } from "./profile";

let conn: DB;
let maria: string;
let sam: string;

beforeEach(async () => {
  process.env.ALLOW_SIGNUPS = "1";
  conn = setupTestEnv().db;
  await authReady();
  const signUp = (name: string, email: string) =>
    getAuth()
      .api.signUpEmail({ body: { name, email, password: "correct-horse-battery" } })
      .then((r) => r.user.id);
  maria = await signUp("Maria Rossi", "maria@northwind.co");
  sam = await signUp("Sam Park", "sam@northwind.co");
});

function authEmail(id: string): string {
  return (conn.prepare("SELECT email FROM auth_user WHERE id = ?").get(id) as { email: string }).email;
}

describe("updateProfile", () => {
  it("trims the name and normalizes the email in both the app and Better Auth tables", () => {
    const user = updateProfile(maria, { name: "  Maria Rossi  ", email: "  Maria.Rossi@Northwind.CO " });
    assert.equal(user.name, "Maria Rossi");
    assert.equal(user.email, "maria.rossi@northwind.co");
    assert.equal(getProfile(maria).email, "maria.rossi@northwind.co");
    assert.equal(authEmail(maria), "maria.rossi@northwind.co");
  });

  it("rejects a blank name and a malformed email", () => {
    assert.throws(() => updateProfile(maria, { name: "   ", email: "maria@northwind.co" }), {
      message: "Enter your name.",
    });
    assert.throws(() => updateProfile(maria, { name: "Maria", email: "not-an-email" }), SettingsError);
  });

  it("refuses an email that another account already uses, in any case", () => {
    assert.throws(() => updateProfile(maria, { name: "Maria", email: "SAM@northwind.co" }), {
      message: "An account with this email already exists.",
    });
    assert.equal(getProfile(maria).email, "maria@northwind.co");
    assert.equal(authEmail(maria), "maria@northwind.co");
  });

  it("checks uniqueness in both tables, so a clash in either one is refused", () => {
    conn.prepare("UPDATE users SET email = 'app-only@northwind.co' WHERE id = ?").run(sam);
    assert.throws(() => updateProfile(maria, { name: "Maria", email: "app-only@northwind.co" }), SettingsError);

    conn.prepare("UPDATE auth_user SET email = 'auth-only@northwind.co' WHERE id = ?").run(sam);
    assert.throws(() => updateProfile(maria, { name: "Maria", email: "auth-only@northwind.co" }), {
      message: "An account with this email already exists.",
    });
    assert.equal(authEmail(maria), "maria@northwind.co");
  });

  it("keeps the user's own email without an error, including a change of case", () => {
    const user = updateProfile(maria, { name: "Maria R.", email: "MARIA@northwind.co" });
    assert.equal(user.name, "Maria R.");
    assert.equal(authEmail(maria), "maria@northwind.co");
  });

  it("audits the update and notes an email change", () => {
    updateProfile(maria, { name: "Maria", email: "maria@northwind.co" });
    updateProfile(maria, { name: "Maria", email: "maria.new@northwind.co" });
    const rows = conn
      .prepare("SELECT detail FROM audit_log WHERE action = 'settings.updated' AND actor_user_id = ? ORDER BY id")
      .all(maria) as { detail: string }[];
    assert.deepEqual(rows.map((r) => r.detail), ["Profile updated.", "Profile updated. Email address changed."]);
  });
});
