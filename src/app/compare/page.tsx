import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountButton, AppHeader } from "@/components/layout";
import { ComparePickerView, ComparePickerSkeleton } from "./_ui/ComparePickerView";

export const metadata: Metadata = {
  title: "Compare · DataCleanse",
};

export default function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ left?: string | string[]; right?: string | string[] }>;
}) {
  return (
    <>
      <AppHeader active="Compare" actions={<AccountButton />} />
      <Suspense fallback={<ComparePickerSkeleton />}>
        <ComparePickerView searchParams={searchParams} />
      </Suspense>
    </>
  );
}
