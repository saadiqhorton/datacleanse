import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { getSession } from "@/server/auth/session";
import { AccountMenu } from "./AccountMenu";
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
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-divider bg-white px-4 py-3 sm:px-8">
      <Logo label={logoLabel} />
      {nav && (
        // On phones the nav takes its own full-width row and scrolls sideways.
        <nav
          aria-label={navLabel}
          className="order-last -mx-4 flex basis-full gap-6 overflow-x-auto px-4 text-sm whitespace-nowrap sm:order-none sm:mx-0 sm:basis-auto sm:flex-1 sm:overflow-visible sm:px-0"
        >
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
      {center}
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </header>
  );
}

/** Signed-in user's avatar + menu. Reads the session, so it streams in behind Suspense. */
export function AccountButton({ active }: { active?: boolean }) {
  return (
    <Suspense fallback={<span className="inline-block size-10 rounded-full border border-hairline bg-surface" />}>
      <AccountButtonInner active={active} />
    </Suspense>
  );
}

async function AccountButtonInner({ active }: { active?: boolean }) {
  const current = await getSession();
  if (!current) return null;
  const { user } = current;
  return (
    <AccountMenu
      active={active}
      name={user.name}
      email={user.email}
      initials={initialsOf(user.name || user.email)}
      isAdmin={user.role === "admin"}
    />
  );
}

function initialsOf(nameOrEmail: string) {
  const words = nameOrEmail.split("@")[0].split(/[\s._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}
