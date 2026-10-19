import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { peekMagicLink } from "@/server/auth/tokens";
import { AuthShell } from "../_ui/AuthShell";
import { confirmMagicLinkAction } from "./actions";
import { ConfirmSignInButton } from "./ConfirmSignInButton";

export const metadata: Metadata = {
  title: "Confirm sign-in · DataCleanse",
  // The sign-in token is in this page's URL. Do not send it on in Referer headers.
  referrer: "no-referrer",
};

type Params = Record<string, string | string[] | undefined>;

export default function MagicLinkPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <Suspense
      fallback={
        <AuthShell title="Sign in" subtitle="Checking your sign-in link.">
          <p className="text-sm text-slate">One moment.</p>
        </AuthShell>
      }
    >
      <MagicLinkConfirm searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Checks the link without using it, then asks for one click. Email link scanners open the URL
 * on their own, so a GET must never sign anyone in.
 */
async function MagicLinkConfirm({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const raw = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = typeof raw === "string" && raw.length <= 200 ? raw : "";

  const email = peekMagicLink(token);
  if (!email) redirect("/signin?error=link_expired");

  return (
    <AuthShell
      title={`Sign in to DataCleanse as ${email}?`}
      subtitle="Your sign-in link works once. Press the button to finish signing in."
      footer={
        <p className="text-sm text-slate">
          Didn&apos;t ask for this? You can close this page. The link expires on its own.
        </p>
      }
    >
      <form action={confirmMagicLinkAction} className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <ConfirmSignInButton />
      </form>
    </AuthShell>
  );
}
