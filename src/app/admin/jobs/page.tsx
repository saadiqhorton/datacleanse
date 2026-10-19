import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Mono, cn } from "@/components/ui";
import { formatDuration, JOB_STATUSES, jobStatusLabel, jobTypeLabel, parseJobStatus, type JobStatus } from "@/server/admin/format";
import { listJobs } from "@/server/admin/jobs";
import { parsePage } from "@/server/admin/paging";
import { requireAdmin } from "@/server/auth/session";
import { AdminFrame, AdminLoading, TableLoading } from "../_ui/AdminFrame";
import { CancelJobButton } from "../_ui/CancelJobButton";
import { JobStatusBadge } from "../_ui/JobStatusBadge";
import { LocalTime } from "../_ui/LocalTime";
import { Pager } from "../_ui/Pager";

export const metadata: Metadata = {
  title: "Jobs · Admin · DataCleanse",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function AdminJobsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AdminLoading />}>
      <AdminFrame active="Jobs">
        <h1 className="text-4xl leading-[1.2] font-semibold tracking-[-0.5px]">Jobs</h1>
        <Suspense fallback={<TableLoading label="Loading jobs" />}>
          <JobsList searchParams={searchParams} />
        </Suspense>
      </AdminFrame>
    </Suspense>
  );
}

async function JobsList({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const params = await searchParams;
  const status = parseJobStatus(first(params.status));
  const jobs = listJobs({ status, page: parsePage(first(params.page)) });
  const filters: { label: string; value: JobStatus | null }[] = [
    { label: "All", value: null },
    ...JOB_STATUSES.map((value) => ({ label: jobStatusLabel(value), value })),
  ];

  return (
    <>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {filters.map((filter) => {
          const active = filter.value === status;
          return (
            <Link
              key={filter.label}
              href={filter.value ? `/admin/jobs?status=${filter.value}` : "/admin/jobs"}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center rounded-full px-4 py-2 text-sm no-underline",
                active ? "bg-ink font-medium text-white" : "border border-hairline bg-white text-slate",
              )}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      <Card className="min-w-0 overflow-x-auto">
        <table aria-label="Jobs" className="w-full text-sm leading-normal">
          <thead>
            <tr>
              {["Job", "Type", "User", "Status", "Started", "Duration", ""].map((heading, i) => (
                <th
                  key={heading || `col-${i}`}
                  scope="col"
                  className="px-5 py-3 text-left text-[11px] font-semibold tracking-[0.5px] text-slate uppercase"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.items.length === 0 && (
              <tr className="border-t border-divider">
                <td colSpan={7} className="px-5 py-6 text-center text-slate">
                  {status ? `No ${jobStatusLabel(status).toLowerCase()} jobs.` : "No jobs yet."}
                </td>
              </tr>
            )}
            {jobs.items.map((job) => (
              <tr key={job.id} className="border-t border-divider align-top">
                <td className="px-5 py-3.5">
                  <Mono>{job.id}</Mono>
                </td>
                <td className="px-5 py-3.5">{jobTypeLabel(job.type, job.fileCount)}</td>
                <td className="px-5 py-3.5 text-slate">{job.userEmail ?? "Deleted account"}</td>
                <td className="px-5 py-3.5">
                  <JobStatusBadge status={job.status} />
                  {job.error && (
                    <p className="mt-2 max-w-[320px] text-[13px] break-words text-error" title={job.error}>
                      {job.error}
                    </p>
                  )}
                </td>
                <td className="px-5 py-3.5 whitespace-nowrap text-slate">
                  <LocalTime at={job.createdAt} format="datetime" />
                </td>
                <td className="px-5 py-3.5 whitespace-nowrap text-slate">{formatDuration(job.durationMs)}</td>
                <td className="px-5 py-3.5">
                  {(job.status === "queued" || job.status === "running") && <CancelJobButton jobId={job.id} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="-mt-4 text-[13px] text-muted">
        {jobs.total.toLocaleString("en-US")} {jobs.total === 1 ? "job" : "jobs"}
        {status ? ` · ${jobStatusLabel(status).toLowerCase()}` : ""}
      </p>
      <Pager
        basePath="/admin/jobs"
        query={{ status: status ?? undefined }}
        page={jobs.page}
        pageCount={jobs.pageCount}
      />
    </>
  );
}
