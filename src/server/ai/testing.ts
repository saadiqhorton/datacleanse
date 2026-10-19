import http from "node:http";
import type { AddressInfo } from "node:net";

/** What the fake server answers to POST /chat/completions. */
export interface FakeReply {
  status?: number;
  /** Assistant message content. Defaults to "". */
  content?: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture, shape checked per test
  body: any;
}

export interface FakeOpenAIServer {
  /** Base URL ending in /v1, as an OpenAI-compatible client expects. */
  baseURL: string;
  requests: RecordedRequest[];
  reply: FakeReply;
  close(): Promise<void>;
}

/** A local OpenAI-compatible server for tests. Records every request. Never leaves the machine. */
export async function startFakeOpenAI(): Promise<FakeOpenAIServer> {
  const fake: FakeOpenAIServer = { baseURL: "", requests: [], reply: {}, close: async () => {} };

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
    fake.requests.push({ method: req.method ?? "", path, headers: req.headers, body });
    res.setHeader("content-type", "application/json");

    if (req.method === "POST" && path === "/v1/chat/completions") {
      const status = fake.reply.status ?? 200;
      if (status >= 400) {
        res.writeHead(status);
        res.end(JSON.stringify({ error: { message: "fake server error" } }));
        return;
      }
      res.writeHead(200);
      res.end(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "test-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: fake.reply.content ?? "" },
              finish_reason: "stop",
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
