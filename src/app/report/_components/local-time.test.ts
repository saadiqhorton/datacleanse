import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatLocal, isoOf } from "./local-time";

// 2026-10-18T23:42:00Z: 7:42 PM in New York (EDT), 8:42 AM the next day in Tokyo.
const at = Date.UTC(2026, 9, 18, 23, 42);

describe("formatLocal", () => {
  it("formats dates, clock times and date-times in the given zone", () => {
    assert.equal(formatLocal(at, "date", "en-US", "America/New_York"), "Oct 18, 2026");
    assert.equal(formatLocal(at, "time", "en-US", "America/New_York"), "19:42");
    assert.equal(formatLocal(at, "datetime", "en-US", "America/New_York"), "Oct 18, 2026 7:42 PM");
  });

  it("moves to the next day in a zone ahead of UTC", () => {
    assert.equal(formatLocal(at, "date", "en-US", "Asia/Tokyo"), "Oct 19, 2026");
    assert.equal(formatLocal(at, "time", "en-US", "Asia/Tokyo"), "08:42");
  });

  it("writes midnight as 00:xx in the 24-hour clock", () => {
    const midnight = Date.UTC(2026, 9, 18, 4, 5);
    assert.equal(formatLocal(midnight, "time", "en-US", "America/New_York"), "00:05");
  });

  it("reports an invalid timestamp instead of throwing", () => {
    assert.equal(formatLocal(Number.NaN, "datetime"), "unknown time");
    assert.equal(isoOf(Number.NaN), "");
  });

  it("gives an ISO string for the dateTime attribute", () => {
    assert.equal(isoOf(at), "2026-10-18T23:42:00.000Z");
  });
});
