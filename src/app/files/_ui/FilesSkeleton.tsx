/** Placeholder for the filter row and table while the list loads. */
export function FilesSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">Loading your files…</span>
      <div className="flex flex-wrap items-center justify-between gap-3" aria-hidden="true">
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 w-24 animate-pulse rounded-full bg-surface" />
          ))}
        </div>
        <div className="h-9 w-[260px] animate-pulse rounded-lg bg-surface" />
      </div>
      <div className="h-[320px] animate-pulse rounded-xl border border-hairline bg-surface" aria-hidden="true" />
    </div>
  );
}
