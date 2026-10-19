import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccountButton, AppHeader } from "@/components/layout";
import { FilesSkeleton } from "./_ui/FilesSkeleton";
import { FilesWorkspace } from "./_ui/FilesWorkspace";
import { linkButton } from "./_ui/classes";

export const metadata: Metadata = {
  title: "Your files · DataCleanse",
};

type SearchParams = { status?: string | string[]; q?: string | string[] };

export default function FilesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <>
      <AppHeader
        active="Files"
        actions={
          <>
            <Link href="/upload" className={linkButton("primary")}>
              New upload
            </Link>
            <AccountButton />
          </>
        }
      />

      <main className="mx-auto flex max-w-[1344px] flex-col gap-8 px-4 py-12 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-4xl font-semibold leading-[1.2] tracking-[-0.5px]">Your files</h1>
            <p className="text-base text-slate">Uploads and results are deleted 24 hours after upload.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/compare" className={linkButton("secondary")}>
              Compare files
            </Link>
            <Link href="/ask" className={linkButton("secondary")}>
              Ask about files
            </Link>
          </div>
        </div>

        <Suspense fallback={<FilesSkeleton />}>
          <FilesWorkspace searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}
