import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startFakeAI, type FakeAI } from "./support/fake-ai";
import { startServer, type AppServer } from "./support/server";

const FIXTURE = path.join(__dirname, "fixtures/crm_export_q3.csv");
const PASSWORD = "correct-horse-battery";

let fake: FakeAI;
let app: AppServer;

test.beforeAll(async () => {
  fake = await startFakeAI();
  app = await startServer({
    AI_PROVIDER: "local",
    AI_BASE_URL: fake.baseURL,
    AI_MODEL: "test-model",
    // Download links and stored API keys are signed or encrypted with this; production refuses to run without it.
    APP_SECRET: "e2e-ai-local-secret-0123456789abcdef",
  });
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) console.log(app?.log());
});
test.afterAll(async () => {
  await app?.stop();
  await fake?.stop();
});

/** The fake's fix_suggestions requests. */
function fixRequests() {
  return fake.requests.filter((r) => r.body?.response_format?.json_schema?.name === "fix_suggestions");
}

/** The user message the app sent, parsed as JSON. */
function promptOf(body: { messages: { role: string; content: string }[] }) {
  return JSON.parse(body.messages.find((m) => m.role === "user")!.content);
}

/**
 * Goes to Upload, picks "Rules + AI suggestions", adds the file and starts cleaning.
 * Returns the file id. A small file can finish before the page leaves Upload, so the wait accepts either step.
 */
async function uploadWithAI(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
  uses = "Uses: Local model · test-model",
) {
  await page.goto(`${app.url}/upload`);
  await expect(page.getByText(uses, { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: /Rules \+ AI suggestions/ }).check();
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: "Start cleaning" }).click();
  await expect(page).toHaveURL(/\/(processing|review)\/file_/);
  return page.url().split(/\/(?:processing|review)\//)[1];
}

test.describe.serial("AI suggestions with a local model", () => {
  test("sign up, connect to the local model, review AI suggestions, survive an outage, use an own key, turn AI off", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await test.step("1. sign up; settings show the local instance model and Test connection passes", async () => {
      await page.goto(`${app.url}/signup`);
      await page.getByLabel("Your name").fill("Ines Duarte");
      await page.getByLabel("Work email").fill("ines@northwind.co");
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page).toHaveURL(/\/files/);

      await page.goto(`${app.url}/settings#ai-provider`);
      await expect(page.getByText("Runs on this machine")).toBeVisible();
      await expect(page.getByText("test-model", { exact: true }).first()).toBeVisible();
      await page.getByRole("button", { name: "Test connection" }).click();
      await expect(page.getByText("Connected. Local model · test-model responded.")).toBeVisible();
    });

    await test.step("2. the model's suggestions reach Review; a rule-changed cell is dropped; Keep and apply write it", async () => {
      // Row 3's company is already title-cased by a rule, so the suggestion for that cell must be dropped.
      // Row 2's name is one the rules leave alone, so that suggestion is the one shown for review.
      fake.reply("fix_suggestions", {
        suggestions: [
          {
            row: 3,
            column: "company",
            before: "park & co",
            after: "Park & Co",
            reason: "Company name capitalization",
            confidence: 0.72,
          },
          {
            row: 2,
            column: "name",
            before: "J. Ortiz",
            after: "Jane Ortiz",
            reason: "Likely the same person as row 1 with a full first name",
            confidence: 0.72,
          },
        ],
      });
      const fileId = await uploadWithAI(page, FIXTURE);
      await expect(page).toHaveURL(new RegExp(`/review/${fileId}`), { timeout: 60_000 });

      const row = page.getByRole("row").filter({ hasText: "#2 · name" });
      await expect(row.getByText("AI · 72%")).toBeVisible();
      await expect(page.getByRole("link", { name: /^AI \d+$/ })).toHaveText("AI 1");
      await expect(page.getByRole("row").filter({ hasText: "#3 · company" }).getByText(/^AI/)).toHaveCount(0);

      await row.getByRole("button", { name: "Keep change #2 · name" }).click();
      await expect(row.getByRole("button", { name: "Keep change #2 · name" })).toBeHidden();

      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: /Apply .* approved and download/ }).click();
      await expect(page).toHaveURL(new RegExp(`/report/${fileId}`));
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("link", { name: "Cleaned CSV" }).click(),
      ]);
      const cleaned = fs.readFileSync((await download.path()) as string, "utf8");
      expect(cleaned).toContain("Jane Ortiz");
      expect(cleaned).not.toContain("J. Ortiz");
    });

    await test.step("3. the AI saw one bounded sample and column summaries, never top values", async () => {
      const requests = fixRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].path).toBe("/v1/chat/completions");
      const prompt = promptOf(requests[0].body);
      expect(Object.keys(prompt).sort()).toEqual(["alreadyChanged", "columns", "file", "rowCount", "sample"]);
      expect(prompt.rowCount).toBe(6);
      expect(prompt.sample).toHaveLength(6);
      expect(prompt.sample[0]).toHaveProperty("company");
      for (const col of prompt.columns) {
        expect(Object.keys(col).sort()).toEqual(["distinctCount", "name", "nullCount", "type"]);
      }
      expect(JSON.stringify(prompt)).not.toContain("topValues");
    });

    await test.step("3b. the 20-row cap holds for a longer file", async () => {
      const rows = ["id,company"];
      for (let i = 1; i <= 45; i++) rows.push(`${i},Company ${i}`);
      const before = fixRequests().length;
      const fileId = await uploadWithAI(page, {
        name: "long_export.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(rows.join("\n") + "\n"),
      });
      await expect(page).toHaveURL(new RegExp(`/review/${fileId}`), { timeout: 60_000 });
      const sent = fixRequests().slice(before);
      expect(sent).toHaveLength(1);
      const prompt = promptOf(sent[0].body);
      expect(prompt.rowCount).toBe(45);
      expect(prompt.sample).toHaveLength(20);
      expect(JSON.stringify(prompt)).not.toContain("Company 45");
    });

    await test.step("4. an outage shows the fallback on Processing; Wait for AI recovers the suggestions", async () => {
      fake.failWith(503);
      const fileId = await uploadWithAI(page, FIXTURE);
      await expect(page.getByText("AI is temporarily unavailable")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("link", { name: "Review rule changes" })).toBeVisible();
      const wait = page.getByRole("button", { name: "Wait for AI" });
      await expect(wait).toBeVisible();

      fake.failWith(null);
      await wait.click();
      await expect(page).toHaveURL(new RegExp(`/review/${fileId}`), { timeout: 60_000 });
      await expect(page.getByRole("row").filter({ hasText: "#2 · name" }).getByText("AI · 72%")).toBeVisible();
    });

    await test.step("5. own API key: saved without being shown, and used for the next upload", async () => {
      await page.goto(`${app.url}/settings#ai-provider`);
      await page.getByLabel("AI mode").selectOption({ label: "Your API key" });
      await page.getByLabel("Provider").selectOption({ label: "OpenAI-compatible API" });
      await page.getByLabel("Model", { exact: true }).fill("user-model");
      await page.getByLabel("Base URL").fill(fake.baseURL);
      await page.getByLabel("API key", { exact: true }).fill("sk-user-123");
      await page.getByRole("button", { name: "Save AI settings" }).click();
      await expect(page.getByText("AI settings saved.")).toBeVisible();
      await expect(page.getByText("Key saved", { exact: true })).toBeVisible();

      expect(await page.content()).not.toContain("sk-user-123");
      const served = await (await page.request.get(`${app.url}/settings`)).text();
      expect(served).not.toContain("sk-user-123");

      const before = fixRequests().length;
      await uploadWithAI(page, FIXTURE, "Uses: Your API key · user-model");
      await expect(page).toHaveURL(/\/review\//, { timeout: 60_000 });
      const sent = fixRequests().slice(before);
      expect(sent).toHaveLength(1);
      expect(sent[0].headers.authorization).toBe("Bearer sk-user-123");
      expect(sent[0].body.model).toBe("user-model");
    });

    await test.step("6. AI off: Rules + AI is disabled on Upload with a note", async () => {
      await page.goto(`${app.url}/settings#ai-provider`);
      await page.getByLabel("AI mode").selectOption({ label: "Off" });
      await page.getByRole("button", { name: "Save AI settings" }).click();
      await expect(page.getByText("AI settings saved.")).toBeVisible();

      await page.goto(`${app.url}/upload`);
      await expect(page.getByRole("radio", { name: /Rules \+ AI suggestions/ })).toBeDisabled();
      await expect(page.getByRole("link", { name: "AI is off in Settings" })).toBeVisible();
    });
  });
});
