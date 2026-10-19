"use client";

import { useFormStatus } from "react-dom";
import { primaryButtonClass } from "../_ui/AuthShell";

/** The button that uses the sign-in link. Disabled while sending so a double click cannot submit twice. */
export function ConfirmSignInButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={primaryButtonClass}>
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}
