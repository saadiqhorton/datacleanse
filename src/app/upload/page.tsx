import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/layout";
import { cn } from "@/components/ui";
import { UploadSkeleton } from "./_ui/UploadSkeleton";
import { UploadWorkspace } from "./_ui/UploadWorkspace";

export const metadata: Metadata = {
  title: "Upload · DataCleanse",
};

const steps = [
  { n: 1, label: "Upload", active: true },
  { n: 2, label: "Options", active: true },
  { n: 3, label: "Review", active: false },
];

export default function UploadPage() {
  return (
    <>
      <AppHeader
        nav={false}
        center={
          <ol aria-label="Steps" className="flex flex-wrap gap-6 text-sm">
            {steps.map((s) => (
              <li
                key={s.n}
                className={cn(
                  "flex items-center gap-2",
                  s.active ? "font-medium" : "text-muted",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-xs",
                    s.active ? "bg-ink text-white" : "border border-hairline",
                  )}
                >
                  {s.n}
                </span>
                {s.label}
              </li>
            ))}
          </ol>
        }
        actions={
          <Link
            href="/files"
            className="inline-flex h-10 items-center justify-center rounded-full border border-hairline px-5 text-sm font-medium text-ink no-underline"
          >
            Cancel
          </Link>
        }
      />

      <Suspense fallback={<UploadSkeleton />}>
        <UploadWorkspace />
      </Suspense>
    </>
  );
}
