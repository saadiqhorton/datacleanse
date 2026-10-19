"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, TextField } from "@/components/ui";
import { signInAction, type FormState } from "@/server/auth/actions";
import { FormError, FormNotice, primaryButtonClass } from "../auth/_ui/AuthShell";

export function SignInForm({
  next = "/files",
  notice,
}: {
  next?: string;
  /** Message from the URL, e.g. an expired sign-in link. */
  notice?: { tone: "info" | "error"; text: string } | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(signInAction, null);

  return (
    <>
      {notice && <FormNotice tone={notice.tone}>{notice.text}</FormNotice>}

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />

        <TextField
          label="Work email"
          type="email"
          name="email"
          autoComplete="email"
          autoFocus
          required
          defaultValue={state?.email ?? ""}
        />

        <TextField
          label={
            <span className="flex items-center justify-between gap-4">
              Password
              <Link href="/reset-password" className="text-[13px] font-medium whitespace-nowrap underline">
                Forgot password?
              </Link>
            </span>
          }
          type="password"
          name="password"
          autoComplete="current-password"
        />

        <FormError>{state?.error}</FormError>

        <button type="submit" name="intent" value="password" disabled={pending} className={primaryButtonClass}>
          Sign in
        </button>

        <div className="flex items-center gap-3 text-[13px] text-muted">
          <span className="h-px flex-1 bg-divider" />
          or
          <span className="h-px flex-1 bg-divider" />
        </div>

        <Button type="submit" name="intent" value="magic" variant="secondary" size="lg" disabled={pending}>
          Email me a sign-in link
        </Button>

        <FormNotice>{state?.message}</FormNotice>
      </form>
    </>
  );
}
