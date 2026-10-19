import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, jobDurationMs, jobTypeLabel, parseJobStatus, readFileCount } from "./format";
import { escapeLike, parsePage, resolvePage } from "./paging";

test("job type labels include the file count when the job recorded one", () => {
  assert.equal(jobTypeLabel("ask", 3), "Ask · 3 files");
  assert.equal(jobTypeLabel("ask", 1), "Ask · 1 file");
  assert.equal(jobTypeLabel("clean", null), "Clean");
});

test("durations read as the design does", () => {
  assert.equal(formatDuration(400), "0.4 s");
  assert.equal(formatDuration(48_000), "48 s");
  assert.equal(formatDuration(192_000), "3 min 12 s");
  assert.equal(formatDuration(null), "—");
});

test("job duration: running jobs count up to now, jobs that never started have none", () => {
  const now = 10_000;
  assert.equal(jobDurationMs({ status: "running", startedAt: 4_000, finishedAt: null }, now), 6_000);
  assert.equal(jobDurationMs({ status: "done", startedAt: 4_000, finishedAt: 5_500 }, now), 1_500);
  assert.equal(jobDurationMs({ status: "cancelled", startedAt: null, finishedAt: 5_000 }, now), null);
  assert.equal(jobDurationMs({ status: "queued", startedAt: null, finishedAt: null }, now), null);
});

test("fileCount is read only when it is a non-negative integer", () => {
  assert.equal(readFileCount('{"fileCount":3}'), 3);
  assert.equal(readFileCount("{}"), null);
  assert.equal(readFileCount('{"fileCount":-1}'), null);
  assert.equal(readFileCount('{"fileCount":"3"}'), null);
  assert.equal(readFileCount("not json"), null);
});

test("status filters accept only known statuses", () => {
  assert.equal(parseJobStatus("failed"), "failed");
  assert.equal(parseJobStatus("drop table"), null);
  assert.equal(parseJobStatus(undefined), null);
});

test("pages parse safely and clamp to the pages that exist", () => {
  assert.equal(parsePage("3"), 3);
  assert.equal(parsePage("0"), 1);
  assert.equal(parsePage("x"), 1);
  assert.deepEqual(resolvePage(9, 30, 10), { page: 3, pageCount: 3, offset: 20 });
  assert.deepEqual(resolvePage(2, 0, 10), { page: 1, pageCount: 1, offset: 0 });
});

test("LIKE wildcards in search text are escaped", () => {
  assert.equal(escapeLike("50%_x\\"), "50\\%\\_x\\\\");
});
