import type { Metadata } from "next";
import Link from "next/link";
import { AccountButton, AppHeader } from "@/components/layout";
import {
  Button,
  Card,
  Eyebrow,
  InfoPanel,
  Mono,
  StatusBadge,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Change report · DataCleanse",
};

const stats = [
  { label: "Applied", value: "198" },
  { label: "Skipped", value: "16" },
  { label: "Rows removed", value: "37" },
  { label: "Rows out", value: "4,775" },
];

const columns = [
  { column: "signup_date", issue: "3 date formats", fixed: "96 / 96", method: "Rule" },
  { column: "company", issue: "Whitespace, casing", fixed: "41 / 41", method: "Rule" },
  { column: "country", issue: "Typos, codes vs names", fixed: "18 / 24", method: "Rule + AI" },
  { column: "email", issue: "Duplicate records", fixed: "37 / 47", method: "Rule + AI" },
  { column: "phone", issue: "Mixed formats", fixed: "6 / 6", method: "Rule" },
];

const activity = [
  { time: "19:42", text: "Applied 198 changes" },
  { time: "19:39", text: "Skipped 16 AI suggestions" },
  { time: "19:31", text: "AI reviewed 20-row sample" },
  { time: "19:30", text: "Uploaded · 4,812 rows" },
];

const linkButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-hairline bg-transparent px-5 py-2.5 text-sm font-medium text-ink no-underline transition-colors hover:bg-surface";

export default function ReportPage() {
  return (
    <div className="min-h-dvh bg-white text-ink">
      <AppHeader active="Reports" actions={<AccountButton />} />

      <main className="mx-auto grid max-w-[1344px] grid-cols-[minmax(0,1fr)] items-start gap-8 px-8 py-12 lg:grid-cols-[repeat(3,minmax(0,1fr))]">
        <section className="flex min-w-0 flex-col gap-8 lg:col-span-2">
          <div className="flex flex-col gap-3">
            <StatusBadge status="ready" className="self-start leading-[1.2]">
              Applied
            </StatusBadge>
            <h1 className="text-4xl leading-[1.2] font-semibold tracking-[-0.5px]">
              Change report
            </h1>
            <div className="text-base leading-normal text-slate">
              <Mono chip>crm_export_q3.csv</Mono> · Approved by Maria R. · Oct 18, 2026
              7:42 PM
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
            {stats.map((stat) => (
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
                    <th className="px-5 py-3 text-left font-semibold">Column</th>
                    <th className="px-5 py-3 text-left font-semibold">Issue</th>
                    <th className="px-5 py-3 text-left font-semibold">Fixed</th>
                    <th className="px-5 py-3 text-left font-semibold">Method</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((row) => (
                    <tr key={row.column} className="border-t border-divider">
                      <td className="px-5 py-3.5">
                        <Mono>{row.column}</Mono>
                      </td>
                      <td className="px-5 py-3.5 text-slate">{row.issue}</td>
                      <td className="px-5 py-3.5">{row.fixed}</td>
                      <td className="px-5 py-3.5 text-slate">{row.method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <Card className="flex flex-col gap-3 p-6">
            <h2 className="text-lg leading-[1.2] font-semibold">Downloads</h2>
            <Button size="lg" className="w-full">
              Cleaned CSV
            </Button>
            <Link href="/report" className={`w-full ${linkButton}`}>
              Report PDF
            </Link>
            <Button variant="secondary" size="lg" className="w-full">
              Change log CSV
            </Button>
            <p className="text-[13px] leading-[1.4] text-slate">
              Download links expire after 15 minutes. Files are deleted in 21 hours.
            </p>
          </Card>

          <InfoPanel className="flex flex-col gap-3 p-6">
            <h2 className="text-lg leading-[1.2] font-semibold">Activity</h2>
            <ol className="flex flex-col gap-3 text-sm leading-[1.4]">
              {activity.map((item) => (
                <li key={item.time}>
                  <Mono className="text-slate">{item.time}</Mono> {item.text}
                </li>
              ))}
            </ol>
          </InfoPanel>
        </aside>
      </main>
    </div>
  );
}
