"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { applyFileAction, decideAllAIAction } from "../actions";

/** Skips every AI suggestion in the file, after a confirmation. */
export function RejectAllAIButton({ fileId, disabled }: { fileId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(decideAllAIAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="fileId" value={fileId} />
      <Button
        type="submit"
        variant="secondary"
        size="lg"
        disabled={disabled || pending}
        onClick={(e) => {
          if (!window.confirm("Skip every AI suggestion in this file? Rule changes are not affected.")) {
            e.preventDefault();
          }
        }}
      >
        Reject all AI suggestions
      </Button>
      {state?.error && (
        <span role="alert" className="text-[13px] text-error">
          {state.error}
        </span>
      )}
    </form>
  );
}

/** Applies the approved changes and opens the report. Pending suggestions are skipped, after a confirmation. */
export function ApplyButton({ fileId, approved, pending: pendingCount }: { fileId: string; approved: string; pending: number }) {
  const [state, action, applying] = useActionState(applyFileAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="fileId" value={fileId} />
      <Button
        type="submit"
        size="lg"
        disabled={applying}
        onClick={(e) => {
          if (pendingCount > 0) {
            const word = pendingCount === 1 ? "suggestion" : "suggestions";
            if (!window.confirm(`${pendingCount} pending ${word} will be skipped. Apply the approved changes now?`)) {
              e.preventDefault();
            }
          }
        }}
      >
        {applying ? "Applying…" : `Apply ${approved} approved and download`}
      </Button>
      {state?.error && (
        <span role="alert" className="text-[13px] text-error">
          {state.error}
        </span>
      )}
    </form>
  );
}
