import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/layout";
import { Button, CheckIcon, TextField } from "@/components/ui";

export const metadata: Metadata = {
  title: "Sign in · DataCleanse",
};

const highlights = [
  "Every change is shown before it's applied",
  "AI sees a small sample, never your whole file",
  "Files auto-delete after 24 hours",
];

export default function SignInPage() {
  return (
    <div className="grid min-h-screen grid-cols-1 font-sans text-ink md:grid-cols-2">
      <section className="flex flex-col justify-center px-6 py-16 sm:px-8">
        <div className="mx-auto flex w-full max-w-[400px] flex-col gap-6">
          <Logo />

          <div className="flex flex-col gap-2">
            <h1 className="text-4xl leading-[1.2] font-semibold tracking-[-0.5px]">Sign in</h1>
            <p className="text-base leading-normal text-slate">
              Pick up where you left off with your files.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <TextField
              label="Work email"
              type="email"
              name="email"
              autoComplete="email"
              defaultValue="maria@northwind.co"
            />

            <TextField
              label={
                <span className="flex items-center justify-between gap-4">
                  Password
                  <a href="#" className="text-[13px] font-medium">
                    Forgot password?
                  </a>
                </span>
              }
              type="password"
              name="password"
              autoComplete="current-password"
              defaultValue="password12"
            />

            <Link
              href="/files"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink-2"
            >
              Sign in
            </Link>

            <div className="flex items-center gap-3 text-[13px] text-muted">
              <span className="h-px flex-1 bg-divider" />
              or
              <span className="h-px flex-1 bg-divider" />
            </div>

            <Button variant="secondary" size="lg">
              Email me a sign-in link
            </Button>
          </div>

          <p className="text-sm text-slate">
            New to DataCleanse?{" "}
            <a href="#" className="font-medium">
              Create an account
            </a>
          </p>
        </div>
      </section>

      <section className="flex flex-col justify-center gap-8 bg-[linear-gradient(135deg,#062A26_0%,#0A5A4A_60%,#00A47F_100%)] px-6 py-16 text-white sm:px-8 md:px-16 md:py-24">
        <h2 className="max-w-[520px] text-4xl leading-[1.1] font-semibold tracking-[-1.5px] md:text-[56px]">
          Clean CSVs you can actually trust.
        </h2>

        <ul className="flex max-w-[460px] flex-col gap-4 text-base leading-normal">
          {highlights.map((text) => (
            <li key={text} className="flex gap-3">
              <CheckIcon size={20} className="mt-0.5 shrink-0 text-mint" />
              {text}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
