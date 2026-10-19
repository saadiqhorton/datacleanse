import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MESSAGES } from "@/server/auth/actions-logic";
import { AuthShell } from "../auth/_ui/AuthShell";
import { NewPasswordForm, RequestResetForm } from "./ResetForms";

export const metadata: Metadata = {
  title: "Reset password · DataCleanse",
};

type Params = Record<string, string | string[] | undefined>;

export default function ResetPasswordPage({ searchParams }: { searchParams: Promise<Params> }) {
  // Reads searchParams, so the step sits behind a boundary (cacheComponents).
  return (
    <Suspense fallback={null}>
      <ResetStep searchParams={searchParams} />
    </Suspense>
  );
}

async function ResetStep({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const raw = Array.isArray(params.token) ? params.token[0] : params.token;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const footer = (
    <p className="text-sm text-slate">
      Remembered it?{" "}
      <Link href="/signin" className="font-medium underline">
        Back to sign in
      </Link>
    </p>
  );

  // Better Auth sends the emailed link here with ?token=..., or ?error=INVALID_TOKEN when it is dead.
  if (raw && /^[A-Za-z0-9_-]{20,200}$/.test(raw)) {
    return (
      <AuthShell
        title="Choose a new password"
        subtitle="Set a new password for your account."
        footer={footer}
      >
        <NewPasswordForm token={raw} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={footer}
    >
      <RequestResetForm notice={error === "INVALID_TOKEN" ? MESSAGES.resetLinkInvalid : null} />
    </AuthShell>
  );
}
