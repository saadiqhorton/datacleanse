import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { LocalTime } from "@/app/admin/_ui/LocalTime";
import { formatCount } from "@/server/csv/errors";
import { downloadLink } from "@/server/files/downloads";
import { getFileForUser, listChanges, type ChangeFilter, type ChangeRecord } from "@/server/files/repo";
import {
  PAGE_SIZE,
  aiSampleRowCount,
  clampPage,
  confidencePercent,
  filterCount,
  mergeLabel,
  pageCount,
  pageSpan,
  parseFilter,
  parsePage,
  piiColumnNames,
  retentionLabel,
  reviewHref,
  reviewTotals,
  rowLabel,
  type ReviewTotals,
} from "@/server/files/review-view";
import { requireUser } from "@/server/auth/session";
import { Callout, Card, InfoPanel, Mono, PiiTag, SourceTag, StatCard, ValueChange, cn } from "@/components/ui";
import { DecisionCell } from "./DecisionCell";
import { ApplyButton, RejectAllAIButton } from "./HeaderActions";
import { RetryAiButton, RulesOnlyToggle } from "./AiControls";
import { LinkButton } from "./LinkButton";

type SearchParams = Promise<{ filter?: string | string[]; page?: string | string[] }>;

/** Placeholder in the same shape while the file and its changes load. */
export function ReviewSkeleton() {
  return (
    <main aria-hidden="true" className="mx-auto flex max-w-[1344px] animate-pulse flex-col gap-8 px-8 py-12">
      <div className="flex flex-col gap-3">
        <div className="h-6 w-56 rounded bg-divider" />
        <div className="h-10 w-96 rounded bg-divider" />
        <div className="h-5 w-[480px] rounded bg-divider" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="h-28 rounded-xl border border-hairline bg-white" />
        <div className="h-28 rounded-xl border border-hairline bg-white" />
        <div className="h-28 rounded-xl border border-hairline bg-white" />
        <div className="h-28 rounded-xl border border-hairline bg-white" />
      </div>
      <div className="h-96 rounded-xl border border-hairline bg-white" />
    </main>
  );
}

/** Pill for the filter row, a link so the filter lives in the URL. */
function FilterLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex min-h-9 items-center rounded-full px-4 py-2 text-sm no-underline",
        active ? "bg-ink font-medium text-white" : "border border-hairline bg-white text-slate",
      )}
    >
      {children}
    </Link>
  );
}

const pagerLink =
  "inline-flex min-h-9 items-center rounded-full border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink no-underline";
const pagerDisabled =
  "inline-flex min-h-9 items-center rounded-full border border-divider px-4 py-2 text-sm font-medium text-muted";

const chipWhite = "font-mono text-[13px] font-medium text-ink-2 rounded border border-hairline bg-white px-1.5 py-0.5";

function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/**
 * The Review screen body: the file's header and totals, the paged change table and the side
 * panels. Redirects files that are not waiting for review, and makes applied files read-only.
 */
export async function ReviewWorkspace({ params, searchParams }: { params: Promise<{ fileId: string }>; searchParams: SearchParams }) {
  const { user } = await requireUser();
  const { fileId } = await params;
  const query = await searchParams;

  const file = getFileForUser(user.id, fileId);
  if (!file) notFound();
  if (file.status === "deleted") redirect(`/report/${file.id}`);
  if (file.status === "uploaded" || file.status === "processing" || file.status === "failed") {
    redirect(`/processing/${file.id}`);
  }

  const readOnly = file.status !== "needs_review";
  const filter: ChangeFilter = parseFilter(query.filter);
  const totals: ReviewTotals = reviewTotals(file.id);

  let page = parsePage(query.page);
  let list = listChanges(file.id, { filter, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE });
  if (page > pageCount(list.total)) {
    page = clampPage(page, list.total);
    list = listChanges(file.id, { filter, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE });
  }
  const span = pageSpan(page, list.total);
  const last = pageCount(list.total);

  const retention = retentionLabel(file.createdAt, file.expiresAt);
  const sizeLine =
    file.rowCount !== null && file.columnCount !== null
      ? `${formatCount(file.rowCount)} rows · ${file.columnCount} columns`
      : null;
  const titleTotal = `Review ${plural(totals.total, "proposed change", "proposed changes")}`;
  const pii = piiColumnNames(file.profile);
  const sampleRows = aiSampleRowCount(file.profile);
  const rulesOnly = file.mode === "rules_only" || file.aiStatus === "skipped" || file.aiStatus === "none";
  const aiUnavailable = file.aiStatus === "unavailable" && file.mode === "rules_ai" && !readOnly;

  const reportPdf = file.appliedAt !== null ? downloadLink(user.id, file.id, "report_pdf") : null;
  const changesCsv = downloadLink(user.id, file.id, "changes_csv");

  const stats = [
    {
      label: "Dates normalized",
      value: formatCount(totals.buckets.dates),
      caption: "Rule-based · ISO 8601",
      tone: "default" as const,
    },
    {
      label: "Duplicates merged",
      value: formatCount(totals.buckets.duplicates),
      caption: "Exact + fuzzy match",
      tone: "default" as const,
    },
    {
      label: "Text cleaned",
      value: formatCount(totals.buckets.text),
      caption: "Whitespace, casing, phones",
      tone: "default" as const,
    },
    {
      label: "Needs your decision",
      value: formatCount(totals.pending),
      caption: "AI-suggested · low confidence",
      tone: "review" as const,
    },
  ];

  const pills: { filter: ChangeFilter; label: string }[] = [
    { filter: "all", label: "All" },
    { filter: "pending", label: "Needs review" },
    { filter: "rule", label: "Rule-based" },
    { filter: "ai", label: "AI" },
  ];

  return (
    <>
      <main className="mx-auto flex max-w-[1344px] flex-col gap-8 px-4 py-12 sm:px-8">
        {readOnly && file.appliedAt !== null && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-mint-soft px-5 py-4 text-sm">
            <span>
              Applied on <LocalTime at={file.appliedAt} format="datetime" />. This file is read-only.
            </span>
            <Link href={`/report/${file.id}`} className="font-medium">
              View report
            </Link>
          </div>
        )}

        <section className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Mono chip>{file.name}</Mono>
              {sizeLine && <span className="text-[13px] text-muted">{sizeLine}</span>}
            </div>
            <h1 className="text-4xl leading-[1.2] font-semibold tracking-[-0.5px]">{titleTotal}</h1>
            <p className="text-base leading-normal text-slate">
              {readOnly
                ? `Changes are final. Files are deleted automatically after ${retention}.`
                : `Nothing is applied until you approve it. Files are deleted automatically after ${retention}.`}
            </p>
          </div>
          {readOnly ? (
            <div className="flex flex-wrap gap-3">
              <LinkButton href={`/report/${file.id}`} size="lg">
                View report
              </LinkButton>
            </div>
          ) : (
            <div className="flex flex-wrap items-start gap-3">
              <RejectAllAIButton fileId={file.id} disabled={totals.aiOpen === 0} />
              <ApplyButton fileId={file.id} approved={formatCount(totals.approvedEdits)} pending={totals.pending} />
            </div>
          )}
        </section>

        <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <StatCard key={stat.label} label={stat.label} value={stat.value} caption={stat.caption} tone={stat.tone} />
          ))}
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-3">
          <section aria-label="Proposed changes" className="min-w-0 lg:col-span-2">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap gap-2 border-b border-divider px-5 py-4">
                {pills.map((p) => (
                  <FilterLink key={p.filter} href={reviewHref(file.id, { filter: p.filter })} active={filter === p.filter}>
                    {p.label} {formatCount(filterCount(totals, p.filter))}
                  </FilterLink>
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
                    {list.items.length === 0 && (
                      <tr className="border-t border-divider">
                        <td colSpan={4} className="px-5 py-10 text-center text-slate">
                          {totals.total === 0
                            ? "No changes were proposed for this file."
                            : "No changes match this filter."}
                        </td>
                      </tr>
                    )}
                    {list.items.map((item) => (
                      <ChangeRow key={item.id} item={item} fileId={file.id} readOnly={readOnly} />
                    ))}
                  </tbody>
                </table>
              </div>

              {list.total > 0 && (
                <nav
                  aria-label="Pages"
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-divider px-5 py-3 text-[13px] text-slate"
                >
                  <span>
                    Showing {formatCount(span.from)}–{formatCount(span.to)} of {formatCount(list.total)}
                  </span>
                  <div className="flex items-center gap-2">
                    {page > 1 ? (
                      <Link href={reviewHref(file.id, { filter, page: page - 1 })} rel="prev" className={pagerLink}>
                        Previous
                      </Link>
                    ) : (
                      <span aria-disabled="true" className={pagerDisabled}>
                        Previous
                      </span>
                    )}
                    <span>
                      Page {page} of {last}
                    </span>
                    {page < last ? (
                      <Link href={reviewHref(file.id, { filter, page: page + 1 })} rel="next" className={pagerLink}>
                        Next
                      </Link>
                    ) : (
                      <span aria-disabled="true" className={pagerDisabled}>
                        Next
                      </span>
                    )}
                  </div>
                </nav>
              )}
            </Card>
          </section>

          <aside aria-label="Privacy and report" className="flex flex-col gap-4">
            {aiUnavailable && (
              <Callout tone="review" title="AI was unavailable for this file">
                <p className="m-0 mt-1 text-sm text-slate">
                  The rule changes are ready to review. Ask the AI again once the connection is back.
                </p>
                <div className="mt-3">
                  <RetryAiButton fileId={file.id} />
                </div>
              </Callout>
            )}

            <InfoPanel className="flex flex-col gap-3 p-8">
              <h2 className="text-lg leading-[1.4] font-semibold">What the AI saw</h2>
              <p className="m-0 text-sm leading-normal text-slate">
                Column names, statistics and a {sampleRows}-row sample. Never the full file.
              </p>
              <RulesOnlyToggle fileId={file.id} rulesOnly={rulesOnly} readOnly={readOnly} />
              {pii.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate">
                  <PiiTag />
                  <span>Possible in</span>
                  {pii.map((name) => (
                    <span key={name} className={chipWhite}>
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </InfoPanel>

            <Card className="flex flex-col gap-3 p-6">
              <h2 className="text-lg leading-[1.4] font-semibold">Change report</h2>
              <p className="m-0 text-sm leading-normal text-slate">
                Every change, its reason and who approved it — exported with your cleaned file.
              </p>
              <div className="flex flex-wrap gap-2">
                {reportPdf ? (
                  <a
                    href={reportPdf}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-mint px-5 py-2.5 text-sm font-medium text-ink no-underline"
                  >
                    Report PDF
                  </a>
                ) : (
                  <span
                    aria-disabled="true"
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-hairline px-5 py-2.5 text-sm font-medium text-muted"
                  >
                    Report PDF
                  </span>
                )}
                <a
                  href={changesCsv}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-hairline bg-transparent px-5 py-2.5 text-sm font-medium text-ink no-underline"
                >
                  Changes CSV
                </a>
              </div>
              {!reportPdf && (
                <p className="m-0 text-[13px] text-muted">The PDF is available once the changes are applied.</p>
              )}
            </Card>
          </aside>
        </div>
      </main>
    </>
  );
}

function ChangeRow({ item, fileId, readOnly }: { item: ChangeRecord; fileId: string; readOnly: boolean }) {
  const isAi = item.source === "ai";
  const isMerge = item.kind === "merge";
  const isFlag = item.kind === "flag";
  const location = isMerge ? mergeLabel(item.rowIndex, item.mergeIntoRow) : rowLabel(item.rowIndex, item.column);
  const pct = confidencePercent(item.confidence);

  return (
    <tr className={cn("border-t border-divider", (isAi || item.decision === "pending") && "bg-review-row")}>
      <td className="px-5 py-4">
        <Mono className="text-ink-2">{location}</Mono>
      </td>
      <td className="px-5 py-4">
        {isMerge ? (
          <span className="text-sm">
            Merge <Mono>&quot;{item.before ?? "row"}&quot;</Mono> into <Mono>&quot;{item.after ?? "row"}&quot;</Mono>
          </span>
        ) : isFlag ? (
          <span className="text-sm">
            <span className="text-muted">—</span> <span className="text-slate">Missing value</span>
          </span>
        ) : (
          <ValueChange
            className="whitespace-nowrap"
            before={item.before ? item.before : <span className="text-muted">(empty)</span>}
            after={item.after ? item.after : <span className="text-muted">(empty)</span>}
          />
        )}
      </td>
      <td className="px-5 py-4 text-slate">
        {isAi ? <SourceTag kind="ai">{pct !== null ? `AI · ${pct}%` : "AI"}</SourceTag> : <SourceTag kind="rule" />}{" "}
        {item.reason}
      </td>
      <td className="px-5 py-4">
        {isFlag ? (
          <span className="text-muted">Info only</span>
        ) : (
          <DecisionCell
            fileId={fileId}
            changeId={item.id}
            label={location}
            source={item.source}
            decision={item.decision}
            readOnly={readOnly}
          />
        )}
      </td>
    </tr>
  );
}
