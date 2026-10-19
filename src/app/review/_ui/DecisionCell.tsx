"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Button, CheckIcon, cn } from "@/components/ui";
import { setDecisionAction } from "../actions";

type Decision = "approved" | "pending" | "skipped";

const skipButton =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:text-muted";

const textButton =
  "rounded text-[13px] font-medium text-slate underline-offset-2 hover:text-ink hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline";

/**
 * The Decision column for one editable change. Clicks update the cell at once (useOptimistic);
 * the server action then refreshes the page with the real counts. A failed action puts the
 * saved decision back and shows the reason.
 */
export function DecisionCell({
  fileId,
  changeId,
  label,
  decision,
  readOnly,
}: {
  fileId: string;
  changeId: number;
  /** Row and column, used in accessible names. */
  label: string;
  decision: Decision;
  readOnly: boolean;
}) {
  const [shown, setShown] = useOptimistic<Decision>(decision);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(next: "approved" | "skipped") {
    setError(null);
    startTransition(async () => {
      setShown(next);
      const result = await setDecisionAction({ fileId, changeId, decision: next });
      if (result.error) setError(result.error);
    });
  }

  const message = error ? (
    <span role="alert" className="text-[13px] text-error">
      {error}
    </span>
  ) : null;

  if (shown === "approved") {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <CheckIcon className="text-mint-deep" />
          Approved
          {!readOnly && (
            <button
              type="button"
              disabled={busy}
              aria-label={`Undo change ${label}`}
              onClick={() => choose("skipped")}
              className={cn(textButton, "ml-2")}
            >
              Undo
            </button>
          )}
        </span>
        {message}
      </div>
    );
  }

  if (shown === "skipped") {
    // Rule and AI changes alike can be restored, the same as Undo on an approved change.
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="inline-flex items-center gap-2 text-muted">
          Skipped
          {!readOnly && (
            <button
              type="button"
              disabled={busy}
              aria-label={`Restore change ${label}`}
              onClick={() => choose("approved")}
              className={cn(textButton, "ml-1")}
            >
              Restore
            </button>
          )}
        </span>
        {message}
      </div>
    );
  }

  // Pending: Keep and Skip.
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || readOnly}
          aria-label={`Keep change ${label}`}
          onClick={() => choose("approved")}
        >
          Keep
        </Button>
        <button
          type="button"
          disabled={busy || readOnly}
          aria-label={`Skip change ${label}`}
          onClick={() => choose("skipped")}
          className={skipButton}
        >
          Skip
        </button>
      </div>
      {message}
    </div>
  );
}
