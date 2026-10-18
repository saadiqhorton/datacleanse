import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "./cn";

const inputBase =
  "h-11 rounded-lg border border-hairline px-4 text-sm font-normal text-ink outline-none focus:border-2 focus:border-mint";

export function TextField({
  label,
  hint,
  error,
  className,
  inputClassName,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  inputClassName?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-sm font-medium", className)}>
      {label}
      <input
        className={cn(inputBase, error && "border-2 border-error", inputClassName)}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error && <span className="text-[13px] font-normal text-error">{error}</span>}
      {hint && !error && <span className="text-[13px] font-normal text-slate">{hint}</span>}
    </label>
  );
}

export function SelectField({
  label,
  children,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-sm font-medium", className)}>
      {label}
      <select
        className="h-10 rounded-lg border border-hairline bg-white px-3 text-sm font-normal"
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function CheckboxField({
  children,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { children: ReactNode }) {
  return (
    <label className={cn("flex min-h-9 items-center gap-2.5 text-sm", className)}>
      <input type="checkbox" className="accent-ink" {...props} />
      {children}
    </label>
  );
}

/** Bordered radio card: title + description. Selected card gets a 2px ink border. */
export function RadioCard({
  title,
  description,
  checked,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "title"> & {
  title: ReactNode;
  description: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex gap-3 rounded-xl p-4 text-sm leading-normal",
        checked ? "border-2 border-ink" : "border border-hairline",
        className,
      )}
    >
      <input type="radio" checked={checked} className="mt-[3px] accent-ink" {...props} />
      <span>
        <span className="font-semibold">{title}</span>
        <br />
        <span className="text-slate">{description}</span>
      </span>
    </label>
  );
}
