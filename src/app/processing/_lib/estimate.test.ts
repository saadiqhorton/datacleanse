import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_SAMPLES, addSample, secondsLeft, timeLeftLabel } from "./estimate";

describe("secondsLeft", () => {
  it("is hidden until there are two samples", () => {
    assert.equal(secondsLeft([], 10), null);
    assert.equal(secondsLeft([{ at: 0, progress: 10 }], 10), null);
  });

  it("is hidden when progress has not moved between the samples", () => {
    const samples = [
      { at: 0, progress: 40 },
      { at: 1000, progress: 40 },
    ];
    assert.equal(secondsLeft(samples, 40), null);
  });

  it("estimates from the rate across the samples", () => {
    // 10 points per second, 60 points left: six seconds.
    const samples = [
      { at: 0, progress: 20 },
      { at: 1000, progress: 30 },
      { at: 2000, progress: 40 },
    ];
    assert.equal(secondsLeft(samples, 40), 6);
  });
});

describe("timeLeftLabel", () => {
  it("says almost done near the end", () => {
    assert.equal(timeLeftLabel(96, 2), "Almost done");
  });

  it("hides the line without an estimate", () => {
    assert.equal(timeLeftLabel(50, null), null);
  });

  it("rounds seconds to five and never says less than five", () => {
    assert.equal(timeLeftLabel(60, 38), "About 40 seconds left");
    assert.equal(timeLeftLabel(60, 1), "About 5 seconds left");
  });

  it("switches to minutes at sixty seconds", () => {
    assert.equal(timeLeftLabel(30, 90), "About 2 minutes left");
    assert.equal(timeLeftLabel(30, 60), "About 1 minute left");
  });
});

describe("addSample", () => {
  it("keeps only the newest samples", () => {
    let samples: { at: number; progress: number }[] = [];
    for (let i = 0; i < MAX_SAMPLES + 5; i++) samples = addSample(samples, { at: i, progress: i });
    assert.equal(samples.length, MAX_SAMPLES);
    assert.equal(samples[0].at, 5);
  });
});
