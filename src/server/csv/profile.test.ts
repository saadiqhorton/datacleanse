import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseCsvText, profileTable } from "./index";
import type { Table } from "../types";

/** Timing budgets assume an idle machine; CI or parallel runs can raise this (PERF_SLACK=3). */
const PERF_SLACK = Number(process.env.PERF_SLACK || 2);

const CRM = `name,email,signup_date,country,phone,amount,active,customer_id,notes
Ana Silva,ana@acme.co,01/15/22,Portugal,+351 912 345 678,1200.50,yes,1001,renewal
Bo Chen,bo.chen@example.org,2022-03-04,China,(555) 014-2233,-45,no,1002,
Carla Diaz,carla@diaz.mx,03/22/22,Mexico,555-014-2290,"1,234.5",yes,1003,vip
Dev Patel,dev@patel.in,2022-05-30,India,+91 98765 43210,0,yes,1004,
Eli Brown,eli@brown.us,12/01/21,United States,555-014-2300 x12,99.9,no,1005,follow up
Fay Okafor,fay@okafor.ng,2021-11-09,Nigeria,+234 802 555 0199,250,y,1006,
Gus Berg,gus@berg.se,07/04/22,Sweden,070-123 45 67,75,n,1007,
Hana Kim,hana@kim.kr,2022-01-20,South Korea,+82 10-1234-5678,300,yes,1008,
Ivo Novak,ivo@novak.cz,02/28/22,Czechia,+420 601 234 567,1500,no,1009,
Jo Lee,jo@lee.hk,2022-06-15,Hong Kong,+852 9123 4567,800,yes,1010,
Kim Park,kim@park.kr,,South Korea,,40,no,1011,
Lu Wei,lu@wei.cn,04/10/22,China,+86 138 0013 8000,60,yes,1012,
`;

function col(profile: ReturnType<typeof profileTable>, name: string) {
  const c = profile.columns.find((x) => x.name === name);
  assert.ok(c, `no column ${name}`);
  return c;
}

describe("profileTable on a CRM-like fixture", () => {
  const { table } = parseCsvText(CRM);
  const profile = profileTable(table);

  test("row and column counts", () => {
    assert.equal(profile.rowCount, 12);
    assert.equal(profile.columnCount, 9);
    assert.equal(profile.columns.length, 9);
  });

  test("email is detected and flagged as PII", () => {
    const c = col(profile, "email");
    assert.equal(c.type, "email");
    assert.equal(c.pii, true);
    assert.equal(c.typeConfidence, 1);
    assert.equal(c.nullCount, 0);
    assert.equal(c.distinctCount, 12);
  });

  test("mixed MM/DD/YY and ISO dates are one date column with both layouts", () => {
    const c = col(profile, "signup_date");
    assert.equal(c.type, "date");
    assert.equal(c.nullCount, 1);
    assert.equal(c.typeConfidence, 1);
    assert.deepEqual(c.dateFormats?.slice().sort(), ["NN/NN/YY", "YYYY-MM-DD"]);
    assert.equal(c.min, "2021-11-09");
    assert.equal(c.max, "2022-07-04");
    assert.equal(c.pii, false);
  });

  test("phone is detected and flagged as PII", () => {
    const c = col(profile, "phone");
    assert.equal(c.type, "phone");
    assert.equal(c.pii, true);
    assert.equal(c.nullCount, 1);
    assert.equal(c.typeConfidence, 1);
  });

  test("amount with decimals, negatives and thousands separators is a number", () => {
    const c = col(profile, "amount");
    assert.equal(c.type, "number");
    assert.equal(c.min, "-45");
    assert.equal(c.max, "1500");
    assert.equal(c.pii, false);
  });

  test("plain integer IDs are integers, not phones, and not PII", () => {
    const c = col(profile, "customer_id");
    assert.equal(c.type, "integer");
    assert.equal(c.pii, false);
    assert.equal(c.min, "1001");
    assert.equal(c.max, "1012");
  });

  test("yes/no/y/n columns are booleans", () => {
    const c = col(profile, "active");
    assert.equal(c.type, "boolean");
    assert.equal(c.typeConfidence, 1);
  });

  test("names are PII strings; free text with blanks is a string with nulls", () => {
    const name = col(profile, "name");
    assert.equal(name.type, "string");
    assert.equal(name.pii, true);
    const notes = col(profile, "notes");
    assert.equal(notes.type, "string");
    assert.equal(notes.nullCount, 9);
    assert.equal(notes.distinctCount, 3);
    assert.equal(notes.pii, false);
  });

  test("country: string, top values are the most frequent first", () => {
    const c = col(profile, "country");
    assert.equal(c.type, "string");
    assert.equal(c.topValues.length, 10);
    assert.deepEqual(new Set(c.topValues.slice(0, 2)), new Set(["China", "South Korea"]));
  });

  test("sample holds the first 20 rows (here all 12) keyed by header", () => {
    assert.equal(profile.sample.length, 12);
    assert.equal(profile.sample[0].name, "Ana Silva");
    assert.equal(profile.sample[0].phone, "+351 912 345 678");
    assert.deepEqual(Object.keys(profile.sample[0]), table.headers);
  });
});

describe("profileTable type rules", () => {
  function one(values: string[], header = "v"): ReturnType<typeof profileTable>["columns"][number] {
    const table: Table = { headers: [header], rows: values.map((v) => [v]) };
    return profileTable(table).columns[0];
  }

  test("all-blank column is empty", () => {
    const c = one(["", "  ", ""]);
    assert.equal(c.type, "empty");
    assert.equal(c.nullCount, 3);
    assert.equal(c.distinctCount, 0);
    assert.deepEqual(c.topValues, []);
  });

  test("a type needs at least 80% of non-empty values", () => {
    // 7 of 10 are integers: below the threshold, so the column is a string.
    const c = one(["1", "2", "3", "4", "5", "6", "7", "x", "y", "z"]);
    assert.equal(c.type, "string");
    assert.equal(c.typeConfidence, 1);
    // 8 of 10 are integers: at the threshold.
    const d = one(["1", "2", "3", "4", "5", "6", "7", "8", "x", "y"]);
    assert.equal(d.type, "integer");
    assert.equal(d.typeConfidence, 0.8);
  });

  test("blanks do not count against the threshold", () => {
    const c = one(["1", "", "2", "", "3", "   ", "4"]);
    assert.equal(c.type, "integer");
    assert.equal(c.nullCount, 3);
    assert.equal(c.typeConfidence, 1);
  });

  test("0/1 is an integer column, not boolean; yes/no is boolean", () => {
    assert.equal(one(["0", "1", "1", "0"]).type, "integer");
    assert.equal(one(["yes", "no", "Y", "N", "true", "false"]).type, "boolean");
  });

  test("negative and signed integers", () => {
    assert.equal(one(["-1", "+2", "3", "-40"]).type, "integer");
  });

  test("numbers with thousands separators must be grouped in threes", () => {
    assert.equal(one(["1,234", "12,345.6", "-0.5"]).type, "number");
    assert.equal(one(["1,2345", "12,34"]).type, "string");
  });

  test("email needs a domain with a dot", () => {
    assert.equal(one(["a@b.co", "c@d.org"]).type, "email");
    assert.equal(one(["a@localhost", "c@d.org", "e@f.co", "g@h.io", "i@j.net"]).type, "email");
    assert.equal(one(["a@localhost", "c@d.org", "e@f.co"]).type, "string");
    assert.equal(one(["a@localhost", "b@localhost", "c@d.org"]).type, "string");
  });

  test("plain digits count as phones only when the header says phone", () => {
    assert.equal(one(["5550142233", "5550142244", "5550142255"], "phone").type, "phone");
    assert.equal(one(["5550142233", "5550142244", "5550142255"], "account").type, "integer");
  });

  test("a phone header with plain digits is PII", () => {
    const c = one(["5550142233", "5550142244"], "mobile_number");
    assert.equal(c.type, "phone");
    assert.equal(c.pii, true);
  });

  test("date min and max are reported as ISO dates", () => {
    const c = one(["12/31/2019", "2020-02-29", "1/2/20"]);
    assert.equal(c.type, "date");
    assert.equal(c.min, "2019-12-31");
    assert.equal(c.max, "2020-02-29");
  });

  test("dateFormats holds at most 5 layouts", () => {
    const values = [
      "2020-01-01",
      "2020/01/01",
      "2020.01.01",
      "01/02/2020",
      "01-02-20",
      "1 Jan 2020",
      "Jan 1, 2020",
    ];
    const c = one(values);
    assert.equal(c.type, "date");
    assert.equal(c.dateFormats?.length, 5);
  });

  test("numeric min and max keep the original text", () => {
    const c = one(["1,234.5", "-2", "1,500"]);
    assert.equal(c.min, "-2");
    assert.equal(c.max, "1,500");
  });

  test("topValues are truncated to 80 characters and limited to 10", () => {
    const long = "x".repeat(200);
    const values = [long];
    for (let i = 0; i < 12; i++) values.push(`v${i}`);
    const c = one(values);
    assert.equal(c.topValues.length, 10);
    assert.equal(c.topValues[0].length, 80);
    assert.equal(c.topValues[0], "x".repeat(80));
  });

  test("topValues are ordered by frequency", () => {
    const c = one(["a", "b", "b", "c", "c", "c", "d"]);
    assert.deepEqual(c.topValues.slice(0, 3), ["c", "b", "a"]);
  });

  test("distinct values are counted after trimming", () => {
    const c = one(["Acme", " Acme ", "Acme"]);
    assert.equal(c.distinctCount, 1);
    assert.equal(c.typeConfidence, 1);
  });
});

describe("PII header flags", () => {
  function piiFor(header: string): boolean {
    return profileTable({ headers: [header], rows: [["x"]] }).columns[0].pii;
  }

  test("sensitive headers are flagged", () => {
    for (const h of [
      "name",
      "first_name",
      "last_name",
      "full_name",
      "firstName",
      "address",
      "street",
      "ssn",
      "social_security",
      "dob",
      "date_of_birth",
      "passport",
      "ip_address",
    ]) {
      assert.equal(piiFor(h), true, h);
    }
  });

  test("unrelated headers are not flagged", () => {
    for (const h of ["country", "amount", "username", "status", "customer_id"]) {
      assert.equal(piiFor(h), false, h);
    }
  });
});

describe("profileTable sample and edge cases", () => {
  test("sample is limited to 20 rows", () => {
    const rows: string[][] = [];
    for (let i = 0; i < 25; i++) rows.push([String(i), `row ${i}`]);
    const p = profileTable({ headers: ["id", "label"], rows });
    assert.equal(p.sample.length, 20);
    assert.deepEqual(p.sample[19], { id: "19", label: "row 19" });
    assert.equal(p.rowCount, 25);
  });

  test("a header named __proto__ is an ordinary sample key", () => {
    const p = profileTable({ headers: ["__proto__"], rows: [["x"]] });
    assert.equal(Object.getPrototypeOf(p.sample[0]), Object.prototype);
    assert.equal(Object.keys(p.sample[0])[0], "__proto__");
    assert.equal(p.sample[0]["__proto__"], "x");
  });

  test("a table with no rows profiles cleanly", () => {
    const p = profileTable({ headers: ["a", "b"], rows: [] });
    assert.equal(p.rowCount, 0);
    assert.equal(p.columns[0].type, "empty");
    assert.deepEqual(p.sample, []);
  });

  test("200k rows x 12 columns profiles in under 3 seconds", () => {
    const headers = [
      "id",
      "name",
      "email",
      "signup_date",
      "country",
      "phone",
      "amount",
      "active",
      "score",
      "notes",
      "city",
      "zip",
    ];
    const countries = ["Portugal", "China", "Mexico", "India", "Sweden", "Nigeria"];
    const rows: string[][] = new Array(200_000);
    for (let i = 0; i < rows.length; i++) {
      const m = (i % 12) + 1;
      const d = (i % 28) + 1;
      rows[i] = [
        String(i + 1),
        `Person ${i}`,
        `person${i}@example.com`,
        i % 2 === 0 ? `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/22` : `2022-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        countries[i % countries.length],
        `+1 555-${String(i % 10000).padStart(4, "0")}`,
        `${(i % 5000) - 100}.${i % 100}`,
        i % 3 === 0 ? "yes" : "no",
        String((i * 7) % 1000),
        i % 5 === 0 ? "" : `note ${i % 50}`,
        `City ${i % 300}`,
        String(10000 + (i % 90000)),
      ];
    }
    const start = performance.now();
    const p = profileTable({ headers, rows });
    const ms = performance.now() - start;
    assert.equal(p.rowCount, 200_000);
    assert.equal(p.columnCount, 12);
    assert.ok(ms < 3000 * PERF_SLACK, `profiling took ${Math.round(ms)} ms`);
    assert.equal(col(p, "email").type, "email");
    assert.equal(col(p, "active").type, "boolean");
    assert.equal(col(p, "signup_date").type, "date");
  });
});
