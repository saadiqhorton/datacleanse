import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { candidateNamesMatch, hasOuterJoin, proposedJoins, referencedAliases, sharedNameCandidates, withJoinHint } from "./joins";

describe("referencedAliases", () => {
  it("finds tables named in FROM, JOIN and as qualifiers, ignoring text in string literals", () => {
    const sql = "SELECT c.company, SUM(o.amount) FROM orders o JOIN customers c ON o.customer_email = c.email WHERE note = 'refunds'";
    assert.deepEqual(referencedAliases(sql, ["orders", "customers", "refunds"]), ["orders", "customers"]);
  });

  it("ignores comments and compares names without case", () => {
    const sql = "SELECT * FROM Orders -- join customers later\n";
    assert.deepEqual(referencedAliases(sql, ["orders", "customers"]), ["orders"]);
  });

  it("reads quoted identifiers", () => {
    assert.deepEqual(referencedAliases('SELECT "orders".id FROM "orders"', ["orders"]), ["orders"]);
  });
});

describe("hasOuterJoin", () => {
  it("is true only for LEFT, RIGHT or FULL joins", () => {
    assert.equal(hasOuterJoin("SELECT 1 FROM a LEFT OUTER JOIN b ON a.x = b.x"), true);
    assert.equal(hasOuterJoin("SELECT 1 FROM a JOIN b ON a.x = b.x"), false);
    assert.equal(hasOuterJoin("SELECT 'left join' FROM a"), false);
  });
});

describe("candidateNamesMatch", () => {
  it("matches equal names and a '<stem>_' prefix in either direction", () => {
    assert.equal(candidateNamesMatch("customer_email", "email"), true);
    assert.equal(candidateNamesMatch("order_id", "id"), true);
    assert.equal(candidateNamesMatch("Email", "email"), true);
    assert.equal(candidateNamesMatch("amount", "email"), false);
    assert.equal(candidateNamesMatch("myemail", "email"), false);
  });
});

describe("sharedNameCandidates", () => {
  it("lists column pairs across tables, with the left alias first", () => {
    const pairs = sharedNameCandidates([
      { alias: "orders", columns: [{ name: "order_id" }, { name: "customer_email" }] },
      { alias: "customers", columns: [{ name: "email" }, { name: "company" }] },
    ]);
    assert.deepEqual(
      pairs.map((p) => `${p.left.alias}.${p.left.column}>${p.right.alias}.${p.right.column}`),
      ["orders.customer_email>customers.email"],
    );
    assert.equal(pairs[0].matchRate, null);
  });
});

describe("proposedJoins", () => {
  it("keeps the best suggestion per pair of referenced tables, highest rate first", () => {
    const joins = proposedJoins(
      [
        { left: { alias: "customers", column: "email" }, right: { alias: "orders", column: "customer_email" }, matchRate: 0.5 },
        { left: { alias: "orders", column: "customer_email" }, right: { alias: "customers", column: "email" }, matchRate: 0.75 },
        { left: { alias: "refunds", column: "order_id" }, right: { alias: "orders", column: "id" }, matchRate: 1 },
        { left: { alias: "refunds", column: "order_id" }, right: { alias: "other", column: "id" }, matchRate: 1 },
      ],
      ["orders", "customers", "refunds"],
    );
    assert.deepEqual(
      joins.map((j) => `${j.left.alias}>${j.right.alias}:${j.matchRate}`),
      ["refunds>orders:1", "orders>customers:0.75"],
    );
  });
});

describe("withJoinHint", () => {
  it("adds the join columns to the question, and leaves the question alone without joins", () => {
    const joins = [
      {
        left: { alias: "orders", column: "customer_email" },
        right: { alias: "customers", column: "email" },
        matchRate: 0.9,
      },
    ];
    assert.equal(withJoinHint("How many?", []), "How many?");
    assert.match(withJoinHint("How many?", joins), /join them on: orders\.customer_email = customers\.email\./);
  });
});
