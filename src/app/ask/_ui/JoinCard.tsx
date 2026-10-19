"use client";

import { useActionState, useState } from "react";
import { Button, Mono } from "@/components/ui";
import type { JoinPair } from "@/server/ask/types";
import { changeJoinsAction, confirmJoinsAction } from "../actions";
import { formatRate } from "./format";

/** "Confirm how these files connect": the proposed joins, "Use these joins" and "Change". */
export function JoinCard({
  messageId,
  joins,
  candidates,
}: {
  messageId: string;
  joins: JoinPair[];
  candidates: JoinPair[];
}) {
  const [state, action, pending] = useActionState(confirmJoinsAction, null);
  const error = state && !state.ok ? state.error : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-review-border bg-review-bg px-5 py-4">
      <div className="text-sm font-semibold text-review">Confirm how these files connect</div>
      <div className="text-sm leading-normal text-ink-2">
        {joins.length === 0 ? (
          <>I couldn&apos;t match columns across these files. Pick the columns to join on.</>
        ) : (
          <>
            I&apos;ll join{" "}
            {joins.map((join, i) => (
              <span key={`${join.left.alias}.${join.left.column}-${join.right.alias}.${join.right.column}`}>
                {i > 0 && (i === joins.length - 1 ? " and " : ", ")}
                <Mono>{`${join.left.alias}.${join.left.column}`}</Mono> → <Mono>{`${join.right.alias}.${join.right.column}`}</Mono>
                {join.matchRate !== null && <> ({formatRate(join.matchRate)} of {join.left.alias} match)</>}
              </span>
            ))}
            .
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <form action={action}>
          <input type="hidden" name="messageId" value={messageId} />
          <Button type="submit" variant="primary" size="sm" disabled={pending || joins.length === 0}>
            {pending ? "Running…" : "Use these joins"}
          </Button>
        </form>
        <JoinPicker
          key={joins.map((j) => `${j.left.alias}.${j.left.column}=${j.right.alias}.${j.right.column}`).join("|")}
          messageId={messageId}
          candidates={candidates}
        />
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Change": a list of the column pairs the files share. Keyed by the current joins, so it closes after a change. */
function JoinPicker({ messageId, candidates }: { messageId: string; candidates: JoinPair[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(changeJoinsAction, null);
  if (candidates.length === 0) return null;

  return (
    <>
      <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Change
      </Button>
      {open && (
        <form action={action} className="flex basis-full flex-col gap-3 rounded-lg border border-hairline bg-white p-4">
          <input type="hidden" name="messageId" value={messageId} />
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Join on</legend>
            {candidates.map((c, i) => (
              <label key={i} className="flex min-h-9 items-center gap-2.5 text-sm">
                <input type="radio" name="candidate" value={i} defaultChecked={i === 0} />
                <Mono>{`${c.left.alias}.${c.left.column}`}</Mono> → <Mono>{`${c.right.alias}.${c.right.column}`}</Mono>
                {c.matchRate !== null && <span className="text-slate">({formatRate(c.matchRate)})</span>}
              </label>
            ))}
          </fieldset>
          {state && !state.ok && (
            <p role="alert" className="text-[13px] text-error">
              {state.error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Checking…" : "Use this pair"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
