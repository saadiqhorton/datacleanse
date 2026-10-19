"use client";

import { useSyncExternalStore } from "react";

const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const subscribe = () => () => {};

/** A timestamp in the viewer's local time. Empty on the server and first render, then filled in. */
export function LocalTime({ at, className }: { at: number; className?: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => formatter.format(at),
    () => "",
  );
  return (
    <time dateTime={new Date(at).toISOString()} className={className}>
      {text}
    </time>
  );
}
