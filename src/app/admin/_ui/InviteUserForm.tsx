"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, TextField } from "@/components/ui";
import { inviteUserAction, type ActionState } from "../actions";

/** Creates an account by email and sends its single-use sign-in link. */
export function InviteUserForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(inviteUserAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the fields after a successful invite so the next one can be typed straight away.
  useEffect(() => {
    if (state?.message) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <TextField label="Email" type="email" name="email" required autoComplete="off" />
        <TextField label="Name (optional)" name="name" autoComplete="off" />
        <Button type="submit" size="lg" disabled={pending}>
          Send invite
        </Button>
      </div>
      <p className="text-[13px] text-slate">
        They get a sign-in link by email. No password is set, so they can sign in with the link or set one later.
      </p>
      {state?.error && (
        <p role="alert" className="text-sm text-error">
          {state.error}
        </p>
      )}
      {state?.message && !state.error && (
        <p role="status" className="text-sm text-mint-ink">
          {state.message}
        </p>
      )}
    </form>
  );
}
