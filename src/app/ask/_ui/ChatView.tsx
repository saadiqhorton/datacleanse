import Link from "next/link";
import { notFound } from "next/navigation";
import { Eyebrow, InfoPanel, Mono } from "@/components/ui";
import { requireUser } from "@/server/auth/session";
import { listAskableFiles, getChatForUser, listMessages, resolveChatTables } from "@/server/ask/repo";
import { formatCount } from "./format";
import { AddFileDialog } from "./AddFileDialog";
import { AskBar } from "./AskBar";
import { Messages } from "./Messages";
import { ScrollToEnd } from "./ScrollToEnd";

/** One chat: its files on the left, the conversation and the input bar on the right. */
export async function ChatView({ params }: { params: Promise<{ chatId: string }> }) {
  const { user } = await requireUser();
  const { chatId } = await params;
  if (!getChatForUser(user.id, chatId)) notFound();

  const [{ files }, addable] = await Promise.all([
    resolveChatTables(user.id, chatId),
    listAskableFiles(user.id, chatId),
  ]);
  const messages = listMessages(user.id, chatId);

  return (
    <div className="mx-auto flex w-full max-w-[1344px] flex-col md:min-h-[calc(100dvh-65px)] md:flex-row">
      <aside
        aria-label="Files in this conversation"
        className="flex flex-col gap-4 border-b border-divider px-4 py-8 md:w-[313px] md:shrink-0 md:border-r md:border-b-0"
      >
        <div className="flex items-center justify-between gap-2 px-2">
          <Eyebrow>Files in this chat · {files.length}</Eyebrow>
          <Link href="/ask" className="text-xs text-slate underline">
            All chats
          </Link>
        </div>

        {files.length === 0 ? (
          <p className="px-2 text-sm leading-normal text-slate">This chat has no files yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {files.map((file) => (
              <li key={file.fileId} className="flex flex-col gap-1 rounded-lg border border-hairline p-3">
                <Mono className="font-medium">{file.name}</Mono>
                {file.skipNote ? (
                  <span className="text-xs text-review">{file.skipNote}</span>
                ) : (
                  <span className="text-xs text-slate">
                    {file.rows !== null ? `${formatCount(file.rows)} rows` : "Rows unknown"}
                    {file.columns !== null ? ` · ${file.columns} cols` : ""}
                    {file.source === "cleaned" ? " · cleaned" : ""}
                    {" · "}
                    <span className="font-mono">{file.alias}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <AddFileDialog chatId={chatId} files={addable} />

        <InfoPanel className="flex flex-col gap-2 p-4 text-[13px] leading-normal text-slate">
          <div className="font-semibold text-ink">How answers work</div>
          AI writes a read-only query. We run it on every row of your files, so the numbers come
          from the query, not the AI. AI only sees column names, types and summary statistics.
        </InfoPanel>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-8">
        {messages.length === 0 && (
          <p className="max-w-[592px] text-sm leading-normal text-slate">
            Ask anything about these files in plain English. Every answer shows the query it ran.
          </p>
        )}
        <Messages messages={messages} />
        <ScrollToEnd count={messages.length} />
        <AskBar chatId={chatId} />
      </main>
    </div>
  );
}
