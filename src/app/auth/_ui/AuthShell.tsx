import type { ReactNode } from "react";
// Import Logo directly: the layout barrel also exports server-only components (AccountButton reads the session),
// and client forms import helpers from this file.
import { Logo } from "@/components/layout/Logo";
import { CheckIcon } from "@/components/ui";

const highlights = [
  "Every change is shown before it's applied",
  "AI sees a small sample, never your whole file",
  "Files auto-delete after 24 hours",
];

/** Two-column layout shared by the sign-in, sign-up and password reset pages. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 font-sans text-ink md:grid-cols-2">
      <section className="flex flex-col justify-center px-6 py-16 sm:px-8">
        <div className="mx-auto flex w-full max-w-[400px] flex-col gap-6">
          <Logo />

          <div className="flex flex-col gap-2">
            <h1 className="text-4xl leading-[1.2] font-semibold tracking-[-0.5px]">{title}</h1>
            <p className="text-base leading-normal text-slate">{subtitle}</p>
          </div>

          {children}

          {footer}
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

/** Field-level or form-level error, styled like TextField's error text. */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-[13px] font-normal text-error">
      {children}
    </p>
  );
}

/** Neutral confirmation text, e.g. "If an account exists for that email, we sent a reset link." */
export function FormNotice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" }) {
  if (!children) return null;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm leading-normal text-error-ink"
          : "rounded-lg bg-surface px-4 py-3 text-sm leading-normal text-ink"
      }
    >
      {children}
    </p>
  );
}

/** Button styled like the primary sign-in call to action. */
export const primaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-60";
