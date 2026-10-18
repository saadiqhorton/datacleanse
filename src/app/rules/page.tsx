import type { Metadata } from "next";
import { AccountButton, AppHeader, SideNav } from "@/components/layout";
import { Button, Card, CodeBlock, Eyebrow, Kw, Mono } from "@/components/ui";

export const metadata: Metadata = {
  title: "Rules · DataCleanse",
};

const ruleSets = [
  { label: "CRM exports", href: "/rules" },
  { label: "Payroll", href: "/rules" },
  { label: "Vendor lists", href: "/rules" },
];

const activeRules = [
  {
    id: "dates",
    column: "*_date",
    text: "Normalize to YYYY-MM-DD, detect day/month order per column",
    on: true,
  },
  {
    id: "email",
    column: "email",
    text: "Lowercase; treat matching emails as duplicates, keep the newest row",
    on: true,
  },
  {
    id: "phone",
    column: "phone",
    text: "Format as E.164, default country US",
    on: true,
  },
  {
    id: "text",
    column: "all text",
    text: "Trim whitespace, collapse double spaces",
    on: false,
  },
];

/** On/Off label driven by the checkbox state through `peer-checked`, so the page stays a Server Component. */
function ToggleLabel({ id, on, column }: { id: string; on: boolean; column: string }) {
  return (
    <label className="flex min-h-9 items-center gap-1.5 text-[13px]">
      <input
        type="checkbox"
        name={`rule-${id}`}
        defaultChecked={on}
        aria-label={`Enable ${column} rule`}
        className="peer accent-ink"
      />
      <span className="inline peer-checked:hidden">Off</span>
      <span className="hidden peer-checked:inline">On</span>
    </label>
  );
}

export default function RulesPage() {
  return (
    <>
      <AppHeader active="Rules" actions={<AccountButton />} />

      <div className="mx-auto flex max-w-[1280px] flex-wrap">
        <SideNav
          label="Rule sets"
          bordered
          dot
          active="CRM exports"
          items={ruleSets}
          footer={
            <Button variant="ghost" className="mt-3 justify-start">
              + New rule set
            </Button>
          }
        />

        <main className="flex min-w-0 flex-1 basis-[320px] flex-col gap-6 p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <h1 className="text-[28px] font-semibold leading-[1.25]">CRM exports</h1>
              <p className="text-sm text-slate">
                Applied automatically to files whose headers match this set.
              </p>
            </div>
            <Button variant="primary" size="md">
              Save rules
            </Button>
          </div>

          <Card className="flex flex-col gap-3 p-5">
            <label htmlFor="nl-rule" className="text-sm font-medium">
              Describe a rule in plain English
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="nl-rule"
                name="nl-rule"
                defaultValue="Country should always be the full English name"
                className="h-11 min-w-0 flex-1 basis-60 rounded-lg border-2 border-mint px-4 text-sm outline-none"
              />
              <Button variant="primary" size="lg">
                Turn into rule
              </Button>
            </div>

            <CodeBlock
              caption={
                <span className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                  <span>Draft rule · check before saving</span>
                  <span>Preview: 24 matches</span>
                </span>
              }
            >
              <span className="block">
                {"when column matches  "}
                <span className="text-mint">&quot;country&quot;</span>
              </span>
              <span className="block">map ISO-3166 codes → English names</span>
              <span className="block">
                {"fix typos within    "}
                <span className="text-[#F5B97A]">edit distance 2</span>
              </span>
              <span className="block">
                {"on low confidence   "}
                <Kw>ask for review</Kw>
              </span>
            </CodeBlock>
          </Card>

          <section className="flex flex-col">
            <Eyebrow className="pb-2">Active rules · {activeRules.length}</Eyebrow>
            {activeRules.map((rule, i) => (
              <div
                key={rule.id}
                className={
                  "flex flex-wrap items-center gap-3 border-t border-divider py-4" +
                  (i === activeRules.length - 1 ? " border-b" : "")
                }
              >
                <Mono chip>{rule.column}</Mono>
                <span className="min-w-[200px] flex-1 text-sm">{rule.text}</span>
                <ToggleLabel id={rule.id} on={rule.on} column={rule.column} />
              </div>
            ))}
          </section>
        </main>
      </div>
    </>
  );
}
