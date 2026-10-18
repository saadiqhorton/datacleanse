import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-hairline bg-white", className)}
      {...props}
    />
  );
}

/** Grey panel used for privacy and "how it works" explanations. */
export function InfoPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl bg-surface", className)} {...props} />;
}

/** Small uppercase section label. */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.5px] text-slate",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  caption,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  tone?: "default" | "review";
  className?: string;
}) {
  const review = tone === "review";
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border p-6",
        review ? "border-review-border bg-review-bg" : "border-hairline bg-white",
        className,
      )}
    >
      <Eyebrow className={review ? "text-review" : undefined}>{label}</Eyebrow>
      <div className={cn("text-[28px] font-semibold leading-tight", review && "text-review")}>
        {value}
      </div>
      {caption && (
        <div className={cn("text-[13px]", review ? "text-review" : "text-muted")}>
          {caption}
        </div>
      )}
    </div>
  );
}

const calloutStyles = {
  review: { box: "border border-review-border bg-review-bg", title: "text-review" },
  error: { box: "border border-error-border bg-error-bg", title: "text-error-ink" },
  info: { box: "bg-surface", title: "text-ink" },
} as const;

export function Callout({
  tone,
  title,
  children,
  className,
}: {
  tone: keyof typeof calloutStyles;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const s = calloutStyles[tone];
  return (
    <div className={cn("rounded-xl p-6 text-sm leading-normal", s.box, className)}>
      <div className={cn("font-semibold", s.title)}>{title}</div>
      {children}
    </div>
  );
}
