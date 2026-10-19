/** Loading placeholders in the same layout as the pages they stand in for. */
export function HomeSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-[820px] flex-col gap-8 p-4 md:p-8" aria-busy="true">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-48 rounded bg-surface" />
        <div className="h-4 w-80 max-w-full rounded bg-surface" />
      </div>
      <div className="h-24 rounded-xl bg-surface" />
    </main>
  );
}

export function ChatSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[1344px] flex-col md:min-h-[calc(100dvh-65px)] md:flex-row" aria-busy="true">
      <aside className="flex flex-col gap-3 border-b border-divider px-4 py-8 md:w-[313px] md:shrink-0 md:border-r md:border-b-0">
        <div className="h-3 w-32 rounded bg-surface" />
        <div className="h-16 rounded-lg bg-surface" />
        <div className="h-16 rounded-lg bg-surface" />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-8">
        <div className="h-12 max-w-[592px] self-end w-2/3 rounded-xl bg-surface" />
        <div className="h-32 max-w-[820px] rounded-xl bg-surface" />
      </main>
    </div>
  );
}
