import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getAIProvider, type AIProvider } from "../../lib/ai";
import { QueryRejectedError } from "../query";
import type { DB } from "../db";
import { insertTestUser, setupTestEnv } from "../testing";
import { AI_OFF_MESSAGE, FALLBACK_ANSWER, NO_FILES_MESSAGE } from "./copy";
import { answerQuestion, changeJoins, confirmJoins } from "./answer";
import { createChat, listMessages, resolveChatTables } from "./repo";
import type { ChatMessageView } from "./types";
import { CUSTOMERS_CSV, ORDERS_CSV, addStoredFile, startFakeAskServer, type FakeAskServer } from "./test-support";

const JOIN_SQL =
  "SELECT c.company, SUM(o.amount) AS total FROM orders o JOIN customers c ON o.customer_email = c.email GROUP BY c.company ORDER BY total DESC";

let conn: DB;
let fake: FakeAskServer;
let ai: AIProvider;
let userId: string;

/** The newest assistant or user message of a chat. */
function lastMessage(chatId: string, role: "user" | "assistant" = "assistant"): ChatMessageView {
  const messages = listMessages(userId, chatId).filter((m) => m.role === role);
  const last = messages[messages.length - 1];
  assert.ok(last, `no ${role} message`);
  return last;
}

describe("ask flow with a fake AI server and real DuckDB", () => {
  before(async () => {
    ({ db: conn } = setupTestEnv());
    insertTestUser(conn, "user_ask", "ask@example.test");
    userId = "user_ask";
    fake = await startFakeAskServer();
    ai = getAIProvider({ provider: "local", model: "test-model", baseURL: fake.baseURL }) as AIProvider;
  });
  after(async () => {
    await fake.close();
    conn.close();
  });

  it("answers a single-file question with a table, the SQL and a checked result", async () => {
    const orders = addStoredFile(userId, "orders_2026.csv", "orders", ORDERS_CSV);
    const chatId = await createChat(userId, [orders]);
    fake.plans = ["SELECT COUNT(*) AS n FROM orders"];
    fake.summary = JSON.stringify({ answer: "There are 4 orders." });

    await answerQuestion(userId, chatId, "How many orders are there?", ai);

    const answer = lastMessage(chatId);
    assert.equal(answer.status, "done");
    assert.equal(answer.content, "There are 4 orders.");
    assert.equal(answer.sql, "SELECT COUNT(*) AS n FROM orders");
    assert.deepEqual(answer.result?.rows, [[4]]);
    assert.equal(answer.result?.rowsScanned, 4);
    assert.equal(answer.result?.truncated, false);
    assert.deepEqual(answer.result?.notes, []);
    assert.deepEqual(answer.joins?.joins, [], "no joins for one file");
    assert.equal(answer.joins?.confirmed, false);
  });

  it("asks the user to confirm joins before running a query over two files", async () => {
    const orders = addStoredFile(userId, "orders_2026.csv", "orders", ORDERS_CSV);
    const customers = addStoredFile(userId, "crm_export_q3.csv", "customers", CUSTOMERS_CSV);
    const chatId = await createChat(userId, [orders, customers]);
    fake.plans = [JOIN_SQL];
    fake.summary = JSON.stringify({ answer: "Globex had the most order value, at 250." });
    const before = fake.requests.length;

    await answerQuestion(userId, chatId, "Which company has the most order value?", ai);

    const card = lastMessage(chatId);
    assert.equal(card.status, "needs_confirmation");
    assert.equal(card.result, null, "nothing is run before the user confirms");
    assert.equal(card.sql, JOIN_SQL);
    assert.deepEqual(card.joins?.joins.map((j) => `${j.left.alias}.${j.left.column}>${j.right.alias}.${j.right.column}`), [
      "orders.customer_email>customers.email",
    ]);
    assert.equal(card.joins?.joins[0].matchRate, 0.75);
    assert.equal(card.joins?.confirmed, false);
    assert.ok(card.joins?.candidates.some((c) => c.left.column === "customer_email" && c.right.column === "email"));
    assert.equal(fake.requests.length - before, 1, "only the planning call is made");

    await confirmJoins(userId, card.id, ai);

    const done = listMessages(userId, chatId).find((m) => m.id === card.id);
    assert.equal(done?.status, "done");
    assert.equal(done?.joins?.confirmed, true);
    assert.deepEqual(done?.result?.rows, [
      ["Globex", 250],
      ["Acme Corp", 175],
    ]);
    assert.equal(done?.result?.rowsScanned, 6);
    assert.deepEqual(done?.result?.notes, [
      "1 row from orders had no matching row in customers and were left out.",
    ]);
    assert.equal(done?.content, "Globex had the most order value, at 250.");
  });

  it("reuses the confirmed joins for the next question over the same files, and hints them to the planner", async () => {
    const orders = addStoredFile(userId, "orders_2026.csv", "orders", ORDERS_CSV);
    const customers = addStoredFile(userId, "crm_export_q3.csv", "customers", CUSTOMERS_CSV);
    const chatId = await createChat(userId, [orders, customers]);
    const card = await askAndGetCard(chatId, JOIN_SQL);
    await confirmJoins(userId, card.id, ai);

    fake.plans = [JOIN_SQL];
    fake.summary = JSON.stringify({ answer: "Globex leads with 250." });
    await answerQuestion(userId, chatId, "And by country?", ai);

    const answer = lastMessage(chatId);
    assert.equal(answer.status, "done", "no second confirmation is asked");
    assert.equal(answer.content, "Globex leads with 250.");
    assertLastPlanHasHint();
  });

  it("lets the user change the join columns, and plans the query again with that pair", async () => {
    const orders = addStoredFile(userId, "orders_2026.csv", "orders", ORDERS_CSV);
    const customers = addStoredFile(userId, "crm_export_q3.csv", "customers", CUSTOMERS_CSV);
    const chatId = await createChat(userId, [orders, customers]);
    const card = await askAndGetCard(chatId, JOIN_SQL);
    const index = card.joins!.candidates.findIndex((c) => c.left.column === "customer_email");
    assert.ok(index >= 0);

    const changed = JOIN_SQL.replace("o.customer_email = c.email", "o.customer_email = c.email AND 1 = 1");
    fake.plans = [changed];
    await changeJoins(userId, card.id, index, ai);

    const after = listMessages(userId, chatId).find((m) => m.id === card.id);
    assert.equal(after?.status, "needs_confirmation");
    assert.equal(after?.sql, changed);
    assert.equal(after?.joins?.confirmed, false);
    assert.equal(after?.joins?.joins.length, 1);
    assertLastPlanHasHint();

    await assert.rejects(changeJoins(userId, card.id, 999, ai), (err: unknown) => err instanceof Error && /Pick one/.test(err.message));
  });

  it("writes a blocked answer when DuckDB refuses the query, and rethrows it for the job record", async () => {
    const orders = addStoredFile(userId, "orders_2026.csv", "orders", ORDERS_CSV);
    const chatId = await createChat(userId, [orders]);
    fake.plans = ["SELECT * FROM table_that_does_not_exist"];

    await assert.rejects(answerQuestion(userId, chatId, "Show the missing table", ai), QueryRejectedError);

    const blocked = lastMessage(chatId);
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.content, /^I couldn't run that query: /);
    assert.equal(blocked.result, null);
  });

  it("refuses a write statement before any file is read", async () => {
    const orders = addStoredFile(userId, "orders_2026.csv", "orders", ORDERS_CSV);
    const chatId = await createChat(userId, [orders]);
    fake.plans = ["DELETE FROM orders"];

    await assert.rejects(answerQuestion(userId, chatId, "Delete everything", ai));
    const answer = lastMessage(chatId);
    assert.equal(answer.status, "failed");
    assert.match(answer.content, /could not write a query I can run/);
  });

  it("uses the fallback sentence when the answer uses a number that is not in the result", async () => {
    const orders = addStoredFile(userId, "orders_2026.csv", "orders", ORDERS_CSV);
    const chatId = await createChat(userId, [orders]);
    fake.plans = ["SELECT COUNT(*) AS n FROM orders"];
    fake.summary = JSON.stringify({ answer: "There are 99 orders." });

    await answerQuestion(userId, chatId, "How many?", ai);

    const answer = lastMessage(chatId);
    assert.equal(answer.status, "done");
    assert.equal(answer.content, FALLBACK_ANSWER);
    assert.deepEqual(answer.result?.rows, [[4]]);
  });

  it("says AI is off and makes no query when there is no provider", async () => {
    const orders = addStoredFile(userId, "orders_2026.csv", "orders", ORDERS_CSV);
    const chatId = await createChat(userId, [orders]);
    const before = fake.requests.length;

    await answerQuestion(userId, chatId, "How many?", null);

    const note = lastMessage(chatId);
    assert.equal(note.content, AI_OFF_MESSAGE);
    assert.equal(note.result, null);
    assert.equal(fake.requests.length, before);
  });

  it("says so when none of the chat's files can be read", async () => {
    const gone = addStoredFile(userId, "gone.csv", "gone", ORDERS_CSV);
    const chatId = await createChat(userId, [gone]);
    conn.prepare("UPDATE files SET status = 'deleted', storage_path = NULL WHERE id = ?").run(gone);

    await answerQuestion(userId, chatId, "How many?", ai);

    const note = lastMessage(chatId);
    assert.equal(note.content, NO_FILES_MESSAGE);
    assert.equal(note.status, "failed");
  });

  it("shows the friendly text for an AI service that cannot be reached", async () => {
    const orders = addStoredFile(userId, "orders_2026.csv", "orders", ORDERS_CSV);
    const chatId = await createChat(userId, [orders]);
    const unreachable = getAIProvider({ provider: "local", model: "m", baseURL: "http://127.0.0.1:1/v1" }) as AIProvider;

    await assert.rejects(answerQuestion(userId, chatId, "How many?", unreachable));
    const note = lastMessage(chatId);
    assert.equal(note.status, "failed");
    assert.equal(note.content, "The AI service could not be reached. Try again, or check the AI settings.");
    assert.equal((await resolveChatTables(userId, chatId)).tables.length, 1);
  });
});

/** The last planning request (the summary call comes after the query) carries the confirmed join. */
function assertLastPlanHasHint() {
  const plan = [...fake.requests].reverse().find((r) => r.schema === "query_plan");
  assert.ok(plan, "a planning request was made");
  assert.match(plan.prompt, /join them on: orders\.customer_email = customers\.email/);
}

/** Asks a two-file question with a join, returns the confirmation card. */
async function askAndGetCard(chatId: string, sql: string): Promise<ChatMessageView> {
  fake.plans = [sql];
  await answerQuestion(userId, chatId, "Which company has the most order value?", ai);
  const card = lastMessage(chatId);
  assert.equal(card.status, "needs_confirmation");
  return card;
}
