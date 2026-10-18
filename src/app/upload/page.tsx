import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/layout";
import {
  Card,
  CheckIcon,
  CheckboxField,
  Mono,
  RadioCard,
  SelectField,
  UploadIcon,
  cn,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Upload · DataCleanse",
};

const steps = [
  { n: 1, label: "Upload", active: true },
  { n: 2, label: "Options", active: true },
  { n: 3, label: "Review", active: false },
];

const columns = ["name", "email", "signup_date", "country"];

const rows: (string | null)[][] = [
  ["Jane Ortiz", "jane@acme.io", "2022-03-04", "Germany"],
  ["J. Ortiz", "jane@acme.io", "03/04/22", "Gemany"],
  ["  lee park", null, "4 Mar 2022", "KR"],
];

/**
 * RadioCard is controlled by `checked`; the has-[:checked] classes draw the selected border natively.
 * Preflight zeroes input margins; the design uses the browser default (5px left, 3px right).
 */
const radioClass =
  "has-[:checked]:border-2 has-[:checked]:border-ink [&>input]:ml-[5px] [&>input]:mr-[3px]";

/** Design uses the browser-default checkbox margin (4px left, 3px right). */
const checkboxClass = "[&>input]:ml-1 [&>input]:mr-[3px]";

export default function UploadPage() {
  return (
    <>
      <AppHeader
        nav={false}
        center={
          <ol aria-label="Steps" className="flex flex-wrap gap-6 text-sm">
            {steps.map((s) => (
              <li
                key={s.n}
                className={cn(
                  "flex items-center gap-2",
                  s.active ? "font-medium" : "text-muted",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-xs",
                    s.active ? "bg-ink text-white" : "border border-hairline",
                  )}
                >
                  {s.n}
                </span>
                {s.label}
              </li>
            ))}
          </ol>
        }
        actions={
          <Link
            href="/files"
            className="inline-flex h-10 items-center justify-center rounded-full border border-hairline px-5 text-sm font-medium text-ink no-underline"
          >
            Cancel
          </Link>
        }
      />

      <main className="mx-auto grid max-w-[1344px] grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] items-start gap-8 px-8 py-12">
        <section className="flex min-w-0 flex-col gap-6">
          <h1 className="text-4xl font-semibold leading-[1.2] tracking-[-0.5px]">
            Upload a CSV
          </h1>

          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-surface px-6 py-12 text-center [border-color:var(--color-dashed)]">
            <UploadIcon />
            <div className="text-[18px] font-semibold">Drop your file here</div>
            <div className="text-[14px] text-slate">
              .csv or .tsv · or add several at once to compare or ask about
            </div>
            <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-mint">
              Choose file
              <input
                type="file"
                name="files"
                accept=".csv,.tsv,text/csv"
                multiple
                className="sr-only"
              />
            </label>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-5 py-4">
              <div className="flex items-center gap-2">
                <CheckIcon className="text-mint-deep" />
                <Mono className="font-medium">crm_export_q3.csv</Mono>
              </div>
              <span className="text-[13px] text-slate">
                2.1 MB · 4,812 rows · comma-separated ·{" "}
                <span className="whitespace-nowrap">UTF-8</span> · scanned clean
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[13px] leading-[1.4]">
                <thead>
                  <tr className="bg-surface text-left text-ink-2">
                    {columns.map((c) => (
                      <th
                        key={c}
                        scope="col"
                        className="whitespace-nowrap px-4 py-2 font-medium"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-slate">
                  {rows.map((row, i) => (
                    <tr key={i} className="border-t border-divider">
                      {row.map((cell, j) =>
                        cell === null ? (
                          <td
                            key={j}
                            className="whitespace-nowrap px-4 py-2 text-error"
                          >
                            (empty)
                          </td>
                        ) : (
                          <td key={j} className="whitespace-nowrap px-4 py-2">
                            {cell}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        <section className="flex min-w-0 flex-col gap-6">
          <Card className="flex flex-col gap-4 p-6">
            <h2 className="text-[18px] font-semibold">How should we clean it?</h2>
            <RadioCard
              name="mode"
              defaultChecked
              title="Rules + AI suggestions"
              description="Rules fix the obvious issues. AI suggests fixes for ambiguous values, and you approve each one."
              className={radioClass}
            />
            <RadioCard
              name="mode"
              title="Rules only"
              description="Nothing leaves our servers. Best for sensitive data."
              className={radioClass}
            />
          </Card>

          <Card className="flex flex-col gap-3 p-6">
            <h2 className="text-[18px] font-semibold">What to fix</h2>
            <CheckboxField defaultChecked className={checkboxClass}>
              Normalize dates to{" "}
              <Mono chip>YYYY-MM-DD</Mono>
            </CheckboxField>
            <CheckboxField defaultChecked className={checkboxClass}>
              Find and merge duplicate records
            </CheckboxField>
            <CheckboxField defaultChecked className={checkboxClass}>
              Trim whitespace and fix casing
            </CheckboxField>
            <CheckboxField className={checkboxClass}>
              Fill missing values (flag only by default)
            </CheckboxField>
            <SelectField
              label="Ambiguous dates like 03/04/22 mean"
              defaultValue="detect"
              className="mt-2 leading-[17px]"
            >
              <option value="detect">Detect from column (recommended)</option>
              <option value="month-day">Month / Day</option>
              <option value="day-month">Day / Month</option>
            </SelectField>
          </Card>

          <Link
            href="/processing"
            className="flex min-h-11 items-center justify-center rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-ink no-underline"
          >
            Start cleaning
          </Link>
        </section>
      </main>
    </>
  );
}
