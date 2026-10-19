import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountButton, AppHeader } from "@/components/layout";
import { Card, Mono, StatusBadge, cn } from "@/components/ui";
import { requireUser } from "@/server/auth/session";
import { formatCount } from "@/server/reports/format";
import { listReportsForUser, reportListStatus } from "@/server/reports/view";
import { LocalTime } from "./_components/LocalTime";

export const metadata: Metadata = {
  title: "Change reports · DataCleanse",
};

/** Link styled as a pill button (the shared Button only renders <button>). */
function linkButton(variant: "primary" | "secondary", size: "sm" | "md" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium no-underline transition-colors",
    size === "sm" ? "min-h-9 px-4 py-2" : "min-h-10 px-5 py-2.5",
    variant === "primary" ? "bg-ink text-white" : "border border-hairline bg-transparent text-ink",
  );
}

const headers = ["File", "Status", "Applied", "Applied / skipped", "Rows out"];

export default function ReportsPage() {
  return (
    <div className="min-h-dvh bg-white text-ink">
      <AppHeader active="Reports" actions={<AccountButton />} />
      <Suspense fallback={<ReportsSkeleton />}>
        <ReportsList />
      </Suspense>
    </div>
  );
}

async function ReportsList() {
  await connection();
  const current = await requireUser();
  const items = listReportsForUser(current.user.id);

  return (
    <main className="mx-auto flex max-w-[1344px] flex-col gap-8 px-8 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold leading-[1.2] tracking-[-0.5px]">Change reports</h1>
        <p className="text-base text-slate">Reports stay available after their files are deleted.</p>
      </div>

      {items.length === 0 ? (
        <Card className="flex flex-col items-center gap-5 px-6 py-16 text-center">
          <p className="text-base text-slate">No reports yet — reports appear after you apply changes</p>
          <Link href="/upload" className={linkButton("primary")}>
            Upload
          </Link>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm leading-normal">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.5px] text-slate">
                {headers.map((h) => (
                  <th key={h} scope="col" className="px-5 py-3 font-semibold">
                    {h}
                  </th>
                ))}
                <th scope="col" className="px-5 py-3 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const badge = reportListStatus(item);
                const appliedAt = item.appliedAt;
                return (
                  <tr key={item.id} className="border-t border-divider">
                    <td className="px-5 py-4">
                      <Mono className="font-medium">{item.name}</Mono>
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={badge.status}>{badge.label}</StatusBadge>
                    </td>
                    <td className="px-5 py-4 text-slate">
                      {appliedAt !== null ? <LocalTime at={appliedAt} format="date" /> : "—"}
                    </td>
                    <td className="px-5 py-4 text-slate">
                      {appliedAt !== null ? `${formatCount(item.applied)} / ${formatCount(item.skipped)}` : "—"}
                    </td>
                    <td className="px-5 py-4 text-slate">
                      {appliedAt !== null && item.rowsOut !== null ? formatCount(item.rowsOut) : "—"}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link href={`/report/${item.id}`} className={linkButton("secondary", "sm")}>
                        View report
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}

function ReportsSkeleton() {
  return (
    <main aria-busy="true" className="mx-auto flex max-w-[1344px] flex-col gap-8 px-8 py-12">
      <div className="flex flex-col gap-2">
        <div className="h-10 w-64 max-w-full animate-pulse rounded bg-surface" />
        <div className="h-5 w-96 max-w-full animate-pulse rounded bg-surface" />
      </div>
      <Card className="flex flex-col gap-3 p-5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-surface" />
        ))}
      </Card>
    </main>
  );
}
