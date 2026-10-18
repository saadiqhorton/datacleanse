import type { ReactNode } from "react";
import { cn } from "./cn";

/** Strikethrough before value → mint-highlighted after value. */
export function ValueChange({
  before,
  after,
  className,
}: {
  before: ReactNode;
  after: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("font-mono text-[13px]", className)}>
      <span className="text-error line-through">{before}</span> →{" "}
      <span className="rounded bg-mint-soft px-1.5 py-0.5 font-medium">{after}</span>
    </span>
  );
}

export function ProgressBar({
  value,
  label,
  className,
}: {
  value: number;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn("h-2 rounded-full bg-divider", className)}
    >
      <div className="h-2 rounded-full bg-ink" style={{ width: `${value}%` }} />
    </div>
  );
}

/** Dark code block that shows the query behind an AI answer. */
export function CodeBlock({
  caption,
  children,
  className,
}: {
  caption?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg bg-code text-white", className)}>
      {caption && (
        <div className="border-b border-ink-2 px-4 py-2 text-[13px] text-white/65">
          {caption}
        </div>
      )}
      <pre className="m-0 overflow-x-auto p-4 font-mono text-[13px] leading-normal">
        {children}
      </pre>
    </div>
  );
}

/** SQL keyword colouring inside CodeBlock. */
export function Kw({ children }: { children: ReactNode }) {
  return <span className="text-code-keyword">{children}</span>;
}
