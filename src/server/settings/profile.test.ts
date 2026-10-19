import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, insertTestUser } from "../testing";
import type { DB } from "../db";
import { SettingsError } from "./errors";
import { getProfile, updateProfile } from "./profile";

let conn: DB;

beforeEach(() => {
  conn = setupTestEnv().db;
  insertTestUser(conn, "usr_maria", "maria@northwind.co");
  insertTestUser(conn, "usr_sam", "sam@northwind.co");
});

describe("updateProfile", () => {
  it("trims the name and normalizes the email", () => {
    const user = updateProfile("usr_maria", { name: "  Maria Rossi  ", email: "  Maria.Rossi@Northwind.CO " });
    assert.equal(user.name, "Maria Rossi");
    assert.equal(user.email, "maria.rossi@northwind.co");
    assert.equal(getProfile("usr_maria").email, "maria.rossi@northwind.co");
  });

  it("rejects a blank name and a malformed email", () => {
    assert.throws(() => updateProfile("usr_maria", { name: "   ", email: "maria@northwind.co" }), {
      message: "Enter your name.",
    });
    assert.throws(() => updateProfile("usr_maria", { name: "Maria", email: "not-an-email" }), SettingsError);
  });

  it("refuses an email that another account already uses, in any case", () => {
    assert.throws(
      () => updateProfile("usr_maria", { name: "Maria", email: "SAM@northwind.co" }),
      { message: "An account with this email already exists." },
    );
    assert.equal(getProfile("usr_maria").email, "maria@northwind.co");
  });

  it("keeps the user's own email without an error", () => {
    const user = updateProfile("usr_maria", { name: "Maria R.", email: "MARIA@northwind.co" });
    assert.equal(user.name, "Maria R.");
  });

  it("audits the update and notes an email change", () => {
    updateProfile("usr_maria", { name: "Maria", email: "maria@northwind.co" });
    updateProfile("usr_maria", { name: "Maria", email: "maria.new@northwind.co" });
    const rows = conn
      .prepare("SELECT detail FROM audit_log WHERE action = 'settings.updated' AND actor_user_id = 'usr_maria' ORDER BY id")
      .all() as { detail: string }[];
    assert.deepEqual(rows.map((r) => r.detail), ["Profile updated.", "Profile updated. Email address changed."]);
  });
});
