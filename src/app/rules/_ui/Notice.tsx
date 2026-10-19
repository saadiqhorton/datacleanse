/** Message under a control: an error (alert), a confirmation (status), or a neutral note. */
export type NoticeState = { tone: "error" | "ok" | "info"; text: string } | null;

export function Notice({ state }: { state: NoticeState }) {
  if (!state) return null;
  if (state.tone === "error") {
    return (
      <p role="alert" className="text-[13px] text-error">
        {state.text}
      </p>
    );
  }
  return (
    <p role="status" className={state.tone === "ok" ? "text-[13px] text-mint-ink" : "text-[13px] text-slate"}>
      {state.text}
    </p>
  );
}
