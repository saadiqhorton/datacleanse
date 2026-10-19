"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { askAboutComparisonAction, type CompareState } from "../actions";

/** Starts an Ask chat over the comparison's two files. Shows the error when that is not possible. */
export function AskAboutButton({ compareId }: { compareId: string }) {
  const [state, action, pending] = useActionState<CompareState, FormData>(askAboutComparisonAction, null);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="compareId" value={compareId} />
      <Button type="submit" variant="secondary" size="md" disabled={pending}>
        Ask about these
      </Button>
      {state?.error && (
        <span role="alert" className="max-w-xs text-right text-[13px] text-error">
          {state.error}
        </span>
      )}
    </form>
  );
}
