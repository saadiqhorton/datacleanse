"use client";

import { useActionState } from "react";
import { Button, CheckboxField } from "@/components/ui";
import { retryAiAction, skipAIForFileAction } from "../actions";

/**
 * "Rules only — no AI for this file". Checking it skips every AI suggestion and stops AI calls for
 * the file. It cannot be undone, so once checked it stays checked.
 */
export function RulesOnlyToggle({ fileId, rulesOnly, readOnly }: { fileId: string; rulesOnly: boolean; readOnly: boolean }) {
  const [state, action, pending] = useActionState(skipAIForFileAction, null);
  const checked = rulesOnly || pending;
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="fileId" value={fileId} />
      <CheckboxField
        className="min-h-11! font-medium"
        checked={checked}
        disabled={checked || readOnly}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        Rules only — no AI for this file
      </CheckboxField>
      {state?.error && (
        <span role="alert" className="text-[13px] text-error">
          {state.error}
        </span>
      )}
    </form>
  );
}

/** Asks the AI again for a file whose AI step was unavailable. Opens Processing while it runs. */
export function RetryAiButton({ fileId }: { fileId: string }) {
  const [state, action, pending] = useActionState(retryAiAction, null);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="fileId" value={fileId} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? "Starting…" : "Try AI again"}
      </Button>
      {state?.error && (
        <span role="alert" className="text-[13px] text-error">
          {state.error}
        </span>
      )}
    </form>
  );
}
