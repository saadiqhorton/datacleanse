import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, Eyebrow, Mono } from "@/components/ui";
import { listAuditEntries } from "@/server/admin/audit-log";
import { formatDuration, jobTypeLabel } from "@/server/admin/format";
import { listJobs } from "@/server/admin/jobs";
import { getOverviewStats } from "@/server/admin/overview";
import { requireAdmin } from "@/server/auth/session";
import { AdminFrame, AdminLoading, TableLoading } from "./_ui/AdminFrame";
import { JobStatusBadge } from "./_ui/JobStatusBadge";
import { LocalTime } from "./_ui/LocalTime";

export const metadata: Metadata = {
  title: "Admin · DataCleanse",
};

export default function AdminOverviewPage() {
  return (
    <Suspense fallback={<AdminLoading />}>
      <AdminFrame active="Overview">
        <h1 className="text-4xl leading-[1.2] font-semibold tracking-[-0.5px]">Overview</h1>

        <Suspense fallback={<TableLoading label="Loading statistics" />}>
          <StatCards />
        </Suspense>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <Suspense fallback={<TableLoading label="Loading recent jobs" />}>
            <RecentJobs />
          </Suspense>
          <Suspense fallback={<TableLoading label="Loading audit log" />}>
            <RecentAudit />
          </Suspense>
        </div>
      </AdminFrame>
    </Suspense>
  );
}

async function StatCards() {
  await requireAdmin();
  const stats = getOverviewStats();
  const cards: { label: string; value: number; tone?: "error" }[] = [
    { label: "Jobs today", value: stats.jobsToday },
    { label: "Failed", value: stats.failedToday, tone: "error" },
    { label: "Queue depth", value: stats.queueDepth },
    { label: "AI calls today", value: stats.aiCallsToday },
  ];

  return (
    <section aria-label="Last 24 hours" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
      {cards.map((card) => (
        <Card key={card.label} className="flex flex-col p-6">
          <Eyebrow className="leading-[normal]">{card.label}</Eyebrow>
          <div
            className={
              card.tone === "error"
                ? "text-[28px] leading-[normal] font-semibold text-error"
                : "text-[28px] leading-[normal] font-semibold"
            }
          >
            {card.value.toLocaleString("en-US")}
          </div>
        </Card>
      ))}
    </section>
  );
}

async function RecentJobs() {
  await requireAdmin();
  const { items: jobs } = listJobs({ pageSize: 10 });

  return (
    <Card className="min-w-0 overflow-x-auto lg:col-span-2">
      <table aria-label="Recent jobs" className="w-full text-sm leading-normal">
        <thead>
          <tr>
            {["Job", "Type", "Status", "Duration"].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="px-5 py-3 text-left text-[11px] font-semibold tracking-[0.5px] text-slate uppercase"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 && (
            <tr className="border-t border-divider">
              <td colSpan={4} className="px-5 py-6 text-center text-slate">
                No jobs yet.
              </td>
            </tr>
          )}
          {jobs.map((job) => (
            <tr key={job.id} className="border-t border-divider">
              <td className="px-5 py-3.5">
                <Mono>{job.id}</Mono>
              </td>
              <td className="px-5 py-3.5">{jobTypeLabel(job.type, job.fileCount)}</td>
              <td className="px-5 py-3.5">
                <JobStatusBadge status={job.status} />
              </td>
              <td className="px-5 py-3.5 text-slate">{formatDuration(job.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function RecentAudit() {
  await requireAdmin();
  const { items: entries } = listAuditEntries({ pageSize: 20 });

  return (
    <section aria-labelledby="audit-log-heading" className="flex flex-col gap-3 rounded-xl bg-surface p-6">
      <h2 id="audit-log-heading" className="text-lg leading-[normal] font-semibold">
        Audit log
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-slate">Nothing has been logged yet.</p>
      ) : (
        <ol className="flex flex-col gap-3 text-sm leading-[1.4]">
          {entries.map((entry) => (
            <li key={entry.id}>
              <LocalTime at={entry.at} format="time" className="font-mono text-[13px] text-slate" />{" "}
              {entry.detail}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
