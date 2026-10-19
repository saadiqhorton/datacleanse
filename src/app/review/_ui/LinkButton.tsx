import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/components/ui";

const base = "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium no-underline transition-colors";

const sizes = {
  sm: "min-h-9 px-4 py-2",
  md: "min-h-10 px-5 py-2.5",
  lg: "min-h-11 px-5 py-2.5",
} as const;

const variants = {
  primary: "bg-ink text-white",
  accent: "bg-mint text-ink",
  secondary: "border border-hairline bg-transparent text-ink",
} as const;

/** Next.js Link styled as a pill button (a <Button> cannot render as a link). */
export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  children,
}: {
  href: string;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  children: ReactNode;
}) {
  return <Link href={href} className={cn(base, sizes[size], variants[variant])}>{children}</Link>;
}
