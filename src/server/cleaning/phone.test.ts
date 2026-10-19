import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatPhone } from "./phone";

describe("formatPhone", () => {
  it("formats a 7-digit local number as +1 (design example)", () => {
    assert.equal(formatPhone("(555)0142 x", "US"), "+1 555-0142");
  });

  it("formats 10-digit and 11-digit US numbers", () => {
    assert.equal(formatPhone("555.123.4567", "US"), "+1 555-123-4567");
    assert.equal(formatPhone("1-555-123-4567", "US"), "+1 555-123-4567");
  });

  it("keeps the country code of numbers that start with +", () => {
    assert.equal(formatPhone("+44 20 7946 0958", "US"), "+44 2079460958");
    assert.equal(formatPhone("+49 30 1234567", "US"), "+49 301234567");
  });

  it("is idempotent on already formatted numbers", () => {
    assert.equal(formatPhone("+1 555-0142", "US"), "+1 555-0142");
    assert.equal(formatPhone("+1 555-123-4567", "US"), "+1 555-123-4567");
  });

  it("drops extensions marked ext, extension or x", () => {
    assert.equal(formatPhone("555-123-4567 ext. 89", "US"), "+1 555-123-4567");
    assert.equal(formatPhone("+1 (555) 014-2 x 99", "US"), "+1 555-0142");
  });

  it("uses the default country for numbers without a + prefix", () => {
    assert.equal(formatPhone("020 7946 0958", "GB"), "+44 2079460958");
  });

  it("returns null for numbers that are too short or too long", () => {
    assert.equal(formatPhone("12345", "US"), null);
    assert.equal(formatPhone("1234567890123456", "US"), null);
  });

  it("returns null for values that are not phone numbers", () => {
    assert.equal(formatPhone("call me", "US"), null);
    assert.equal(formatPhone("", "US"), null);
    assert.equal(formatPhone("jane@x.com", "US"), null);
  });

  it("returns null for an unknown default country", () => {
    assert.equal(formatPhone("555-123-4567", "ZZ"), null);
  });
});
