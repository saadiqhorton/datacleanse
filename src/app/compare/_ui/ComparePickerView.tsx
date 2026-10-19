import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listComparableFiles } from "@/server/comparisons/inputs";
import { listComparisonsForUser, type ComparisonSummary } from "@/server/comparisons/repo";
import { formatCount } from "@/server/comparisons/view";
import { Card, Mono } from "@/components/ui";
import { ComparePicker, type PickerFile } from "./ComparePicker";
import { LocalTime } from "./LocalTime";

const linkPill =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-hairline px-5 py-2.5 text-sm font-medium text-ink no-underline transition-colors hover:bg-surface";

/** The picker and recent comparisons. Reads the session and the file list, so it streams in. */
export async function ComparePickerView({
  searchParams,
}: {
  searchParams: Promise<{ left?: string | string[]; right?: string | string[] }>;
}) {
  const { user } = await requireUser();
  const query = await searchParams;

  const files: PickerFile[] = listComparableFiles(user.id).map((f) => ({
    id: f.id,
    label: `${f.name} · ${f.rows === null ? "— rows" : `${formatCount(f.rows)} rows`} · ${f.hasCleaned ? "cleaned" : "original"}`,
  }));
  const recent = listComparisonsForUser(user.id, 10);

  const preselect = (raw: string | string[] | undefined) => {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return files.some((f) => f.id === value) ? (value as string) : "";
  };

  return (
    <main className="mx-auto flex max-w-[1344px] flex-col gap-8 px-4 py-12 sm:px-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold leading-[1.2] tracking-[-0.5px]">Compare files</h1>
        <p className="text-base text-slate">
          Pick two files. Rows are matched on a key column, then changed, added and removed rows are listed.
        </p>
      </div>

      {files.length < 2 ? (
        <Card className="flex flex-col items-start gap-4 p-6">
          <p className="text-sm text-slate">
            {files.length === 0
              ? "You need two files to compare. Upload them first."
              : "You need one more file to compare. Upload it first."}
          </p>
          <Link href="/upload" className={linkPill}>
            New upload
          </Link>
        </Card>
      ) : (
        <ComparePicker files={files} initialLeft={preselect(query.left)} initialRight={preselect(query.right)} />
      )}

      <section aria-label="Recent comparisons" className="flex flex-col gap-3">
        <h2 className="text-[22px] leading-[1.2] font-semibold">Recent comparisons</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-slate">No comparisons yet.</p>
        ) : (
          <Card className="overflow-hidden">
            <ul className="m-0 list-none p-0">
              {recent.map((c) => (
                <li key={c.id} className="border-t border-divider first:border-t-0">
                  <RecentRow item={c} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </main>
  );
}

function RecentRow({ item }: { item: ComparisonSummary }) {
  return (
    <Link
      href={`/compare/${item.id}`}
      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-ink no-underline transition-colors hover:bg-surface"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Mono chip className="break-all">{item.leftName}</Mono>
          <span className="text-slate">vs</span>
          <Mono chip className="break-all">{item.rightName}</Mono>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-slate">
          <span>rows matched on</span>
          {item.keyColumns.map((k) => (
            <Mono key={k} chip>{k}</Mono>
          ))}
          {!item.keyUnique && <span className="text-review">· key not unique</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="font-mono text-[13px]">
          <span className="text-ink">+{formatCount(item.added)}</span>{" "}
          <span className="text-error">−{formatCount(item.removed)}</span>{" "}
          <span className="text-slate">{formatCount(item.changed)} changed</span>
        </span>
        <LocalTime at={item.createdAt} className="text-[13px] text-slate" />
      </div>
    </Link>
  );
}

export function ComparePickerSkeleton() {
  return (
    <div aria-hidden="true" className="mx-auto flex max-w-[1344px] animate-pulse flex-col gap-8 px-4 py-12 sm:px-8">
      <div className="flex flex-col gap-3">
        <div className="h-9 w-64 rounded bg-divider" />
        <div className="h-4 w-96 max-w-full rounded bg-divider" />
      </div>
      <div className="h-56 rounded-xl border border-hairline bg-white" />
      <div className="h-40 rounded-xl border border-hairline bg-white" />
    </div>
  );
}
