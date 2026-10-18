import type { Metadata } from "next";
import Link from "next/link";
import { AccountButton, AppHeader } from "@/components/layout";
import {
  Button,
  Card,
  FilterPill,
  Mono,
  StatusBadge,
  cn,
  type Status,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Your files · DataCleanse",
};

/** Link styled as a pill button (the shared Button only renders <button>). */
function linkButton(variant: "primary" | "secondary", size: "sm" | "md" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium no-underline transition-colors",
    size === "sm" ? "min-h-9 px-4 py-2" : "min-h-10 px-5 py-2.5",
    // Global unlayered `a { color }` in globals.css would otherwise override text-white.
    variant === "primary"
      ? "bg-ink text-white"
      : "border border-hairline bg-transparent text-ink",
  );
}

const filters = [
  { label: "All 6", active: true },
  { label: "Needs review 2", active: false },
  { label: "Ready 2", active: false },
  { label: "Processing 1", active: false },
];

type Action = { label: string; variant: "primary" | "secondary"; href?: string };

const files: {
  name: string;
  nameClass: string;
  status: Status;
  statusLabel: string;
  rows: string;
  rowsClass: string;
  changes: string;
  changesClass: string;
  deletes: string;
  deletesClass: string;
  action: Action;
}[] = [
  {
    name: "crm_export_q3.csv",
    nameClass: "font-medium",
    status: "review",
    statusLabel: "Needs review",
    rows: "4,812",
    rowsClass: "text-slate",
    changes: "214 · 16 pending",
    changesClass: "text-slate",
    deletes: "21 h",
    deletesClass: "text-slate",
    action: { label: "Review", variant: "primary", href: "/review" },
  },
  {
    name: "vendors_2026.csv",
    nameClass: "font-medium",
    status: "processing",
    statusLabel: "Processing · 62%",
    rows: "18,240",
    rowsClass: "text-slate",
    changes: "—",
    changesClass: "text-muted",
    deletes: "23 h",
    deletesClass: "text-slate",
    action: { label: "View progress", variant: "secondary", href: "/processing" },
  },
  {
    name: "payroll_sept.csv",
    nameClass: "font-medium",
    status: "ready",
    statusLabel: "Ready",
    rows: "642",
    rowsClass: "text-slate",
    changes: "58 applied",
    changesClass: "text-slate",
    deletes: "9 h",
    deletesClass: "text-slate",
    action: { label: "Download", variant: "primary" },
  },
  {
    name: "leads_export.csv",
    nameClass: "font-medium",
    status: "failed",
    statusLabel: "Failed",
    rows: "—",
    rowsClass: "text-slate",
    changes: "Not valid UTF-8 at line 1,204",
    changesClass: "text-error",
    deletes: "2 h",
    deletesClass: "text-slate",
    action: { label: "Try again", variant: "secondary" },
  },
  {
    name: "inventory_aug.csv",
    nameClass: "text-muted",
    status: "deleted",
    statusLabel: "Deleted",
    rows: "2,031",
    rowsClass: "text-muted",
    changes: "Report kept",
    changesClass: "text-muted",
    deletes: "—",
    deletesClass: "text-muted",
    action: { label: "Report", variant: "secondary", href: "/report" },
  },
];

const headers = ["File", "Status", "Rows", "Changes", "Deletes in"];

export default function FilesPage() {
  return (
    <>
      <AppHeader
        active="Files"
        actions={
          <>
            <Link href="/upload" className={linkButton("primary")}>
              New upload
            </Link>
            <AccountButton />
          </>
        }
      />

      <main className="mx-auto flex max-w-[1280px] flex-col gap-8 px-8 py-12">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-4xl font-semibold leading-[1.2] tracking-[-0.5px]">
              Your files
            </h1>
            <p className="text-base text-slate">
              Uploads and results are deleted 24 hours after upload.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/compare" className={linkButton("secondary")}>
              Compare files
            </Link>
            <Link href="/ask" className={linkButton("secondary")}>
              Ask about files
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {filters.map((f) => (
              <FilterPill key={f.label} active={f.active}>
                {f.label}
              </FilterPill>
            ))}
          </div>
          <label className="flex h-9 min-w-[260px] items-center gap-2 rounded-lg border border-hairline bg-surface px-3 text-sm text-slate focus-within:border-ink">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
              className="shrink-0"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <input
              placeholder="Search files"
              aria-label="Search files"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-slate"
            />
          </label>
        </div>

        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm leading-normal">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.5px] text-slate">
                {headers.map((h) => (
                  <th key={h} scope="col" className="px-5 py-3 font-semibold">
                    {h}
                  </th>
                ))}
                <th scope="col" className="px-5 py-3 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => {
                const { action } = f;
                return (
                  <tr key={f.name} className="border-t border-divider">
                    <td className="px-5 py-4">
                      <Mono className={f.nameClass}>{f.name}</Mono>
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={f.status}>{f.statusLabel}</StatusBadge>
                    </td>
                    <td className={cn("px-5 py-4", f.rowsClass)}>{f.rows}</td>
                    <td className={cn("px-5 py-4", f.changesClass)}>{f.changes}</td>
                    <td className={cn("px-5 py-4", f.deletesClass)}>{f.deletes}</td>
                    <td className="px-5 py-4 text-right">
                      {action.href ? (
                        <Link
                          href={action.href}
                          className={linkButton(action.variant, "sm")}
                        >
                          {action.label}
                        </Link>
                      ) : (
                        <Button variant={action.variant} size="sm">
                          {action.label}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </main>
    </>
  );
}
