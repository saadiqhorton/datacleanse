"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { retryFileAction, type FileActionState } from "../actions";

/** "Try again" for a failed file. On success the action redirects to the file's progress page. */
export function RetryFileButton({ fileId, name }: { fileId: string; name: string }) {
  const [state, action, pending] = useActionState<FileActionState, FormData>(retryFileAction, null);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="fileId" value={fileId} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending} aria-label={`Try again ${name}`}>
        Try again
      </Button>
      {state && "error" in state && (
        <span role="alert" className="max-w-[260px] text-right text-[13px] text-error">
          {state.error}
        </span>
      )}
    </form>
  );
}
