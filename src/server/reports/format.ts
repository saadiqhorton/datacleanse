const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 1234567 -> "1,234,567". Non-finite input prints as "0". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const digits = Math.trunc(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 ? `-${digits}` : digits;
}

/** Milliseconds as a short human duration: "850 ms", "4.2 s", "3 m 12 s", "1 h 5 m". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} m ${Math.floor((ms % 60_000) / 1000)} s`;
  return `${Math.floor(ms / 3_600_000)} h ${Math.floor((ms % 3_600_000) / 60_000)} m`;
}

/** "Oct 18, 2026 19:42 UTC". Invalid dates print as "unknown time". */
export function formatDateTimeUtc(d: Date): string {
  if (Number.isNaN(d.getTime())) return "unknown time";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${formatTimeUtc(d)} UTC`;
}

/** "19:42" in UTC. */
export function formatTimeUtc(d: Date): string {
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
