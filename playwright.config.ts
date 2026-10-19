import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against a production build (`npm run build` first).
 * Each spec file starts its own server with an isolated DATA_DIR via e2e/support/server.ts,
 * so specs can run in parallel without sharing state.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 4,
  reporter: [["list"]],
  use: {
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
