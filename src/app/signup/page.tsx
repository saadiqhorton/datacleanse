import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { signupsOpen } from "@/server/auth/users";
import { AuthShell } from "../auth/_ui/AuthShell";
import { SignUpForm } from "./SignUpForm";

export const metadata: Metadata = {
  title: "Create account · DataCleanse",
};

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpGate />
    </Suspense>
  );
}

/** Single-user by default: the first visitor creates the owner account, then sign-up closes. */
async function SignUpGate() {
  await connection();
  const open = signupsOpen();
  const signInLink = (
    <p className="text-sm text-slate">
      Already have an account?{" "}
      <Link href="/signin" className="font-medium underline">
        Sign in
      </Link>
    </p>
  );
  if (!open) {
    return (
      <AuthShell title="Sign-ups are closed" subtitle="This DataCleanse already has an owner." footer={signInLink}>
        <p className="text-sm leading-normal text-slate">
          Ask the owner to invite you from the admin console, or sign in if you already have an account.
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Create your account" subtitle="Clean your first file in a few minutes." footer={signInLink}>
      <SignUpForm />
    </AuthShell>
  );
}
