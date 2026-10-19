import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { Table } from "../types";
import { DEFAULT_CLEAN_OPTIONS } from "../types";
import { applyChanges } from "./apply";
import { proposeChanges } from "./propose";
import { rulesFromOptions } from "./rules";

const ROWS = 500_000;
const HEADERS = ["id", "first_name", "last_name", "email", "signup_date", "phone", "country", "company", "notes", "city"];

/** Deterministic, realistic-ish CRM data: pooled values plus unique ids, emails and notes. */
function buildTable(rows: number): Table {
  const firsts = Array.from({ length: 300 }, (_, i) => (i % 3 === 0 ? `  ${"NAME" + i} ` : `name${i}`));
  const lasts = Array.from({ length: 300 }, (_, i) => `Last${i}`);
  const countries = ["Germany", "DE", "usa", "United States", "Gemany", "France", "FR", "United Kingdom", "Japan", "  Canada "];
  const companies = ["  acme corp. ", "IBM LLC", "globex", "initech inc.", "Umbrella, Ltd.", "hooli"];
  const cities = ["Berlin", "paris", "TOKYO", "new york", "  London"];
  const phones = ["(555)0142 x", "+44 20 7946 0958", "555.123.4567", "1-555-123-4567", "12345", "+1 555-0142"];
  const out: string[][] = new Array<string[]>(rows);
  for (let i = 0; i < rows; i++) {
    const mm = String((i % 12) + 1).padStart(2, "0");
    const dd = String((i % 28) + 1).padStart(2, "0");
    const yy = String(20 + (i % 5));
    out[i] = [
      String(i),
      firsts[i % 300],
      lasts[(i * 7) % 300],
      `user${i}@Example.COM`,
      i % 4 === 0 ? `${dd}/${mm}/${yy}` : `20${yy}-${mm}-${dd}`,
      phones[i % phones.length],
      countries[i % countries.length],
      companies[i % companies.length],
      `note  ${i}  with   spaces `,
      cities[i % cities.length],
    ];
  }
  return { headers: HEADERS, rows: out };
}

describe("performance smoke", () => {
  it("proposes changes for 500k rows x 10 columns in under 5 seconds", () => {
    const table = buildTable(ROWS);
    const rules = rulesFromOptions(DEFAULT_CLEAN_OPTIONS, table.headers);

    const started = performance.now();
    const changes = proposeChanges(table, rules);
    const ms = performance.now() - started;

    assert.ok(changes.length > ROWS, "expected many changes");
    assert.ok(ms < 5000, `proposeChanges took ${Math.round(ms)} ms`);

    const sample = changes.find((c) => c.rowIndex === 0 && c.column === "signup_date");
    assert.equal(sample?.after, "2020-01-01");
  });

  it("applies the proposed changes to 500k rows in a reasonable time", () => {
    const table = buildTable(ROWS);
    const changes = proposeChanges(table, rulesFromOptions(DEFAULT_CLEAN_OPTIONS, table.headers));
    const started = performance.now();
    const { table: cleaned, rowsRemoved } = applyChanges(table, changes);
    const ms = performance.now() - started;
    assert.equal(cleaned.rows.length + rowsRemoved, ROWS);
    assert.ok(ms < 5000, `applyChanges took ${Math.round(ms)} ms`);
  });
});
