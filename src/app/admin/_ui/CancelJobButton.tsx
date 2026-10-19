"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { cancelJobAction, type ActionState } from "../actions";

export function CancelJobButton({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelJobAction, null);

  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="jobId" value={jobId} />
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={(e) => {
          if (!window.confirm("Cancel this job?")) {
            e.preventDefault();
          }
        }}
      >
        Cancel job
      </Button>
      {state?.error && (
        <span role="alert" className="text-[13px] text-error">
          {state.error}
        </span>
      )}
    </form>
  );
}
