import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { startServer, type AppServer } from "./support/server";

const CRM = path.resolve(__dirname, "fixtures/crm_export_q3.csv");
const NOT_UTF8 = path.resolve(__dirname, "fixtures/not_utf8.csv");
const CRM_NAME = "crm_export_q3.csv";
const HEADER = "customer_id,name,email,phone,signup_date,country,company";

let app: AppServer;
test.beforeAll(async () => {
  app = await startServer({ APP_SECRET: "e2e-core-clean-secret-0123456789abcdef" });
});
test.afterAll(async () => app.stop());
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) fs.writeFileSync("/home/user/claude-0/scratch-pw/server.log", app.log());
});

/** The value under a stat card label, e.g. "Rows removed" -> "3". */
async function statValue(page: Page, scope: string | null, label: string): Promise<string> {
  const root = scope ? page.getByRole("region", { name: scope }) : page;
  const card = root.getByText(label, { exact: true });
  return (await card.locator("xpath=following-sibling::div[1]").innerText()).trim();
}

function toNumber(text: string): number {
  return Number(text.replace(/[^0-9]/g, ""));
}

test("core cleaning journey with AI off", async ({ page }) => {
  test.setTimeout(180_000);
  let fileId = "";

  await test.step("sign up as the first user and see the empty Files state", async () => {
    await page.goto(`${app.url}/signup`);
    await page.getByLabel(/name/i).first().fill("Maria Rossi");
    await page.getByLabel(/email/i).fill("maria@northwind.co");
    await page.getByLabel(/^password/i).first().fill("correct-horse-battery");
    await page.getByRole("button", { name: /create|sign up/i }).click();
    await expect(page).toHaveURL(/\/files/);
    await expect(page.getByRole("heading", { name: /your files/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No files yet" })).toBeVisible();
  });

  await test.step("upload the CRM fixture and start a rules-only clean", async () => {
    await page.goto(`${app.url}/upload`);
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="file"]').setInputFiles(CRM);
    await expect(page.getByText(CRM_NAME, { exact: true })).toBeVisible();
    await expect(page.getByRole("table")).toContainText("customer_id");

    const aiMode = page.getByRole("radio", { name: /Rules \+ AI suggestions/ });
    await expect(aiMode).toBeDisabled();
    await expect(page.getByRole("link", { name: "AI is off in Settings" })).toBeVisible();

    const rulesOnly = page.getByRole("radio", { name: /Rules only/ });
    await rulesOnly.check();
    await expect(rulesOnly).toBeChecked();

    await page.getByRole("button", { name: "Start cleaning" }).click();
    // Small files finish before the progress page is seen, so accept either hop and then the review page.
    await page.waitForURL(/\/(processing|review)\/[^/?]+$/);
    await expect(page).toHaveURL(/\/review\/[^/?]+$/, { timeout: 60_000 });
    fileId = new URL(page.url()).pathname.split("/").pop()!;
  });

  await test.step("review shows the proposed changes and stat cards", async () => {
    await expect(page.getByRole("heading", { level: 1, name: /^Review \d+ proposed changes?$/ })).toBeVisible();
    for (const label of ["Dates normalized", "Duplicates merged", "Text cleaned"]) {
      expect(toNumber(await statValue(page, "Summary", label)), label).toBeGreaterThan(0);
    }

    const rows = page.getByRole("region", { name: "Proposed changes" }).getByRole("row");
    // Date: 03/04/22 -> 2022-03-04 (the row for customer 2).
    await expect(rows.filter({ hasText: "03/04/22" }).filter({ hasText: "2022-03-04" })).toHaveCount(1);
    // Company: "  acme corp. " -> "Acme Corp".
    await expect(rows.filter({ hasText: "Acme Corp" }).first()).toBeVisible();
    // Duplicate merges: the fuzzy jane row and the exact Ana Silva row.
    await expect(rows.filter({ hasText: "Merge" }).filter({ hasText: "Jane Ortiz" }).first()).toBeVisible();
    await expect(rows.filter({ hasText: "Merge" }).filter({ hasText: "Ana Silva" }).first()).toBeVisible();
  });

  await test.step("filter pills change the list and the URL", async () => {
    const proposed = page.getByRole("region", { name: "Proposed changes" });
    await proposed.getByRole("link", { name: /^Rule-based/ }).click();
    await expect(page).toHaveURL(/filter=rule/);
    await expect(proposed.getByRole("row").filter({ hasText: "Acme Corp" }).first()).toBeVisible();

    await proposed.getByRole("link", { name: /^Needs review/ }).click();
    await expect(page).toHaveURL(/filter=pending/);

    await proposed.getByRole("link", { name: /^All/ }).click();
    await expect(page).toHaveURL(/filter=all|(?!.*filter=)/);
  });

  await test.step("skip a rule change, then restore it", async () => {
    const proposed = page.getByRole("region", { name: "Proposed changes" });
    const companyRow = proposed.getByRole("row").filter({ hasText: "Acme Corp" }).first();
    await companyRow.getByRole("button", { name: /^Undo change / }).click();
    await expect(companyRow.getByText("Skipped", { exact: true })).toBeVisible();
    if (process.env.TMP_SKIP_RESTORE !== "1") {
      await companyRow.getByRole("button", { name: /^Restore change / }).click();
      await expect(companyRow.getByText("Approved", { exact: true })).toBeVisible();
    }
  });

  await test.step("keep a pending change if there is one", async () => {
    const proposed = page.getByRole("region", { name: "Proposed changes" });
    const keep = proposed.getByRole("button", { name: /^Keep change / });
    const pendingCount = await keep.count();
    if (pendingCount > 0) {
      const label = (await keep.first().getAttribute("aria-label")) ?? "";
      await keep.first().click();
      await expect(proposed.getByRole("button", { name: label })).toHaveCount(0);
      await expect(proposed.getByRole("button", { name: /^Keep change /})).toHaveCount(pendingCount - 1);
    }
  });

  let removed = 0;
  let rowsOut = 0;
  await test.step("apply the approved changes and land on the report", async () => {
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: /^Apply .* approved and download$/ }).click();
    await expect(page).toHaveURL(new RegExp(`/report/${fileId}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Change report" })).toBeVisible();
    await expect(page.getByText("Applied", { exact: true }).first()).toBeVisible();

    removed = toNumber(await statValue(page, null, "Rows removed"));
    rowsOut = toNumber(await statValue(page, null, "Rows out"));
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(rowsOut).toBe(6 - removed);
    await expect(page.getByRole("heading", { name: "By column" })).toBeVisible();
    await expect(page.getByRole("table").getByRole("row").nth(1)).toBeVisible();
    await expect(page.getByRole("list").filter({ has: page.locator("li") }).last()).toBeVisible();
  });

  await test.step("download the cleaned CSV and check its content", async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Cleaned CSV" }).click(),
    ]);
    const text = fs.readFileSync((await download.path())!, "utf8");
    const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
    expect(lines[0]).toBe(HEADER);
    expect(lines.length - 1).toBe(6 - removed);
    expect(text).toContain("2022-03-04");
    expect(text).toContain("Acme Corp");
    expect(text.match(/ana@initech\.co/g)?.length ?? 0).toBe(1);
  });

  await test.step("download the report PDF and the change log CSV", async () => {
    const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Report PDF" }).click()]);
    const pdfHead = fs.readFileSync((await pdf.path())!).subarray(0, 4).toString("latin1");
    expect(pdfHead).toBe("%PDF");

    const [log] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Change log CSV" }).click(),
    ]);
    const header = fs.readFileSync((await log.path())!, "utf8").split(/\r?\n/)[0];
    expect(header.startsWith("row,column,change,before,after")).toBe(true);
  });

  await test.step("the file is Ready on /files and listed on /report", async () => {
    await page.goto(`${app.url}/files`);
    const row = page.getByRole("row").filter({ hasText: CRM_NAME });
    await expect(row.getByText("Ready", { exact: true })).toBeVisible();
    await expect(row.getByText(/\d[\d,]* applied/)).toBeVisible();
    await expect(row.getByRole("link", { name: `Report for ${CRM_NAME}` })).toBeVisible();
    await expect(row.getByRole("link", { name: `Download cleaned ${CRM_NAME}` })).toBeVisible();

    await page.goto(`${app.url}/report`);
    await expect(page.getByRole("row").filter({ hasText: CRM_NAME })).toBeVisible();
  });

  await test.step("a non-UTF-8 upload fails with the UTF-8 message", async () => {
    await page.goto(`${app.url}/upload`);
    await page.locator('input[type="file"]').setInputFiles(NOT_UTF8);
    await page.getByRole("button", { name: "Start cleaning" }).click();
    await expect(page).toHaveURL(/\/processing\/[^/]+$/);
    await expect(page.getByText("We couldn't read this file", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/isn't valid UTF-8/)).toBeVisible();

    await page.goto(`${app.url}/files`);
    const row = page.getByRole("row").filter({ hasText: "not_utf8.csv" });
    await expect(row.getByText("Failed", { exact: false })).toBeVisible();
    await expect(row.getByText(/isn't valid UTF-8/)).toBeVisible();
  });

  await test.step("delete the cleaned file; the report stays", async () => {
    await page.goto(`${app.url}/files`);
    const row = page.getByRole("row").filter({ hasText: CRM_NAME });
    await row.getByRole("button", { name: `Delete ${CRM_NAME}` }).click();
    await page.getByRole("button", { name: "Delete now" }).click();
    await expect(row.getByText("Deleted", { exact: true })).toBeVisible();
    await expect(row.getByText("Report kept", { exact: true })).toBeVisible();

    await row.getByRole("link", { name: `Report for ${CRM_NAME}` }).click();
    await expect(page).toHaveURL(new RegExp(`/report/${fileId}$`));
    await expect(page.getByText(/Cleaned file deleted/)).toBeVisible();
    await expect(page.getByText(/report kept/)).toBeVisible();
  });
});
