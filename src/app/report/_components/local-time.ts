/** Client-safe formatting for times shown in the viewer's timezone. No server imports here. */

export type LocalTimeFormat = "date" | "time" | "datetime";

const DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
const CLOCK_12: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
const CLOCK_24: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

/**
 * A timestamp as the design shows it: "Oct 18, 2026" for dates, "19:42" for activity clock times,
 * and "Oct 18, 2026 7:42 PM" for date and time. `timeZone` defaults to the viewer's zone.
 */
export function formatLocal(at: number, format: LocalTimeFormat, locale = "en-US", timeZone?: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "unknown time";
  const zone = timeZone ? { timeZone } : {};
  switch (format) {
    case "date":
      return d.toLocaleDateString(locale, { ...DATE, ...zone });
    case "time":
      return d.toLocaleTimeString(locale, { ...CLOCK_24, ...zone });
    case "datetime":
      return `${d.toLocaleDateString(locale, { ...DATE, ...zone })} ${d.toLocaleTimeString(locale, { ...CLOCK_12, ...zone })}`;
  }
}

/** ISO 8601 for a `dateTime` attribute, or "" for an invalid timestamp. */
export function isoOf(at: number): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
