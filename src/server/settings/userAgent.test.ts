import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeUserAgent } from "./userAgent";
import { relativeTime, formatDate } from "./format";

describe("describeUserAgent", () => {
  it("names the browser and OS for common agents", () => {
    const cases: [string, string][] = [
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0", "Edge on Windows"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", "Safari on macOS"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1", "Safari on iOS"],
      ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36", "Chrome on Android"],
      ["Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", "Firefox on Linux"],
      ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "Chrome on ChromeOS"],
    ];
    for (const [ua, label] of cases) assert.equal(describeUserAgent(ua).label, label);
  });

  it("falls back to a neutral label for an empty or unknown agent", () => {
    assert.equal(describeUserAgent("").label, "Unknown device");
    assert.equal(describeUserAgent("curl/8.5.0").label, "Unknown OS");
  });
});

describe("relativeTime and formatDate", () => {
  const now = Date.UTC(2026, 9, 19, 12, 0, 0);
  it("uses short relative units", () => {
    assert.equal(relativeTime(now - 10_000, now), "just now");
    assert.equal(relativeTime(now - 12 * 60_000, now), "12 min ago");
    assert.equal(relativeTime(now - 3 * 3600_000, now), "3 h ago");
    assert.equal(relativeTime(now - 24 * 3600_000, now), "1 day ago");
    assert.equal(relativeTime(now - 90 * 24 * 3600_000, now), "3 months ago");
    assert.equal(relativeTime(now - 800 * 24 * 3600_000, now), "2 years ago");
  });

  it("formats a UTC calendar date", () => {
    assert.equal(formatDate(Date.UTC(2026, 9, 17)), "17 Oct 2026");
  });
});
