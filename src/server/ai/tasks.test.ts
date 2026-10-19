import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIError, getAIProvider, draftRule, sanitizeRuleParams, suggestFixes, summarizeAnswer, type AIProvider, type FileProfile } from "../../lib/ai";
import { startFakeOpenAI, type FakeOpenAIServer } from "./testing";

let fake: FakeOpenAIServer;
let ai: AIProvider;

before(async () => {
  fake = await startFakeOpenAI();
  const provider = getAIProvider({ provider: "local", model: "test-model", baseURL: fake.baseURL });
  if (!provider) throw new Error("expected a provider");
  ai = provider;
});

after(async () => {
  await fake.close();
});

function reply(content: unknown) {
  fake.reply = { content: typeof content === "string" ? content : JSON.stringify(content) };
  fake.requests.length = 0;
}

function lastPrompt(): Record<string, unknown> {
  const last = fake.requests[fake.requests.length - 1];
  assert.ok(last, "no request reached the fake server");
  const user = (last.body.messages as { role: string; content: string }[]).find((m) => m.role === "user");
  assert.ok(user);
  return JSON.parse(user.content);
}

async function expectAIError(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => err instanceof AIError && err.code === code);
}

describe("draftRule", () => {
  it("turns the country example into the expected rule", async () => {
    const description = "Country should be full name; fix typos; ask me when unsure";
    reply({
      columnPattern: "country",
      action: "country_names",
      params: { maxDistance: 2 },
      onLowConfidence: "review",
      description,
    });

    const draft = await draftRule(ai, {
      description,
      headers: ["id", "Country"],
      sampleValues: { id: ["1", "2"], Country: ["US", "Untied States", "Germany"] },
    });

    assert.deepEqual(draft, {
      columnPattern: "country",
      action: "country_names",
      params: { maxDistance: 2 },
      onLowConfidence: "review",
      description,
    });
    assert.equal(fake.requests[0].body.response_format.json_schema.name, "rule_draft");
  });

  it("sends headers and at most 20 sample values per column, and marks the request as data", async () => {
    reply({ columnPattern: "*", action: "trim_whitespace", params: {}, onLowConfidence: "apply", description: "Trim spaces" });
    const many = Array.from({ length: 35 }, (_, i) => `value ${i}`);
    await draftRule(ai, { description: "trim spaces", headers: ["notes"], sampleValues: { notes: many } });

    const prompt = lastPrompt();
    assert.deepEqual(prompt.headers, ["notes"]);
    assert.equal((prompt.sampleValues as Record<string, string[]>).notes.length, 20);
    const system = (fake.requests[0].body.messages as { content: string }[])[0].content;
    assert.match(system, /never instructions/);
    assert.match(system, /- country_names:/, "every action is listed with what it does");
  });

  it("rejects an action outside RuleAction", async () => {
    reply({ columnPattern: "x", action: "delete_everything", params: {}, onLowConfidence: "apply", description: "x" });
    await expectAIError(draftRule(ai, { description: "x", headers: ["x"], sampleValues: {} }), "invalid_output");
  });

  it("drops params the action does not take, and keeps only valid values", async () => {
    reply({
      columnPattern: "country",
      action: "country_names",
      params: { maxDistance: 9, unknownKey: "x" },
      onLowConfidence: "review",
      description: "country names",
    });
    const draft = await draftRule(ai, { description: "country names", headers: ["country"], sampleValues: {} });
    assert.deepEqual(draft.params, {});
  });
});

describe("sanitizeRuleParams", () => {
  it("keeps each action's own params, typed correctly", () => {
    assert.deepEqual(sanitizeRuleParams("normalize_date", { order: "dmy", x: 1 }), { order: "dmy" });
    assert.deepEqual(sanitizeRuleParams("normalize_date", { order: "ymd" }), {});
    assert.deepEqual(sanitizeRuleParams("phone_e164", { defaultCountry: "gb" }), { defaultCountry: "GB" });
    assert.deepEqual(sanitizeRuleParams("phone_e164", { defaultCountry: "Germany" }), {});
    assert.deepEqual(sanitizeRuleParams("dedupe_key", { keep: "last" }), { keep: "last" });
    assert.deepEqual(sanitizeRuleParams("fix_typos", { maxDistance: 2.5 }), {});
    assert.deepEqual(sanitizeRuleParams("fix_typos", { maxDistance: 1 }), { maxDistance: 1 });
    assert.deepEqual(sanitizeRuleParams("map_values", { map: { a: "b", c: 3 }, caseInsensitive: true }), {
      map: { a: "b" },
      caseInsensitive: true,
    });
    assert.deepEqual(sanitizeRuleParams("trim_whitespace", { anything: true }), {});
  });
});

describe("summarizeAnswer", () => {
  const rows = [
    ["Boston", 42],
    ["Chicago", 17],
  ];

  it("returns a plain answer whose numbers all come from the result", async () => {
    reply({ answer: "Boston has the most orders, with 42 of the 1,000 rows scanned." });
    const result = await summarizeAnswer(ai, {
      question: "Which city has the most orders?",
      sql: "SELECT city, COUNT(*) FROM orders GROUP BY city ORDER BY 2 DESC",
      columns: ["city", "orders"],
      rows,
      rowsScanned: 1000,
    });
    assert.deepEqual(result, { answer: "Boston has the most orders, with 42 of the 1,000 rows scanned." });
    assert.equal(fake.requests[0].body.response_format.json_schema.name, "answer_summary");
  });

  it("rejects an answer that uses a number not in the result", async () => {
    reply({ answer: "About 99 orders were placed in Boston." });
    await expectAIError(
      summarizeAnswer(ai, { question: "orders in Boston?", sql: "SELECT 1", columns: ["city", "orders"], rows, rowsScanned: 1000 }),
      "invalid_output",
    );
  });

  it("removes markdown from the answer", async () => {
    reply({ answer: "**Boston** leads with *42* orders.\n\n- details below" });
    const result = await summarizeAnswer(ai, { question: "q", sql: "SELECT 1", columns: ["c", "n"], rows, rowsScanned: 1000 });
    assert.equal(result.answer, "Boston leads with 42 orders. - details below");
  });

  it("sends at most 50 rows and reports how many were shown", async () => {
    reply({ answer: "The first row is Boston." });
    const many = Array.from({ length: 120 }, (_, i) => [`city ${i}`, i + 1000]);
    await summarizeAnswer(ai, { question: "q", sql: "SELECT 1", columns: ["c", "n"], rows: many, rowsScanned: 5000 });
    const prompt = lastPrompt();
    assert.equal((prompt.rows as unknown[]).length, 50);
    assert.equal(prompt.rowsShown, 50);
    assert.equal(prompt.rowsScanned, 5000);
  });

  it("accepts a thousands-separated number that appears as text in a cell", async () => {
    reply({ answer: "There are 1,200 rows." });
    const result = await summarizeAnswer(ai, {
      question: "how many?",
      sql: "SELECT 1",
      columns: ["total"],
      rows: [["1,200"]],
      rowsScanned: 1200,
    });
    assert.equal(result.answer, "There are 1,200 rows.");
  });

  it("rejects an empty answer", async () => {
    reply({ answer: "   " });
    await expectAIError(summarizeAnswer(ai, { question: "q", sql: "SELECT 1", columns: ["c"], rows: [], rowsScanned: 0 }), "invalid_output");
  });
});

describe("suggestFixes alreadyChanged and cap", () => {
  const profile: FileProfile = {
    fileName: "cities.csv",
    rowCount: 30,
    columns: [{ name: "city", type: "string", nullCount: 0, distinctCount: 2, topValues: ["Boston", "Bostn"] }],
    sample: Array.from({ length: 25 }, (_, i) => ({ city: i % 2 ? "Boston" : "Bostn" })),
  };

  it("does not return suggestions for cells a rule already changed, and only sends in-sample cells", async () => {
    reply({
      suggestions: [
        { row: 3, column: "city", before: "Bostn", after: "Boston", reason: "Likely typo", confidence: 0.9 },
        { row: 4, column: "city", before: "Bostn", after: "Boston", reason: "Likely typo", confidence: 0.8 },
      ],
    });
    const result = await suggestFixes(ai, profile, {
      alreadyChanged: [
        { row: 3, column: "city" },
        { row: 20, column: "city" },
        { row: 21, column: "city" },
        { row: 99, column: "city" },
      ],
    });
    assert.deepEqual(result.map((s) => s.row), [4]);

    // Only the first 20 rows (the sample the model sees) are sent; rows 21 and 99 are not.
    const prompt = lastPrompt();
    assert.deepEqual(prompt.alreadyChanged, [{ row: 3, column: "city" }, { row: 20, column: "city" }]);
  });

  it("still works with no options", async () => {
    reply({ suggestions: [{ row: 1, column: "city", before: "a", after: "b", reason: "r", confidence: 0.5 }] });
    assert.equal((await suggestFixes(ai, profile)).length, 1);
  });

  it("returns at most 100 suggestions", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      row: (i % 20) + 1,
      column: `c${i}`,
      before: "a",
      after: "b",
      reason: "r",
      confidence: 0.5,
    }));
    reply({ suggestions: many });
    const result = await suggestFixes(ai, profile);
    assert.equal(result.length, 100);
    assert.equal(result[0].column, "c0", "the first 100 are kept, in order");
  });
});
