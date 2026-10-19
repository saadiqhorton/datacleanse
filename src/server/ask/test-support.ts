import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { env } from "../env";
import { db } from "../db";
import { newId } from "../ids";
import { cleanedRel, originalRel } from "../files/storage";

/** Writes a CSV for a user and inserts its files row. Returns the file id. */
export function addStoredFile(
  userId: string,
  name: string,
  alias: string,
  csv: string,
  opts: { cleaned?: string; status?: string } = {},
): string {
  const fileId = newId("file");
  const storage = originalRel(userId, fileId);
  writeRel(storage, csv);
  let cleanedPath: string | null = null;
  if (opts.cleaned !== undefined) {
    cleanedPath = cleanedRel(userId, fileId);
    writeRel(cleanedPath, opts.cleaned);
  }
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO files (id, user_id, original_name, alias, size_bytes, storage_path, cleaned_path, status,
         row_count, column_count, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fileId,
      userId,
      name,
      alias,
      Buffer.byteLength(csv),
      storage,
      cleanedPath,
      opts.status ?? "ready",
      Math.max(0, csv.trim().split("\n").length - 1),
      csv.split("\n")[0].split(",").length,
      now,
      now + 24 * 60 * 60 * 1000,
    );
  return fileId;
}

function writeRel(rel: string, text: string) {
  const abs = path.join(env.dataDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

export const ORDERS_CSV = [
  "order_id,customer_email,amount,order_date",
  "1,a@acme.test,100,2026-07-02",
  "2,b@globex.test,250,2026-07-05",
  "3,a@acme.test,75,2026-08-10",
  "4,ghost@nowhere.test,20,2026-08-11",
  "",
].join("\n");

export const CUSTOMERS_CSV = ["email,company", "a@acme.test,Acme Corp", "b@globex.test,Globex", ""].join("\n");

export interface FakeAskServer {
  baseURL: string;
  /** Planned SQL, returned in order for each query_plan call. The last entry repeats. */
  plans: string[];
  /** Raw JSON content for answer_summary calls. */
  summary: string;
  /** Every request, with the schema name and the user prompt. */
  requests: { schema: string; prompt: string }[];
  close(): Promise<void>;
}

/**
 * A local OpenAI-compatible server for the Ask flow. It answers query_plan and answer_summary requests
 * by schema name, so each test controls the SQL and the wording of the answer.
 */
export async function startFakeAskServer(): Promise<FakeAskServer> {
  const fake: FakeAskServer = {
    baseURL: "",
    plans: [],
    summary: JSON.stringify({ answer: "Here is the answer." }),
    requests: [],
    close: async () => {},
  };

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture
    const body: any = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const schema: string = body.response_format?.json_schema?.name ?? "";
    const prompt: string = body.messages?.[1]?.content ?? "";
    fake.requests.push({ schema, prompt });

    let content = "{}";
    if (schema === "query_plan") {
      const sql = fake.plans.length > 1 ? fake.plans.shift()! : (fake.plans[0] ?? "SELECT 1");
      content = JSON.stringify({ sql, explanation: "Test plan." });
    } else if (schema === "answer_summary") {
      content = fake.summary;
    }

    res.setHeader("content-type", "application/json");
    res.writeHead(200);
    res.end(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "test-model",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      }),
    );
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
