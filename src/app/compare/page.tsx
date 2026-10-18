import type { Metadata } from "next";
import Link from "next/link";
import { AccountButton, AppHeader } from "@/components/layout";
import {
  Button,
  Card,
  Eyebrow,
  FilterPill,
  InfoPanel,
  Mono,
  ValueChange,
  cn,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Compare · DataCleanse",
};

const summary = [
  { label: "Added rows", value: "+ 128" },
  { label: "Removed rows", value: "− 34" },
  { label: "Changed rows", value: "57" },
  { label: "Unchanged", value: "4,684" },
];

const tabs = [
  { label: "Changed", count: 57, active: true },
  { label: "Added", count: 128, active: false },
  { label: "Removed", count: 34, active: false },
];

const changedRows = [
  { email: "jane@acme.io", column: "plan", before: "starter", after: "team" },
  { email: "lee@park.kr", column: "city", before: "Seoul", after: "Busan" },
  { email: "ops@globex.com", column: "zip", before: "2134", after: "02134" },
  { email: "ana@initech.co", column: "status", before: "active", after: "churned" },
];

const chip = "rounded border border-hairline bg-white px-1.5 py-0.5";
const linkPill =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-hairline px-5 py-2.5 text-sm font-medium text-ink no-underline transition-colors hover:bg-surface";

export default function ComparePage() {
  return (
    <>
      <AppHeader active="Compare" actions={<AccountButton />} />

      <main className="mx-auto flex max-w-[1280px] flex-col gap-8 px-4 py-12 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-3">
            <h1 className="text-4xl font-semibold leading-[1.2] tracking-[-0.5px]">
              Compare files
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate">
              <Mono chip>customers_sept.csv</Mono>
              <span>vs</span>
              <Mono chip>customers_oct.csv</Mono>
              <span>· rows matched on</span>
              <select
                aria-label="Match rows on"
                defaultValue="email"
                className="h-8 rounded-lg border border-hairline bg-white px-2 font-mono text-[13px] text-ink"
              >
                <option>email</option>
                <option>customer_id</option>
              </select>
              <span>(unique in both files)</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/ask" className={linkPill}>
              Ask about these
            </Link>
            <Button variant="primary" size="md">
              Export diff
            </Button>
          </div>
        </div>

        <section
          aria-label="Summary"
          className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4"
        >
          {summary.map((item) => (
            <Card key={item.label} className="p-6">
              <Eyebrow>{item.label}</Eyebrow>
              <div className="text-[28px] font-semibold leading-tight">{item.value}</div>
            </Card>
          ))}
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-3">
          <InfoPanel className="flex flex-col gap-3 p-6">
            <h2 className="text-lg font-semibold">Columns</h2>
            <div className="flex flex-col gap-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-16 font-semibold">Added</span>
                <Mono className={chip}>lifetime_value</Mono>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-16 font-semibold">Removed</span>
                <Mono className={cn(chip, "text-error line-through")}>fax</Mono>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 font-semibold">Type</span>
                <Mono className={chip}>zip</Mono>
                <span className="text-slate">number → text (leading zeros kept)</span>
              </div>
            </div>
          </InfoPanel>

          <section aria-label="Changed rows" className="min-w-0 lg:col-span-2">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap gap-2 border-b border-divider px-5 py-4">
                {tabs.map((tab) => (
                  <FilterPill key={tab.label} active={tab.active}>
                    {tab.label} {tab.count}
                  </FilterPill>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm leading-normal">
                  <thead>
                    <tr className="text-[11px] font-semibold uppercase tracking-[0.5px] text-slate">
                      <th className="px-5 py-3 text-left font-semibold">email</th>
                      <th className="px-5 py-3 text-left font-semibold">Column</th>
                      <th className="px-5 py-3 text-left font-semibold">
                        September → October
                      </th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-[13px]">
                    {changedRows.map((row) => (
                      <tr key={`${row.email}-${row.column}`} className="border-t border-divider">
                        <td className="px-5 py-3.5">{row.email}</td>
                        <td className="px-5 py-3.5 text-slate">{row.column}</td>
                        <td className="px-5 py-3.5">
                          <ValueChange before={row.before} after={row.after} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        </div>
      </main>
    </>
  );
}
