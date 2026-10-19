import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountButton, AppHeader } from "@/components/layout";
import { Button } from "@/components/ui";
import { LinkButton } from "../_ui/LinkButton";
import { ReviewSkeleton, ReviewWorkspace } from "../_ui/ReviewWorkspace";

export const metadata: Metadata = {
  title: "Review changes · DataCleanse",
};

export default function ReviewChangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ fileId: string }>;
  searchParams: Promise<{ filter?: string | string[]; page?: string | string[] }>;
}) {
  return (
    <div className="min-h-screen bg-white font-sans text-ink">
      <AppHeader
        active="Files"
        actions={
          <>
            <Button variant="secondary">Help</Button>
            <LinkButton href="/upload">New upload</LinkButton>
            <AccountButton />
          </>
        }
      />
      <Suspense fallback={<ReviewSkeleton />}>
        <ReviewWorkspace params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
