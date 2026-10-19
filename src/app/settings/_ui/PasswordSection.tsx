"use client";

import { useActionState, useState } from "react";
import { Button, TextField } from "@/components/ui";
import { changePasswordAction, type SettingsState } from "../actions";
import { FormMessage, Row } from "./Row";

export function PasswordSection({ changedLabel }: { changedLabel: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<SettingsState, FormData>(changePasswordAction, null);

  return (
    <>
      <Row title="Password" description={changedLabel ?? "Password is set."}>
        <Button
          variant="secondary"
          size="md"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="password-form"
        >
          Change
        </Button>
      </Row>
      {open && (
        <form
          id="password-form"
          action={action}
          className="flex flex-col gap-4 border-b border-divider px-4 py-5 sm:px-6"
        >
          <TextField
            label="Current password"
            name="current"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            required
            className="max-w-sm"
          />
          <TextField
            label="New password"
            name="next"
            type="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            required
            hint="At least 10 characters."
            className="max-w-sm"
          />
          <TextField
            label="Confirm new password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            required
            className="max-w-sm"
          />
          <FormMessage error={state?.error} ok={state?.ok} />
          <p className="text-[13px] text-slate">Other devices are signed out. This browser stays signed in.</p>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="primary" size="md" disabled={pending}>
              Change password
            </Button>
            <Button variant="secondary" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
