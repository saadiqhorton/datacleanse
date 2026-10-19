import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { setupTestEnv, insertTestUser } from "../testing";
import type { DB } from "../db";
import { getAISettingsView, saveUserAI, testUserAIConnection } from "./ai";
import { SettingsError } from "./errors";

const KEY = "sk-own-key-must-not-leak-998877";
const USER = "usr_maria";

let conn: DB;
let server: http.Server | null = null;

beforeEach(() => {
  conn = setupTestEnv().db;
  insertTestUser(conn, USER, "maria@northwind.co");
  // Instance AI is off so the user's own key is the only provider in play.
  process.env.AI_PROVIDER = "off";
});

afterEach(async () => {
  delete process.env.AI_PROVIDER;
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

/** Minimal OpenAI-compatible server that answers the /models reachability check. */
async function startModelsServer(status: number): Promise<string> {
  server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(status === 200 ? { data: [] } : { error: { message: "bad key" } }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/v1`;
}

describe("saving the user's AI mode", () => {
  it("requires a key before the own-key mode can be used", () => {
    assert.throws(
      () => saveUserAI(USER, { aiMode: "own_key", ownProvider: "anthropic", ownModel: "claude-opus-5-5" }),
      { message: "Add your provider, model and API key before using your own key." },
    );
  });

  it("validates the mode and model name", () => {
    assert.throws(() => saveUserAI(USER, { aiMode: "everything" }), SettingsError);
    assert.throws(
      () => saveUserAI(USER, { aiMode: "own_key", ownProvider: "anthropic", ownModel: "x".repeat(300), ownApiKey: KEY }),
      SettingsError,
    );
  });

  it("stores the key encrypted and never returns it", () => {
    saveUserAI(USER, { aiMode: "own_key", ownProvider: "anthropic", ownModel: "", ownApiKey: KEY });
    const view = getAISettingsView(USER);
    assert.equal(view.user.aiMode, "own_key");
    assert.equal(view.user.ownKey?.model, "claude-opus-5-5", "blank model falls back to the default");
    assert.equal(view.user.ownKey?.hasKey, true);
    assert.equal(JSON.stringify(view).includes(KEY), false);

    const raw = conn.prepare("SELECT own_key_secret FROM user_settings WHERE user_id = ?").get(USER) as {
      own_key_secret: string;
    };
    assert.equal(raw.own_key_secret.includes(KEY), false, "stored value must be encrypted");
  });

  it("keeps the saved key when the field is left blank, and when switching to another mode", () => {
    saveUserAI(USER, { aiMode: "own_key", ownProvider: "anthropic", ownModel: "claude-opus-5-5", ownApiKey: KEY });
    saveUserAI(USER, { aiMode: "own_key", ownProvider: "anthropic", ownModel: "claude-opus-5-5", ownApiKey: "" });
    assert.equal(getAISettingsView(USER).user.ownKey?.hasKey, true);

    saveUserAI(USER, { aiMode: "off" });
    assert.equal(getAISettingsView(USER).user.aiMode, "off");
    assert.equal(getAISettingsView(USER).user.ownKey?.hasKey, true);
  });

  it("will not send a saved key to a different provider without a new key", () => {
    saveUserAI(USER, { aiMode: "own_key", ownProvider: "anthropic", ownModel: "claude-opus-5-5", ownApiKey: KEY });
    assert.throws(
      () => saveUserAI(USER, { aiMode: "own_key", ownProvider: "openai", ownModel: "gpt-4o-mini", ownBaseURL: "https://example.com/v1" }),
      { message: "Enter your API key again when you change the provider or base URL." },
    );
  });

  it("only uses a base URL for OpenAI-compatible providers", () => {
    saveUserAI(USER, {
      aiMode: "own_key",
      ownProvider: "anthropic",
      ownModel: "claude-opus-5-5",
      ownBaseURL: "https://ignored.example.com/v1",
      ownApiKey: KEY,
    });
    assert.equal(getAISettingsView(USER).user.ownKey?.baseURL, undefined);
  });
});

describe("testing the connection", () => {
  it("reports off when the user's mode is off", async () => {
    saveUserAI(USER, { aiMode: "off" });
    const result = await testUserAIConnection(USER);
    assert.equal(result.ok, false);
    assert.equal(result.error, "AI is off for your account.");
  });

  it("checks the user's own provider and reports success", async () => {
    const baseURL = await startModelsServer(200);
    saveUserAI(USER, { aiMode: "own_key", ownProvider: "openai", ownModel: "gpt-4o-mini", ownBaseURL: baseURL, ownApiKey: KEY });
    const result = await testUserAIConnection(USER);
    assert.equal(result.ok, true);
    assert.equal(result.label, "Your API key · gpt-4o-mini");
    assert.equal(JSON.stringify(result).includes(KEY), false);
  });

  it("reports a failed check without exposing the key", async () => {
    const baseURL = await startModelsServer(401);
    saveUserAI(USER, { aiMode: "own_key", ownProvider: "openai", ownModel: "gpt-4o-mini", ownBaseURL: baseURL, ownApiKey: KEY });
    const result = await testUserAIConnection(USER);
    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.equal(JSON.stringify(result).includes(KEY), false);
  });
});
