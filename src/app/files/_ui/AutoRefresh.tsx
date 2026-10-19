"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export const AUTO_REFRESH_MS = 3000;

/**
 * Re-renders the Files list every few seconds while a file is processing, so its progress and
 * status update without a reload. Renders nothing; the interval is cleared when nothing is processing.
 */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => router.refresh(), AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [active, router]);

  return null;
}
