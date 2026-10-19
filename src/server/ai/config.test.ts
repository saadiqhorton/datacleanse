import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, insertTestUser } from "../testing";
import type { DB } from "../db";
import {
  AISettingsError,
  describeInstanceAI,
  getInstanceAIConfig,
  getUserAIConfig,
  getUserAISettings,
  setInstanceAIConfig,
  setUserAISettings,
} from "./config";

/** Explicit environment for the config readers, so the host env never leaks into a test. */
function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

const ADMIN = "user_admin";
const USER = "user_maria";

let conn: DB;

beforeEach(() => {
  conn = setupTestEnv().db;
  insertTestUser(conn, ADMIN, "admin@northwind.co", "admin");
  insertTestUser(conn, USER, "maria@northwind.co");
});

function setAppConfig(key: string, value: string) {
  conn
    .prepare("INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value, Date.now());
}

function rawAppConfig(key: string): string | undefined {
  const row = conn.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

function auditDetails(action: string): string[] {
  return (conn.prepare("SELECT detail FROM audit_log WHERE action = ? ORDER BY id").all(action) as { detail: string }[]).map(
    (r) => r.detail,
  );
}

const LOCAL_ENV = env({ AI_PROVIDER: "local", AI_BASE_URL: "http://localhost:1234/v1", AI_MODEL: "llama3.1" });

describe("instance config precedence", () => {
  it("uses environment values when no admin override is stored", () => {
    const config = getInstanceAIConfig(LOCAL_ENV);
    assert.deepEqual(config, { provider: "local", model: "llama3.1", baseURL: "http://localhost:1234/v1" });
  });

  it("an app_config model override beats AI_MODEL, and the environment still supplies the rest", () => {
    setAppConfig("ai.model", "qwen2.5:7b");
    const config = getInstanceAIConfig(LOCAL_ENV);
    assert.equal(config.provider, "local");
    assert.equal(config.model, "qwen2.5:7b");
    assert.equal(config.baseURL, "http://localhost:1234/v1");
  });

  it("an app_config provider override replaces the env provider and takes that provider's default model and endpoint", () => {
    setAppConfig("ai.provider", "openai");
    const config = getInstanceAIConfig(LOCAL_ENV);
    assert.equal(config.provider, "openai");
    assert.equal(config.model, "gpt-4o-mini", "AI_MODEL belongs to the env provider and must not leak across");
    assert.equal(config.baseURL, "https://api.openai.com/v1", "AI_BASE_URL belongs to the env provider too");
  });

  it("setInstanceAIConfig wins over later env values", () => {
    setInstanceAIConfig({ provider: "anthropic", model: "claude-opus-5-5" }, ADMIN);
    const config = getInstanceAIConfig(LOCAL_ENV);
    assert.equal(config.provider, "anthropic");
    assert.equal(config.model, "claude-opus-5-5");
    assert.equal(config.baseURL, undefined);
  });

  it("defaults to Anthropic from ANTHROPIC_API_KEY when AI_PROVIDER is unset", () => {
    const config = getInstanceAIConfig(env({ ANTHROPIC_API_KEY: "sk-ant-env" }));
    assert.equal(config.provider, "anthropic");
    assert.equal(config.apiKey, undefined, "the SDK reads ANTHROPIC_API_KEY itself; it is not copied into the config");
  });

  it("an invalid stored provider is an error, not silently ignored", () => {
    setAppConfig("ai.provider", "gemini");
    assert.throws(() => getInstanceAIConfig(LOCAL_ENV), /ai\.provider must be one of/);
  });
});

describe("instance API key", () => {
  it("is stored encrypted and only returned by getInstanceAIConfig", () => {
    setInstanceAIConfig(
      { provider: "openai", model: "gpt-4o-mini", baseURL: "https://api.openai.com/v1/", apiKey: "sk-admin-secret-123" },
      ADMIN,
    );
    const stored = rawAppConfig("ai.api_key");
    assert.ok(stored, "key row exists");
    assert.ok(!stored.includes("sk-admin-secret-123"), "stored value must not contain the plaintext key");

    const config = getInstanceAIConfig(env({}));
    assert.equal(config.apiKey, "sk-admin-secret-123");
    assert.equal(config.baseURL, "https://api.openai.com/v1", "trailing slash is normalized away");
  });

  it("describeInstanceAI reports hasKey without the key", () => {
    setInstanceAIConfig({ provider: "openai", model: "gpt-4o-mini", baseURL: "https://api.openai.com/v1", apiKey: "sk-admin-secret-456" }, ADMIN);
    const description = describeInstanceAI(env({}));
    assert.deepEqual(Object.keys(description).sort(), ["baseURL", "hasKey", "local", "model", "provider"]);
    assert.equal(description.hasKey, true);
    assert.equal(description.local, false);
    assert.ok(!JSON.stringify(description).includes("sk-admin-secret-456"));
  });

  it("undefined keeps the stored key, an empty string clears it", () => {
    setInstanceAIConfig({ provider: "openai", model: "gpt-4o-mini", baseURL: "https://api.openai.com/v1", apiKey: "sk-keep-me" }, ADMIN);

    setInstanceAIConfig({ provider: "openai", model: "gpt-4o-search", baseURL: "https://api.openai.com/v1" }, ADMIN);
    assert.equal(getInstanceAIConfig(env({})).apiKey, "sk-keep-me");
    assert.equal(getInstanceAIConfig(env({})).model, "gpt-4o-search");

    const cleared = setInstanceAIConfig(
      { provider: "openai", model: "gpt-4o-mini", baseURL: "https://api.openai.com/v1", apiKey: "" },
      ADMIN,
    );
    assert.equal(getInstanceAIConfig(env({})).apiKey, undefined);
    assert.equal(cleared.hasKey, false);
    assert.equal(rawAppConfig("ai.api_key"), undefined);
  });

  it("an environment key applies only while the provider is not overridden", () => {
    const sharedEnv = env({ AI_PROVIDER: "openai", AI_BASE_URL: "https://api.openai.com/v1", AI_API_KEY: "sk-env" });
    assert.equal(getInstanceAIConfig(sharedEnv).apiKey, "sk-env");

    setAppConfig("ai.provider", "local");
    assert.equal(getInstanceAIConfig(sharedEnv).apiKey, undefined, "an env key for OpenAI must not be sent to a local server");
  });

  it("describeInstanceAI reports hasKey for an anthropic env key without exposing it", () => {
    const description = describeInstanceAI(env({ ANTHROPIC_API_KEY: "sk-ant-env-789" }));
    assert.equal(description.provider, "anthropic");
    assert.equal(description.hasKey, true);
    assert.ok(!JSON.stringify(description).includes("sk-ant-env-789"));
  });
});

describe("setInstanceAIConfig validation and audit", () => {
  it("rejects an unknown provider", () => {
    assert.throws(
      () => setInstanceAIConfig({ provider: "gemini" as "openai", model: "x" }, ADMIN),
      AISettingsError,
    );
  });

  it("rejects a base URL that is not http(s) or that carries credentials", () => {
    for (const baseURL of ["ftp://files.example.com/v1", "not a url", "https://user:pass@example.com/v1"]) {
      assert.throws(
        () => setInstanceAIConfig({ provider: "openai", model: "gpt-4o-mini", baseURL }, ADMIN),
        AISettingsError,
        `expected rejection for ${baseURL}`,
      );
    }
    assert.equal(rawAppConfig("ai.provider"), undefined, "nothing is written when validation fails");
  });

  it("writes an audit entry that names the provider and model but not the key", () => {
    setInstanceAIConfig({ provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-ant-audit-secret" }, ADMIN);
    setInstanceAIConfig({ provider: "local", model: "llama3.1", baseURL: "http://localhost:11434/v1" }, ADMIN);

    const details = auditDetails("admin.ai_provider_changed");
    assert.equal(details.length, 2);
    assert.match(details[0], /Admin changed AI provider to Anthropic \(claude-opus-5-5\)/);
    assert.match(details[1], /Admin changed AI provider to local model \(llama3\.1\)/);
    assert.ok(!details.join("\n").includes("sk-ant-audit-secret"));

    const actor = conn.prepare("SELECT actor_user_id FROM audit_log WHERE action = 'admin.ai_provider_changed' LIMIT 1").get() as {
      actor_user_id: string;
    };
    assert.equal(actor.actor_user_id, ADMIN);
  });
});

describe("user AI settings", () => {
  it("defaults to instance mode with no own key", () => {
    assert.deepEqual(getUserAISettings(USER), { aiMode: "instance", ownKey: null });
  });

  it("stores the own key encrypted, returns only hasKey, and getUserAIConfig decrypts it", () => {
    const saved = setUserAISettings(USER, {
      aiMode: "own_key",
      ownKey: { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-user-own-key-555" },
    });
    assert.deepEqual(saved.ownKey, { provider: "openai", model: "gpt-4o-mini", hasKey: true });
    assert.ok(!JSON.stringify(saved).includes("sk-user-own-key-555"));
    assert.ok(!JSON.stringify(getUserAISettings(USER)).includes("sk-user-own-key-555"));

    const row = conn.prepare("SELECT own_key_secret FROM user_settings WHERE user_id = ?").get(USER) as { own_key_secret: string };
    assert.ok(!row.own_key_secret.includes("sk-user-own-key-555"));

    const config = getUserAIConfig(USER);
    assert.equal(config?.apiKey, "sk-user-own-key-555");
    assert.equal(config?.baseURL, "https://api.openai.com/v1", "OpenAI-compatible keys default to OpenAI's endpoint");
  });

  it("switching provider or base URL requires the key again, so a saved key never goes to another endpoint", () => {
    setUserAISettings(USER, {
      aiMode: "own_key",
      ownKey: { provider: "openai", model: "gpt-4o-mini", baseURL: "https://api.openai.com/v1", apiKey: "sk-user-keep" },
    });

    // Same endpoint: the key is kept and the model can change.
    const modelOnly = setUserAISettings(USER, {
      aiMode: "own_key",
      ownKey: { provider: "openai", model: "gpt-4o", baseURL: "https://api.openai.com/v1" },
    });
    assert.equal(modelOnly.ownKey?.hasKey, true);
    assert.equal(getUserAIConfig(USER)?.apiKey, "sk-user-keep");

    // Different endpoint without a key: refused.
    assert.throws(
      () =>
        setUserAISettings(USER, {
          aiMode: "own_key",
          ownKey: { provider: "openai", model: "gpt-4o", baseURL: "https://openrouter.ai/api/v1" },
        }),
      /Enter your API key again/,
    );
    assert.equal(getUserAIConfig(USER)?.apiKey, "sk-user-keep", "the failed change left the stored key alone");
  });

  it("own_key mode needs a saved key, and an unknown mode is rejected", () => {
    assert.throws(() => setUserAISettings(USER, { aiMode: "own_key" }), /Add your provider, model and API key/);
    assert.throws(
      () => setUserAISettings(USER, { aiMode: "gpt" as "off" }),
      /Choose an AI mode/,
    );
    assert.equal(getUserAISettings(USER).aiMode, "instance", "nothing changed");
  });

  it("off mode keeps the saved key and does not require one", () => {
    setUserAISettings(USER, { aiMode: "off", ownKey: { provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-ant-x" } });
    const settings = getUserAISettings(USER);
    assert.equal(settings.aiMode, "off");
    assert.equal(settings.ownKey?.hasKey, true);
  });

  it("the audit entry for a user change never contains the key", () => {
    setUserAISettings(USER, {
      aiMode: "own_key",
      ownKey: { provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-ant-user-audit-999" },
    });
    const details = auditDetails("user.ai_settings_changed");
    assert.equal(details.length, 1);
    assert.match(details[0], /AI mode set to own_key/);
    assert.ok(!details.join("\n").includes("sk-ant-user-audit-999"));
  });
});
