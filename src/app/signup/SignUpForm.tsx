"use client";

import { useActionState } from "react";
import { TextField } from "@/components/ui";
import { signUpAction, type FormState } from "@/server/auth/actions";
import { FormError, primaryButtonClass } from "../auth/_ui/AuthShell";

export function SignUpForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(signUpAction, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <TextField
        label="Your name"
        name="name"
        autoComplete="name"
        autoFocus
        required
        defaultValue={state?.name ?? ""}
      />

      <TextField
        label="Work email"
        type="email"
        name="email"
        autoComplete="email"
        required
        defaultValue={state?.email ?? ""}
      />

      <TextField
        label="Password"
        type="password"
        name="password"
        autoComplete="new-password"
        required
        hint="At least 10 characters."
      />

      <FormError>{state?.error}</FormError>

      <button type="submit" disabled={pending} className={primaryButtonClass}>
        Create account
      </button>
    </form>
  );
}
