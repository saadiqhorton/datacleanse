import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "../ui/cn";
import { Logo } from "./Logo";

export type NavItem = { label: string; href: string };

export const MAIN_NAV: NavItem[] = [
  { label: "Files", href: "/files" },
  { label: "Compare", href: "/compare" },
  { label: "Ask", href: "/ask" },
  { label: "Rules", href: "/rules" },
  { label: "Reports", href: "/report" },
];

export const ADMIN_NAV: NavItem[] = [
  { label: "Overview", href: "/admin" },
  { label: "Jobs", href: "/admin#jobs" },
  { label: "Users", href: "/admin#users" },
  { label: "Audit log", href: "/admin#audit" },
  { label: "Configuration", href: "/admin#config" },
];

/**
 * Top bar: logo, optional primary nav, and a right-hand slot for actions.
 * Pass `nav={false}` for focused flows (upload, processing) and supply
 * `center` for a stepper instead.
 */
export function AppHeader({
  active,
  nav = MAIN_NAV,
  navLabel = "Main",
  logoLabel,
  center,
  actions,
}: {
  active?: string;
  nav?: NavItem[] | false;
  navLabel?: string;
  logoLabel?: string;
  center?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-4 border-b border-divider bg-white px-8 py-3">
      <div className="flex flex-wrap items-center gap-8">
        <Logo label={logoLabel} />
        {nav && (
          <nav aria-label={navLabel} className="flex flex-wrap gap-6 text-sm">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.label === active ? "page" : undefined}
                className={cn(
                  "no-underline",
                  item.label === active ? "font-medium text-ink" : "text-slate",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
      {center}
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </header>
  );
}

export function AccountButton({
  initials = "MR",
  active,
}: {
  initials?: string;
  active?: boolean;
}) {
  return (
    <Link
      href="/settings"
      aria-label="Account menu"
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-full bg-surface text-[13px] font-semibold no-underline",
        active ? "border-2 border-ink" : "border border-hairline",
      )}
    >
      {initials}
    </Link>
  );
}
