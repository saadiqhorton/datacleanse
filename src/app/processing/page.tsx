import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/layout";
import {
  Callout,
  Card,
  CheckIcon,
  Eyebrow,
  Mono,
  ProgressBar,
} from "@/components/ui";
import { cn } from "@/components/ui/cn";

export const metadata: Metadata = {
  title: "Processing · DataCleanse",
};

const pillBase =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium no-underline transition-colors";
const pillPrimary = "bg-ink text-white hover:text-white";
const pillSecondary = "border border-hairline bg-white text-ink";

const steps = [
  { text: "Checked file format and size", state: "done" },
  { text: "Scanned for malware", state: "done" },
  { text: "Profiled 11 columns", state: "done" },
  { text: "Applied cleaning rules · 168 changes", state: "done" },
  { text: "Asking AI about 46 ambiguous values", state: "active" },
  { text: "Building change report", state: "pending" },
] as const;

export default function ProcessingPage() {
  return (
    <div className="min-h-[960px] bg-white font-sans text-ink">
      <AppHeader
        nav={false}
        actions={
          <Link href="/files" className="text-sm font-medium no-underline">
            Back to files
          </Link>
        }
      />

      <main className="mx-auto grid max-w-[1280px] grid-cols-1 items-start gap-8 px-4 py-12 sm:px-8 lg:grid-cols-2 lg:py-16">
        <Card className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex flex-col gap-2">
            <Mono className="text-slate">crm_export_q3.csv</Mono>
            <h1 className="text-[28px] font-semibold leading-[1.25]">
              Cleaning your file…
            </h1>
          </div>

          <div className="flex flex-col gap-2">
            <ProgressBar value={68} label="Cleaning progress" />
            <div className="flex justify-between text-[13px] text-slate">
              <span>68%</span>
              <span>About 40 seconds left</span>
            </div>
          </div>

          <ol className="m-0 flex list-none flex-col gap-3.5 p-0 text-sm">
            {steps.map((step) => (
              <li
                key={step.text}
                className={cn(
                  "flex items-center gap-3",
                  step.state === "active" && "font-semibold",
                  step.state === "pending" && "text-muted",
                )}
              >
                {step.state === "done" && (
                  <CheckIcon size={18} className="shrink-0 text-mint-deep" />
                )}
                {step.state === "active" && (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    aria-hidden="true"
                    className="shrink-0"
                  >
                    <circle cx="12" cy="12" r="8" strokeDasharray="30 20" />
                  </svg>
                )}
                {step.state === "pending" && (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#C5C9CF"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                    className="shrink-0"
                  >
                    <circle cx="12" cy="12" r="8" />
                  </svg>
                )}
                {step.text}
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4">
            <span className="text-sm text-slate">
              You can leave this page. We&apos;ll email you when it&apos;s ready.
            </span>
            <Link href="/files" className={cn(pillBase, pillSecondary)}>
              Cancel job
            </Link>
          </div>
        </Card>

        <section className="flex flex-col gap-4">
          <Eyebrow>Other states</Eyebrow>

          <Callout
            tone="error"
            title={
              <span className="flex items-center gap-2.5 text-base">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  aria-hidden="true"
                  className="shrink-0 text-error"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v6M12 16.5v.5" />
                </svg>
                We couldn&apos;t read this file
              </span>
            }
          >
            <div className="mt-3 flex flex-col gap-3">
              <p className="m-0 text-sm leading-normal text-slate">
                Line 1,204 isn&apos;t valid UTF-8. Re-export from your tool as
                &quot;CSV UTF-8&quot; and try again. Nothing was sent to AI.
              </p>
              <div>
                <Link href="/upload" className={cn(pillBase, pillPrimary)}>
                  Upload again
                </Link>
              </div>
            </div>
          </Callout>

          <Callout
            tone="review"
            title={<span className="text-base">AI is temporarily unavailable</span>}
          >
            <div className="mt-3 flex flex-col gap-3">
              <p className="m-0 text-sm leading-normal text-slate">
                Rule-based changes are ready to review now. AI suggestions will
                be added when the service is back, or you can skip them.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href="/review" className={cn(pillBase, pillPrimary)}>
                  Review rule changes
                </Link>
                <button type="button" className={cn(pillBase, pillSecondary)}>
                  Wait for AI
                </button>
              </div>
            </div>
          </Callout>

          <Callout
            tone="info"
            className="border border-hairline"
            title={<span className="text-base">Large file · processing in chunks</span>}
          >
            <p className="mb-0 mt-2 text-sm leading-normal text-slate">
              2.4 million rows. We stream this file in parts so memory stays
              stable. Results appear when every chunk is done.
            </p>
          </Callout>
        </section>
      </main>
    </div>
  );
}
