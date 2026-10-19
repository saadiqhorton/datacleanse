import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv } from "../testing";
import { setInstanceAIConfig } from "../ai";
import { checkAIConnection, getAIAdminView } from "./config";

/** An explicit environment, so the host's AI_* variables never leak into a test. */
function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

beforeEach(() => {
  setupTestEnv();
});

describe("AI configuration view", () => {
  it("shows the environment as the default until something is saved here", () => {
    const view = getAIAdminView(env({}));
    assert.equal(view.envDefaults?.provider, "off");
    assert.equal(view.effective?.provider, "off");
    assert.deepEqual(view.saved, { provider: false, model: false, baseURL: false, apiKey: false });
  });

  it("marks what was saved on the page and reports the saved provider", () => {
    setInstanceAIConfig({ provider: "openai", model: "gpt-test", apiKey: "sk-test-value" }, null);
    const view = getAIAdminView(env({}));
    assert.equal(view.effective?.provider, "openai");
    assert.equal(view.effective?.model, "gpt-test");
    assert.equal(view.effective?.hasKey, true);
    assert.deepEqual(view.saved, { provider: true, model: true, baseURL: false, apiKey: true });
    assert.equal(JSON.stringify(view).includes("sk-test-value"), false, "the key itself is never in the view");
  });

  it("reports an unreadable environment instead of throwing", () => {
    const view = getAIAdminView(env({ AI_PROVIDER: "bogus" }));
    assert.equal(view.effective, null);
    assert.match(view.effectiveError ?? "", /AI_PROVIDER/);
    assert.match(view.envError ?? "", /AI_PROVIDER/);
  });
});

describe("testing the connection", () => {
  it("says so when AI is off", async () => {
    const result = await checkAIConnection(env({ AI_PROVIDER: "off" }));
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /AI is off/);
  });

  it("reports a bad environment as an error", async () => {
    const result = await checkAIConnection(env({ AI_PROVIDER: "bogus" }));
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /could not be read/);
  });

  it("reports an unreachable local server as a failed check", async () => {
    const result = await checkAIConnection(env({
      AI_PROVIDER: "local",
      AI_MODEL: "llama3.1",
      AI_BASE_URL: "http://127.0.0.1:9/v1",
    }));
    assert.equal(result.ok, false);
  });
});
