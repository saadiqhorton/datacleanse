import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-white",
  accent: "bg-mint text-ink font-semibold",
  secondary: "border border-hairline bg-transparent text-ink",
  ghost: "rounded-lg bg-transparent px-3 text-ink",
  destructive: "bg-error text-white",
};

const sizes: Record<Size, string> = {
  sm: "min-h-9 px-4 py-2",
  md: "min-h-10 px-5 py-2.5",
  lg: "min-h-11 px-5 py-2.5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors",
        sizes[size],
        disabled ? "cursor-not-allowed bg-hairline text-muted" : variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-full border border-hairline bg-white",
        className,
      )}
      {...props}
    />
  );
}

/** Rounded filter toggle used above tables ("All 214", "Needs review 16"). */
export function FilterPill({
  active,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        "min-h-9 rounded-full px-4 py-2 text-sm",
        active
          ? "bg-ink font-medium text-white"
          : "border border-hairline bg-white text-slate",
        className,
      )}
      {...props}
    />
  );
}
