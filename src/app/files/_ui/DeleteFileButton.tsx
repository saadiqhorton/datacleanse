"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui";
import { deleteFileAction, type FileActionState } from "../actions";

/**
 * Delete for one row. The first click asks for confirmation inline; the confirm button runs the
 * action. On success the row becomes Deleted on refresh, which unmounts this button.
 */
export function DeleteFileButton({ fileId, name }: { fileId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FileActionState, FormData>(deleteFileAction, null);

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Delete ${name}`}>
        Delete
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="fileId" value={fileId} />
      <span className="max-w-[260px] text-right text-[13px] text-slate">
        Delete {name} now? Its copies are removed. The report and change log stay.
      </span>
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={pending}>
          Delete now
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
      {state && "error" in state && (
        <span role="alert" className="max-w-[260px] text-right text-[13px] text-error">
          {state.error}
        </span>
      )}
    </form>
  );
}
