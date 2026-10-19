"use client";

import { useSyncExternalStore } from "react";
import { formatLocal, isoOf, type LocalTimeFormat } from "./local-time";

const subscribe = () => () => {};

/**
 * A timestamp in the viewer's timezone. The server and the first client render show UTC so the
 * markup matches; after hydration the viewer's own zone replaces it.
 */
export function LocalTime({ at, format = "datetime" }: { at: number; format?: LocalTimeFormat }) {
  const local = useSyncExternalStore(
    subscribe,
    () => formatLocal(at, format),
    () => null,
  );
  return <time dateTime={isoOf(at)}>{local ?? formatLocal(at, format, "en-US", "UTC")}</time>;
}
