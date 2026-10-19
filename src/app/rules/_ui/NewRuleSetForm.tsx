"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { createRuleSetAction } from "../actions";
import { Notice, type NoticeState } from "./Notice";

/** "+ New rule set" in the sidebar. Opens a name field; on success the action redirects to the new set. */
export function NewRuleSetForm() {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="mt-3 justify-start" onClick={() => setOpen(true)}>
        + New rule set
      </Button>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createRuleSetAction(formData);
      if (!result.ok) setNotice({ tone: "error", text: result.error });
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2 px-4">
      <label htmlFor="new-rule-set-name" className="text-[13px] font-medium">
        Name
      </label>
      <input
        id="new-rule-set-name"
        name="name"
        required
        maxLength={80}
        autoFocus
        placeholder="e.g. Payroll"
        className="h-10 min-w-0 rounded-lg border border-hairline px-3 text-sm outline-none focus:border-2 focus:border-mint"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Create
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <Notice state={notice} />
    </form>
  );
}
