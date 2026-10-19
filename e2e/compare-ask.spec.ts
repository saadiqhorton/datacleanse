import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startFakeAI, type FakeAI } from "./support/fake-ai";
import { startServer, type AppServer } from "./support/server";

const FIX = path.resolve(__dirname, "fixtures");
const fixture = (name: string) => path.join(FIX, name);

let fake: FakeAI;
let app: AppServer;

test.beforeAll(async () => {
  fake = await startFakeAI();
  app = await startServer({ AI_PROVIDER: "local", AI_BASE_URL: fake.baseURL, AI_MODEL: "test-model" });
});
test.afterAll(async () => {
  await app?.stop();
  await fake?.stop();
});

async function uploadRulesOnly(page: Page, names: string[]) {
  await page.goto(`${app.url}/upload`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/choose file/i).setInputFiles(names.map(fixture));
  await expect(page.getByRole("list", { name: "Selected files" })).toContainText(names[0], { timeout: 10_000 });
  await page.getByRole("radio", { name: /rules only/i }).check();
  await page.getByRole("button", { name: /start cleaning/i }).click();
  await expect(page).toHaveURL(/\/files$/);
}

/** Picks the option whose text names this file (the value is the file id). */
async function pickFile(page: Page, label: string, name: string) {
  const option = page.getByLabel(label).locator("option", { hasText: name });
  await page.getByLabel(label).selectOption((await option.getAttribute("value")) as string);
}

test("compare two customer exports, then ask questions about them", async ({ page }) => {
  test.setTimeout(240_000);

  await test.step("sign up", async () => {
    await page.goto(`${app.url}/signup`);
    await page.getByLabel(/name/i).first().fill("Sam Patel");
    await page.getByLabel(/email/i).fill("sam@acme.io");
    await page.getByLabel(/^password/i).first().fill("correct-horse-battery");
    await page.getByRole("button", { name: /create|sign up/i }).click();
    await expect(page).toHaveURL(/\/files/);
  });

  await test.step("upload both customer files and wait for review", async () => {
    await uploadRulesOnly(page, ["ca_customers_sept.csv", "ca_customers_oct.csv"]);
    await expect(page.getByRole("link", { name: "Review ca_customers_sept.csv" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("link", { name: "Review ca_customers_oct.csv" })).toBeVisible({ timeout: 60_000 });
  });

  let compareUrl = "";
  let joinChatUrl = "";
  await test.step("compare sept vs oct", async () => {
    await page.goto(`${app.url}/compare`);
    await pickFile(page, "First file", "ca_customers_sept.csv");
    await pickFile(page, "Second file", "ca_customers_oct.csv");
    await expect(page.getByText(/Auto-detect picks the best column/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page).toHaveURL(/\/compare\/[^/?]+$/);
    compareUrl = page.url();

    const summary = page.getByRole("region", { name: "Summary" });
    await expect(summary.getByText("Added rows").locator("..")).toHaveText(/^Added rows\+ 2$/);
    await expect(summary.getByText("Removed rows").locator("..")).toHaveText(/^Removed rows− 1$/);
    await expect(summary.getByText("Changed rows").locator("..")).toHaveText(/^Changed rows3$/);
    await expect(summary.getByText("Unchanged").locator("..")).toHaveText(/^Unchanged6$/);
    await expect(page.getByText(/unique in both files/)).toBeVisible();
    await expect(page.getByText("email", { exact: true }).first()).toBeVisible();

    const columns = page.getByRole("heading", { name: "Columns" }).locator("..");
    await expect(columns.getByText(/zip/)).toBeVisible();
    await expect(columns.getByText(/leading zeros/)).toBeVisible();

    await page.getByRole("link", { name: /^Changed 3$/ }).click();
    await expect(page.getByRole("cell", { name: "ann@acme.io" }).first()).toBeVisible();
    await page.getByRole("link", { name: /^Added 2$/ }).click();
    await expect(page.getByRole("cell", { name: "kim@acme.io" }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "lou@acme.io" }).first()).toBeVisible();
    await page.getByRole("link", { name: /^Removed 1$/ }).click();
    await expect(page.getByRole("cell", { name: "hal@acme.io" }).first()).toBeVisible();
  });

  await test.step("export diff downloads a CSV with change_type rows", async () => {
    await page.goto(compareUrl);
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export diff" }).click();
    const file = await download;
    const body = fs.readFileSync((await file.path()) as string, "utf8");
    // One row per changed cell, so count distinct keys per change type. Fixture values have no commas.
    // The file starts with a UTF-8 BOM so Excel reads accents; strip it before parsing.
    const rows = body.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    expect(rows[0]).toBe("change_type,key,column,before,after");
    const keysOf = (kind: string) => new Set(rows.slice(1).filter((r) => r.split(",")[0] === kind).map((r) => r.split(",")[1]));
    expect([...keysOf("added")].sort()).toEqual(["kim@acme.io", "lou@acme.io"]);
    expect([...keysOf("removed")]).toEqual(["hal@acme.io"]);
    expect([...keysOf("changed")].sort()).toEqual(["ann@acme.io", "cara@acme.io", "gia@acme.io"]);
    expect(rows.some((r) => r.startsWith("type_changed,") && r.includes(",zip,"))).toBe(true);
  });

  await test.step("ask about these opens a chat with both files", async () => {
    await page.goto(compareUrl);
    await page.getByRole("button", { name: "Ask about these" }).click();
    await expect(page).toHaveURL(/\/ask\/[^/]+$/);
    const aside = page.getByRole("complementary", { name: "Files in this conversation" });
    await expect(aside.getByText("ca_customers_sept.csv")).toBeVisible();
    await expect(aside.getByText("ca_customers_oct.csv")).toBeVisible();
    await expect(aside.getByText("ca_customers_oct", { exact: true })).toBeVisible();
  });

  await test.step("ask a question: answer, result table, SQL, CSV download", async () => {
    fake.reply("query_plan", {
      sql: "SELECT plan, COUNT(*) AS n FROM ca_customers_oct GROUP BY plan ORDER BY n DESC",
      explanation: "Counts October customers per plan.",
    });
    fake.reply("answer_summary", { answer: "Most customers are on the team plan." });
    await page.getByRole("textbox", { name: "Ask a question about your files" }).fill("Which plan has the most customers in October?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    await expect(page.getByText("Most customers are on the team plan.")).toBeVisible({ timeout: 30_000 });
    const table = page.getByRole("table").last();
    await expect(table.getByRole("cell", { name: "team", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "6", exact: true })).toBeVisible();
    await expect(page.getByText("SELECT plan, COUNT(*)")).toBeAttached();
    await expect(page.getByText(/Ran on \d[\d,]* rows/)).toBeAttached();

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download result CSV" }).click();
    const body = fs.readFileSync((await (await download).path()) as string, "utf8");
    const lines = body.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    expect(lines[0]).toMatch(/plan/);
    expect(lines.length).toBe(4); // header + team, starter, enterprise
    expect(body).toMatch(/team/);
  });

  await test.step("a blocked query gets a friendly message, not a crash", async () => {
    fake.reply("query_plan", { sql: "SELECT * FROM read_csv('/etc/passwd')", explanation: "Reads a system file." });
    await page.getByRole("textbox", { name: "Ask a question about your files" }).fill("Show me the passwd file");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText(/couldn't run that query/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
  });

  await test.step("join flow: orders + refunds need a confirmed join", async () => {
    await uploadRulesOnly(page, ["ca_orders.csv", "ca_refunds.csv"]);
    await expect(page.getByRole("link", { name: "Review ca_refunds.csv" })).toBeVisible({ timeout: 60_000 });

    await page.goto(`${app.url}/ask`);
    await page.getByRole("button", { name: /new chat/i }).click();
    await page.getByRole("checkbox", { name: /ca_orders\.csv/ }).check();
    await page.getByRole("checkbox", { name: /ca_refunds\.csv/ }).check();
    await page.getByRole("checkbox", { name: /ca_customers_oct\.csv/ }).check();
    await page.getByRole("button", { name: /create|start|open/i }).last().click();
    await expect(page).toHaveURL(/\/ask\/[^/]+$/);
    joinChatUrl = page.url();

    fake.reply("query_plan", {
      sql: "SELECT o.id, o.amount, r.amount AS refund FROM ca_orders o JOIN ca_refunds r ON o.id = r.order_id",
      explanation: "Lists refunds next to the order they belong to.",
    });
    fake.reply("answer_summary", { answer: "Three orders have a refund." });
    await page.getByRole("textbox", { name: "Ask a question about your files" }).fill("Which orders were refunded?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    await expect(page.getByText("Confirm how these files connect")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("I'll join ca_refunds.order_id → ca_orders.id (75% of ca_refunds match).")).toBeVisible();
    await page.getByRole("button", { name: "Use these joins" }).click();

    await expect(page.getByText("Three orders have a refund.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/had no matching row/)).toBeVisible();
  });

  await test.step("AI off: asking shows guidance", async () => {
    await page.goto(`${app.url}/settings#ai-provider`);
    const aiSection = page.locator("#ai-provider");
    await aiSection.getByLabel("AI mode").selectOption("off");
    await aiSection.getByRole("button", { name: "Save AI settings" }).click();
    await expect(aiSection.getByText("AI settings saved.")).toBeVisible({ timeout: 15_000 });

    await page.goto(joinChatUrl);
    await page.getByRole("textbox", { name: "Ask a question about your files" }).fill("How many customers?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("AI is off. Turn it on in Settings to ask questions.")).toBeVisible({ timeout: 30_000 });
  });

  await test.step("no unexpected server errors were logged", () => {
    expect(app.log()).not.toMatch(/\[(ask|compare)\] unexpected error/);
  });
});
