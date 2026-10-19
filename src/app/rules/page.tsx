import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountButton, AppHeader } from "@/components/layout";
import { RulesSkeleton, RulesWorkspace } from "./_ui/RulesWorkspace";

export const metadata: Metadata = {
  title: "Rules · DataCleanse",
};

export default function RulesPage({ searchParams }: { searchParams: Promise<{ set?: string | string[] }> }) {
  return (
    <>
      <AppHeader active="Rules" actions={<AccountButton />} />
      <Suspense fallback={<RulesSkeleton />}>
        <RulesWorkspace searchParams={searchParams} />
      </Suspense>
    </>
  );
}
