import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv } from "../testing";
import type { DB } from "../db";
import { authReady, getAuth } from "../auth/better-auth";
import { SettingsError } from "./errors";
import {
  changeOwnPassword,
  getPasswordInfo,
  listSessionViews,
  passwordFormSchema,
  revokeOneSession,
  signOutOtherSessions,
} from "./security";

const PASSWORD = "correct-horse-battery";
const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

let conn: DB;
let maria: string;
let sam: string;

async function signUp(name: string, email: string): Promise<string> {
  const res = await getAuth().api.signUpEmail({ body: { name, email, password: PASSWORD } });
  return res.user.id;
}

/** Signs in from one browser. Returns that browser's request headers and its Better Auth session id. */
async function signIn(email: string, password = PASSWORD, userAgent = CHROME_MAC) {
  const res = await getAuth().api.signInEmail({
    body: { email, password },
    headers: new Headers({ "user-agent": userAgent }),
    returnHeaders: true,
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  const headers = new Headers({ cookie, "user-agent": userAgent });
  const session = await getAuth().api.getSession({ headers });
  return { headers, sessionId: session!.session.id };
}

async function liveSessionCount(userId: string): Promise<number> {
  return (conn.prepare("SELECT COUNT(*) AS n FROM auth_session WHERE userId = ?").get(userId) as { n: number }).n;
}

beforeEach(async () => {
  process.env.ALLOW_SIGNUPS = "1";
  conn = setupTestEnv().db;
  await authReady();
  maria = await signUp("Maria Rossi", "maria@northwind.co");
  sam = await signUp("Sam Park", "sam@northwind.co");
});

describe("session list", () => {
  it("labels each session by browser and OS and marks the current one", async () => {
    const here = await signIn("maria@northwind.co", PASSWORD, CHROME_MAC);
    const phone = await signIn("maria@northwind.co", PASSWORD, IPHONE_SAFARI);
    await signIn("sam@northwind.co", PASSWORD, CHROME_MAC);

    const views = await listSessionViews(maria, here.headers, here.sessionId);
    assert.equal(views.length, 2, "only the user's own sessions are listed");
    const current = views.find((v) => v.id === here.sessionId);
    assert.equal(current?.current, true);
    assert.equal(current?.label, "Chrome on macOS");
    const other = views.find((v) => v.id === phone.sessionId);
    assert.equal(other?.current, false);
    assert.equal(other?.label, "Safari on iOS");
  });

  it("never includes session tokens", async () => {
    const here = await signIn("maria@northwind.co");
    const views = await listSessionViews(maria, here.headers, here.sessionId);
    const tokens = (conn.prepare("SELECT token FROM auth_session").all() as { token: string }[]).map((r) => r.token);
    const json = JSON.stringify(views);
    for (const token of tokens) assert.equal(json.includes(token), false);
    assert.equal(json.includes("token"), false);
  });

  it("explains when Better Auth will not list sessions older than its fresh window", async () => {
    const here = await signIn("maria@northwind.co");
    conn.prepare("UPDATE auth_session SET createdAt = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(here.sessionId);
    await assert.rejects(listSessionViews(maria, here.headers, here.sessionId), {
      message: "Sign in again to see your signed-in devices.",
    });
  });
});

describe("revoking sessions", () => {
  it("signs out one of the user's other sessions and keeps the caller's", async () => {
    const here = await signIn("maria@northwind.co", PASSWORD, CHROME_MAC);
    const other = await signIn("maria@northwind.co", PASSWORD, IPHONE_SAFARI);
    await revokeOneSession(maria, here.headers, here.sessionId, other.sessionId);

    assert.equal(await getAuth().api.getSession({ headers: other.headers }), null);
    assert.ok(await getAuth().api.getSession({ headers: here.headers }));
  });

  it("will not revoke the current session, another user's session, or a malformed id", async () => {
    const here = await signIn("maria@northwind.co");
    const theirs = await signIn("sam@northwind.co");
    await assert.rejects(revokeOneSession(maria, here.headers, here.sessionId, here.sessionId), {
      message: "Use Sign out to end this session.",
    });
    await assert.rejects(revokeOneSession(maria, here.headers, here.sessionId, theirs.sessionId), {
      message: "That session has already ended.",
    });
    await assert.rejects(revokeOneSession(maria, here.headers, here.sessionId, "../../x"), SettingsError);
    assert.ok(await getAuth().api.getSession({ headers: theirs.headers }));
  });

  it("signs out every other session of the user and keeps the caller's", async () => {
    const here = await signIn("maria@northwind.co", PASSWORD, CHROME_MAC);
    const a = await signIn("maria@northwind.co", PASSWORD, IPHONE_SAFARI);
    const b = await signIn("maria@northwind.co", PASSWORD, CHROME_MAC);
    const sam1 = await signIn("sam@northwind.co");

    assert.equal(await signOutOtherSessions(maria, here.headers, here.sessionId), 2);
    assert.ok(await getAuth().api.getSession({ headers: here.headers }));
    assert.equal(await getAuth().api.getSession({ headers: a.headers }), null);
    assert.equal(await getAuth().api.getSession({ headers: b.headers }), null);
    assert.ok(await getAuth().api.getSession({ headers: sam1.headers }), "other users keep their sessions");
    assert.equal(await liveSessionCount(maria), 1);
  });
});

describe("changing the password", () => {
  it("refuses a wrong current password with a message the form can show", async () => {
    const here = await signIn("maria@northwind.co");
    await assert.rejects(changeOwnPassword(maria, here.headers, "not-my-password", "a-new-password-1"), {
      message: "Current password is incorrect.",
    });
    assert.ok(await getAuth().api.getSession({ headers: here.headers }));
  });

  it("changes the password and signs out the other sessions", async () => {
    const here = await signIn("maria@northwind.co");
    const other = await signIn("maria@northwind.co", PASSWORD, IPHONE_SAFARI);

    await changeOwnPassword(maria, here.headers, PASSWORD, "a-new-password-1");

    await assert.rejects(getAuth().api.signInEmail({ body: { email: "maria@northwind.co", password: PASSWORD } }));
    const res = await getAuth().api.signInEmail({ body: { email: "maria@northwind.co", password: "a-new-password-1" } });
    assert.equal(res.user.email, "maria@northwind.co");
    assert.equal(await getAuth().api.getSession({ headers: other.headers }), null);
    // Better Auth rotates the caller's session when it signs the others out, so only the new one is live.
    assert.equal(await getAuth().api.getSession({ headers: here.headers }), null);
    assert.equal(await liveSessionCount(maria), 2, "the new sign-in plus the one just created");
  });

  it("records when the password was last changed", async () => {
    const before = getPasswordInfo(maria);
    assert.ok(before && before.changedAt > 0);
    assert.equal(getPasswordInfo("usr_without_credentials"), null);
  });

  it("checks the new password length and confirmation before it is sent", () => {
    const short = passwordFormSchema.safeParse({ current: PASSWORD, next: "short", confirm: "short" });
    assert.equal(short.success, false);
    assert.equal(short.success || short.error.issues[0].message, "Password must be at least 10 characters.");

    const mismatch = passwordFormSchema.safeParse({ current: PASSWORD, next: "another-password-2", confirm: "another-password-3" });
    assert.equal(mismatch.success, false);
    assert.equal(!mismatch.success && mismatch.error.issues[0].message, "The new passwords don't match.");

    const missing = passwordFormSchema.safeParse({ current: "", next: "another-password-2", confirm: "another-password-2" });
    assert.equal(!missing.success && missing.error.issues[0].message, "Enter your current password.");

    assert.equal(passwordFormSchema.safeParse({ current: PASSWORD, next: "another-password-2", confirm: "another-password-2" }).success, true);
  });
});
