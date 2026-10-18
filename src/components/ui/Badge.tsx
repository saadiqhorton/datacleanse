import type { ReactNode } from "react";
import { cn } from "./cn";

export type Status = "ready" | "processing" | "review" | "failed" | "deleted";

const statusStyles: Record<Status, string> = {
  ready: "bg-mint-soft text-mint-ink",
  processing: "bg-rule-soft text-rule",
  review: "bg-review-soft text-review",
  failed: "bg-error-soft text-error",
  deleted: "bg-neutral-soft text-slate",
};

/** Rounded status pill: Ready, Processing, Needs review, Failed, Deleted. */
export function StatusBadge({
  status,
  children,
  className,
}: {
  status: Status;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold",
        statusStyles[status],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Source tag for a change: "Rule" (blue) or "AI · 72%" (review orange). */
export function SourceTag({
  kind,
  children,
  className,
}: {
  kind: "rule" | "ai";
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[13px] font-semibold",
        kind === "rule" ? "bg-rule-soft text-rule" : "bg-review-soft text-review",
        className,
      )}
    >
      {children ?? (kind === "rule" ? "Rule" : "AI")}
    </span>
  );
}

export function PiiTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-md bg-error px-1.5 py-0.5 text-[11px] font-semibold tracking-[0.5px] text-white",
        className,
      )}
    >
      PII
    </span>
  );
}

/** Monospace chip for file and column names. */
export function Mono({
  children,
  chip,
  className,
}: {
  children: ReactNode;
  chip?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-[13px]",
        chip &&
          "rounded border border-hairline bg-surface px-1.5 py-0.5 font-medium text-ink-2",
        className,
      )}
    >
      {children}
    </span>
  );
}
