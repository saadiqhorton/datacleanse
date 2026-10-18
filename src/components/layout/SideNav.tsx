import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "../ui/cn";
import { Eyebrow } from "../ui/Card";

/** Left column nav used by Rules and Settings. */
export function SideNav({
  label,
  items,
  active,
  bordered,
  dot,
  footer,
}: {
  label: string;
  items: { label: string; href: string }[];
  active: string | string[];
  bordered?: boolean;
  /** Show a mint dot before the active item. */
  dot?: boolean;
  footer?: ReactNode;
}) {
  const isActive = (l: string) => (Array.isArray(active) ? active.includes(l) : active === l);
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex flex-[0_0_240px] flex-col gap-1 px-4 py-8 text-sm",
        bordered && "border-r border-divider",
      )}
    >
      <Eyebrow className="px-4 pb-2">{label}</Eyebrow>
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-current={isActive(item.label) ? "page" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-2 no-underline",
            isActive(item.label) ? "bg-surface font-medium" : "text-slate",
          )}
        >
          {dot && isActive(item.label) && <span className="size-1.5 rounded-full bg-mint" />}
          {item.label}
        </Link>
      ))}
      {footer}
    </nav>
  );
}
