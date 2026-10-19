import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { QueryTable } from "../types";
import { describeTables, suggestJoins, unmatchedCount } from "./profile";

let dir: string;
let tables: QueryTable[];

// 9 non-empty customer_email values: 7 exist in customers, 2 do not. 1 is empty.
const ORDERS = [
  "order_id,customer_email,amount",
  "1,jane@acme.io,10",
  "2,jane@acme.io,20",
  "3,bob@acme.io,5",
  "4,kim@acme.io,7",
  "5,bob@acme.io,8",
  "6,ghost@acme.io,9",
  "7,jane@acme.io,11",
  "8,kim@acme.io,12",
  "9,nobody@x.io,13",
  "10,,14",
].join("\n");

// 5 customers. 4 of them appear in orders.customer_email.
const CUSTOMERS = [
  "id,email,plan",
  "1,jane@acme.io,starter",
  "2,bob@acme.io,team",
  "3,kim@acme.io,team",
  "4,lee@acme.io,free",
  "5,pat@acme.io,free",
].join("\n");

const WIDGETS = ["sku,color", "A1,red", "B2,blue", "C3,green"].join("\n");

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-query-profile-"));
  fs.writeFileSync(path.join(dir, "orders.csv"), ORDERS);
  fs.writeFileSync(path.join(dir, "customers.csv"), CUSTOMERS);
  fs.writeFileSync(path.join(dir, "widgets.csv"), WIDGETS);
  tables = [
    { alias: "orders", path: path.join(dir, "orders.csv") },
    { alias: "customers", path: path.join(dir, "customers.csv") },
  ];
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("describeTables", () => {
  test("reports row counts, DuckDB types, null and distinct counts and top values", async () => {
    const [orders, customers] = await describeTables(tables);

    assert.equal(orders.alias, "orders");
    assert.equal(orders.rowCount, 10);
    const email = orders.columns.find((c) => c.name === "customer_email");
    assert.ok(email);
    assert.equal(email.type, "VARCHAR");
    assert.equal(email.nullCount, 1);
    assert.equal(email.distinctCount, 5); // jane, bob, kim, ghost, nobody
    assert.equal(email.topValues?.[0], "jane@acme.io");
    assert.equal(email.topValues?.length, 5);

    const amount = orders.columns.find((c) => c.name === "amount");
    assert.equal(amount?.type, "BIGINT");

    assert.equal(customers.rowCount, 5);
    assert.equal(customers.columns.find((c) => c.name === "id")?.distinctCount, 5);
  });

  test("truncates top values to 80 characters", async () => {
    const longDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-query-long-"));
    try {
      const file = path.join(longDir, "long.csv");
      fs.writeFileSync(file, `note\n${"x".repeat(200)}\n${"x".repeat(200)}\n`);
      const [profile] = await describeTables([{ alias: "notes", path: file }]);
      assert.equal(profile.columns[0].topValues?.[0].length, 80);
    } finally {
      fs.rmSync(longDir, { recursive: true, force: true });
    }
  });
});

describe("suggestJoins", () => {
  test("finds orders.customer_email -> customers.email with the right match rate", async () => {
    const suggestions = await suggestJoins(tables);
    const hit = suggestions.find(
      (s) =>
        s.left.alias === "orders" &&
        s.left.column === "customer_email" &&
        s.right.alias === "customers" &&
        s.right.column === "email",
    );
    assert.ok(hit, `expected orders.customer_email -> customers.email in ${JSON.stringify(suggestions)}`);
    // 7 of the 9 non-null order emails are customers.
    assert.equal(hit.matchRate, 0.7778);
  });

  test("suggests the reverse direction too, one best candidate per direction, best first", async () => {
    const suggestions = await suggestJoins(tables);
    const reverse = suggestions.find((s) => s.left.alias === "customers" && s.right.alias === "orders");
    assert.ok(reverse, "customers -> orders should be suggested");
    assert.equal(reverse.left.column, "email");
    assert.equal(reverse.right.column, "customer_email");
    assert.equal(reverse.matchRate, 0.6); // 3 of 5 customers appear in orders
    // Sorted best first.
    for (let i = 1; i < suggestions.length; i++) {
      assert.ok(suggestions[i - 1].matchRate >= suggestions[i].matchRate);
    }
    // At most one suggestion per direction.
    const keys = suggestions.map((s) => `${s.left.alias}>${s.right.alias}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  test("drops pairs below 0.5 match rate", async () => {
    const suggestions = await suggestJoins([
      ...tables,
      { alias: "widgets", path: path.join(dir, "widgets.csv") },
    ]);
    assert.ok(suggestions.every((s) => s.matchRate >= 0.5));
    assert.ok(!suggestions.some((s) => s.left.alias === "widgets" || s.right.alias === "widgets"));
  });

  test("returns nothing for a single table", async () => {
    assert.deepEqual(await suggestJoins([tables[0]]), []);
  });

  test("matches <table>_id against id", async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "dc-query-ids-"));
    try {
      fs.writeFileSync(path.join(dir2, "line_items.csv"), "order_id,sku\n1,A\n1,B\n2,A\n3,C\n");
      fs.writeFileSync(path.join(dir2, "orders.csv"), "id,total\n1,10\n2,20\n3,30\n4,40\n");
      const suggestions = await suggestJoins([
        { alias: "line_items", path: path.join(dir2, "line_items.csv") },
        { alias: "orders", path: path.join(dir2, "orders.csv") },
      ]);
      const hit = suggestions.find((s) => s.left.alias === "line_items" && s.right.alias === "orders");
      assert.ok(hit);
      assert.equal(hit.left.column, "order_id");
      assert.equal(hit.right.column, "id");
      assert.equal(hit.matchRate, 1);
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe("unmatchedCount", () => {
  test("counts NULL keys and keys missing on the right", async () => {
    const suggestions = await suggestJoins(tables);
    const join = suggestions.find(
      (s) => s.left.alias === "orders" && s.left.column === "customer_email",
    );
    assert.ok(join);
    // One empty email and two emails not in customers.
    assert.equal(await unmatchedCount(tables, join), 3);
  });

  test("rejects unknown tables and columns", async () => {
    await assert.rejects(
      unmatchedCount(tables, {
        left: { alias: "nope", column: "x" },
        right: { alias: "customers", column: "email" },
        matchRate: 1,
      }),
      /Unknown table/,
    );
    await assert.rejects(
      unmatchedCount(tables, {
        left: { alias: "orders", column: 'x" FROM customers --' },
        right: { alias: "customers", column: "email" },
        matchRate: 1,
      }),
      /Unknown column/,
    );
  });
});
