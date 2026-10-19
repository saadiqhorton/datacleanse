import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { QueryTable } from "../types";
import { QueryRejectedError, QueryTimeoutError, runReadOnlyQuery } from "./run";

let dir: string;
let tables: QueryTable[];

const ORDERS = [
  "order_id,customer_email,amount,placed_on",
  "1,jane@acme.io,10.50,2024-01-03",
  "2,jane@acme.io,20.00,2024-01-04",
  "3,bob@acme.io,5.25,2024-02-01",
  "4,,7.00,2024-02-02",
  "5,nobody@x.io,1.00,2024-02-03",
].join("\n");

const CUSTOMERS = ["email,plan", "jane@acme.io,starter", "bob@acme.io,team", "kim@acme.io,team"].join("\n");

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-query-run-"));
  fs.writeFileSync(path.join(dir, "orders.csv"), ORDERS);
  fs.writeFileSync(path.join(dir, "customers.csv"), CUSTOMERS);
  tables = [
    { alias: "orders", path: path.join(dir, "orders.csv") },
    { alias: "customers", path: path.join(dir, "customers.csv") },
  ];
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function rejects(sql: string, pattern?: RegExp) {
  await assert.rejects(runReadOnlyQuery({ tables, sql }), (err: unknown) => {
    assert.ok(err instanceof QueryRejectedError, `expected QueryRejectedError, got ${String(err)}`);
    if (pattern) assert.match(err.reason, pattern);
    return true;
  });
}

describe("runReadOnlyQuery", () => {
  test("joins two CSVs and aggregates", async () => {
    const result = await runReadOnlyQuery({
      tables,
      sql: `SELECT c.plan, SUM(o.amount) AS total, COUNT(*) AS orders
            FROM orders o JOIN customers c ON o.customer_email = c.email
            GROUP BY c.plan ORDER BY c.plan`,
    });
    assert.deepEqual(result.columns, ["plan", "total", "orders"]);
    assert.deepEqual(result.rows, [
      ["starter", 30.5, 2],
      ["team", 5.25, 1],
    ]);
    assert.equal(result.truncated, false);
    assert.equal(result.rowsScanned, 5 + 3);
    assert.equal(typeof result.ms, "number");
  });

  test("accepts WITH, UNION and a trailing semicolon", async () => {
    const result = await runReadOnlyQuery({
      tables,
      sql: `WITH big AS (SELECT * FROM orders WHERE amount > 6)
            SELECT COUNT(*) AS n FROM big UNION ALL SELECT 0;`,
    });
    assert.deepEqual(result.rows.length, 2);
  });

  test("truncates at maxRows and reports it", async () => {
    const sql = "SELECT * FROM orders ORDER BY order_id";
    const cut = await runReadOnlyQuery({ tables, sql, maxRows: 2 });
    assert.equal(cut.rows.length, 2);
    assert.equal(cut.truncated, true);

    const exact = await runReadOnlyQuery({ tables, sql, maxRows: 5 });
    assert.equal(exact.rows.length, 5);
    assert.equal(exact.truncated, false);
  });

  test("converts BIGINT, DECIMAL, DATE, TIMESTAMP, BLOB and NULL to JSON-safe values", async () => {
    const result = await runReadOnlyQuery({
      tables,
      sql: `SELECT 42::BIGINT AS small,
                   9007199254740993::BIGINT AS big,
                   3.50::DECIMAL(10,2) AS dec,
                   DATE '2024-01-02' AS d,
                   TIMESTAMP '2024-01-02 03:04:05' AS ts,
                   '\\x01'::BLOB AS blob,
                   NULL::INTEGER AS nothing,
                   TRUE AS flag,
                   TIME '01:02:03' AS t`,
      maxRows: 1,
    });
    const [row] = result.rows;
    assert.equal(row[0], 42);
    assert.equal(typeof row[0], "number");
    assert.equal(row[1], "9007199254740993");
    assert.equal(row[2], 3.5);
    assert.equal(row[3], "2024-01-02");
    assert.equal(row[4], "2024-01-02T03:04:05.000Z");
    assert.equal(row[5], null);
    assert.equal(row[6], null);
    assert.equal(row[7], true);
    assert.equal(row[8], "01:02:03");
  });

  test("rejects DROP, INSERT, UPDATE and DELETE", async () => {
    await rejects("DROP TABLE orders", /SELECT|read-only/);
    await rejects("INSERT INTO customers VALUES ('a', 'b')", /SELECT|read-only/);
    await rejects("UPDATE customers SET plan = 'x'", /SELECT|read-only/);
    await rejects("DELETE FROM orders", /SELECT|read-only/);
  });

  test("rejects multi-statement input", async () => {
    await rejects("SELECT 1; DROP TABLE orders", /single statement/);
    await rejects("SELECT 1; SELECT 2", /single statement/);
  });

  test("rejects reads of files outside the tables", async () => {
    await rejects("SELECT * FROM read_csv('/etc/passwd')", /outside the chat/);
    await rejects("SELECT * FROM read_text('/etc/hosts')", /outside the chat/);
    await rejects("SELECT * FROM glob('/etc/*')", /outside the chat/);
  });

  test("rejects COPY, ATTACH, INSTALL, LOAD and SET", async () => {
    await rejects("COPY orders TO '/tmp/dc-should-not-exist.csv'", /SELECT|read-only/);
    await rejects("ATTACH '/tmp/dc-should-not-exist.db' AS evil", /SELECT|read-only/);
    await rejects("INSTALL httpfs", /SELECT|read-only/);
    await rejects("LOAD httpfs", /SELECT|read-only/);
    await rejects("SET enable_external_access = true", /SELECT|read-only/);
    await rejects("PRAGMA database_list", /SELECT|read-only/);
    assert.equal(fs.existsSync("/tmp/dc-should-not-exist.csv"), false);
  });

  test("rejects SQL that does not parse or names unknown tables", async () => {
    await rejects("SELEC * FROM orders", /must be a SELECT/);
    await rejects("SELECT * FROM orders WHERE", /syntax/i);
    await rejects("SELECT * FROM no_such_table", /no_such_table|does not exist|Catalog/i);
  });

  test("interrupts a heavy query at timeoutMs", async () => {
    const started = Date.now();
    await assert.rejects(
      runReadOnlyQuery({
        tables,
        sql: "SELECT SUM(a.range * b.range) AS s FROM range(100000) a, range(100000) b",
        timeoutMs: 200,
      }),
      (err: unknown) => err instanceof QueryTimeoutError,
    );
    assert.ok(Date.now() - started < 10_000, "timeout should return promptly");
  });

  test("rejects an alias that is not a safe identifier", async () => {
    await assert.rejects(
      runReadOnlyQuery({
        tables: [{ alias: 'orders"; DROP', path: path.join(dir, "orders.csv") }],
        sql: "SELECT 1",
      }),
      /Invalid table alias/,
    );
  });

  test("requires an absolute path that exists", async () => {
    await assert.rejects(
      runReadOnlyQuery({ tables: [{ alias: "t", path: "relative.csv" }], sql: "SELECT 1" }),
      /absolute file path/,
    );
    await assert.rejects(
      runReadOnlyQuery({ tables: [{ alias: "t", path: path.join(dir, "missing.csv") }], sql: "SELECT 1" }),
      /does not exist/,
    );
  });
});
