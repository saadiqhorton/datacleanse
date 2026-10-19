"use client";

import { useActionState } from "react";
import { Button, TextField } from "@/components/ui";
import { verifyTwoFactorAction, type FormState } from "@/server/auth/actions";
import { FormError } from "../../auth/_ui/AuthShell";

export function TwoFactorForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(verifyTwoFactorAction, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <TextField
        label="Authentication code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]{6,8}"
        maxLength={8}
        autoFocus
        required
        hint="Open your authenticator app and enter the 6-digit code."
      />

      <FormError>{state?.error}</FormError>

      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        Verify and continue
      </Button>
    </form>
  );
}
