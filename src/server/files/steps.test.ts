import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_STEP_STATE, stepLabel, stepViews, stepLabels } from "./steps";

describe("step labels", () => {
  it("uses the Processing design labels, with live counts once known", () => {
    assert.deepEqual(stepLabels(EMPTY_STEP_STATE), [
      "Checked file format and size",
      "Scanned for malware",
      "Profiling columns",
      "Applying cleaning rules",
      "Asking AI about ambiguous values",
      "Building change report",
    ]);
    const s = { ...EMPTY_STEP_STATE, columns: 11, changes: 1204, ambiguous: 46 };
    assert.equal(stepLabel(2, s), "Profiled 11 columns");
    assert.equal(stepLabel(3, s), "Applied cleaning rules · 1,204 changes");
    assert.equal(stepLabel(4, s), "Asking AI about 46 ambiguous values");
    assert.equal(stepLabel(4, { ...s, aiSkipped: true }), "AI skipped · rules only");
  });
});

describe("step views", () => {
  const meta = { steps: ["A", "B", "C", "D", "E", "F"], activeStep: 3 };

  it("marks earlier steps done, the current one active, and the rest pending", () => {
    assert.deepEqual(
      stepViews("running", meta).map((s) => s.state),
      ["done", "done", "done", "active", "pending", "pending"],
    );
    assert.equal(stepViews("running", meta)[3].label, "D");
  });

  it("keeps the failing step active when a job stops", () => {
    assert.deepEqual(
      stepViews("failed", meta).map((s) => s.state),
      ["done", "done", "done", "active", "pending", "pending"],
    );
  });

  it("shows every step done when the job is done, and pending when queued", () => {
    assert.ok(stepViews("done", meta).every((s) => s.state === "done"));
    assert.ok(stepViews("queued", meta).every((s) => s.state === "pending"));
  });

  it("falls back to the default labels when the job has none yet", () => {
    const views = stepViews("queued", {});
    assert.equal(views.length, 6);
    assert.equal(views[0].label, "Checked file format and size");
  });
});
