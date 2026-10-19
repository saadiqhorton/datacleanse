import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, insertTestUser } from "../testing";
import type { DB } from "../db";
import { createSessionRecord, lookupSession, sessionIdFromToken } from "../auth/sessions";
import { SettingsError } from "./errors";
import { listSessionViews, revokeOneSession, setInitialPassword, signOutOtherSessions } from "./security";
import { authenticate } from "../auth/users";

let conn: DB;
const USER = "usr_maria";

beforeEach(() => {
  conn = setupTestEnv().db;
  insertTestUser(conn, USER, "maria@northwind.co");
  insertTestUser(conn, "usr_sam", "sam@northwind.co");
});

function session(userId: string, ua: string) {
  const token = createSessionRecord(userId, { twoFactorPassed: false, userAgent: ua });
  return { token, id: sessionIdFromToken(token) };
}

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

describe("session list", () => {
  it("labels each session by browser and OS and marks the current one", () => {
    const here = session(USER, CHROME_MAC);
    const phone = session(USER, IPHONE_SAFARI);
    session("usr_sam", CHROME_MAC);

    const views = listSessionViews(USER, here.id);
    assert.equal(views.length, 2);
    const current = views.find((v) => v.id === here.id);
    assert.equal(current?.current, true);
    assert.equal(current?.label, "Chrome on macOS");
    const other = views.find((v) => v.id === phone.id);
    assert.equal(other?.current, false);
    assert.equal(other?.label, "Safari on iOS");
  });
});

describe("revoking sessions", () => {
  it("signs out one of the user's other sessions", () => {
    const here = session(USER, CHROME_MAC);
    const other = session(USER, IPHONE_SAFARI);
    revokeOneSession(USER, here.id, other.id);
    assert.equal(lookupSession(other.token), null);
    assert.ok(lookupSession(here.token));
  });

  it("will not revoke the current session or another user's session", () => {
    const here = session(USER, CHROME_MAC);
    const theirs = session("usr_sam", CHROME_MAC);
    assert.throws(() => revokeOneSession(USER, here.id, here.id), { message: "Use Sign out to end this session." });
    assert.throws(() => revokeOneSession(USER, here.id, theirs.id), SettingsError);
    assert.ok(lookupSession(theirs.token));
  });

  it("rejects a malformed session id", () => {
    const here = session(USER, CHROME_MAC);
    assert.throws(() => revokeOneSession(USER, here.id, "../../x"), SettingsError);
  });

  it("signs out every other session of the user and keeps the caller's", () => {
    const here = session(USER, CHROME_MAC);
    const a = session(USER, IPHONE_SAFARI);
    const b = session(USER, CHROME_MAC);
    const sam = session("usr_sam", CHROME_MAC);
    assert.equal(signOutOtherSessions(USER, here.id), 2);
    assert.ok(lookupSession(here.token));
    assert.equal(lookupSession(a.token), null);
    assert.equal(lookupSession(b.token), null);
    assert.ok(lookupSession(sam.token));
  });
});

describe("setting a first password", () => {
  it("sets a password for a magic-link-only account and keeps the current session", async () => {
    const here = session(USER, CHROME_MAC);
    const other = session(USER, IPHONE_SAFARI);
    await setInitialPassword(USER, "a-new-password-1", here.id);
    assert.ok((await authenticate("maria@northwind.co", "a-new-password-1"))?.id === USER);
    assert.ok(lookupSession(here.token));
    assert.equal(lookupSession(other.token), null);
  });

  it("refuses when the account already has a password, and for short passwords", async () => {
    const here = session(USER, CHROME_MAC);
    await setInitialPassword(USER, "a-new-password-1", here.id);
    await assert.rejects(setInitialPassword(USER, "another-password-2", here.id), SettingsError);

    insertTestUser(conn, "usr_new", "new@northwind.co");
    await assert.rejects(setInitialPassword("usr_new", "short", here.id), { message: "Password must be at least 10 characters." });
  });
});
