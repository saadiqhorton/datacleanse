import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv } from "../testing";
import { authReady, getAuth } from "./better-auth";
import { getUserById } from "./users";

before(async () => {
  setupTestEnv();
  await authReady();
});

test("first sign-up becomes the owner, then sign-ups close", async () => {
  const auth = getAuth();
  const res = await auth.api.signUpEmail({
    body: { name: "Maria Rossi", email: "maria@northwind.co", password: "correct-horse-battery" },
  });
  assert.ok(res.user.id);
  const appUser = getUserById(res.user.id);
  assert.equal(appUser?.role, "admin");
  assert.equal(appUser?.email, "maria@northwind.co");

  await assert.rejects(
    auth.api.signUpEmail({ body: { name: "Eve", email: "eve@example.com", password: "correct-horse-battery" } }),
    /Sign-ups are closed/,
  );
});

test("sign in returns a session the server can read back", async () => {
  const auth = getAuth();
  const res = await auth.api.signInEmail({
    body: { email: "maria@northwind.co", password: "correct-horse-battery" },
    returnHeaders: true,
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  assert.match(cookie, /better-auth\.session_token=/);
  const session = await auth.api.getSession({ headers: new Headers({ cookie: cookie.split(";")[0] }) });
  assert.equal(session?.user.email, "maria@northwind.co");

  await assert.rejects(
    auth.api.signInEmail({ body: { email: "maria@northwind.co", password: "wrong-password-123" } }),
  );
});

test("short passwords are rejected", async () => {
  process.env.ALLOW_SIGNUPS = "1";
  try {
    await assert.rejects(
      getAuth().api.signUpEmail({ body: { name: "Lee", email: "lee@park.kr", password: "short" } }),
    );
  } finally {
    delete process.env.ALLOW_SIGNUPS;
  }
});
