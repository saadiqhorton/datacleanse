/**
 * Smoke test for the AI provider layer, local / OpenAI-compatible path only.
 * A fake OpenAI-compatible server stands in for Ollama or LM Studio, so no
 * real model and no network access are needed.
 *
 *   npm run test:ai
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import {
  AIError,
  assertReadOnly,
  getAIProvider,
  isLocal,
  planQuery,
  readAIConfig,
  suggestFixes,
  type AIConfig,
  type AIErrorCode,
  type AIProvider,
  type FileProfile,
  type TableProfile,
} from "../src/lib/ai";

// ---------------------------------------------------------------------------
// Fake OpenAI-compatible server
// ---------------------------------------------------------------------------

interface Reply {
  /** HTTP status for POST /v1/chat/completions. Defaults to 200. */
  status?: number;
  /** Assistant message content. */
  content?: string;
  /** choices[0].finish_reason. Defaults to "stop". */
  finishReason?: string;
  /** Send this exact body instead of a chat completion. */
  raw?: string;
}

interface Recorded {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  // Parsed JSON request body; shape is checked by each test.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture
  body: any;
}

interface FakeServer {
  baseURL: string;
  reply: Reply;
  last: Recorded | undefined;
  close(): Promise<void>;
}

async function startFakeServer(): Promise<FakeServer> {
  const fake: FakeServer = {
    baseURL: "",
    reply: {},
    last: undefined,
    close: async () => {},
  };

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    const path = req.url ?? "";
    fake.last = { method: req.method ?? "", path, headers: req.headers, body };

    res.setHeader("content-type", "application/json");

    if (req.method === "GET" && path === "/v1/models") {
      res.writeHead(200);
      res.end(JSON.stringify({ object: "list", data: [{ id: "test-model", object: "model" }] }));
      return;
    }

    if (req.method === "POST" && path === "/v1/chat/completions") {
      const reply = fake.reply;
      if ((reply.status ?? 200) >= 400) {
        res.writeHead(reply.status ?? 500);
        res.end(JSON.stringify({ error: { message: "fake server error" } }));
        return;
      }
      res.writeHead(200);
      if (reply.raw !== undefined) {
        res.end(reply.raw);
        return;
      }
      res.end(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "test-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: reply.content ?? "" },
              finish_reason: reply.finishReason ?? "stop",
            },
          ],
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  fake.baseURL = `http://127.0.0.1:${port}/v1`;
  fake.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return fake;
}

/** Runs `fn` against a fresh fake server and always shuts it down afterwards. */
async function withFakeServer(fn: (fake: FakeServer) => Promise<void>) {
  const fake = await startFakeServer();
  try {
    await fn(fake);
  } finally {
    await fake.close();
  }
}

/** A base URL whose port was just released, so connections are refused. */
async function closedPortBaseURL(): Promise<string> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}/v1`;
}

/** Builds an explicit environment for readAIConfig, so the host's own env never leaks in. */
function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

function localConfig(baseURL: string, extra: Record<string, string> = {}): AIConfig {
  return readAIConfig(
    env({
      AI_PROVIDER: "local",
      AI_BASE_URL: baseURL,
      AI_MODEL: "test-model",
      ...extra,
    }),
  );
}

function providerFor(baseURL: string, extra: Record<string, string> = {}): AIProvider {
  const provider = getAIProvider(localConfig(baseURL, extra));
  assert.ok(provider, "expected a provider for AI_PROVIDER=local");
  return provider;
}

function lastRequest(fake: FakeServer): Recorded {
  assert.ok(fake.last, "the fake server received no request");
  return fake.last;
}

/** The user message of a chat request, parsed back from the JSON prompt. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture
function userPromptOf(rec: Recorded): any {
  const messages = rec.body.messages as { role: string; content: string }[];
  const user = messages.find((m) => m.role === "user");
  assert.ok(user, "chat request has no user message");
  return JSON.parse(user.content);
}

async function expectAIError(promise: Promise<unknown>, code: AIErrorCode): Promise<AIError> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof AIError, `expected an AIError, got ${String(caught)}`);
  assert.equal(caught.code, code, `wrong AIError code: ${caught.message}`);
  return caught;
}

function sampleProfile(rows: number): FileProfile {
  return {
    fileName: "customers.csv",
    rowCount: rows,
    columns: [
      { name: "id", type: "INTEGER", nullCount: 0, distinctCount: rows },
      { name: "city", type: "VARCHAR", nullCount: 0, distinctCount: 2, topValues: ["Boston", "Bostn"] },
    ],
    sample: Array.from({ length: rows }, (_, i) => ({
      id: String(i + 1),
      city: i % 2 ? "Boston" : "Bostn",
    })),
  };
}

const sampleTables: TableProfile[] = [
  {
    alias: "orders",
    rowCount: 3,
    columns: [{ name: "updated_at", type: "TIMESTAMP", nullCount: 0, distinctCount: 3 }],
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readAIConfig", () => {
  it("is off when nothing is set", () => {
    assert.equal(readAIConfig(env({})).provider, "off");
  });

  it("defaults to local Ollama settings when only AI_PROVIDER=local is set", () => {
    const config = readAIConfig(env({ AI_PROVIDER: "local" }));
    assert.equal(config.provider, "local");
    assert.equal(config.baseURL, "http://localhost:11434/v1");
    assert.equal(config.model, "llama3.1");
    assert.equal(config.apiKey, undefined);
  });

  it("treats a bare AI_BASE_URL as a local model server", () => {
    assert.equal(readAIConfig(env({ AI_BASE_URL: "http://localhost:1234/v1" })).provider, "local");
  });

  it("only calls private-network hosts local", () => {
    const local = (baseURL: string) => isLocal({ provider: "local", model: "m", baseURL });
    assert.equal(local("http://192.168.1.20:11434/v1"), true);
    assert.equal(local("https://ollama.example.com/v1"), false);
    assert.equal(local("http://ollama:11434/v1"), true);
  });

  it("defaults to anthropic when ANTHROPIC_API_KEY is set", () => {
    const config = readAIConfig(env({ ANTHROPIC_API_KEY: "x" }));
    assert.equal(config.provider, "anthropic");
    assert.equal(config.model, "claude-opus-5-5");
  });

  it("AI_PROVIDER=off yields no provider", () => {
    const config = readAIConfig(env({ AI_PROVIDER: "off" }));
    assert.equal(config.provider, "off");
    assert.equal(getAIProvider(config), null);
  });

  it("rejects an unknown AI_PROVIDER", () => {
    assert.throws(
      () => readAIConfig(env({ AI_PROVIDER: "gemini" })),
      /AI_PROVIDER must be one of/,
    );
  });

  it("isLocal is true for local and false for openai at api.openai.com", () => {
    assert.equal(isLocal(readAIConfig(env({ AI_PROVIDER: "local" }))), true);
    assert.equal(
      isLocal(
        readAIConfig(env({
          AI_PROVIDER: "openai",
          AI_BASE_URL: "https://api.openai.com/v1",
          AI_API_KEY: "k",
        })),
      ),
      false,
    );
  });

  it("isLocal recognises an OpenAI-compatible server on IPv6 loopback [::1]", () => {
    // Expected to fail: new URL("http://[::1]:1234/v1").hostname is "[::1]" (with brackets),
    // but isLocal compares against "::1".
    const config = readAIConfig(env({
      AI_PROVIDER: "openai",
      AI_BASE_URL: "http://[::1]:1234/v1",
    }));
    assert.equal(isLocal(config), true);
  });
});

describe("check()", () => {
  it("reports ok against the fake server (GET /v1/models)", async () => {
    await withFakeServer(async (fake) => {
      const result = await providerFor(fake.baseURL).check();
      assert.deepEqual(result, { ok: true });
      const rec = lastRequest(fake);
      assert.equal(rec.method, "GET");
      assert.equal(rec.path, "/v1/models");
    });
  });

  it("reports ok:false with an unreachable message for a closed port", async () => {
    const baseURL = await closedPortBaseURL();
    const result = await providerFor(baseURL).check();
    assert.equal(result.ok, false);
    if (result.ok) return;
    // check() returns only the message text. The message says "Could not reach ...".
    assert.match(result.error, /could not reach/i);
  });
});

describe("suggestFixes", () => {
  it("returns parsed suggestions and sends a json_schema request for test-model", async () => {
    await withFakeServer(async (fake) => {
      const suggestion = {
        row: 3,
        column: "city",
        before: "Bostn",
        after: "Boston",
        reason: "Likely typo",
        confidence: 0.9,
      };
      fake.reply = { content: JSON.stringify({ suggestions: [suggestion] }) };

      const result = await suggestFixes(providerFor(fake.baseURL), sampleProfile(50));
      assert.deepEqual(result, [suggestion]);

      const rec = lastRequest(fake);
      assert.equal(rec.path, "/v1/chat/completions");
      assert.equal(rec.body.model, "test-model");
      assert.equal(rec.body.response_format.type, "json_schema");
      assert.equal(rec.body.response_format.json_schema.name, "fix_suggestions");
    });
  });

  it("sends at most 20 sample rows out of 50", async () => {
    await withFakeServer(async (fake) => {
      fake.reply = { content: JSON.stringify({ suggestions: [] }) };
      await suggestFixes(providerFor(fake.baseURL), sampleProfile(50));

      const prompt = userPromptOf(lastRequest(fake));
      assert.equal(prompt.rowCount, 50, "full row count should still be reported");
      assert.ok(prompt.sample.length <= 20, `sent ${prompt.sample.length} sample rows`);
      assert.equal(prompt.sample[0].id, "1", "sample should start from the first row");
    });
  });

  it("accepts JSON wrapped in ```json fences", async () => {
    await withFakeServer(async (fake) => {
      fake.reply = { content: "```json\n" + JSON.stringify({ suggestions: [] }) + "\n```" };
      const result = await suggestFixes(providerFor(fake.baseURL), sampleProfile(5));
      assert.deepEqual(result, []);
    });
  });

  it("rejects invalid JSON with invalid_output", async () => {
    await withFakeServer(async (fake) => {
      fake.reply = { content: "Sure! Here are my suggestions: none." };
      await expectAIError(suggestFixes(providerFor(fake.baseURL), sampleProfile(5)), "invalid_output");
    });
  });

  it("rejects a schema mismatch with invalid_output", async () => {
    await withFakeServer(async (fake) => {
      // Wrong type for row, and confidence outside 0..1.
      fake.reply = {
        content: JSON.stringify({
          suggestions: [{ row: "three", column: "city", before: "a", after: "b", reason: "x", confidence: 1.5 }],
        }),
      };
      await expectAIError(suggestFixes(providerFor(fake.baseURL), sampleProfile(5)), "invalid_output");
    });
  });

  it("maps HTTP 401 to auth", async () => {
    await withFakeServer(async (fake) => {
      fake.reply = { status: 401 };
      await expectAIError(suggestFixes(providerFor(fake.baseURL), sampleProfile(5)), "auth");
    });
  });

  it("treats finish_reason 'length' as invalid_output", async () => {
    await withFakeServer(async (fake) => {
      fake.reply = { content: '{"suggestions":[{"row":1,', finishReason: "length" };
      await expectAIError(suggestFixes(providerFor(fake.baseURL), sampleProfile(5)), "invalid_output");
    });
  });
});

describe("planQuery and assertReadOnly", () => {
  it("accepts a valid SELECT plan", async () => {
    await withFakeServer(async (fake) => {
      const plan = {
        sql: "SELECT updated_at FROM orders ORDER BY updated_at DESC",
        explanation: "Lists order timestamps, newest first.",
      };
      fake.reply = { content: JSON.stringify(plan) };
      const result = await planQuery(providerFor(fake.baseURL), "latest orders?", sampleTables);
      assert.deepEqual(result, plan);
      assert.equal(lastRequest(fake).body.response_format.json_schema.name, "query_plan");
    });
  });

  it("rejects 'DROP TABLE x' with invalid_output", async () => {
    await withFakeServer(async (fake) => {
      fake.reply = { content: JSON.stringify({ sql: "DROP TABLE x", explanation: "x" }) };
      await expectAIError(planQuery(providerFor(fake.baseURL), "drop it", sampleTables), "invalid_output");
    });
  });

  it("rejects 'SELECT 1; DELETE FROM x' with invalid_output", async () => {
    await withFakeServer(async (fake) => {
      fake.reply = { content: JSON.stringify({ sql: "SELECT 1; DELETE FROM x", explanation: "x" }) };
      await expectAIError(planQuery(providerFor(fake.baseURL), "combo", sampleTables), "invalid_output");
    });
  });

  it("assertReadOnly allows a WITH ... SELECT", () => {
    assert.doesNotThrow(() => assertReadOnly("WITH t AS (SELECT 1) SELECT * FROM t"));
  });

  it("assertReadOnly allows a column named updated_at", () => {
    assert.doesNotThrow(() => assertReadOnly("SELECT id, updated_at FROM orders"));
  });
});

describe("Authorization header", () => {
  it("is sent when AI_API_KEY is set", async () => {
    await withFakeServer(async (fake) => {
      const provider = providerFor(fake.baseURL, { AI_API_KEY: "sk-test-123" });
      assert.deepEqual(await provider.check(), { ok: true });
      assert.equal(lastRequest(fake).headers.authorization, "Bearer sk-test-123");

      fake.reply = { content: JSON.stringify({ suggestions: [] }) };
      await suggestFixes(provider, sampleProfile(3));
      assert.equal(lastRequest(fake).headers.authorization, "Bearer sk-test-123");
    });
  });

  it("is absent when AI_API_KEY is not set", async () => {
    await withFakeServer(async (fake) => {
      const provider = providerFor(fake.baseURL);
      assert.deepEqual(await provider.check(), { ok: true });
      assert.equal(lastRequest(fake).headers.authorization, undefined);

      fake.reply = { content: JSON.stringify({ suggestions: [] }) };
      await suggestFixes(provider, sampleProfile(3));
      assert.equal(lastRequest(fake).headers.authorization, undefined);
    });
  });
});
