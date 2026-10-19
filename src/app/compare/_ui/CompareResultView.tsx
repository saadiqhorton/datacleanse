import Link from "next/link";
import { notFound } from "next/navigation";
import { MAX_DETAIL_ENTRIES } from "@/server/compare";
import { requireUser } from "@/server/auth/session";
import { getComparisonForUser } from "@/server/comparisons/repo";
import { pageOf, parsePage, parseTab, tabCount, TABS, formatCount, type CompareTab } from "@/server/comparisons/view";
import type { CompareResult } from "@/server/types";
import { Card, InfoPanel, Mono, ValueChange, cn } from "@/components/ui";
import { AskAboutButton } from "./AskButton";

const linkPill =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-hairline px-5 py-2.5 text-sm font-medium text-ink no-underline transition-colors hover:bg-surface";
const solidPill =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white no-underline transition-colors hover:bg-ink-2";
const chip = "rounded border border-hairline bg-white px-1.5 py-0.5";

type ChangeEntry = CompareResult["changed"][number];
type RowEntry = CompareResult["added"][number];
type Entry = ChangeEntry | RowEntry;

const TAB_LABEL: Record<CompareTab, string> = { changed: "Changed", added: "Added", removed: "Removed" };
const TAB_NOUN: Record<CompareTab, string> = { changed: "changes", added: "rows", removed: "rows" };

/** One saved comparison: summary, columns and the paged changes. Owner only. */
export async function CompareResultView({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[]; page?: string | string[] }>;
}) {
  const { user } = await requireUser();
  const { id } = await params;
  const query = await searchParams;

  const record = getComparisonForUser(user.id, id);
  if (!record) notFound();
  if (!record.result) return <UnreadableResult />;

  const result = record.result;
  const tab = parseTab(query.tab);
  const entries: Entry[] = tab === "changed" ? result.changed : tab === "added" ? result.added : result.removed;
  const pg = pageOf(entries, parsePage(query.page));
  const truncated = entries.length >= MAX_DETAIL_ENTRIES;

  return (
    <main className="mx-auto flex max-w-[1344px] flex-col gap-8 px-4 py-12 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="text-4xl font-semibold leading-[1.2] tracking-[-0.5px]">Compare files</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate">
            <Mono chip className="break-all">{result.leftName}</Mono>
            <span>vs</span>
            <Mono chip className="break-all">{result.rightName}</Mono>
            <span>· rows matched on</span>
            {result.keyColumns.map((k) => (
              <Mono key={k} chip>{k}</Mono>
            ))}
            {result.keyUnique ? (
              <span>(unique in both files)</span>
            ) : (
              <span className="font-medium text-review">
                (not unique in both files: repeated keys were matched in order, so check the changes)
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          <AskAboutButton compareId={record.id} />
          <a href={`/api/compares/${record.id}/export`} className={solidPill}>
            Export diff
          </a>
        </div>
      </div>

      <section aria-label="Summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard label="Added rows" value={`+ ${formatCount(result.counts.added)}`} />
        <SummaryCard label="Removed rows" value={`− ${formatCount(result.counts.removed)}`} />
        <SummaryCard label="Changed rows" value={formatCount(result.counts.changed)} />
        <SummaryCard label="Unchanged" value={formatCount(result.counts.unchanged)} />
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <ColumnsPanel result={result} />

        <section aria-label="Row changes" className="min-w-0 lg:col-span-2">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap gap-2 border-b border-divider px-5 py-4">
              {TABS.map((t) => (
                <Link
                  key={t}
                  href={`/compare/${record.id}?tab=${t}`}
                  aria-current={t === tab ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-9 items-center rounded-full px-4 py-2 text-sm no-underline",
                    t === tab ? "bg-ink font-medium text-white" : "border border-hairline bg-white text-slate",
                  )}
                >
                  {TAB_LABEL[t]} {formatCount(tabCount(result, t))}
                </Link>
              ))}
            </div>

            {pg.total === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate">{emptyMessage(tab)}</p>
            ) : tab === "changed" ? (
              <ChangedTable result={result} items={pg.items as ChangeEntry[]} startIndex={pg.from} />
            ) : (
              <RowsTable keyColumns={result.keyColumns} items={pg.items as RowEntry[]} tab={tab} />
            )}

            {pg.total > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider px-5 py-3 text-[13px] text-slate">
                <span>
                  Showing {formatCount(pg.from)}–{formatCount(pg.to)} of {formatCount(pg.total)} {TAB_NOUN[tab]}
                  {truncated && ". Only the first 5,000 are listed here and in the export."}
                </span>
                <div className="flex gap-2">
                  <PageLink
                    label="Previous"
                    disabled={pg.page <= 1}
                    href={`/compare/${record.id}?tab=${tab}&page=${pg.page - 1}`}
                  />
                  <PageLink
                    label="Next"
                    disabled={pg.page >= pg.pageCount}
                    href={`/compare/${record.id}?tab=${tab}&page=${pg.page + 1}`}
                  />
                </div>
              </div>
            )}
          </Card>
        </section>
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4 sm:p-6">
      <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-slate">{label}</div>
      <div className="text-[28px] font-semibold leading-tight">{value}</div>
    </Card>
  );
}

function ColumnsPanel({ result }: { result: CompareResult }) {
  const nothing =
    result.columns.added.length === 0 && result.columns.removed.length === 0 && result.columns.typeChanged.length === 0;
  return (
    <InfoPanel className="flex flex-col gap-3 p-6">
      <h2 className="text-lg font-semibold">Columns</h2>
      {nothing ? (
        <p className="text-sm text-slate">Both files have the same columns and types.</p>
      ) : (
        <div className="flex flex-col gap-2.5 text-sm">
          {result.columns.added.map((c) => (
            <div key={`add-${c}`} className="flex flex-wrap items-center gap-2">
              <span className="w-16 font-semibold">Added</span>
              <Mono className={chip}>{c}</Mono>
            </div>
          ))}
          {result.columns.removed.map((c) => (
            <div key={`rm-${c}`} className="flex flex-wrap items-center gap-2">
              <span className="w-16 font-semibold">Removed</span>
              <Mono className={cn(chip, "text-error line-through")}>{c}</Mono>
            </div>
          ))}
          {result.columns.typeChanged.map((t) => (
            <div key={`type-${t.column}`} className="flex flex-wrap items-center gap-2">
              <span className="w-16 font-semibold">Type</span>
              <Mono className={chip}>{t.column}</Mono>
              <span className="text-slate">
                {t.from} → {t.to}
                {t.note ? ` (${t.note})` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </InfoPanel>
  );
}

function ChangedTable({
  result,
  items,
  startIndex,
}: {
  result: CompareResult;
  items: ChangeEntry[];
  startIndex: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full whitespace-nowrap text-sm leading-normal">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-[0.5px] text-slate">
            <th className="px-5 py-3 text-left font-semibold">{result.keyColumns.join(" + ") || "Row"}</th>
            <th className="px-5 py-3 text-left font-semibold">Column</th>
            <th className="px-5 py-3 text-left font-semibold">
              {result.leftName} → {result.rightName}
            </th>
          </tr>
        </thead>
        <tbody className="font-mono text-[13px]">
          {items.map((row, i) => (
            <tr key={`${startIndex + i}`} className="border-t border-divider">
              <td className="px-5 py-3.5">{row.key}</td>
              <td className="px-5 py-3.5 text-slate">{row.column}</td>
              <td className="px-5 py-3.5">
                <ValueChange before={shown(row.before)} after={shown(row.after)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowsTable({
  keyColumns,
  items,
  tab,
}: {
  keyColumns: string[];
  items: RowEntry[];
  tab: "added" | "removed";
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm leading-normal">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-[0.5px] text-slate">
            <th className="px-5 py-3 text-left font-semibold whitespace-nowrap">{keyColumns.join(" + ") || "Row"}</th>
            <th className="px-5 py-3 text-left font-semibold">{tab === "added" ? "Added row" : "Removed row"}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((entry, i) => (
            <tr key={`${tab}-${i}`} className="border-t border-divider align-top">
              <td className="px-5 py-3.5 font-mono text-[13px] whitespace-nowrap">{entry.key}</td>
              <td className="px-5 py-3.5">
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[13px]">
                  {Object.entries(entry.row).map(([column, value]) => (
                    <span key={column}>
                      <span className="text-slate">{column}</span> {value === "" ? <span className="text-muted">(empty)</span> : value}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PageLink({ label, disabled, href }: { label: string; disabled: boolean; href: string }) {
  if (disabled) {
    return (
      <span aria-disabled="true" className="inline-flex min-h-9 items-center rounded-full border border-hairline px-4 text-muted">
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className="inline-flex min-h-9 items-center rounded-full border border-hairline px-4 text-ink no-underline hover:bg-surface">
      {label}
    </Link>
  );
}

function shown(value: string) {
  return value === "" ? <span className="text-muted">(empty)</span> : value;
}

function emptyMessage(tab: CompareTab): string {
  if (tab === "added") return "No rows were added.";
  if (tab === "removed") return "No rows were removed.";
  return "No values changed between matched rows.";
}

function UnreadableResult() {
  return (
    <main className="mx-auto flex max-w-[1344px] flex-col gap-6 px-4 py-12 sm:px-8">
      <h1 className="text-4xl font-semibold leading-[1.2] tracking-[-0.5px]">Compare files</h1>
      <Card className="flex flex-col items-start gap-4 p-6">
        <p className="text-sm text-slate">The results of this comparison can no longer be read. Run it again to see the changes.</p>
        <Link href="/compare" className={linkPill}>
          Back to compare
        </Link>
      </Card>
    </main>
  );
}

export function CompareResultSkeleton() {
  return (
    <div aria-hidden="true" className="mx-auto flex max-w-[1344px] animate-pulse flex-col gap-8 px-4 py-12 sm:px-8">
      <div className="flex flex-col gap-3">
        <div className="h-9 w-64 rounded bg-divider" />
        <div className="h-4 w-[28rem] max-w-full rounded bg-divider" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-xl border border-hairline bg-white" />
        ))}
      </div>
      <div className="h-72 rounded-xl border border-hairline bg-white" />
    </div>
  );
}
