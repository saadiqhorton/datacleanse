import { cn } from "@/components/ui/cn";

/** Link styled as a pill button (the shared Button only renders <button>). */
export function linkButton(variant: "primary" | "secondary", size: "sm" | "md" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium no-underline transition-colors",
    size === "sm" ? "min-h-9 px-4 py-2" : "min-h-10 px-5 py-2.5",
    // Global unlayered `a { color }` in globals.css would otherwise override text-white.
    variant === "primary"
      ? "bg-ink text-white"
      : "border border-hairline bg-transparent text-ink",
  );
}

/** Filter pill as a link, same look as FilterPill (which renders a button). */
export function pillLink(active: boolean) {
  return cn(
    "inline-flex min-h-9 items-center rounded-full px-4 py-2 text-sm no-underline transition-colors",
    active ? "bg-ink font-medium text-white" : "border border-hairline bg-white text-slate",
  );
}
