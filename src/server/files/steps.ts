import { formatCount } from "../csv/errors";

/** The six Processing steps, in order. Labels match the Processing design copy. */
export const STEP_COUNT = 6;

/** What is known so far, used to put live counts into the step labels. */
export interface StepState {
  columns: number | null;
  changes: number | null;
  ambiguous: number | null;
  /** True when AI was not used for this file (off, rules only, or unavailable at setup). */
  aiSkipped: boolean;
}

export const EMPTY_STEP_STATE: StepState = { columns: null, changes: null, ambiguous: null, aiSkipped: false };

export function stepLabel(index: number, s: StepState): string {
  switch (index) {
    case 0:
      return "Checked file format and size";
    case 1:
      return "Scanned for malware";
    case 2:
      return s.columns === null ? "Profiling columns" : `Profiled ${formatCount(s.columns)} columns`;
    case 3:
      return s.changes === null
        ? "Applying cleaning rules"
        : `Applied cleaning rules · ${formatCount(s.changes)} changes`;
    case 4:
      if (s.aiSkipped) return "AI skipped · rules only";
      return s.ambiguous === null
        ? "Asking AI about ambiguous values"
        : `Asking AI about ${formatCount(s.ambiguous)} ambiguous values`;
    case 5:
      return "Building change report";
    default:
      throw new Error(`No step ${index}`);
  }
}

/** All six labels for the given state. */
export function stepLabels(s: StepState): string[] {
  return Array.from({ length: STEP_COUNT }, (_, i) => stepLabel(i, s));
}

export type StepViewState = "done" | "active" | "pending";

export interface StepView {
  label: string;
  state: StepViewState;
}

/**
 * Steps for the Processing page. `meta.steps` and `meta.activeStep` are written by the clean
 * handler as it moves on; before it starts, every step is pending.
 */
export function stepViews(jobStatus: string, meta: Record<string, unknown>): StepView[] {
  const stored = Array.isArray(meta.steps) && meta.steps.length === STEP_COUNT ? (meta.steps as unknown[]) : null;
  const labels = stepLabels(EMPTY_STEP_STATE).map((fallback, i) => {
    const s = stored?.[i];
    return typeof s === "string" && s !== "" ? s : fallback;
  });
  const active = typeof meta.activeStep === "number" && Number.isInteger(meta.activeStep) ? meta.activeStep : 0;

  return labels.map((label, i) => {
    let state: StepViewState;
    if (jobStatus === "done") state = "done";
    else if (jobStatus === "queued") state = "pending";
    else if (i < active) state = "done";
    else if (i === active) state = "active";
    else state = "pending";
    return { label, state };
  });
}
