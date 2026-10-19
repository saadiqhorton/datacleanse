import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "../auth/_ui/AuthShell";
import { SignUpForm } from "./SignUpForm";

export const metadata: Metadata = {
  title: "Create account · DataCleanse",
};

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Clean your first file in a few minutes."
      footer={
        <p className="text-sm text-slate">
          Already have an account?{" "}
          <Link href="/signin" className="font-medium underline">
            Sign in
          </Link>
        </p>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
