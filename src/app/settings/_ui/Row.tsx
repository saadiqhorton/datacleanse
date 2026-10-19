import type { ReactNode } from "react";
import { cn } from "@/components/ui";

/** One setting: title and description on the left, control on the right. */
export function Row({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 border-b border-divider px-4 py-4 last:border-b-0 sm:px-6 sm:py-5",
        className,
      )}
    >
      <div>
        <div className="text-base font-medium">{title}</div>
        <div className="text-sm text-slate">{description}</div>
      </div>
      {children}
    </div>
  );
}

export const selectClass =
  "h-10 rounded-lg border border-hairline bg-white px-3 text-sm font-normal text-ink";

export const inputClass =
  "h-10 min-w-0 rounded-lg border border-hairline bg-white px-3 text-sm font-normal text-ink outline-none focus:border-2 focus:border-mint sm:w-72";

/** Status under a form: an error (alert) or a confirmation (status). */
export function FormMessage({ error, ok }: { error?: string; ok?: string }) {
  if (error) {
    return (
      <p role="alert" className="text-[13px] font-normal text-error">
        {error}
      </p>
    );
  }
  if (ok) {
    return (
      <p role="status" className="text-[13px] font-normal text-mint-ink">
        {ok}
      </p>
    );
  }
  return null;
}
