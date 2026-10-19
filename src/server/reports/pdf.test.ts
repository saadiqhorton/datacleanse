import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import type { ProposedChange } from "../types";
import { reportPdf, type ReportPdfInput } from "./pdf";
import { summarizeChanges } from "./summary";
import { formatCount, formatDuration } from "./format";

function change(i: number, over: Partial<ProposedChange> = {}): ProposedChange {
  return {
    rowIndex: i,
    column: i % 3 === 0 ? "signup_date" : i % 3 === 1 ? "company" : "country",
    kind: "value",
    before: `before ${i}`,
    after: `after ${i}`,
    source: i % 4 === 0 ? "ai" : "rule",
    ruleId: i % 4 === 0 ? "ai" : "trim_whitespace",
    reason: `Reason for change ${i}`,
    confidence: 0.9,
    decision: "approved",
    ...over,
  };
}

function input(changes: ProposedChange[], over: Partial<ReportPdfInput> = {}): ReportPdfInput {
  return {
    fileName: "crm_export_q3.csv",
    approvedBy: "Maria R.",
    appliedAt: new Date(Date.UTC(2026, 9, 18, 19, 42)),
    summary: summarizeChanges(changes, { rowsIn: changes.length }),
    activity: [
      { at: new Date(Date.UTC(2026, 9, 18, 19, 30)), detail: "Uploaded 4,812 rows" },
      { at: new Date(Date.UTC(2026, 9, 18, 19, 42)), detail: "Applied 198 changes" },
    ],
    changes,
    ...over,
  };
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe("reportPdf", () => {
  it("returns a PDF", async () => {
    const bytes = await reportPdf(input([change(0), change(1)]));
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(Buffer.from(bytes.subarray(0, 4)).toString("latin1"), "%PDF");
    assert.equal(await pageCount(bytes), 1);
  });

  it("handles an empty report", async () => {
    const bytes = await reportPdf(input([], { activity: [] }));
    assert.equal(Buffer.from(bytes.subarray(0, 4)).toString("latin1"), "%PDF");
    assert.equal(await pageCount(bytes), 1);
  });

  it("breaks pages for 2,000 changes without throwing", async () => {
    const changes = Array.from({ length: 2000 }, (_, i) => change(i));
    const bytes = await reportPdf(input(changes));
    assert.equal(Buffer.from(bytes.subarray(0, 4)).toString("latin1"), "%PDF");
    assert.ok((await pageCount(bytes)) > 3);
  });

  it("lists at most 500 applied changes and does not throw past that", async () => {
    const changes = Array.from({ length: 1200 }, (_, i) => change(i));
    const bytes = await reportPdf(input(changes));
    assert.ok((await pageCount(bytes)) > 1);
  });

  it("survives odd unicode, controls and very long names", async () => {
    const weird = [
      change(0, { before: "Zoë \u{1F600} 山田 漢字", after: "→ · — …", reason: "emoji \u{1F389}‍\u{1F468}\u{1F3FD} \u0007\u0000 null" }),
      change(1, { before: "é combining", after: "ΑΒΓ Greek", column: "\u{1F4C8} col" }),
      change(2, { before: "x".repeat(5000), after: "tab\there\nnewline\r\nCRLF", reason: "" }),
    ];
    const bytes = await reportPdf(
      input(weird, {
        fileName: "\u{1F4C4} " + "very-long-file-name-".repeat(60) + ".csv",
        approvedBy: "山田 太郎",
        activity: [{ at: new Date(NaN), detail: "detail ".repeat(400) }],
      }),
    );
    assert.equal(Buffer.from(bytes.subarray(0, 4)).toString("latin1"), "%PDF");
    assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 1);
  });

  it("does not throw on an invalid date", async () => {
    const bytes = await reportPdf(input([change(0)], { appliedAt: new Date("nope") }));
    assert.equal(Buffer.from(bytes.subarray(0, 4)).toString("latin1"), "%PDF");
  });
});

describe("format helpers", () => {
  it("groups thousands", () => {
    assert.equal(formatCount(0), "0");
    assert.equal(formatCount(999), "999");
    assert.equal(formatCount(4775), "4,775");
    assert.equal(formatCount(1234567), "1,234,567");
    assert.equal(formatCount(Number.NaN), "0");
  });

  it("formats durations", () => {
    assert.equal(formatDuration(0), "0 ms");
    assert.equal(formatDuration(850), "850 ms");
    assert.equal(formatDuration(4200), "4.2 s");
    assert.equal(formatDuration(192_000), "3 m 12 s");
    assert.equal(formatDuration(3_900_000), "1 h 5 m");
    assert.equal(formatDuration(-5), "0 ms");
  });
});
