import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, signInLimiter } from "./rateLimit";

const MINUTE = 60_000;

test("blocks after 5 failures inside 15 minutes and unblocks when they age out", () => {
  const limiter = createRateLimiter({ max: 5, windowMs: 15 * MINUTE });
  const t0 = 1_000_000;
  for (let i = 0; i < 4; i++) limiter.record("a@x.co|1.2.3.4", t0 + i);
  assert.equal(limiter.isLimited("a@x.co|1.2.3.4", t0 + 10), false, "4 failures still allowed");
  limiter.record("a@x.co|1.2.3.4", t0 + 5);
  assert.equal(limiter.isLimited("a@x.co|1.2.3.4", t0 + 10), true, "5th failure blocks");
  assert.ok(limiter.retryAfterMs("a@x.co|1.2.3.4", t0 + 10) > 14 * MINUTE);
  assert.equal(limiter.isLimited("a@x.co|1.2.3.4", t0 + 15 * MINUTE + 10), false, "window passed");
});

test("keys are independent (email and IP both part of the key)", () => {
  const limiter = createRateLimiter({ max: 2, windowMs: MINUTE });
  limiter.record("a|1", 0);
  limiter.record("a|1", 0);
  assert.equal(limiter.isLimited("a|1", 1), true);
  assert.equal(limiter.isLimited("a|2", 1), false);
  assert.equal(limiter.isLimited("b|1", 1), false);
});

test("reset clears a key", () => {
  const limiter = createRateLimiter({ max: 1, windowMs: MINUTE });
  limiter.record("k", 0);
  assert.equal(limiter.isLimited("k", 1), true);
  limiter.reset("k");
  assert.equal(limiter.isLimited("k", 1), false);
});

test("sign-in limiter is 5 failures per 15 minutes", () => {
  const key = `limit-test-${Math.random()}`;
  for (let i = 0; i < 5; i++) signInLimiter.record(key);
  assert.equal(signInLimiter.isLimited(key), true);
  signInLimiter.reset(key);
});
