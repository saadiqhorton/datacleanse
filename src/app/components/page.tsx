import type { Metadata } from "next";
import {
  Button,
  Callout,
  CheckboxField,
  CloseIcon,
  CodeBlock,
  Eyebrow,
  FilterPill,
  IconButton,
  Kw,
  Mono,
  PiiTag,
  ProgressBar,
  SourceTag,
  StatCard,
  StatusBadge,
  TextField,
  ValueChange,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Components · DataCleanse",
};

const colors = [
  { name: "Ink", hex: "#0B0C0E", swatch: "bg-ink" },
  { name: "Slate", hex: "#5B616B", swatch: "bg-slate" },
  { name: "Hairline", hex: "#E3E5E8", swatch: "bg-hairline" },
  { name: "Surface", hex: "#F6F7F8", swatch: "bg-surface border border-hairline" },
  { name: "Mint", hex: "#00D4A4", swatch: "bg-mint" },
  { name: "Rule blue", hex: "#2A5DB0", swatch: "bg-rule" },
  { name: "Review", hex: "#8A3A10", swatch: "bg-review" },
  { name: "Error", hex: "#B42318", swatch: "bg-error" },
];

export default function ComponentsPage() {
  return (
    <main className="mx-auto max-w-[1440px] p-16">
      <div className="flex flex-col gap-14">
        <header className="flex flex-col gap-2">
          <h1 className="text-5xl leading-[1.1] font-semibold tracking-[-1px]">
            DataCleanse components
          </h1>
          <p className="text-lg text-slate">
            Inter for interface text, Geist Mono for data. Pills for every button, 12px
            corners on cards, mint for accents only.
          </p>
        </header>

        <section className="flex flex-col gap-4">
          <Eyebrow>Color</Eyebrow>
          <div className="grid grid-cols-2 gap-4 text-[13px] sm:grid-cols-4 lg:grid-cols-8">
            {colors.map((c) => (
              <div key={c.name} className="flex flex-col gap-1.5">
                <div className={`h-16 rounded-xl ${c.swatch}`} />
                <div>{c.name}</div>
                <Mono className="text-slate">{c.hex}</Mono>
              </div>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <section className="flex flex-col gap-4">
            <Eyebrow>Type</Eyebrow>
            <div className="text-5xl leading-[1.1] font-semibold tracking-[-1px]">
              Heading 1 · 48
            </div>
            <div className="text-4xl leading-[1.2] font-semibold tracking-[-0.5px]">
              Heading 2 · 36
            </div>
            <div className="text-[28px] leading-[1.25] font-semibold">Heading 3 · 28</div>
            <div className="text-lg font-semibold">Heading 5 · 18</div>
            <div className="text-base leading-normal">
              Body · 16 / 1.5, used for explanations and answers.
            </div>
            <div className="text-sm text-slate">
              Small · 14, used for table cells and secondary text.
            </div>
            <Mono>signup_date · Geist Mono 13 for values and columns</Mono>
          </section>

          <section className="flex flex-col gap-5">
            <Eyebrow>Buttons</Eyebrow>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">Primary</Button>
              <Button variant="accent">Accent</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button disabled>Disabled</Button>
              <Button variant="destructive">Destructive</Button>
              <IconButton aria-label="Close">
                <CloseIcon />
              </IconButton>
            </div>

            <Eyebrow className="mt-3">Filter pills</Eyebrow>
            <div className="flex flex-wrap gap-2">
              <FilterPill active>Active 214</FilterPill>
              <FilterPill>Inactive 16</FilterPill>
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <section className="flex flex-col gap-4">
            <Eyebrow>Inputs</Eyebrow>
            <TextField label="Default" placeholder="maria@northwind.co" />
            <TextField
              label="Focused"
              defaultValue="Country should be full name"
              inputClassName="border-2 border-mint"
            />
            <TextField
              label="Error"
              defaultValue="not-an-email"
              error="Enter a valid email address."
            />
            <div className="flex flex-wrap gap-6 text-sm">
              <CheckboxField defaultChecked>Checkbox</CheckboxField>
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input type="radio" name="sample-radio" defaultChecked className="accent-ink" />
                Radio
              </label>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <Eyebrow>Status &amp; badges</Eyebrow>
            <div className="flex flex-wrap gap-2">
              <StatusBadge status="ready">Ready</StatusBadge>
              <StatusBadge status="processing">Processing</StatusBadge>
              <StatusBadge status="review">Needs review</StatusBadge>
              <StatusBadge status="failed">Failed</StatusBadge>
              <StatusBadge status="deleted">Deleted</StatusBadge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SourceTag kind="rule" />
              <SourceTag kind="ai">AI · 72%</SourceTag>
              <PiiTag />
              <Mono chip>column_name</Mono>
            </div>

            <Eyebrow className="mt-2">Value change</Eyebrow>
            <div>
              <ValueChange before="03/04/22" after="2022-03-04" />
            </div>

            <Eyebrow className="mt-2">Progress</Eyebrow>
            <ProgressBar value={68} label="Progress" />
          </section>
        </div>

        <section className="flex flex-col gap-4">
          <Eyebrow>Cards &amp; callouts</Eyebrow>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Stat card" value="96" caption="Caption" />
            <Callout tone="review" title="Needs a decision">
              Ask the user to confirm joins, low-confidence fixes.
            </Callout>
            <Callout tone="error" title="Error">
              Say what happened and how to fix it.
            </Callout>
            <Callout tone="info" title="Info panel">
              Explain privacy, how answers work.
            </Callout>
          </div>
          <CodeBlock
            caption="Code block · shows the query behind every AI answer"
            className="max-w-[640px]"
          >
            <Kw>SELECT</Kw> country, <Kw>COUNT</Kw>(*) <Kw>FROM</Kw> customers{" "}
            <Kw>GROUP BY</Kw> 1
          </CodeBlock>
        </section>
      </div>
    </main>
  );
}
