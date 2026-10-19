import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountButton, AppHeader } from "@/components/layout";
import { CompareResultView, CompareResultSkeleton } from "../_ui/CompareResultView";

export const metadata: Metadata = {
  title: "Compare · DataCleanse",
};

export default function CompareResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[]; page?: string | string[] }>;
}) {
  return (
    <>
      <AppHeader active="Compare" actions={<AccountButton />} />
      <Suspense fallback={<CompareResultSkeleton />}>
        <CompareResultView params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
