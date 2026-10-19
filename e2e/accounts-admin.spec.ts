import fs from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { startServer, type AppServer } from "./support/server";
import { messageBody, startMailCapture, type MailCapture } from "./support/mail-capture";

const OWNER = { name: "Ada Admin", email: "ada@northwind.co", password: "correct-horse-battery" };
const OWNER_AFTER_RESET = "reset-horse-battery-1";
const OWNER_CHANGED = "changed-horse-battery-2";
const MEMBER = { name: "Sam Member", email: "sam@northwind.co", password: "member-horse-battery" };

interface Instance {
  app: AppServer;
  mail: MailCapture;
}

/** Default rules: the first account is the owner and sign-up closes after it. */
let fresh: Instance;
/** ALLOW_SIGNUPS=1: a second account can sign up, for the admin and non-admin journeys. */
let shared: Instance;

test.beforeAll(async () => {
  const [freshMail, sharedMail] = await Promise.all([startMailCapture(), startMailCapture()]);
  const [freshApp, sharedApp] = await Promise.all([
    startServer({ SMTP_URL: freshMail.url, ALLOW_SIGNUPS: "0" }),
    startServer({ SMTP_URL: sharedMail.url, ALLOW_SIGNUPS: "1" }),
  ]);
  fresh = { app: freshApp, mail: freshMail };
  shared = { app: sharedApp, mail: sharedMail };
});

test.afterAll(async () => {
  await fresh?.app.stop();
  await shared?.app.stop();
  await fresh?.mail.stop();
  await shared?.mail.stop();
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Latest reset link mailed to an address. Better Auth's link goes through /api/auth and then redirects to /reset-password. */
function resetLinkFor(instance: Instance, email: string): string | null {
  const pattern = new RegExp(`${escapeRegExp(instance.app.url)}/api/auth/reset-password/[A-Za-z0-9_-]+\\?callbackURL=\\S+`);
  const messages = instance.mail.messages().filter((m) => m.to === email);
  for (let i = messages.length - 1; i >= 0; i--) {
    const match = messageBody(messages[i].data).match(pattern);
    if (match) return match[0];
  }
  return null;
}

/** Navigates and waits for the page to settle, so clicks and typing are not lost to the streamed swap. */
async function open(page: Page, url: string) {
  const response = await page.goto(url);
  await page.waitForLoadState("networkidle");
  return response;
}

/** Waits until the streamed form has replaced the Suspense fallback. */
async function gotoForm(page: Page, url: string, field: string) {
  await open(page, url);
  await expect(page.getByRole("textbox", { name: field })).toHaveCount(1);
}

async function openAccountMenu(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
}

async function signOutViaMenu(page: Page) {
  await openAccountMenu(page);
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/signin$/);
  // Reload the sign-in page: client-side navigation to it can re-stream the form and drop typed input.
  await gotoForm(page, `${new URL(page.url()).origin}/signin`, "Work email");
}

async function signIn(page: Page, email: string, password: string) {
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Work email" }).fill(email);
  await page.getByLabel(/^Password/).filter({ visible: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function signUp(page: Page, url: string, who: { name: string; email: string; password: string }) {
  await gotoForm(page, url, "Your name");
  await page.getByRole("textbox", { name: "Your name" }).fill(who.name);
  await page.getByRole("textbox", { name: "Work email" }).fill(who.email);
  await page.getByLabel(/^Password/).filter({ visible: true }).fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

/** Keys of every object in a JSON value, at any depth. */
function keyNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keyNames);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => [key, ...keyNames(child)]);
  }
  return [];
}

test("owner signs up on a fresh instance, then sign-up closes", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const { app } = fresh;
  const extra: BrowserContext[] = [];

  try {
    await test.step("fresh instance: /files leads to sign-up; the owner account signs in and sees the menu", async () => {
      await open(page, `${app.url}/files`);
      await expect(page).toHaveURL(/\/signup$/);
      await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

      await signUp(page, `${app.url}/signup`, OWNER);
      await expect(page).toHaveURL(/\/files$/);
      await expect(page.getByRole("heading", { name: /your files/i })).toBeVisible();

      await expect(page.getByRole("button", { name: "Account menu" })).toHaveText("AA");
      await openAccountMenu(page);
      await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Admin console" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
      await page.keyboard.press("Escape");
    });

    await test.step("sign-in: no sign-up link, wrong password is refused, right password honours ?next", async () => {
      await signOutViaMenu(page);
      await expect(page.getByRole("link", { name: "Create an account" })).toHaveCount(0);
      await expect(page.getByText("New to DataCleanse?")).toHaveCount(0);

      await open(page, `${app.url}/settings`);
      await expect(page).toHaveURL(/\/signin\?next=%2Fsettings$/);

      await signIn(page, OWNER.email, "not-the-password-123");
      await expect(page.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();
      await expect(page).toHaveURL(/\/signin/);

      await signIn(page, OWNER.email, OWNER.password);
      await expect(page).toHaveURL(/\/settings$/);
    });

    await test.step("sign-ups are closed once the owner exists; the admin users note says so", async () => {
      await signOutViaMenu(page);
      await open(page, `${app.url}/signup`);
      await expect(page.getByRole("heading", { name: "Sign-ups are closed" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Your name" })).toHaveCount(0);

      await signIn(page, OWNER.email, OWNER.password);
      await expect(page).toHaveURL(/\/settings$/);
      await open(page, `${app.url}/admin/users`);
      await expect(page.getByText(/Single-user instance\. Sign-ups are closed/)).toBeVisible();
    });

    await test.step("forgot password: emailed link sets a new password; old one stops working", async () => {
      await signOutViaMenu(page);
      await page.getByRole("link", { name: "Forgot password?" }).click();
      await expect(page).toHaveURL(/\/reset-password$/);
      await page.waitForLoadState("networkidle");
      await page.getByRole("textbox", { name: "Work email" }).fill(OWNER.email);
      await page.getByRole("button", { name: "Email me a reset link" }).click();
      await expect(page.getByText("If an account exists for that email, we sent a reset link.")).toBeVisible();

      await expect.poll(() => resetLinkFor(fresh, OWNER.email)).not.toBeNull();
      const link = resetLinkFor(fresh, OWNER.email)!;
      await open(page, link);
      await expect(page).toHaveURL(/\/reset-password\?token=/);
      await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
      await page.getByLabel(/^New password/).fill(OWNER_AFTER_RESET);
      await page.getByLabel(/^Confirm new password/).fill(OWNER_AFTER_RESET);
      await page.getByRole("button", { name: "Set new password" }).click();
      await expect(page).toHaveURL(/\/signin\?reset=1$/);
      await expect(page.getByText("Password changed. Sign in with your new password.")).toBeVisible();

      await signIn(page, OWNER.email, OWNER.password);
      await expect(page.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();
      await signIn(page, OWNER.email, OWNER_AFTER_RESET);
      await expect(page).toHaveURL(/\/files$/);
    });

    await test.step("reset links are single-use; invalid tokens show the expired message", async () => {
      // The link was used above, so opening it again is a dead link.
      await open(page, resetLinkFor(fresh, OWNER.email)!);
      await expect(page).toHaveURL(/\/reset-password\?error=INVALID_TOKEN$/);
      await expect(page.getByText("This reset link is invalid or expired.")).toBeVisible();

      const bogus = `${app.url}/api/auth/reset-password/not-a-real-token-123456?callbackURL=${encodeURIComponent(`${app.url}/reset-password`)}`;
      await open(page, bogus);
      await expect(page.getByText("This reset link is invalid or expired.")).toBeVisible();
    });

    await test.step("security: change password (wrong, then right); sessions list; sign out others ends the other browser", async () => {
      await open(page, `${app.url}/settings`);
      const devices = page.getByRole("list", { name: "Signed-in devices" });
      await expect(devices.getByRole("listitem")).toHaveCount(1);
      await expect(devices.getByText("This browser")).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out others" })).toBeDisabled();

      await page.getByRole("button", { name: "Change", exact: true }).click();
      await page.getByLabel("Current password", { exact: true }).fill("definitely-not-it");
      await page.getByLabel(/^New password/).fill(OWNER_CHANGED);
      await page.getByLabel(/^Confirm new password/).fill(OWNER_CHANGED);
      await page.getByRole("button", { name: "Change password" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Current password is incorrect." })).toBeVisible();

      await page.getByLabel("Current password", { exact: true }).fill(OWNER_AFTER_RESET);
      await page.getByRole("button", { name: "Change password" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Password changed. Other sessions were signed out." })).toBeVisible();
      await open(page, `${app.url}/settings`);
      await expect(page).toHaveURL(/\/settings$/);

      const otherContext = await browser.newContext();
      extra.push(otherContext);
      const other = await otherContext.newPage();
      await gotoForm(other, `${app.url}/signin`, "Work email");
      await signIn(other, OWNER.email, OWNER_CHANGED);
      await expect(other).toHaveURL(/\/files$/);

      await open(page, `${app.url}/settings`);
      await expect(devices.getByRole("listitem")).toHaveCount(2);
      await expect(devices.getByText("This browser")).toBeVisible();

      await page.getByRole("button", { name: "Sign out others" }).click();
      await expect(devices.getByRole("listitem")).toHaveCount(1);

      await open(other, `${app.url}/files`);
      await expect(other).toHaveURL(/\/signin/);
    });

    await test.step("profile name shows in the account menu; privacy choices persist; export has no secrets", async () => {
      await open(page, `${app.url}/settings`);
      await page.getByRole("textbox", { name: "Name", exact: true }).fill("Ada Lovelace");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toBeVisible();
      await openAccountMenu(page);
      await expect(page.getByRole("menu").getByText("Ada Lovelace")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Account menu" })).toHaveText("AL");

      await page.getByRole("combobox", { name: "Keep files for" }).selectOption({ label: "7 days" });
      await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
      await page.getByRole("combobox", { name: "Default cleaning mode" }).selectOption({ label: "Rules only" });
      await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("combobox", { name: "Keep files for" })).toHaveValue("168");
      await expect(page.getByRole("combobox", { name: "Default cleaning mode" })).toHaveValue("rules_only");

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("link", { name: "Download JSON" }).click(),
      ]);
      const body = fs.readFileSync((await download.path())!, "utf8");
      const exported = JSON.parse(body);
      expect(exported.account.email).toBe(OWNER.email);
      expect(exported.account.name).toBe("Ada Lovelace");
      const secretKeys = keyNames(exported).filter(
        (key) => !["passwordSet", "passwordChangedAt"].includes(key) && /password|token|hash|secret|totp|api_?key|key_?enc|cookie|salt/i.test(key),
      );
      expect(secretKeys).toEqual([]);
      expect(body).not.toContain(OWNER_CHANGED);
      expect(body).not.toContain(OWNER_AFTER_RESET);
    });
  } finally {
    for (const ctx of extra) await ctx.close();
  }
});

test("admin and non-admin journeys on an instance that allows sign-ups", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const { app } = shared;
  const extra: BrowserContext[] = [];
  const memberContext = await browser.newContext();
  extra.push(memberContext);
  const member = await memberContext.newPage();

  try {
    await test.step("the owner and a second account sign up on this instance", async () => {
      await signUp(page, `${app.url}/signup`, OWNER);
      await expect(page).toHaveURL(/\/files$/);
      await expect(page.getByRole("button", { name: "Account menu" })).toHaveText("AA");

      await signUp(member, `${app.url}/signup`, MEMBER);
      await expect(member).toHaveURL(/\/files$/);
      await expect(member.getByRole("heading", { name: /your files/i })).toBeVisible();
    });

    await test.step("admin overview renders its stat cards", async () => {
      await open(page, `${app.url}/admin`);
      await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
      const stats = page.getByRole("region", { name: "Last 24 hours" });
      for (const label of ["Jobs today", "Failed", "Queue depth", "AI calls today"]) {
        await expect(stats.getByText(label, { exact: true })).toBeVisible();
      }
    });

    await test.step("users: sign-up note, promote and demote, disable kicks the open session out, enable again", async () => {
      await open(page, `${app.url}/admin/users`);
      await expect(page.getByText("Sign-ups are open.")).toBeVisible();
      const users = page.getByRole("table", { name: "Users" });
      const memberRow = () => users.getByRole("row").filter({ hasText: MEMBER.email });
      await expect(memberRow()).toBeVisible();
      await expect(users.getByRole("row").filter({ hasText: OWNER.email }).getByText("That's you")).toBeVisible();

      await memberRow().getByRole("button", { name: "Make admin" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Now an admin." })).toBeVisible();
      await expect(memberRow().getByText("Admin", { exact: true })).toBeVisible();

      await memberRow().getByRole("button", { name: "Remove admin" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Now a regular user." })).toBeVisible();

      // The member is signed in on their own browser; disabling them signs that session out.
      await open(member, `${app.url}/files`);
      await expect(member).toHaveURL(/\/files$/);

      page.once("dialog", (d) => d.accept());
      await memberRow().getByRole("button", { name: "Disable" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Disabled. Their sessions are signed out." })).toBeVisible();
      await expect(memberRow().getByText("Disabled", { exact: true })).toBeVisible();

      await open(member, `${app.url}/files`);
      await expect(member).toHaveURL(/\/signin/);
      await signIn(member, MEMBER.email, MEMBER.password);
      await expect(member.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();
      await expect(member).toHaveURL(/\/signin/);

      await open(page, `${app.url}/admin/users`);
      await memberRow().getByRole("button", { name: "Enable" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Enabled." })).toBeVisible();
      await expect(memberRow().getByText("Active", { exact: true })).toBeVisible();

      const selfRow = users.getByRole("row").filter({ hasText: OWNER.email });
      await expect(selfRow.getByRole("button", { name: "Disable" })).toHaveCount(0);
    });

    await test.step("audit log: prefix search and text search both find the entries", async () => {
      await open(page, `${app.url}/admin/audit`);
      await page.getByLabel("Action starts with").fill("auth.");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      const entries = page.getByRole("table", { name: "Audit log entries" });
      await expect(entries.getByText("auth.signed_in", { exact: true }).first()).toBeVisible();
      await expect(entries.getByText("auth.sign_in_failed", { exact: true }).first()).toBeVisible();

      await page.getByLabel("Action starts with").fill("");
      await page.getByRole("searchbox", { name: "Search" }).fill(MEMBER.email);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(entries.getByText("admin.user_promoted", { exact: true })).toBeVisible();
      await expect(entries.getByText("admin.user_disabled", { exact: true })).toBeVisible();
      await expect(entries.getByText("admin.user_enabled", { exact: true })).toBeVisible();
    });

    await test.step("configuration: a local model that is not running fails the test without crashing; then off", async () => {
      await open(page, `${app.url}/admin/config`);
      await page.getByRole("combobox", { name: "Provider", exact: true }).selectOption("local");
      await page.getByLabel(/^Base URL/).fill("http://127.0.0.1:9/v1");
      await page.getByRole("button", { name: "Save AI settings" }).click();
      await expect(page.getByText("Saved. AI provider is now local model.")).toBeVisible();

      await page.getByRole("button", { name: "Test connection" }).click();
      const result = page.locator("form").filter({ has: page.getByRole("button", { name: "Test connection" }) });
      await expect(result.getByRole("alert")).toBeVisible({ timeout: 30_000 });
      await expect(result.getByRole("alert")).not.toContainText("Connected.");
      await expect(page.getByText("Application error")).toHaveCount(0);

      await page.getByRole("combobox", { name: "Provider", exact: true }).selectOption("off");
      await page.getByRole("button", { name: "Save AI settings" }).click();
      await expect(page.getByText("Saved. AI provider is now off.")).toBeVisible();
    });

    await test.step("non-admin: no Admin console in the menu, and /admin is a 404", async () => {
      await gotoForm(member, `${app.url}/signin`, "Work email");
      await signIn(member, MEMBER.email, MEMBER.password);
      await expect(member).toHaveURL(/\/files$/);

      await openAccountMenu(member);
      await expect(member.getByRole("menuitem", { name: "Settings" })).toBeVisible();
      await expect(member.getByRole("menuitem", { name: "Admin console" })).toHaveCount(0);
      await member.keyboard.press("Escape");

      const response = await open(member, `${app.url}/admin`);
      expect(response?.status()).toBe(404);
      await expect(member.getByRole("heading", { name: "Overview" })).toHaveCount(0);
    });

    await test.step("rules: seeded set, toggle, add by hand, new/rename/delete a set, AI-off draft message", async () => {
      await open(page, `${app.url}/rules`);
      await expect(page.getByRole("heading", { name: "CRM exports", exact: true })).toBeVisible();
      const phone = page.getByRole("checkbox", { name: "Enable phone rule" });
      await expect(phone).toBeChecked();

      await phone.uncheck();
      await expect(page.getByText("Rule turned off.")).toBeVisible();
      await expect(phone).not.toBeChecked();
      await phone.check();
      await expect(page.getByText("Rule turned on.")).toBeVisible();
      await expect(phone).toBeChecked();

      await page.getByRole("textbox", { name: /^Column/ }).fill("country");
      await page.getByRole("combobox", { name: /^Action/ }).selectOption({ label: "Country names" });
      await page.getByRole("button", { name: "Add rule" }).click();
      await expect(page.getByText("Rule added.")).toBeVisible();
      await expect(page.getByRole("region", { name: "Rules in this set" }).getByText("country", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "+ New rule set" }).click();
      await page.getByRole("textbox", { name: "Name", exact: true }).fill("Payroll");
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Payroll", exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Rename" }).click();
      await page.getByRole("textbox", { name: "Rule set name" }).fill("Payroll 2026");
      await page.getByRole("button", { name: "Save name" }).click();
      await expect(page.getByRole("heading", { name: "Payroll 2026", exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await page.getByRole("button", { name: "Delete set" }).click();
      await expect(page.getByRole("heading", { name: "Payroll 2026", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Payroll 2026" })).toHaveCount(0);

      await page.getByRole("link", { name: "CRM exports" }).first().click();
      await expect(page.getByRole("heading", { name: "CRM exports", exact: true })).toBeVisible();
      await page.getByRole("textbox", { name: "Describe a rule in plain English" }).fill("Country should always be the full English name");
      await page.getByRole("button", { name: "Turn into rule" }).click();
      await expect(page.getByText("AI is off. Add the rule manually below.")).toBeVisible();
    });

    await test.step("the owner cannot delete the account while they are the last admin", async () => {
      await open(page, `${app.url}/settings`);
      await page.getByRole("button", { name: "Delete everything" }).click();
      await page.getByLabel(/to confirm/).fill(OWNER.email);
      await page.getByRole("button", { name: "Delete account and data" }).click();
      await expect(page.getByRole("dialog").getByRole("alert").filter({ hasText: /last admin/ })).toBeVisible();
      await expect(page).toHaveURL(/\/settings$/);
    });

    await test.step("member deletes their account: signed out, and signing in again fails", async () => {
      await open(member, `${app.url}/settings`);
      await member.getByRole("button", { name: "Delete everything" }).click();
      await member.getByLabel(/to confirm/).fill(MEMBER.email);
      await member.getByRole("button", { name: "Delete account and data" }).click();
      await expect(member).toHaveURL(/\/signin$/);

      await open(member, `${app.url}/files`);
      await expect(member).toHaveURL(/\/signin/);
      await signIn(member, MEMBER.email, MEMBER.password);
      await expect(member.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();
      await expect(member).toHaveURL(/\/signin/);
    });
  } finally {
    for (const ctx of extra) await ctx.close();
  }
});
