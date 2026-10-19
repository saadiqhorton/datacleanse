"use client";

import { useActionState, useState } from "react";
import { Button, TextField } from "@/components/ui";
import { changePasswordAction, type SettingsState } from "../actions";
import { FormMessage, Row } from "./Row";

export function PasswordSection({ hasPassword, changedLabel }: { hasPassword: boolean; changedLabel: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<SettingsState, FormData>(changePasswordAction, null);

  const description = hasPassword
    ? changedLabel ?? "Password is set."
    : "No password yet. You sign in with email links. Add one to sign in with a password too.";

  return (
    <>
      <Row title="Password" description={description}>
        <Button
          variant="secondary"
          size="md"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="password-form"
        >
          {hasPassword ? "Change" : "Set password"}
        </Button>
      </Row>
      {open && (
        <form
          id="password-form"
          action={action}
          className="flex flex-col gap-4 border-b border-divider px-4 py-5 sm:px-6"
        >
          {hasPassword && (
            <TextField
              label="Current password"
              name="current"
              type="password"
              autoComplete="current-password"
              required
              className="max-w-sm"
            />
          )}
          <TextField
            label="New password"
            name="next"
            type="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={1024}
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
            maxLength={1024}
            required
            className="max-w-sm"
          />
          <FormMessage error={state?.error} ok={state?.ok} />
          <p className="text-[13px] text-slate">Other devices are signed out. This browser stays signed in.</p>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="primary" size="md" disabled={pending}>
              {hasPassword ? "Change password" : "Set password"}
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
