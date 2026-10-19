import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Mono, TextField } from "@/components/ui";
import { AUDIT_PAGE_SIZE, listAuditEntries } from "@/server/admin/audit-log";
import { parsePage } from "@/server/admin/paging";
import { requireAdmin } from "@/server/auth/session";
import { AdminFrame, AdminLoading, TableLoading } from "../_ui/AdminFrame";
import { LocalTime } from "../_ui/LocalTime";
import { Pager } from "../_ui/Pager";

export const metadata: Metadata = {
  title: "Audit log · Admin · DataCleanse",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Common action prefixes, offered as suggestions in the filter. */
const PREFIX_SUGGESTIONS = ["auth.", "admin.", "file.", "job.", "ask.", "user."];

export default function AdminAuditPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AdminLoading />}>
      <AdminFrame active="Audit log">
        <h1 className="text-4xl leading-[1.2] font-semibold tracking-[-0.5px]">Audit log</h1>
        <Suspense fallback={<TableLoading label="Loading audit log" />}>
          <AuditList searchParams={searchParams} />
        </Suspense>
      </AdminFrame>
    </Suspense>
  );
}

async function AuditList({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const params = await searchParams;
  const query = (first(params.q) ?? "").trim().slice(0, 200);
  const prefix = (first(params.prefix) ?? "").trim().slice(0, 100);
  const entries = listAuditEntries({ query, prefix, page: parsePage(first(params.page)) });
  const filtered = query !== "" || prefix !== "";

  return (
    <>
      <form role="search" method="get" action="/admin/audit" className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <TextField
          label="Search"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Action, detail or email"
          autoComplete="off"
          className="sm:flex-1"
        />
        <TextField
          label="Action starts with"
          name="prefix"
          defaultValue={prefix}
          placeholder="auth."
          list="audit-prefixes"
          autoComplete="off"
          spellCheck={false}
          className="sm:w-56"
        />
        <datalist id="audit-prefixes">
          {PREFIX_SUGGESTIONS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white"
          >
            Search
          </button>
          {filtered && (
            <Link href="/admin/audit" className="text-sm font-medium text-ink underline">
              Clear
            </Link>
          )}
        </div>
      </form>

      <Card className="min-w-0 overflow-x-auto">
        <table aria-label="Audit log entries" className="w-full text-sm leading-normal">
          <thead>
            <tr>
              {["Time", "Action", "Who", "Detail"].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="px-5 py-3 text-left text-[11px] font-semibold tracking-[0.5px] text-slate uppercase"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.items.length === 0 && (
              <tr className="border-t border-divider">
                <td colSpan={4} className="px-5 py-6 text-center text-slate">
                  {filtered ? "No entries match these filters." : "Nothing has been logged yet."}
                </td>
              </tr>
            )}
            {entries.items.map((entry) => (
              <tr key={entry.id} className="border-t border-divider align-top">
                <td className="px-5 py-3.5 whitespace-nowrap text-slate">
                  <LocalTime at={entry.at} format="datetime" />
                </td>
                <td className="px-5 py-3.5">
                  <Mono>{entry.action}</Mono>
                </td>
                <td className="px-5 py-3.5 break-all text-slate">{entry.actorEmail ?? "System"}</td>
                <td className="px-5 py-3.5 break-words">{entry.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="-mt-4 text-[13px] text-muted">
        {entries.total.toLocaleString("en-US")} {entries.total === 1 ? "entry" : "entries"}, {AUDIT_PAGE_SIZE} per page
      </p>
      <Pager
        basePath="/admin/audit"
        query={{ q: query || undefined, prefix: prefix || undefined }}
        page={entries.page}
        pageCount={entries.pageCount}
      />
    </>
  );
}
