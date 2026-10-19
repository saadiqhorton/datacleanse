import Link from "next/link";
import { Eyebrow } from "@/components/ui";
import { requireUser } from "@/server/auth/session";
import { listAskableFiles, listChatsForUser } from "@/server/ask/repo";
import { NewChatForm } from "./NewChatForm";
import { UpdatedAt } from "./UpdatedAt";

/** /ask: the latest chats, and "New chat" with the file picker. */
export async function AskHome() {
  const { user } = await requireUser();
  const chats = listChatsForUser(user.id);
  const files = await listAskableFiles(user.id);

  return (
    <main className="mx-auto flex w-full max-w-[820px] flex-col gap-8 p-4 md:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ask your data</h1>
        <p className="text-sm leading-normal text-slate">
          Ask questions about your files in plain English. The answer comes from a read-only query that runs on every
          row.
        </p>
      </header>

      {chats.length > 0 && (
        <section aria-labelledby="recent-chats" className="flex flex-col gap-3">
          <Eyebrow>
            <span id="recent-chats">Recent chats</span>
          </Eyebrow>
          <ul className="flex flex-col gap-2">
            {chats.map((chat) => (
              <li key={chat.id}>
                <Link
                  href={`/ask/${chat.id}`}
                  className="flex flex-col gap-1 rounded-xl border border-hairline bg-white p-4 text-ink no-underline hover:bg-surface"
                >
                  <span className="truncate font-medium">{chat.title || "Untitled chat"}</span>
                  <span className="text-xs text-slate">
                    {chat.fileCount} {chat.fileCount === 1 ? "file" : "files"} · updated <UpdatedAt at={chat.updatedAt} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <NewChatForm files={files} startOpen={chats.length === 0} />
    </main>
  );
}
