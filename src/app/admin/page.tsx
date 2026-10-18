import type { Metadata } from "next";
import { ADMIN_NAV, AppHeader } from "@/components/layout";
import { Card, cn, Eyebrow, Mono, StatusBadge, type Status } from "@/components/ui";

export const metadata: Metadata = {
  title: "Admin · DataCleanse",
};

const STATS: { label: string; value: string; tone?: "error" }[] = [
  { label: "Jobs today", value: "1,284" },
  { label: "Failed", value: "17", tone: "error" },
  { label: "Queue depth", value: "6" },
  { label: "AI calls today", value: "3,902" },
];

const JOBS: { id: string; type: string; status: Status; label: string; duration: string }[] = [
  { id: "job_8f21c", type: "Clean", status: "ready", label: "Done", duration: "48 s" },
  { id: "job_8f21a", type: "Ask · 3 files", status: "ready", label: "Done", duration: "0.4 s" },
  { id: "job_8f219", type: "Compare", status: "processing", label: "Running", duration: "12 s" },
  { id: "job_8f214", type: "Ask · 1 file", status: "failed", label: "Blocked query", duration: "—" },
];

const AUDIT: { time: string; text: string }[] = [
  { time: "19:44", text: "Query rejected: tried to read a file outside the chat" },
  { time: "19:12", text: "Retention job deleted 212 files" },
  { time: "18:50", text: "Admin changed AI provider to local model" },
];

const TABLE_HEADINGS = ["Job", "Type", "Status", "Duration"];

export default function AdminPage() {
  return (
    <>
      <div className="flex flex-wrap justify-between gap-2 bg-ink px-8 py-3 text-sm font-medium leading-[normal] text-white">
        <span>Admin mode · signed in with two-factor</span>
        <span className="text-white/65">Self-hosted · v0.1.0</span>
      </div>

      <AppHeader
        nav={ADMIN_NAV}
        navLabel="Admin"
        active="Overview"
        logoLabel="DataCleanse Admin"
      />

      <main className="mx-auto flex max-w-[1344px] flex-col gap-8 px-8 py-12">
        <h1 className="text-4xl font-semibold leading-[1.2] tracking-[-0.5px]">Overview</h1>

        <section className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          {STATS.map((stat) => (
            <Card key={stat.label} className="flex flex-col p-6">
              <Eyebrow className="leading-[normal]">{stat.label}</Eyebrow>
              <div
                className={cn(
                  "text-[28px] font-semibold leading-[normal]",
                  stat.tone === "error" && "text-error",
                )}
              >
                {stat.value}
              </div>
            </Card>
          ))}
        </section>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <Card className="min-w-0 overflow-x-auto lg:col-span-2">
            <table aria-label="Recent jobs" className="w-full text-sm leading-normal">
              <thead>
                <tr>
                  {TABLE_HEADINGS.map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.5px] text-slate"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {JOBS.map((job) => (
                  <tr key={job.id} className="border-t border-divider">
                    <td className="px-5 py-3.5">
                      <Mono>{job.id}</Mono>
                    </td>
                    <td className="px-5 py-3.5">{job.type}</td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={job.status} className="leading-[normal]">
                        {job.label}
                      </StatusBadge>
                    </td>
                    <td className="px-5 py-3.5 text-slate">{job.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <section
            aria-labelledby="audit-log-heading"
            className="flex flex-col gap-3 rounded-xl bg-surface p-6"
          >
            <h2 id="audit-log-heading" className="text-lg font-semibold leading-[normal]">
              Audit log
            </h2>
            <ol className="flex flex-col gap-3 text-sm leading-[1.4]">
              {AUDIT.map((entry) => (
                <li key={entry.time}>
                  <Mono className="text-slate">{entry.time}</Mono> {entry.text}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </main>
    </>
  );
}
