import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A scriptable OpenAI-compatible server standing in for a local model (Ollama / LM Studio).
 * Point the app at it with AI_PROVIDER=local AI_BASE_URL=<fake.baseURL> AI_MODEL=test-model,
 * or via Admin › Configuration / Settings › Your API key.
 */
export interface FakeAI {
  baseURL: string;
  /** Requests received, newest last (parsed JSON bodies). */
  requests: { path: string; body: any; headers: http.IncomingHttpHeaders }[];
  /** Reply by response_format.json_schema.name (e.g. "fix_suggestions", "query_plan", "answer_summary"). */
  reply(schemaName: string, json: unknown): void;
  /** Make every chat request fail with this HTTP status until cleared (null). */
  failWith(status: number | null): void;
  stop(): Promise<void>;
}

export async function startFakeAI(): Promise<FakeAI> {
  const replies = new Map<string, unknown>();
  let failStatus: number | null = null;
  const requests: FakeAI["requests"] = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ path: req.url ?? "", body, headers: req.headers });
    res.setHeader("content-type", "application/json");
    if (req.url?.endsWith("/models")) {
      res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
      return;
    }
    if (failStatus) {
      res.statusCode = failStatus;
      res.end(JSON.stringify({ error: { message: "fake failure" } }));
      return;
    }
    const name: string = body?.response_format?.json_schema?.name ?? "";
    const content = replies.has(name) ? replies.get(name) : defaultReply(name);
    res.end(
      JSON.stringify({
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    reply: (name, json) => replies.set(name, json),
    failWith: (s) => (failStatus = s),
    stop: () => new Promise((r) => server.close(() => r())),
  };
}

function defaultReply(name: string): unknown {
  switch (name) {
    case "fix_suggestions":
      return { suggestions: [] };
    case "answer_summary":
      return { answer: "Here are the results." };
    default:
      return {};
  }
}
