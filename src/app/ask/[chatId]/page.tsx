import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountButton, AppHeader } from "@/components/layout";
import { ChatView } from "../_ui/ChatView";
import { ChatSkeleton } from "../_ui/Skeletons";

export const metadata: Metadata = {
  title: "Ask · DataCleanse",
};

export default function ChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader active="Ask" actions={<AccountButton />} />

      <h1 className="sr-only">Ask your data</h1>

      <Suspense fallback={<ChatSkeleton />}>
        <ChatView params={params} />
      </Suspense>
    </div>
  );
}
