import fs from "node:fs";
import * as OTPAuth from "otpauth";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { startServer, type AppServer } from "./support/server";
import { decodeQuotedPrintable, startMailCapture, type MailCapture } from "./support/mail-capture";

const ADMIN = { name: "Ada Admin", email: "ada@northwind.co", password: "correct-horse-battery" };
const ADMIN_NEW_PASSWORD = "new-horse-battery-staple";
const MEMBER = { name: "Sam Member", email: "sam@northwind.co", password: "member-horse-battery" };

let app: AppServer;
let mail: MailCapture;
test.beforeAll(async () => {
  // The app sends real SMTP here; the production build cannot fall back to logging mail, so capture it locally.
  mail = await startMailCapture();
  app = await startServer({ SMTP_URL: mail.url });
});
test.afterAll(async () => {
  await app.stop();
  await mail.stop();
});

/** Latest link of one kind ("auth/magic" or "reset-password") mailed to an address. */
function emailedLink(kind: "auth/magic" | "reset-password", email: string): string | null {
  const messages = mail.messages().filter((m) => m.to === email);
  for (let i = messages.length - 1; i >= 0; i--) {
    const match = decodeQuotedPrintable(messages[i].data).match(new RegExp(`${app.url}/${kind}\\?token=[A-Za-z0-9_-]+`));
    if (match) return match[0];
  }
  return null;
}

/** Navigates and waits for the page to hydrate, so clicks and typing are not lost to the streamed swap. */
async function open(page: Page, url: string) {
  const response = await page.goto(url);
  await page.waitForLoadState("networkidle");
  return response;
}

/** Waits for the streamed form to replace the Suspense fallback form (both are briefly in the DOM). */
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
  await open(page, `${app.url}/signin`);
  await expect(page.getByRole("textbox", { name: "Work email" })).toHaveCount(1);
}

async function signInWithPassword(page: Page, email: string, password: string) {
  // Submitting before the form hydrates races the progressive-enhancement POST, so let the page settle first.
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Work email" }).fill(email);
  await page.getByLabel(/^Password/).filter({ visible: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function hasSessionCookie(context: BrowserContext): Promise<boolean> {
  return (await context.cookies()).some((c) => c.name === "dc_session");
}

function totpFor(secret: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
}

/** The server accepts the current 30-second step and one either side, so the next step is always usable. */
function nextStepCode(secret: string): string {
  return totpFor(secret).generate({ timestamp: Date.now() + 30_000 });
}

function wrongCodeFor(code: string): string {
  return String((Number(code) + 1) % 1_000_000).padStart(6, "0");
}

test("accounts, security, settings, admin and rules journey", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const contexts: BrowserContext[] = [];
  const newContext = async () => {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    return ctx;
  };

  await test.step("signed out: /files goes to sign-in; first sign-up becomes admin", async () => {
    await open(page, `${app.url}/files`);
    await expect(page).toHaveURL(/\/signin\?next=%2Ffiles$/);

    await gotoForm(page, `${app.url}/signup`, "Your name");
    await page.getByRole("textbox", { name: "Your name" }).fill(ADMIN.name);
    await page.getByRole("textbox", { name: "Work email" }).fill(ADMIN.email);
    await page.getByLabel(/^Password/).filter({ visible: true }).fill(ADMIN.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/files$/);
    await expect(page.getByRole("heading", { name: /your files/i })).toBeVisible();

    await expect(page.getByRole("button", { name: "Account menu" })).toHaveText("AA");
    await openAccountMenu(page);
    await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Admin console" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("wrong password shows inline error; correct password returns to ?next", async () => {
    await signOutViaMenu(page);
    await open(page, `${app.url}/settings`);
    await expect(page).toHaveURL(/\/signin\?next=%2Fsettings$/);
    await expect(page.getByRole("textbox", { name: "Work email" })).toHaveCount(1);

    await signInWithPassword(page, ADMIN.email, "not-the-password-123");
    await expect(page.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();
    await expect(page).toHaveURL(/\/signin/);

    await page.getByLabel(/^Password/).filter({ visible: true }).fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  await test.step("magic link: confirm page does not sign in; Sign in does; reuse says expired", async () => {
    await signOutViaMenu(page);
    await page.getByRole("textbox", { name: "Work email" }).fill(ADMIN.email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByText("Check your email for a sign-in link.")).toBeVisible();

    await expect.poll(() => emailedLink("auth/magic", ADMIN.email)).not.toBeNull();
    const link = emailedLink("auth/magic", ADMIN.email)!;

    await open(page, link);
    await expect(page.getByRole("heading", { name: `Sign in to DataCleanse as ${ADMIN.email}?` })).toBeVisible();
    expect(await hasSessionCookie(page.context())).toBe(false);

    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/files$/);
    await expect(page.getByRole("heading", { name: /your files/i })).toBeVisible();

    await signOutViaMenu(page);
    await open(page, link);
    await expect(page).toHaveURL(/\/signin\?error=link_expired$/);
    await expect(page.getByText("That sign-in link has expired or was already used.")).toBeVisible();
  });

  await test.step("password reset by emailed link: new password works, old one does not", async () => {
    await gotoForm(page, `${app.url}/reset-password`, "Work email");
    await page.getByRole("textbox", { name: "Work email" }).fill(ADMIN.email);
    await page.getByRole("button", { name: "Email me a reset link" }).click();
    await expect(page.getByText(/If an account exists for that address/)).toBeVisible();

    // The reset email is sent without being awaited, so poll the log for it.
    await expect.poll(() => emailedLink("reset-password", ADMIN.email)).not.toBeNull();
    await open(page, emailedLink("reset-password", ADMIN.email)!);
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await page.getByLabel("New password").filter({ visible: true }).fill(ADMIN_NEW_PASSWORD);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page).toHaveURL(/\/signin\?reset=1$/);
    await expect(page.getByText("Your password has been updated.")).toBeVisible();

    await expect(page.getByRole("textbox", { name: "Work email" })).toHaveCount(1);
    await signInWithPassword(page, ADMIN.email, ADMIN.password);
    await expect(page.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();

    await page.getByLabel(/^Password/).filter({ visible: true }).fill(ADMIN_NEW_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/files$/);
  });

  await test.step("security: sessions list shows this browser; sign out others works", async () => {
    // A second browser signs in as the same admin, so there is another session to sign out.
    const other = await newContext();
    const otherPage = await other.newPage();
    await gotoForm(otherPage, `${app.url}/signin`, "Work email");
    await signInWithPassword(otherPage, ADMIN.email, ADMIN_NEW_PASSWORD);
    await expect(otherPage).toHaveURL(/\/files$/);

    await open(page, `${app.url}/settings`);
    const devices = page.getByRole("list", { name: "Signed-in devices" });
    await expect(devices.getByRole("listitem")).toHaveCount(2);
    await expect(devices.getByText("This browser")).toBeVisible();

    await page.getByRole("button", { name: "Sign out others" }).click();
    await expect(devices.getByRole("listitem")).toHaveCount(1);

    await open(otherPage, `${app.url}/files`);
    await expect(otherPage).toHaveURL(/\/signin\?next=%2Ffiles$/);
  });

  let secret = "";
  await test.step("security: turn on 2FA with a TOTP code, then sign-in asks for a code", async () => {
    await open(page, `${app.url}/settings#security`);
    await page.getByRole("button", { name: "Turn on" }).click();
    await expect(page.getByText("Add DataCleanse to your authenticator app", { exact: true })).toBeVisible();

    secret = (await page.getByText(/^[A-Z2-7]{32}$/).textContent())!.trim();
    await page.getByRole("textbox", { name: /^Code from your app/ }).fill(totpFor(secret).generate());
    await page.getByRole("button", { name: "Confirm and turn on" }).click();
    await expect(page.getByText("Two-factor sign-in is on.")).toBeVisible();
    await expect(page.getByText("On", { exact: true })).toBeVisible();

    await signOutViaMenu(page);
    await gotoForm(page, `${app.url}/signin`, "Work email");
    await signInWithPassword(page, ADMIN.email, ADMIN_NEW_PASSWORD);
    await expect(page).toHaveURL(/\/signin\/2fa/);

    await page.getByRole("textbox", { name: /^Authentication code/ }).fill(wrongCodeFor(totpFor(secret).generate()));
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByText("That code isn't right.")).toBeVisible();
    await expect(page).toHaveURL(/\/signin\/2fa/);

    // The sign-in code for the next step. It is used up by this sign-in.
    const code = nextStepCode(secret);
    await page.getByRole("textbox", { name: /^Authentication code/ }).fill(code);
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page).toHaveURL(/\/files$/);

    // Replay: the same code in a new sign-in is refused. A separate browser keeps the admin session as it is.
    const replay = await newContext();
    const replayPage = await replay.newPage();
    await gotoForm(replayPage, `${app.url}/signin`, "Work email");
    await signInWithPassword(replayPage, ADMIN.email, ADMIN_NEW_PASSWORD);
    await expect(replayPage).toHaveURL(/\/signin\/2fa/);
    await replayPage.getByRole("textbox", { name: /^Authentication code/ }).fill(code);
    await replayPage.getByRole("button", { name: "Verify and continue" }).click();
    await expect(replayPage.getByText("That code isn't right.")).toBeVisible();
    await expect(replayPage).toHaveURL(/\/signin\/2fa/);
  });

  await test.step("profile name shows in the account menu; privacy settings persist; export has no secrets", async () => {
    await open(page, `${app.url}/settings`);
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Ada Lovelace");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    await openAccountMenu(page);
    await expect(page.getByRole("menu").getByText("Ada Lovelace")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Account menu" })).toHaveText("AL");

    await page.getByRole("combobox", { name: "Keep files for" }).selectOption({ label: "7 days" });
    await expect(page.getByText("Saved.").first()).toBeVisible();
    await page.getByRole("combobox", { name: "Default cleaning mode" }).selectOption({ label: "Rules only" });
    await expect(page.getByText("Saved.").first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Keep files for" })).toHaveValue("168");
    await expect(page.getByRole("combobox", { name: "Default cleaning mode" })).toHaveValue("rules_only");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download JSON" }).click(),
    ]);
    const body = fs.readFileSync((await download.path())!, "utf8");
    const exported = JSON.parse(body);
    expect(exported.account.email).toBe(ADMIN.email);
    expect(body).not.toMatch(/password_hash|passwordHash|totp_secret|totpSecret|scrypt\$|api_key|apiKey|key_enc/i);
    expect(body).not.toContain(secret);
  });

  await test.step("admin overview renders its stat cards", async () => {
    await open(page, `${app.url}/admin`);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    const stats = page.getByRole("region", { name: "Last 24 hours" });
    for (const label of ["Jobs today", "Failed", "Queue depth", "AI calls today"]) {
      await expect(stats.getByText(label, { exact: true })).toBeVisible();
    }
  });

  await test.step("admin users: invite, promote, demote, disable, enable; cannot disable self", async () => {
    await open(page, `${app.url}/admin/users`);
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(MEMBER.email);
    await page.getByRole("textbox", { name: /^Name/ }).fill(MEMBER.name);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Invite sent to ${MEMBER.email}` })).toBeVisible();

    const users = page.getByRole("table", { name: "Users" });
    const memberRow = users.getByRole("row").filter({ hasText: MEMBER.email });
    await expect(memberRow).toBeVisible();
    await expect.poll(() => emailedLink("auth/magic", MEMBER.email)).not.toBeNull();

    await memberRow.getByRole("button", { name: "Make admin" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Now an admin." })).toBeVisible();
    await expect(users.getByRole("row").filter({ hasText: MEMBER.email }).getByText("Admin", { exact: true })).toBeVisible();

    await users.getByRole("row").filter({ hasText: MEMBER.email }).getByRole("button", { name: "Remove admin" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Now a regular user." })).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await users.getByRole("row").filter({ hasText: MEMBER.email }).getByRole("button", { name: "Disable" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Disabled. Their sessions are signed out." })).toBeVisible();
    await expect(users.getByRole("row").filter({ hasText: MEMBER.email }).getByText("Disabled", { exact: true })).toBeVisible();

    await users.getByRole("row").filter({ hasText: MEMBER.email }).getByRole("button", { name: "Enable" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Enabled." })).toBeVisible();

    const selfRow = users.getByRole("row").filter({ hasText: ADMIN.email });
    await expect(selfRow.getByText("That's you")).toBeVisible();
    await expect(selfRow.getByRole("button", { name: "Disable" })).toHaveCount(0);
  });

  await test.step("audit log: auth and admin entries, search works", async () => {
    await open(page, `${app.url}/admin/audit`);
    await page.getByRole("combobox", { name: "Action starts with" }).fill("auth.");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const entries = page.getByRole("table", { name: "Audit log entries" });
    await expect(entries.getByText("auth.signed_in", { exact: true }).first()).toBeVisible();
    await expect(entries.getByText("auth.magic_link_requested", { exact: true }).first()).toBeVisible();

    await page.getByRole("combobox", { name: "Action starts with" }).fill("");
    await page.getByRole("searchbox", { name: /Search/ }).fill(MEMBER.email);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(entries.getByText("admin.user_invited", { exact: true })).toBeVisible();
    await expect(entries.getByText(`Invited ${MEMBER.email}.`)).toBeVisible();
    await expect(entries.getByText("admin.user_disabled", { exact: true }).first()).toBeVisible();
  });

  await test.step("admin configuration: local model test reports failure; set Off", async () => {
    await open(page, `${app.url}/admin/config`);
    await page.getByRole("combobox", { name: "Provider" }).selectOption("local");
    await page.getByRole("textbox", { name: /^Base URL/ }).fill("http://127.0.0.1:9/v1");
    await page.getByRole("button", { name: "Save AI settings" }).click();
    await expect(page.getByText("Saved. AI provider is now local model.")).toBeVisible();

    await page.getByRole("button", { name: "Test connection" }).click();
    const result = page.getByRole("alert").or(page.getByRole("status")).filter({ hasText: /./ }).last();
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Application error")).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: /connect|reach|fail|refused/i })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("combobox", { name: "Provider" }).selectOption("off");
    await page.getByRole("button", { name: "Save AI settings" }).click();
    await expect(page.getByText("Saved. AI provider is now off.")).toBeVisible();
  });

  await test.step("non-admin: /admin is 404 and no Admin console in the menu", async () => {
    const memberContext = await newContext();
    const memberPage = await memberContext.newPage();
    // The invite email holds the single-use sign-in link for the new account.
    await open(memberPage, emailedLink("auth/magic", MEMBER.email)!);
    await memberPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(memberPage).toHaveURL(/\/files$/);

    await openAccountMenu(memberPage);
    await expect(memberPage.getByRole("menuitem", { name: "Admin console" })).toHaveCount(0);
    await memberPage.keyboard.press("Escape");

    const response = await open(memberPage, `${app.url}/admin`);
    expect(response?.status()).toBe(404);
    await expect(memberPage.getByRole("heading", { name: "Overview" })).toHaveCount(0);
  });

  await test.step("rules: seeded CRM exports set; toggle, add by hand, new/rename/delete set; AI-off message", async () => {
    await open(page, `${app.url}/rules`);
    await expect(page.getByRole("heading", { name: "CRM exports", exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Enable phone rule" })).toBeChecked();

    await page.getByRole("checkbox", { name: "Enable phone rule" }).uncheck();
    await expect(page.getByText("Rule turned off.")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Enable phone rule" })).not.toBeChecked();
    await page.getByRole("checkbox", { name: "Enable phone rule" }).check();
    await expect(page.getByText("Rule turned on.")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Enable phone rule" })).toBeChecked();

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

  await test.step("delete the member account: type email to confirm; signing in again fails", async () => {
    const memberContext = contexts[contexts.length - 1];
    const memberPage = memberContext.pages()[0];
    await open(memberPage, `${app.url}/settings`);
    await memberPage.getByRole("button", { name: "Delete everything" }).click();
    const confirm = memberPage.getByRole("textbox", { name: /to confirm/ });
    await confirm.fill(MEMBER.email);
    await memberPage.getByRole("button", { name: "Delete account and data" }).click();
    await expect(memberPage).toHaveURL(/\/signin$/);

    await gotoForm(memberPage, `${app.url}/signin`, "Work email");
    await signInWithPassword(memberPage, MEMBER.email, MEMBER.password);
    await expect(memberPage.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();
  });

  await test.step("deleting the last admin is refused", async () => {
    await open(page, `${app.url}/settings`);
    await page.getByRole("button", { name: "Delete everything" }).click();
    await page.getByRole("textbox", { name: /to confirm/ }).fill(ADMIN.email);
    await page.getByRole("button", { name: "Delete account and data" }).click();
    await expect(
      page.getByText("You are the last admin. Make another account an admin before deleting this one."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/settings$/);
  });

  for (const ctx of contexts) await ctx.close();
});
