"use client";

import { useSyncExternalStore } from "react";

export type TimeFormat = "time" | "date" | "datetime";

const LOCAL_OPTIONS: Record<TimeFormat, Intl.DateTimeFormatOptions> = {
  time: { hour: "2-digit", minute: "2-digit" },
  date: { year: "numeric", month: "short", day: "numeric" },
  datetime: { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
};

/** Server render (and hydration) uses UTC so the markup is stable; the browser then shows its own zone. */
function utcFallback(at: number, format: TimeFormat): string {
  const iso = new Date(at).toISOString();
  if (format === "time") return `${iso.slice(11, 16)} UTC`;
  if (format === "date") return iso.slice(0, 10);
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

const noSubscribe = () => () => {};

/** A timestamp shown in the viewer's local time zone. */
export function LocalTime({ at, format = "datetime", className }: { at: number; format?: TimeFormat; className?: string }) {
  const text = useSyncExternalStore(
    noSubscribe,
    () => new Date(at).toLocaleString(undefined, LOCAL_OPTIONS[format]),
    () => utcFallback(at, format),
  );
  return (
    <time dateTime={new Date(at).toISOString()} className={className}>
      {text}
    </time>
  );
}
