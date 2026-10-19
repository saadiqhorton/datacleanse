/** Display helpers for the Ask screens. */

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** A 0..1 share as a percentage with one decimal, trailing ".0" dropped: 0.968 -> "96.8%", 1 -> "100%". */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Class names for a link that looks like a pill button (the shared Button only renders <button>). */
export function linkButtonClass(variant: "primary" | "secondary", size: "sm" | "md" = "md"): string {
  return [
    "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium no-underline transition-colors",
    size === "sm" ? "min-h-9 px-4 py-2" : "min-h-10 px-5 py-2.5",
    // Global unlayered `a { color }` in globals.css would otherwise override text-white.
    variant === "primary" ? "bg-ink text-white" : "border border-hairline bg-transparent text-ink",
  ].join(" ");
}
