import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/layout";
import {
  Button,
  Card,
  CheckIcon,
  CheckboxField,
  FilterPill,
  InfoPanel,
  Mono,
  PiiTag,
  SourceTag,
  StatCard,
  ValueChange,
  cn,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Review changes · DataCleanse",
};

type Source = { kind: "rule" } | { kind: "ai"; confidence: number };

type Diff =
  | { type: "value"; before: string; after: string }
  | { type: "merge"; from: string; into: string };

type ProposedChange = {
  id: string;
  location: string;
  diff: Diff;
  source: Source;
  reason: string;
  decision: "approved" | "undecided";
};

type Stat = {
  label: string;
  value: string;
  caption: string;
  tone?: "default" | "review";
};

type Filter = { label: string; count: number; active?: boolean };

const stats: Stat[] = [
  { label: "Dates normalized", value: "96", caption: "Rule-based · ISO 8601" },
  { label: "Duplicates merged", value: "37", caption: "Exact + fuzzy match" },
  { label: "Text cleaned", value: "65", caption: "Whitespace, casing, phones" },
  {
    label: "Needs your decision",
    value: "16",
    caption: "AI-suggested · low confidence",
    tone: "review",
  },
];

const filters: Filter[] = [
  { label: "All", count: 214, active: true },
  { label: "Needs review", count: 16 },
  { label: "Rule-based", count: 168 },
  { label: "AI", count: 46 },
];

const proposedChanges: ProposedChange[] = [
  {
    id: "c-118",
    location: "#118 · signup_date",
    diff: { type: "value", before: "03/04/22", after: "2022-03-04" },
    source: { kind: "rule" },
    reason: "Column is 98% MM/DD/YY",
    decision: "approved",
  },
  {
    id: "c-204",
    location: "#204 · company",
    diff: { type: "value", before: '"  acme corp. "', after: "Acme Corp" },
    source: { kind: "rule" },
    reason: "Trim + title case",
    decision: "approved",
  },
  {
    id: "c-311",
    location: "#311 · country",
    diff: { type: "value", before: "Gemany", after: "Germany" },
    source: { kind: "ai", confidence: 72 },
    reason: "Likely typo",
    decision: "undecided",
  },
  {
    id: "c-87-402",
    location: "#87 + #402",
    diff: { type: "merge", from: '"J. Ortiz"', into: '"Jane Ortiz"' },
    source: { kind: "ai", confidence: 81 },
    reason: "Same email",
    decision: "undecided",
  },
  {
    id: "c-512",
    location: "#512 · phone",
    diff: { type: "value", before: "(555)0142 x", after: "+1 555-0142" },
    source: { kind: "rule" },
    reason: "E.164 phone format",
    decision: "approved",
  },
];

const linkBase =
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium no-underline transition-colors";

const linkSizes = {
  md: "min-h-10 px-5 py-2.5",
  lg: "min-h-11 px-5 py-2.5",
} as const;

const linkVariants = {
  primary: "bg-ink text-white",
  accent: "bg-mint text-ink",
  secondary: "border border-hairline bg-transparent text-ink",
} as const;

/* Design uses a white Skip pill and white chips on grey/tinted surfaces; the shared
   Button and Mono chip set transparent/grey backgrounds, which cn() cannot override. */
const skipButton =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink";

const chipWhite =
  "font-mono text-[13px] font-medium text-ink-2 rounded border border-hairline bg-white px-1.5 py-0.5";

/** Next.js Link styled as a pill button (a <Button> cannot render as a link). */
function LinkButton({
  href,
  variant = "primary",
  size = "md",
  children,
}: {
  href: string;
  variant?: keyof typeof linkVariants;
  size?: keyof typeof linkSizes;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(linkBase, linkSizes[size], linkVariants[variant])}
    >
      {children}
    </Link>
  );
}

export default function ReviewChangesPage() {
  return (
    <div className="min-h-screen bg-white font-sans text-ink">
      <AppHeader
        active="Files"
        actions={
          <>
            <Button variant="secondary">Help</Button>
            <LinkButton href="/upload">New upload</LinkButton>
          </>
        }
      />

      <main className="mx-auto flex max-w-[1344px] flex-col gap-8 px-8 py-12">
        <section className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Mono chip>crm_export_q3.csv</Mono>
              <span className="text-[13px] text-muted">4,812 rows · 11 columns</span>
            </div>
            <h1 className="text-4xl leading-[1.2] font-semibold tracking-[-0.5px]">
              Review 214 proposed changes
            </h1>
            <p className="text-base leading-normal text-slate">
              Nothing is applied until you approve it. Files are deleted automatically
              after 24 hours.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" size="lg">
              Reject all AI suggestions
            </Button>
            <LinkButton href="/report" size="lg">
              Apply 198 approved and download
            </LinkButton>
          </div>
        </section>

        <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <StatCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              caption={stat.caption}
              tone={stat.tone}
            />
          ))}
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-3">
          <section aria-label="Proposed changes" className="min-w-0 lg:col-span-2">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap gap-2 border-b border-divider px-5 py-4">
                {filters.map((filter) => (
                  <FilterPill key={filter.label} active={filter.active}>
                    {filter.label} {filter.count}
                  </FilterPill>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm leading-normal">
                  <thead>
                    <tr className="text-left text-[11px] tracking-[0.5px] text-slate uppercase">
                      <th scope="col" className="px-5 py-3 font-semibold">
                        Row · Column
                      </th>
                      <th scope="col" className="px-5 py-3 font-semibold">
                        Before → After
                      </th>
                      <th scope="col" className="px-5 py-3 font-semibold">
                        Why
                      </th>
                      <th scope="col" className="px-5 py-3 font-semibold">
                        Decision
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposedChanges.map((row) => {
                      const isAi = row.source.kind === "ai";
                      return (
                        <tr
                          key={row.id}
                          className={cn("border-t border-divider", isAi && "bg-review-row")}
                        >
                          <td className="px-5 py-4">
                            <Mono className="text-ink-2">{row.location}</Mono>
                          </td>
                          <td className="px-5 py-4">
                            {row.diff.type === "value" ? (
                              <ValueChange
                                className="whitespace-nowrap"
                                before={row.diff.before}
                                after={row.diff.after}
                              />
                            ) : (
                              <span className="text-sm">
                                Merge <Mono>{row.diff.from}</Mono> into{" "}
                                <Mono>{row.diff.into}</Mono>
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-slate">
                            {row.source.kind === "ai" ? (
                              <SourceTag kind="ai">AI · {row.source.confidence}%</SourceTag>
                            ) : (
                              <SourceTag kind="rule" />
                            )}{" "}
                            {row.reason}
                          </td>
                          <td className="px-5 py-4">
                            {row.decision === "approved" ? (
                              <span className="inline-flex items-center gap-1.5 font-medium">
                                <CheckIcon className="text-mint-deep" />
                                Approved
                              </span>
                            ) : (
                              <div className="flex gap-2">
                                <Button size="sm" aria-label={`Keep change ${row.location}`}>
                                  Keep
                                </Button>
                                <button
                                  type="button"
                                  aria-label={`Skip change ${row.location}`}
                                  className={skipButton}
                                >
                                  Skip
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>

          <aside aria-label="Privacy and report" className="flex flex-col gap-4">
            <InfoPanel className="flex flex-col gap-3 p-8">
              <h2 className="text-lg leading-[1.4] font-semibold">What the AI saw</h2>
              <p className="m-0 text-sm leading-normal text-slate">
                Column names, statistics and a 20-row sample. Never the full file.
              </p>
              <CheckboxField className="min-h-11! font-medium">
                Rules only — no AI for this file
              </CheckboxField>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate">
                <PiiTag />
                <span>Possible in</span>
                <span className={chipWhite}>email</span>
                <span className={chipWhite}>phone</span>
              </div>
            </InfoPanel>

            <Card className="flex flex-col gap-3 p-6">
              <h2 className="text-lg leading-[1.4] font-semibold">Change report</h2>
              <p className="m-0 text-sm leading-normal text-slate">
                Every change, its reason and who approved it — exported with your cleaned
                file.
              </p>
              <div className="flex flex-wrap gap-2">
                <LinkButton href="/report" variant="accent" size="md">
                  Report PDF
                </LinkButton>
                <Button variant="secondary">Changes CSV</Button>
              </div>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
