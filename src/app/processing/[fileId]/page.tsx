import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/layout";
import { requireUser } from "@/server/auth/session";
import { formatCount } from "@/server/csv/errors";
import { getJobForUser } from "@/server/files/jobs";
import { getFileForUser, getFileRowForUser } from "@/server/files/repo";
import { EMPTY_STEP_STATE, stepLabels } from "@/server/files/steps";
import { storedFileExists } from "@/server/files/storage";
import { CHUNK_THRESHOLD_ROWS } from "@/server/jobs/handlers/clean";
import { latestCleanJob } from "../_lib/latest-job";
import { ProcessingPanel } from "./ProcessingPanel";

export const metadata: Metadata = {
  title: "Processing · DataCleanse",
};

export default function ProcessingPage({ params }: { params: Promise<{ fileId: string }> }) {
  return (
    <div className="min-h-[960px] bg-white font-sans text-ink">
      <AppHeader
        nav={false}
        actions={
          <Link href="/files" className="text-sm font-medium no-underline">
            Back to files
          </Link>
        }
      />
      <Suspense fallback={<ProcessingSkeleton />}>
        <ProcessingContent params={params} />
      </Suspense>
    </div>
  );
}

function ProcessingSkeleton() {
  return (
    <div aria-busy="true" className="mx-auto max-w-[1344px] px-4 py-12 sm:px-8 lg:py-16">
      <span className="sr-only">Loading progress</span>
      <div aria-hidden="true" className="flex max-w-[720px] animate-pulse flex-col gap-6">
        <div className="h-8 w-64 rounded bg-divider" />
        <div className="h-72 rounded-xl bg-surface" />
      </div>
    </div>
  );
}

async function ProcessingContent({ params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const { user } = await requireUser();
  const file = getFileForUser(user.id, fileId);
  if (!file) notFound();

  // Terminal file states that have their own pages. Processing only shows work in progress and errors.
  if (file.status === "needs_review" && file.aiStatus !== "unavailable") redirect(`/review/${file.id}`);
  if (file.status === "ready") redirect(`/report/${file.id}`);
  if (file.status === "deleted") redirect("/files");

  const latest = latestCleanJob(user.id, file.id);
  const job = latest ? getJobForUser(user.id, latest.id) : null;
  const row = getFileRowForUser(user.id, file.id);
  const canRetry = file.status === "failed" && (await storedFileExists(row?.storage_path ?? null));
  const large = latest?.chunked === true || (file.rowCount ?? 0) > CHUNK_THRESHOLD_ROWS;

  return (
    <ProcessingPanel
      fileId={file.id}
      fileName={file.name}
      mode={file.mode}
      rowsLabel={file.rowCount === null ? null : formatCount(file.rowCount)}
      large={large}
      canRetry={canRetry}
      fileStatus={file.status}
      aiStatus={file.aiStatus}
      fileError={file.error}
      initialJob={job}
      fallbackSteps={stepLabels(EMPTY_STEP_STATE)}
    />
  );
}
