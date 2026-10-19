import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { safeNext } from "@/server/auth/redirects";
import { AuthShell } from "../auth/_ui/AuthShell";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = {
  title: "Sign in · DataCleanse",
};

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const NOTICES = new Map<string, { tone: "info" | "error"; text: string }>([
  [
    "link_expired",
    { tone: "error", text: "That sign-in link has expired or was already used. Request a new one below." },
  ],
  ["disabled", { tone: "error", text: "This account has been disabled. Contact your administrator." }],
]);

export default function SignInPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <AuthShell
      title="Sign in"
      subtitle="Pick up where you left off with your files."
      footer={
        <p className="text-sm text-slate">
          New to DataCleanse?{" "}
          <Link href="/signup" className="font-medium underline">
            Create an account
          </Link>
        </p>
      }
    >
      {/* Reads searchParams, so it sits behind a boundary (cacheComponents). */}
      {/* The fallback is inert: an interactive copy would lose whatever was typed when the real form streams in. */}
      <Suspense fallback={<div aria-hidden="true" className="pointer-events-none select-none opacity-60" inert><SignInForm /></div>}>
        <SignInFormFromParams searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function SignInFormFromParams({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const next = safeNext(first(params.next));
  const error = first(params.error);
  const notice =
    (error ? NOTICES.get(error) : undefined) ??
    (first(params.reset) === "1"
      ? { tone: "info" as const, text: "Your password has been updated. Sign in with your new password." }
      : null);
  return <SignInForm next={next} notice={notice} />;
}
