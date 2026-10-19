import Link from "next/link";

const linkClass =
  "inline-flex min-h-9 items-center rounded-full border border-hairline px-4 text-sm font-medium text-ink no-underline";

/** Previous / next links that keep the other query parameters (filters, search). */
export function Pager({
  basePath,
  query,
  page,
  pageCount,
}: {
  basePath: string;
  query: Record<string, string | undefined>;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;

  const href = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
    if (target > 1) params.set("page", String(target));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className={linkClass}>
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-slate">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} className={linkClass}>
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
