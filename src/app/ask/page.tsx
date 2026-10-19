import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountButton, AppHeader } from "@/components/layout";
import { AskHome } from "./_ui/AskHome";
import { HomeSkeleton } from "./_ui/Skeletons";

export const metadata: Metadata = {
  title: "Ask · DataCleanse",
};

export default function AskPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader active="Ask" actions={<AccountButton />} />
      <Suspense fallback={<HomeSkeleton />}>
        <AskHome />
      </Suspense>
    </div>
  );
}
