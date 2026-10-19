import { audit } from "../audit";
import { db } from "../db";
import { newId } from "../ids";
import { absoluteDataPath, isValidId, storedFileExists } from "../files/storage";
import { uniqueAlias } from "../files/upload";
import type { QueryTable } from "../types";
import { AskError, CHAT_NOT_FOUND } from "./errors";
import { MAX_CHAT_FILES } from "./copy";
import type { AskableFile, AskResult, ChatFileView, ChatMessageView, JoinsState, MessageStatus } from "./types";

export interface ChatRecord {
  id: string;
  title: string;
  createdAt: number;
}

export interface ChatListItem extends ChatRecord {
  fileCount: number;
  /** Time of the latest message, or the chat's creation. */
  updatedAt: number;
}

/** A chat the user owns, or null. Other users' chats look the same as missing ones. */
export function getChatForUser(userId: string, chatId: string): ChatRecord | null {
  if (!isValidId(chatId) || !isValidId(userId)) return null;
  const row = db()
    .prepare("SELECT id, title, created_at FROM chats WHERE id = ? AND user_id = ?")
    .get(chatId, userId) as { id: string; title: string; created_at: number } | undefined;
  return row ? { id: row.id, title: row.title, createdAt: row.created_at } : null;
}

export function listChatsForUser(userId: string, limit = 20): ChatListItem[] {
  if (!isValidId(userId)) return [];
  const rows = db()
    .prepare(
      `SELECT c.id, c.title, c.created_at,
              (SELECT COUNT(*) FROM chat_files cf WHERE cf.chat_id = c.id) AS file_count,
              COALESCE((SELECT MAX(m.created_at) FROM chat_messages m WHERE m.chat_id = c.id), c.created_at) AS updated_at
         FROM chats c
        WHERE c.user_id = ?
        ORDER BY updated_at DESC, c.id DESC
        LIMIT ?`,
    )
    .all(userId, Math.min(Math.max(1, Math.trunc(limit)), 100)) as {
    id: string;
    title: string;
    created_at: number;
    file_count: number;
    updated_at: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    fileCount: r.file_count,
    updatedAt: r.updated_at,
  }));
}

/**
 * The user's files that a chat can use: not deleted and still stored. Newest first.
 * Files already in `excludeChatId` are left out when it is given.
 */
export async function listAskableFiles(userId: string, excludeChatId?: string): Promise<AskableFile[]> {
  if (!isValidId(userId)) return [];
  const rows = db()
    .prepare(
      `SELECT f.id, f.original_name, f.alias, f.row_count, f.column_count, f.rows_out, f.storage_path, f.cleaned_path
         FROM files f
        WHERE f.user_id = ? AND f.status <> 'deleted' AND f.storage_path IS NOT NULL
        ORDER BY f.created_at DESC, f.id DESC
        LIMIT 200`,
    )
    .all(userId) as FileQueryRow[];
  const inChat = new Set(
    excludeChatId && isValidId(excludeChatId)
      ? (db().prepare("SELECT file_id FROM chat_files WHERE chat_id = ?").all(excludeChatId) as { file_id: string }[]).map(
          (r) => r.file_id,
        )
      : [],
  );
  const out: AskableFile[] = [];
  for (const row of rows) {
    if (inChat.has(row.id)) continue;
    if (!(await storedFileExists(row.storage_path))) continue;
    const cleaned = row.cleaned_path !== null && (await storedFileExists(row.cleaned_path));
    out.push({
      id: row.id,
      name: row.original_name,
      alias: row.alias,
      rows: cleaned ? (row.rows_out ?? row.row_count) : row.row_count,
      columns: row.column_count,
      cleaned,
    });
  }
  return out;
}

interface FileQueryRow {
  id: string;
  original_name: string;
  alias: string;
  row_count: number | null;
  column_count: number | null;
  rows_out: number | null;
  storage_path: string | null;
  cleaned_path: string | null;
}

/**
 * A chat's files with the source each one is read from: the cleaned CSV when it exists, else the
 * original. Deleted or missing files stay in the list with a skip note and are left out of `tables`.
 */
export async function resolveChatTables(
  userId: string,
  chatId: string,
): Promise<{ files: ChatFileView[]; tables: QueryTable[] }> {
  const rows = db()
    .prepare(
      `SELECT cf.alias, f.id, f.original_name, f.status, f.row_count, f.rows_out, f.column_count,
              f.storage_path, f.cleaned_path
         FROM chat_files cf
         JOIN chats c ON c.id = cf.chat_id
         JOIN files f ON f.id = cf.file_id
        WHERE cf.chat_id = ? AND c.user_id = ? AND f.user_id = ?
        ORDER BY cf.alias`,
    )
    .all(chatId, userId, userId) as (FileQueryRow & { alias: string; status: string })[];

  const files: ChatFileView[] = [];
  const tables: QueryTable[] = [];
  for (const row of rows) {
    const base = {
      fileId: row.id,
      name: row.original_name,
      alias: row.alias,
      rows: row.row_count,
      columns: row.column_count,
    };
    if (row.status === "deleted" || row.storage_path === null) {
      files.push({ ...base, source: null, skipNote: "Deleted. Not used in answers." });
      continue;
    }
    if (row.cleaned_path !== null && (await storedFileExists(row.cleaned_path))) {
      files.push({ ...base, rows: row.rows_out ?? row.row_count, source: "cleaned", skipNote: null });
      tables.push({ alias: row.alias, path: absoluteDataPath(row.cleaned_path) });
    } else if (await storedFileExists(row.storage_path)) {
      files.push({ ...base, source: "original", skipNote: null });
      tables.push({ alias: row.alias, path: absoluteDataPath(row.storage_path) });
    } else {
      files.push({ ...base, source: null, skipNote: "The file is no longer stored. Not used in answers." });
    }
  }
  return { files, tables };
}

/** Creates a chat with the given files, each under a unique alias. Returns the chat id. */
export async function createChat(userId: string, fileIds: string[]): Promise<string> {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) throw new AskError("invalid", "Choose at least one file.");
  if (ids.length > MAX_CHAT_FILES) throw new AskError("invalid", `A chat can have up to ${MAX_CHAT_FILES} files.`);
  const picked = await askableFilesByIds(userId, ids);
  const conn = db();
  const chatId = newId("chat");
  const title = picked.map((f) => f.name).join(", ").slice(0, 120);
  conn.transaction(() => {
    conn.prepare("INSERT INTO chats (id, user_id, title, created_at) VALUES (?, ?, ?, ?)").run(chatId, userId, title, Date.now());
    const taken = new Set<string>();
    const insert = conn.prepare("INSERT INTO chat_files (chat_id, file_id, alias) VALUES (?, ?, ?)");
    for (const file of picked) {
      const alias = uniqueAlias(file.alias, taken);
      taken.add(alias);
      insert.run(chatId, file.id, alias);
    }
    audit("ask.chat_created", `Chat with ${picked.length} file${picked.length === 1 ? "" : "s"}`, { actor: userId });
  })();
  return chatId;
}

/** Adds one file to a chat under a unique alias. */
export async function addFileToChat(userId: string, chatId: string, fileId: string): Promise<{ alias: string }> {
  if (!getChatForUser(userId, chatId)) throw new AskError("not_found", CHAT_NOT_FOUND);
  const [file] = await askableFilesByIds(userId, [fileId]);
  const conn = db();
  return conn.transaction(() => {
    const existing = conn.prepare("SELECT alias FROM chat_files WHERE chat_id = ?").all(chatId) as { alias: string }[];
    if (existing.length >= MAX_CHAT_FILES) throw new AskError("invalid", `A chat can have up to ${MAX_CHAT_FILES} files.`);
    if (conn.prepare("SELECT 1 FROM chat_files WHERE chat_id = ? AND file_id = ?").get(chatId, fileId)) {
      throw new AskError("conflict", "That file is already in this chat.");
    }
    const alias = uniqueAlias(
      file.alias,
      new Set(existing.map((r) => r.alias)),
    );
    conn.prepare("INSERT INTO chat_files (chat_id, file_id, alias) VALUES (?, ?, ?)").run(chatId, fileId, alias);
    audit("ask.file_added", `Added ${file.name} as ${alias}`, { actor: userId, fileId });
    return { alias };
  })();
}

/** The named files, when every one belongs to the user, is not deleted and is still stored. */
async function askableFilesByIds(userId: string, fileIds: string[]): Promise<AskableFile[]> {
  const askable = await listAskableFiles(userId);
  return fileIds.map((fileId) => {
    const file = isValidId(fileId) ? askable.find((f) => f.id === fileId) : undefined;
    if (!file) throw new AskError("not_found", "That file could not be found, or it was deleted.");
    return file;
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

interface MessageRow {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  sql: string | null;
  joins_json: string | null;
  result_json: string | null;
  status: MessageStatus;
  created_at: number;
}

export interface StoredMessage extends ChatMessageView {
  chatId: string;
}

function toMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    content: row.content,
    status: row.status,
    sql: row.sql,
    joins: parseJson<JoinsState>(row.joins_json),
    result: parseJson<AskResult>(row.result_json),
    createdAt: row.created_at,
  };
}

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Messages of a chat, oldest first. The caller checks ownership of the chat. */
export function listMessages(userId: string, chatId: string): ChatMessageView[] {
  if (!getChatForUser(userId, chatId)) return [];
  const rows = db()
    .prepare("SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at, rowid")
    .all(chatId) as MessageRow[];
  return rows.map(toMessage);
}

/** One message, only when the user owns its chat. */
export function getMessageForUser(userId: string, messageId: string): StoredMessage | null {
  if (!isValidId(messageId)) return null;
  const row = db()
    .prepare(
      `SELECT m.* FROM chat_messages m JOIN chats c ON c.id = m.chat_id
        WHERE m.id = ? AND c.user_id = ?`,
    )
    .get(messageId, userId) as MessageRow | undefined;
  return row ? toMessage(row) : null;
}

export function insertMessage(input: {
  chatId: string;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  sql?: string | null;
  joins?: JoinsState | null;
  result?: AskResult | null;
}): string {
  const id = newId("msg");
  db()
    .prepare(
      `INSERT INTO chat_messages (id, chat_id, role, content, sql, joins_json, result_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.chatId,
      input.role,
      input.content,
      input.sql ?? null,
      input.joins ? JSON.stringify(input.joins) : null,
      input.result ? JSON.stringify(input.result) : null,
      input.status,
      Date.now(),
    );
  return id;
}

export function updateMessage(
  messageId: string,
  patch: { content?: string; status?: MessageStatus; sql?: string | null; joins?: JoinsState | null; result?: AskResult | null },
): void {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (patch.content !== undefined) {
    sets.push("content = ?");
    args.push(patch.content);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    args.push(patch.status);
  }
  if (patch.sql !== undefined) {
    sets.push("sql = ?");
    args.push(patch.sql);
  }
  if (patch.joins !== undefined) {
    sets.push("joins_json = ?");
    args.push(patch.joins ? JSON.stringify(patch.joins) : null);
  }
  if (patch.result !== undefined) {
    sets.push("result_json = ?");
    args.push(patch.result ? JSON.stringify(patch.result) : null);
  }
  if (sets.length === 0) return;
  db()
    .prepare(`UPDATE chat_messages SET ${sets.join(", ")} WHERE id = ?`)
    .run(...args, messageId);
}

/**
 * Joins the user confirmed earlier in this chat for the same set of files, newest first, or null.
 * A confirmation does not carry over when a file was added or removed.
 */
export function findConfirmedJoins(chatId: string, aliases: string[]): JoinsState | null {
  const rows = db()
    .prepare("SELECT joins_json FROM chat_messages WHERE chat_id = ? AND joins_json IS NOT NULL ORDER BY created_at DESC, rowid DESC")
    .all(chatId) as { joins_json: string }[];
  const wanted = [...aliases].sort();
  for (const row of rows) {
    const state = parseJson<JoinsState>(row.joins_json);
    if (!state || !state.confirmed) continue;
    if (state.tables.length === wanted.length && state.tables.every((t, i) => t === wanted[i])) return state;
  }
  return null;
}
