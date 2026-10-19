import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildUploadForm, destinationFor, parseUploadResponse } from "./request";
import type { UploadValues } from "./options";

const values: UploadValues = {
  mode: "rules_only",
  normalizeDates: true,
  dedupe: false,
  trimAndCase: true,
  fillMissing: true,
  dateChoice: "month-day",
  ruleSetId: "",
};

describe("buildUploadForm", () => {
  it("adds one file field per file and the options as JSON", () => {
    const a = new File(["a,b\n"], "a.csv", { type: "text/csv" });
    const b = new File(["c\n"], "b.tsv");
    const form = buildUploadForm([a, b], values);
    const files = form.getAll("file");
    assert.equal(files.length, 2);
    assert.equal((files[0] as File).name, "a.csv");
    assert.equal(form.get("mode"), "rules_only");
    assert.deepEqual(JSON.parse(String(form.get("options"))), {
      normalizeDates: true,
      dedupe: false,
      trimAndCase: true,
      fillMissing: true,
      dateOrder: "mdy",
    });
    assert.equal(form.has("ruleSetId"), false);
  });

  it("sends the rule set only when one is chosen", () => {
    const form = buildUploadForm([new File(["a\n"], "a.csv")], { ...values, ruleSetId: "rs_1" });
    assert.equal(form.get("ruleSetId"), "rs_1");
  });
});

describe("parseUploadResponse", () => {
  it("returns the created files on 201", () => {
    const body = JSON.stringify({ files: [{ fileId: "file_1", jobId: "job_1", name: "a.csv" }] });
    assert.deepEqual(parseUploadResponse(201, body), {
      ok: true,
      files: [{ fileId: "file_1", jobId: "job_1", name: "a.csv" }],
    });
  });

  it("shows the server's error message", () => {
    const body = JSON.stringify({ error: "This upload is larger than the 200 MB limit.", code: "too_large" });
    assert.deepEqual(parseUploadResponse(413, body), { ok: false, message: "This upload is larger than the 200 MB limit." });
  });

  it("falls back to a generic message for unexpected answers", () => {
    assert.deepEqual(parseUploadResponse(500, "<html>oops</html>"), { ok: false, message: "Upload failed. Try again." });
    assert.deepEqual(parseUploadResponse(201, JSON.stringify({ files: [{ fileId: 1 }] })), {
      ok: false,
      message: "The server sent an unexpected answer. Try again.",
    });
  });
});

describe("destinationFor", () => {
  it("opens the progress page for one file and the list for several", () => {
    assert.equal(destinationFor([{ fileId: "file_a", jobId: "j", name: "a.csv" }]), "/processing/file_a");
    assert.equal(
      destinationFor([
        { fileId: "file_a", jobId: "j", name: "a.csv" },
        { fileId: "file_b", jobId: "k", name: "b.csv" },
      ]),
      "/files",
    );
  });
});
