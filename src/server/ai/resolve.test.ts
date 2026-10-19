import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AIError } from "../../lib/ai";
import { insertTestUser, setupTestEnv } from "../testing";
import type { DB } from "../db";
import { setInstanceAIConfig, setUserAISettings } from "./config";
import { aiCallsSince, getProviderForUser } from "./resolve";
import { startFakeOpenAI, type FakeOpenAIServer } from "./testing";

const USER = "user_maria";
const ENV_KEYS = [
  "AI_PROVIDER",
  "AI_BASE_URL",
  "AI_MODEL",
  "AI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
];

const Answer = z.object({ answer: z.string() });

let conn: DB;
let fake: FakeOpenAIServer;
const savedEnv: Record<string, string | undefined> = {};

before(async () => {
  fake = await startFakeOpenAI();
});

after(async () => {
  await fake.close();
});

beforeEach(() => {
  conn = setupTestEnv().db;
  insertTestUser(conn, USER, "maria@northwind.co");
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  fake.reply = { content: JSON.stringify({ answer: "ok" }) };
  fake.requests.length = 0;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function setEnv(vars: Record<string, string>) {
  Object.assign(process.env, vars);
}

function lastAuthorization(): string | undefined {
  const last = fake.requests[fake.requests.length - 1];
  assert.ok(last, "the fake server received no request");
  return last.headers.authorization;
}

function callRows() {
  return conn
    .prepare("SELECT user_id, provider, model, purpose, ok, ms FROM ai_calls ORDER BY id")
    .all() as { user_id: string; provider: string; model: string; purpose: string; ok: number; ms: number }[];
}

describe("getProviderForUser modes", () => {
  it("off mode gives no provider, whatever the instance is set to", () => {
    setEnv({ AI_PROVIDER: "local", AI_BASE_URL: fake.baseURL, AI_MODEL: "test-model" });
    setUserAISettings(USER, { aiMode: "off" });
    const resolved = getProviderForUser(USER);
    assert.equal(resolved.provider, null);
    assert.equal(resolved.source, "off");
    assert.equal(resolved.label, "Off");
  });

  it("instance mode with a local model uses the instance provider and labels it", async () => {
    setEnv({ AI_PROVIDER: "local", AI_BASE_URL: fake.baseURL, AI_MODEL: "test-model" });
    const resolved = getProviderForUser(USER);
    assert.equal(resolved.source, "instance");
    assert.equal(resolved.label, "Local model · test-model");
    assert.ok(resolved.provider, "expected a provider");

    const result = await resolved.provider.generateObject({ schemaName: "probe", schema: Answer, system: "s", prompt: "p" });
    assert.deepEqual(result, { answer: "ok" });
    assert.equal(fake.requests[0].body.model, "test-model");
    assert.equal(lastAuthorization(), undefined, "a local model with no key sends no Authorization header");
  });

  it("instance mode follows an admin override over the environment", async () => {
    setEnv({ AI_PROVIDER: "local", AI_BASE_URL: "http://127.0.0.1:9/v1", AI_MODEL: "env-model" });
    setInstanceAIConfig({ provider: "local", model: "admin-model", baseURL: fake.baseURL }, null);
    const resolved = getProviderForUser(USER);
    assert.equal(resolved.label, "Local model · admin-model");
    await resolved.provider?.generateObject({ schemaName: "probe", schema: Answer, system: "s", prompt: "p" });
    assert.equal(fake.requests[0].body.model, "admin-model");
  });

  it("instance mode with an admin-set cloud key sends that key", async () => {
    setInstanceAIConfig({ provider: "openai", model: "gpt-4o-mini", baseURL: fake.baseURL, apiKey: "sk-instance-admin" }, null);
    const resolved = getProviderForUser(USER);
    // The fake server is on 127.0.0.1, so it counts as a local model.
    assert.equal(resolved.label, "Local model · gpt-4o-mini");
    await resolved.provider?.generateObject({ schemaName: "probe", schema: Answer, system: "s", prompt: "p" });
    assert.equal(lastAuthorization(), "Bearer sk-instance-admin");
  });

  it("a hosted OpenAI-compatible endpoint is labelled as a cloud API, not a local model", () => {
    setInstanceAIConfig({ provider: "openai", model: "gpt-4o-mini", baseURL: "https://api.openai.com/v1", apiKey: "sk-x" }, null);
    assert.equal(getProviderForUser(USER).label, "OpenAI-compatible API · gpt-4o-mini");
    assert.equal(fake.requests.length, 0);
  });

  it("instance Anthropic is labelled Anthropic and needs no network call to resolve", () => {
    setInstanceAIConfig({ provider: "anthropic", model: "claude-opus-5-5" }, null);
    const resolved = getProviderForUser(USER);
    assert.equal(resolved.source, "instance");
    assert.equal(resolved.label, "Anthropic · claude-opus-5-5");
    assert.equal(resolved.provider?.id, "anthropic");
    assert.equal(fake.requests.length, 0);
  });

  it("instance mode set to off gives no provider", () => {
    setInstanceAIConfig({ provider: "off" }, null);
    const resolved = getProviderForUser(USER);
    assert.equal(resolved.provider, null);
    assert.equal(resolved.label, "Off");
  });

  it("own_key sends the user's key, not the instance key", async () => {
    setEnv({ AI_PROVIDER: "openai", AI_BASE_URL: fake.baseURL, AI_MODEL: "instance-model", AI_API_KEY: "sk-instance-env" });
    setUserAISettings(USER, {
      aiMode: "own_key",
      ownKey: { provider: "openai", model: "gpt-4o-mini", baseURL: fake.baseURL, apiKey: "sk-user-own-7f3a" },
    });

    const resolved = getProviderForUser(USER);
    assert.equal(resolved.source, "own_key");
    assert.equal(resolved.label, "Your API key · gpt-4o-mini");

    await resolved.provider?.generateObject({ schemaName: "probe", schema: Answer, system: "s", prompt: "p" });
    assert.equal(lastAuthorization(), "Bearer sk-user-own-7f3a");
    assert.equal(fake.requests[0].body.model, "gpt-4o-mini");
  });

  it("own_key for Anthropic sends the user's key as x-api-key", async () => {
    const root = fake.baseURL.replace(/\/v1$/, "");
    setUserAISettings(USER, {
      aiMode: "own_key",
      ownKey: { provider: "anthropic", model: "claude-opus-5-5", baseURL: root, apiKey: "sk-ant-user-key-42" },
    });
    const resolved = getProviderForUser(USER);
    assert.equal(resolved.label, "Your API key · claude-opus-5-5");
    // check() calls GET /v1/models/{model}; the fake answers 404, but the headers are what this test reads.
    await resolved.provider?.check();
    const last = fake.requests[fake.requests.length - 1];
    assert.equal(last.headers["x-api-key"], "sk-ant-user-key-42");
  });

  it("own_key with a saved key that cannot be decrypted gives no provider and says so", () => {
    setUserAISettings(USER, {
      aiMode: "own_key",
      ownKey: { provider: "openai", model: "gpt-4o-mini", baseURL: fake.baseURL, apiKey: "sk-user-to-corrupt" },
    });
    conn.prepare("UPDATE user_settings SET own_key_secret = ? WHERE user_id = ?").run("garbage.garbage.garbage", USER);

    const resolved = getProviderForUser(USER);
    assert.equal(resolved.provider, null);
    assert.equal(resolved.source, "own_key");
    assert.match(resolved.label, /could not be read/);
  });
});

describe("ai_calls accounting", () => {
  it("writes one row per successful generateObject call", async () => {
    setEnv({ AI_PROVIDER: "local", AI_BASE_URL: fake.baseURL, AI_MODEL: "test-model" });
    const before = Date.now();
    const resolved = getProviderForUser(USER);
    await resolved.provider?.generateObject({ schemaName: "query_plan", schema: Answer, system: "s", prompt: "p" });

    const rows = callRows();
    assert.equal(rows.length, 1);
    assert.deepEqual(
      { user_id: rows[0].user_id, provider: rows[0].provider, model: rows[0].model, purpose: rows[0].purpose, ok: rows[0].ok },
      { user_id: USER, provider: "local", model: "test-model", purpose: "query_plan", ok: 1 },
    );
    assert.ok(rows[0].ms >= 0 && rows[0].ms < 60_000);
    assert.equal(aiCallsSince(before), 1);
    assert.equal(aiCallsSince(Date.now() + 60_000), 0);
  });

  it("writes a row with ok = 0 when the call fails, and still throws the error", async () => {
    setEnv({ AI_PROVIDER: "local", AI_BASE_URL: fake.baseURL, AI_MODEL: "test-model" });
    fake.reply = { status: 401 };
    const resolved = getProviderForUser(USER);

    await assert.rejects(
      resolved.provider!.generateObject({ schemaName: "fix_suggestions", schema: Answer, system: "s", prompt: "p" }),
      (err: unknown) => err instanceof AIError && err.code === "auth",
    );

    const rows = callRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ok, 0);
    assert.equal(rows[0].purpose, "fix_suggestions");
  });

  it("records a row for own_key calls with the user's id", async () => {
    setUserAISettings(USER, {
      aiMode: "own_key",
      ownKey: { provider: "openai", model: "gpt-4o-mini", baseURL: fake.baseURL, apiKey: "sk-user-row-1" },
    });
    await getProviderForUser(USER).provider?.generateObject({ schemaName: "probe", schema: Answer, system: "s", prompt: "p" });
    const rows = callRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, USER);
    assert.equal(rows[0].provider, "openai");
  });
});
