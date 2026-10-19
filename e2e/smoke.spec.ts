import { expect, test } from "@playwright/test";
import { startServer, type AppServer } from "./support/server";

let app: AppServer;
test.beforeAll(async () => {
  app = await startServer();
});
test.afterAll(async () => app.stop());

test("sign up lands on an empty Files page", async ({ page }) => {
  await page.goto(`${app.url}/signup`);
  await page.getByLabel(/name/i).first().fill("Maria Rossi");
  await page.getByLabel(/email/i).fill("maria@northwind.co");
  await page.getByLabel(/^password/i).first().fill("correct-horse-battery");
  await page.getByRole("button", { name: /create|sign up/i }).click();
  await expect(page).toHaveURL(/\/files/);
  await expect(page.getByRole("heading", { name: /your files/i })).toBeVisible();
});
