export interface ProgressSample {
  /** Epoch milliseconds when the poll answered. */
  at: number;
  progress: number;
}

/** Most recent samples kept for the estimate (about half a minute at one poll per second). */
export const MAX_SAMPLES = 30;

/**
 * Seconds left, from the progress rate across the samples. Null until progress has moved between
 * the first and last sample, so the UI hides the estimate rather than guessing.
 */
export function secondsLeft(samples: ProgressSample[], progress: number): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const gained = last.progress - first.progress;
  const elapsed = (last.at - first.at) / 1000;
  if (gained <= 0 || elapsed <= 0) return null;
  const rate = gained / elapsed;
  return Math.max(0, (100 - progress) / rate);
}

/** Text for the time-left line, or null to hide it. */
export function timeLeftLabel(progress: number, seconds: number | null): string | null {
  if (progress >= 95 && progress < 100) return "Almost done";
  if (seconds === null) return null;
  if (seconds < 60) {
    const rounded = Math.max(5, Math.round(seconds / 5) * 5);
    return `About ${rounded} seconds left`;
  }
  const minutes = Math.round(seconds / 60);
  return `About ${minutes} minute${minutes === 1 ? "" : "s"} left`;
}

/** Adds a sample and keeps only the newest MAX_SAMPLES. */
export function addSample(samples: ProgressSample[], sample: ProgressSample): ProgressSample[] {
  const next = [...samples, sample];
  return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
}
