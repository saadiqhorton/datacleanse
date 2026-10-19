/** Same grid as the form, so the page does not jump when the data arrives. */
export const UPLOAD_MAIN_CLASS =
  "mx-auto grid max-w-[1344px] grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] items-start gap-8 px-4 py-12 sm:px-8";

export function UploadSkeleton() {
  return (
    <main aria-hidden="true" className={`${UPLOAD_MAIN_CLASS} animate-pulse`}>
      <section className="flex min-w-0 flex-col gap-6">
        <div className="h-9 w-48 rounded bg-divider" />
        <div className="h-[220px] rounded-xl border-2 border-dashed [border-color:var(--color-dashed)] bg-surface" />
        <div className="h-64 rounded-xl border border-hairline bg-white" />
      </section>
      <section className="flex min-w-0 flex-col gap-6">
        <div className="h-64 rounded-xl border border-hairline bg-white" />
        <div className="h-72 rounded-xl border border-hairline bg-white" />
        <div className="h-11 rounded-full bg-divider" />
      </section>
    </main>
  );
}
