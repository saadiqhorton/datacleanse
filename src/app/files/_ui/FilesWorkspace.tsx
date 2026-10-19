import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { Card, Mono, StatusBadge, cn } from "@/components/ui";
import { downloadLink } from "@/server/files/downloads";
import {
  FILES_TABS,
  TAB_LABELS,
  filesHref,
  filesView,
  parseSearch,
  parseTab,
  type FileListRow,
  type FilesTab,
} from "@/server/files/list-view";
import { AutoRefresh } from "./AutoRefresh";
import { DeleteFileButton } from "./DeleteFileButton";
import { RetryFileButton } from "./RetryFileButton";
import { linkButton, pillLink } from "./classes";

type SearchParams = { status?: string | string[]; q?: string | string[] };

const headers = ["File", "Status", "Rows", "Changes", "Deletes in"];

const EMPTY_TAB_MESSAGE: Record<FilesTab, string> = {
  all: "No files.",
  review: "Nothing needs review.",
  ready: "No files are ready yet.",
  processing: "Nothing is processing.",
  failed: "No failed files.",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The Files list: filter pills, search, the table and the empty state. Reads the signed-in user's
 * files on each request; the pills and search are plain links and a GET form, driven by the URL.
 */
export async function FilesWorkspace({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireUser();
  const params = await searchParams;
  const tab = parseTab(first(params.status));
  const q = parseSearch(first(params.q));
  const view = await filesView(user.id, { tab, q });

  if (view.total === 0 && !q) return <EmptyFiles />;

  return (
    <>
      <AutoRefresh active={view.counts.processing > 0} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter files" className="flex flex-wrap gap-2">
          {FILES_TABS.map((t) => (
            <Link
              key={t}
              href={filesHref({ tab: t, q })}
              aria-current={t === tab ? "page" : undefined}
              className={pillLink(t === tab)}
            >
              {TAB_LABELS[t]}
              <span className="ml-1.5 tabular-nums">{view.counts[t]}</span>
            </Link>
          ))}
        </nav>
        <SearchBox tab={tab} q={q} />
      </div>

      <Card className="relative overflow-x-auto">
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
            {view.rows.length === 0 ? (
              <tr className="border-t border-divider">
                <td colSpan={headers.length + 1} className="px-5 py-10 text-center text-sm text-slate">
                  {q ? `No files match “${q}”.` : EMPTY_TAB_MESSAGE[tab]}
                </td>
              </tr>
            ) : (
              view.rows.map((row) => <FileRow key={row.id} row={row} userId={user.id} />)
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function SearchBox({ tab, q }: { tab: FilesTab; q: string }) {
  return (
    <form action="/files" method="get" role="search" className="flex flex-wrap items-center gap-3">
      {tab !== "all" && <input type="hidden" name="status" value={tab} />}
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
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search files"
          aria-label="Search files"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-slate"
        />
      </label>
      <button type="submit" className="sr-only">
        Search files
      </button>
      {q && (
        <Link href={filesHref({ tab })} className="text-sm font-medium text-slate no-underline hover:text-ink">
          Clear search
        </Link>
      )}
    </form>
  );
}

function FileRow({ row, userId }: { row: FileListRow; userId: string }) {
  const deleted = row.status === "deleted";
  return (
    <tr className="border-t border-divider">
      <td className="px-5 py-4">
        <Mono className={cn(deleted ? "text-muted" : "font-medium")}>{row.name}</Mono>
      </td>
      <td className="px-5 py-4">
        <StatusBadge status={row.status}>{row.statusLabel}</StatusBadge>
      </td>
      <td className={cn("px-5 py-4", deleted ? "text-muted" : "text-slate")}>{row.rowsLabel}</td>
      <td
        className={cn(
          "px-5 py-4",
          row.changesTone === "error" && "text-error",
          row.changesTone === "muted" && "text-muted",
          row.changesTone === "normal" && "text-slate",
        )}
      >
        {row.changesLabel}
      </td>
      <td className={cn("px-5 py-4", deleted ? "text-muted" : "text-slate")}>{row.deletesLabel}</td>
      <td className="px-5 py-4 text-right">
        <div className="inline-flex flex-wrap justify-end gap-2">
          <RowActions row={row} userId={userId} />
        </div>
      </td>
    </tr>
  );
}

function RowActions({ row, userId }: { row: FileListRow; userId: string }) {
  const name = row.name;
  switch (row.status) {
    case "review":
      return (
        <>
          <Link href={`/review/${row.id}`} className={linkButton("primary", "sm")} aria-label={`Review ${name}`}>
            Review
          </Link>
          <DeleteFileButton fileId={row.id} name={name} />
        </>
      );
    case "processing":
      return (
        <>
          <Link href={`/processing/${row.id}`} className={linkButton("secondary", "sm")} aria-label={`View progress for ${name}`}>
            View progress
          </Link>
          <DeleteFileButton fileId={row.id} name={name} />
        </>
      );
    case "ready":
      return (
        <>
          <Link href={`/report/${row.id}`} className={linkButton("secondary", "sm")} aria-label={`Report for ${name}`}>
            Report
          </Link>
          <a
            href={downloadLink(userId, row.id, "cleaned")}
            download
            className={linkButton("primary", "sm")}
            aria-label={`Download cleaned ${name}`}
          >
            Download
          </a>
          <DeleteFileButton fileId={row.id} name={name} />
        </>
      );
    case "failed":
      return (
        <>
          {row.canRetry ? (
            <RetryFileButton fileId={row.id} name={name} />
          ) : (
            <Link href="/upload" className={linkButton("secondary", "sm")} aria-label={`Upload ${name} again`}>
              Upload again
            </Link>
          )}
          <DeleteFileButton fileId={row.id} name={name} />
        </>
      );
    case "deleted":
      return (
        <Link href={`/report/${row.id}`} className={linkButton("secondary", "sm")} aria-label={`Report for ${name}`}>
          Report
        </Link>
      );
  }
}

function EmptyFiles() {
  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <h2 className="text-xl font-semibold leading-[1.3]">No files yet</h2>
      <p className="max-w-[440px] text-base text-slate">
        Upload a CSV and DataCleanse will scan it, suggest changes, and give you a cleaned copy with a report.
      </p>
      <Link href="/upload" className={linkButton("primary")}>
        Upload a CSV
      </Link>
    </Card>
  );
}
