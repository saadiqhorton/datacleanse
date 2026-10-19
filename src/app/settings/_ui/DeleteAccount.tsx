"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { deleteAccountAction, type SettingsState } from "../actions";
import { FormMessage, inputClass } from "./Row";

/** Danger zone: opens a dialog that needs the account's email typed before anything is deleted. */
export function DeleteAccount({ email }: { email: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [state, action, pending] = useActionState<SettingsState, FormData>(deleteAccountAction, null);
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-error-border bg-error-bg px-4 py-4 sm:px-6 sm:py-5">
        <div>
          <div className="text-base font-medium text-error-ink">Delete account and all data</div>
          <div className="text-sm text-slate">Permanently removes files, reports, rules and your account.</div>
        </div>
        <Button variant="destructive" size="md" onClick={() => dialogRef.current?.showModal()}>
          Delete everything
        </Button>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="delete-title"
        onClose={() => setTyped("")}
        className="m-auto w-[min(480px,calc(100vw-32px))] rounded-xl border border-hairline bg-white p-0 text-ink shadow-lg backdrop:bg-ink/40"
      >
        <form action={action} className="flex flex-col gap-4 p-6">
          <h2 id="delete-title" className="text-xl font-semibold leading-[1.25]">
            Delete your account?
          </h2>
          <p className="text-sm text-slate">
            This deletes every file you uploaded, your cleaned files and reports, your rules and chats, and your
            sign-in. It cannot be undone. Export your data first if you need a copy.
          </p>
          <div className="flex flex-col gap-1.5 text-sm font-medium">
            <label htmlFor="confirm-email">
              Type <span className="font-mono text-[13px]">{email}</span> to confirm
            </label>
            <input
              id="confirm-email"
              name="confirmEmail"
              type="email"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className={inputClass}
            />
          </div>
          <FormMessage error={state?.error} />
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" size="md" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" size="md" disabled={!matches || pending}>
              {pending ? "Deleting…" : "Delete account and data"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
