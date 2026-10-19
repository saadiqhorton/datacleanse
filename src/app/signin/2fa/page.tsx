import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { signOutAction } from "@/server/auth/actions";
import { getSession } from "@/server/auth/session";
import { safeNext } from "@/server/auth/redirects";
import { AuthShell } from "../../auth/_ui/AuthShell";
import { TwoFactorForm } from "./TwoFactorForm";

export const metadata: Metadata = {
  title: "Two-factor check · DataCleanse",
};

type Params = Record<string, string | string[] | undefined>;

export default function TwoFactorPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <AuthShell
      title="Two-factor check"
      subtitle="Enter the code from your authenticator app to finish signing in."
      footer={
        <form action={signOutAction}>
          <button type="submit" className="text-sm font-medium text-slate underline">
            Sign out instead
          </button>
        </form>
      }
    >
      {/* Reads cookies and searchParams, so it sits behind a boundary (cacheComponents). */}
      <Suspense fallback={null}>
        <TwoFactorGate searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function TwoFactorGate({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeNext(raw);

  const current = await getSession();
  if (!current) redirect(`/signin?next=${encodeURIComponent(next)}`);
  if (!current.user.totpEnabled || current.session.twoFactorPassed) redirect(next);

  return <TwoFactorForm next={next} />;
}
