"use client";

import { useEffect, useRef } from "react";

/** Keeps the newest message in view: scrolls to this marker whenever the message count changes. */
export function ScrollToEnd({ count }: { count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [count]);
  return <div ref={ref} aria-hidden="true" />;
}
