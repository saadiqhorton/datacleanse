"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { deleteRuleSetAction, renameRuleSetAction } from "../actions";
import { Notice, type NoticeState } from "./Notice";

/** Title, description, rename and delete for the open rule set. */
export function RuleSetHeader({ setId, name }: { setId: string; name: string }) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [pending, startTransition] = useTransition();

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("setId", setId);
    startTransition(async () => {
      const result = await renameRuleSetAction(formData);
      if (result.ok) {
        setRenaming(false);
        setNotice(null);
      } else {
        setNotice({ tone: "error", text: result.error });
      }
    });
  }

  function remove() {
    const formData = new FormData();
    formData.set("setId", setId);
    startTransition(async () => {
      const result = await deleteRuleSetAction(formData);
      if (!result.ok) setNotice({ tone: "error", text: result.error });
    });
  }

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        {renaming ? (
          <form onSubmit={rename} className="flex flex-wrap items-center gap-2">
            <label htmlFor="rename-rule-set" className="sr-only">
              Rule set name
            </label>
            <input
              id="rename-rule-set"
              name="name"
              defaultValue={name}
              required
              maxLength={80}
              autoFocus
              className="h-11 min-w-0 rounded-lg border border-hairline px-3 text-[20px] font-semibold outline-none focus:border-2 focus:border-mint"
            />
            <Button type="submit" variant="primary" size="md" disabled={pending}>
              Save name
            </Button>
            <Button variant="ghost" size="md" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <h1 className="text-[28px] font-semibold leading-[1.25] break-words">{name}</h1>
        )}
        <p className="text-sm text-slate">Applied automatically to files whose headers match this set.</p>
        <p className="text-[13px] text-slate">Changes save as you go.</p>
        <Notice state={notice} />
      </div>
      {!renaming && (
        <div className="flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <span className="text-sm text-slate">Delete &ldquo;{name}&rdquo; and its rules?</span>
              <Button variant="destructive" size="sm" onClick={remove} disabled={pending}>
                Delete set
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="md" onClick={() => setRenaming(true)}>
                Rename
              </Button>
              <Button variant="ghost" size="md" onClick={() => setConfirming(true)}>
                Delete
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
