import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountButton, AppHeader } from "@/components/layout";
import { Card, Eyebrow, InfoPanel, Mono, StatusBadge, cn } from "@/components/ui";
import { requireUser } from "@/server/auth/session";
import { downloadLink } from "@/server/files/downloads";
import {
  activityText,
  cleanedState,
  downloadNote,
  fixedLabel,
  loadReportForUser,
  reportBadge,
  reportStats,
  reviewHref,
} from "@/server/reports/view";
import { LocalTime } from "../_components/LocalTime";

export const metadata: Metadata = {
  title: "Change report · DataCleanse",
};

const linkButton =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-hairline bg-transparent px-5 py-2.5 text-sm font-medium text-ink no-underline transition-colors hover:bg-surface";

const primaryButton =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white no-underline";

type PageProps = { params: Promise<{ fileId: string }> };

export default function ReportPage({ params }: PageProps) {
  return (
    <div className="min-h-dvh bg-white text-ink">
      <AppHeader active="Reports" actions={<AccountButton />} />
      <Suspense fallback={<ReportSkeleton />}>
        <ReportContent params={params} />
      </Suspense>
    </div>
  );
}

async function ReportContent({ params }: PageProps) {
  await connection();
  const current = await requireUser();
  const { fileId } = await params;
  const report = loadReportForUser(current.user.id, fileId);
  if (!report) notFound();

  const { file, summary, activity } = report;
  const badge = reportBadge(file);
  const applied = file.appliedAt !== null;
  const cleaned = cleanedState(file);
  const review = reviewHref(file);

  return (
    <main className="mx-auto grid max-w-[1344px] grid-cols-[minmax(0,1fr)] items-start gap-8 px-8 py-12 lg:grid-cols-[repeat(3,minmax(0,1fr))]">
      <section className="flex min-w-0 flex-col gap-8 lg:col-span-2">
        <div className="flex flex-col gap-3">
          <StatusBadge status={badge.status} className="self-start leading-[1.2]">
            {badge.label}
          </StatusBadge>
          <h1 className="text-4xl leading-[1.2] font-semibold tracking-[-0.5px]">Change report</h1>
          <div className="text-base leading-normal text-slate">
            <Mono chip>{file.name}</Mono>
            {file.appliedAt !== null && (
              <>
                {file.approvedByName && <> · Approved by {file.approvedByName}</>} · <LocalTime at={file.appliedAt} />
              </>
            )}
          </div>
        </div>

        {applied ? (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
              {reportStats(summary).map((stat) => (
                <Card key={stat.label} className="p-5 leading-[1.2]">
                  <Eyebrow>{stat.label}</Eyebrow>
                  <div className="text-[28px] leading-[1.2] font-semibold">{stat.value}</div>
                </Card>
              ))}
            </div>

            <div className="flex flex-col gap-3">
              <h2 className="text-[22px] leading-[1.2] font-semibold">By column</h2>
              <Card className="overflow-x-auto">
                <table className="w-full text-sm leading-normal">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold tracking-[0.5px] text-slate uppercase">
                      <th scope="col" className="px-5 py-3 text-left font-semibold">Column</th>
                      <th scope="col" className="px-5 py-3 text-left font-semibold">Issue</th>
                      <th scope="col" className="px-5 py-3 text-left font-semibold">Fixed</th>
                      <th scope="col" className="px-5 py-3 text-left font-semibold">Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byColumn.length === 0 ? (
                      <tr className="border-t border-divider">
                        <td colSpan={4} className="px-5 py-3.5 text-slate">
                          No column changes were applied.
                        </td>
                      </tr>
                    ) : (
                      summary.byColumn.map((row) => (
                        <tr key={row.column} className="border-t border-divider">
                          <td className="px-5 py-3.5">
                            <Mono>{row.column}</Mono>
                          </td>
                          <td className="px-5 py-3.5 text-slate">{row.issue}</td>
                          <td className="px-5 py-3.5">{fixedLabel(row)}</td>
                          <td className="px-5 py-3.5 text-slate">{row.method}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </Card>
            </div>
          </>
        ) : (
          <InfoPanel className="flex flex-col items-start gap-3 p-6">
            <p className="text-base leading-normal text-slate">
              No changes have been applied to this file yet. The report appears once you apply them.
            </p>
            {review && (
              <Link href={review} className={cn(linkButton, "w-auto")}>
                Back to review
              </Link>
            )}
          </InfoPanel>
        )}
      </section>

      <aside className="flex min-w-0 flex-col gap-4">
        {applied && (
          <Card className="flex flex-col gap-3 p-6">
            <h2 className="text-lg leading-[1.2] font-semibold">Downloads</h2>
            {cleaned.kind === "available" ? (
              <a href={downloadLink(current.user.id, file.id, "cleaned")} download className={primaryButton}>
                Cleaned CSV
              </a>
            ) : cleaned.kind === "deleted" ? (
              <p className="text-sm leading-normal text-slate">
                Cleaned file deleted
                {cleaned.at !== null && (
                  <>
                    {" "}
                    on <LocalTime at={cleaned.at} format="date" />
                  </>
                )}{" "}
                — report kept
              </p>
            ) : null}
            <a href={downloadLink(current.user.id, file.id, "report_pdf")} download className={linkButton}>
              Report PDF
            </a>
            <a href={downloadLink(current.user.id, file.id, "changes_csv")} download className={linkButton}>
              Change log CSV
            </a>
            <p className="text-[13px] leading-[1.4] text-slate">{downloadNote(file.deletesInMs)}</p>
          </Card>
        )}

        <InfoPanel className="flex flex-col gap-3 p-6">
          <h2 className="text-lg leading-[1.2] font-semibold">Activity</h2>
          {activity.length === 0 ? (
            <p className="text-sm leading-[1.4] text-slate">No activity yet.</p>
          ) : (
            <ol className="flex flex-col gap-3 text-sm leading-[1.4]">
              {activity.map((item) => (
                <li key={item.id}>
                  <Mono className="text-slate">
                    <LocalTime at={item.at} format="time" />
                  </Mono>{" "}
                  {activityText(item)}
                </li>
              ))}
            </ol>
          )}
        </InfoPanel>
      </aside>
    </main>
  );
}

function ReportSkeleton() {
  return (
    <main
      aria-busy="true"
      className="mx-auto grid max-w-[1344px] grid-cols-[minmax(0,1fr)] items-start gap-8 px-8 py-12 lg:grid-cols-[repeat(3,minmax(0,1fr))]"
    >
      <section className="flex min-w-0 flex-col gap-8 lg:col-span-2">
        <div className="flex flex-col gap-3">
          <div className="h-6 w-20 animate-pulse rounded-full bg-surface" />
          <div className="h-10 w-72 max-w-full animate-pulse rounded bg-surface" />
          <div className="h-5 w-96 max-w-full animate-pulse rounded bg-surface" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-xl border border-hairline bg-white" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-surface" />
      </section>
      <aside className="flex min-w-0 flex-col gap-4">
        <div className="h-72 animate-pulse rounded-xl bg-surface" />
        <div className="h-56 animate-pulse rounded-xl bg-surface" />
      </aside>
    </main>
  );
}
