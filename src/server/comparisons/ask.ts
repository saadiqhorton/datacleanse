import { audit } from "../audit";
import { db } from "../db";
import { newId } from "../ids";
import { CompareError, COMPARE_NOT_FOUND } from "./errors";
import { ownedFile } from "./inputs";
import { comparisonFileIds } from "./repo";

/**
 * Starts an Ask chat over the two files of a saved comparison and returns the chat id. The Ask
 * pages own the conversation; this only writes the chats and chat_files rows, with each file's alias.
 */
export function createAskChat(userId: string, compareId: string): string {
  const ids = comparisonFileIds(userId, compareId);
  if (!ids) throw new CompareError("not_found", COMPARE_NOT_FOUND);
  if (!ids.leftFileId || !ids.rightFileId) {
    throw new CompareError("gone", "One of these files was deleted, so there is nothing to ask about.");
  }
  const left = ownedFile(userId, ids.leftFileId);
  const right = ownedFile(userId, ids.rightFileId);

  const chatId = newId("chat");
  const conn = db();
  conn.transaction(() => {
    conn
      .prepare("INSERT INTO chats (id, user_id, title, created_at) VALUES (?, ?, ?, ?)")
      .run(chatId, userId, `${left.original_name} vs ${right.original_name}`, Date.now());
    const link = conn.prepare("INSERT INTO chat_files (chat_id, file_id, alias) VALUES (?, ?, ?)");
    link.run(chatId, left.id, left.alias);
    link.run(chatId, right.id, right.alias);
  })();
  audit("ask.chat_started", `Ask chat started from comparison ${compareId}`, { actor: userId, fileId: left.id });
  return chatId;
}
