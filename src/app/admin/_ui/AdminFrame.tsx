import Link from "next/link";
import type { ReactNode } from "react";
import { AccountButton, AppHeader, type NavItem } from "@/components/layout";
import { requireAdmin } from "@/server/auth/session";
import packageJson from "../../../../package.json";

export type AdminSection = "Overview" | "Jobs" | "Users" | "Audit log" | "Configuration";

/** Admin sub-pages. Passed to AppHeader in place of the shared ADMIN_NAV. */
export const ADMIN_PAGES: NavItem[] = [
  { label: "Overview", href: "/admin" },
  { label: "Jobs", href: "/admin/jobs" },
  { label: "Users", href: "/admin/users" },
  { label: "Audit log", href: "/admin/audit" },
  { label: "Configuration", href: "/admin/config" },
];

/**
 * Banner, header and page container for every admin page. Calls requireAdmin(), so it must sit
 * inside a <Suspense> boundary. Non-admins get a 404 from here before any admin data is read.
 */
export async function AdminFrame({ active, children }: { active: AdminSection; children: ReactNode }) {
  const { session } = await requireAdmin();

  return (
    <>
      <div className="flex flex-wrap justify-between gap-2 bg-ink px-8 py-3 text-sm font-medium leading-[normal] text-white">
        {session.twoFactorPassed ? (
          <span>Admin mode · two-factor on</span>
        ) : (
          <span>
            Admin mode · two-factor off —{" "}
            <Link href="/settings#security" className="text-white underline">
              turn it on in Settings
            </Link>
          </span>
        )}
        <span className="text-white/65">Self-hosted · v{packageJson.version}</span>
      </div>

      <AppHeader
        nav={ADMIN_PAGES}
        navLabel="Admin"
        active={active}
        logoLabel="DataCleanse Admin"
        actions={<AccountButton />}
      />

      <main className="mx-auto flex max-w-[1344px] min-w-0 flex-col gap-8 px-4 py-12 sm:px-8">{children}</main>
    </>
  );
}

/** Placeholder while the admin check runs. Shows no admin content. */
export function AdminLoading() {
  return (
    <div aria-hidden="true" className="mx-auto flex max-w-[1344px] animate-pulse flex-col gap-8 px-8 py-12">
      <div className="h-10 w-48 rounded bg-divider" />
      <div className="h-32 rounded-xl bg-surface" />
    </div>
  );
}

/** Stand-in for a table or list while its rows load. */
export function TableLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex animate-pulse flex-col gap-3 rounded-xl border border-hairline bg-white p-6"
    >
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-5 rounded bg-divider" />
      ))}
    </div>
  );
}
