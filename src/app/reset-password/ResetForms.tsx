"use client";

import Link from "next/link";
import { useActionState } from "react";
import { TextField } from "@/components/ui";
import {
  requestPasswordResetAction,
  resetPasswordAction,
  type FormState,
} from "@/server/auth/actions";
import { FormError, FormNotice, primaryButtonClass } from "../auth/_ui/AuthShell";

export function RequestResetForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(requestPasswordResetAction, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <TextField
        label="Work email"
        type="email"
        name="email"
        autoComplete="email"
        autoFocus
        required
        defaultValue={state?.email ?? ""}
      />

      <FormError>{state?.error}</FormError>

      <button type="submit" disabled={pending} className={primaryButtonClass}>
        Email me a reset link
      </button>

      <FormNotice>{state?.message}</FormNotice>
    </form>
  );
}

export function NewPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resetPasswordAction, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      <TextField
        label="New password"
        type="password"
        name="password"
        autoComplete="new-password"
        autoFocus
        required
        hint="At least 10 characters. This signs out your other sessions."
      />

      <FormError>{state?.error}</FormError>

      {state?.linkInvalid && (
        <Link href="/reset-password" className="text-sm font-medium underline">
          Request a new reset link
        </Link>
      )}

      <button type="submit" disabled={pending} className={primaryButtonClass}>
        Set new password
      </button>
    </form>
  );
}
