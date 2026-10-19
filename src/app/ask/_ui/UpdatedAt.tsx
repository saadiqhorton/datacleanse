"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/** A timestamp in the viewer's local time. The server render uses UTC so the markup is stable. */
export function UpdatedAt({ at }: { at: number }) {
  const text = useSyncExternalStore(
    noSubscribe,
    () => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    () => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`,
  );
  return <time dateTime={new Date(at).toISOString()}>{text}</time>;
}
