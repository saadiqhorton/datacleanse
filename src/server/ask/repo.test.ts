import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { setupTestEnv, insertTestUser } from "../testing";
import type { DB } from "../db";
import { AskError } from "./errors";
import { addFileToChat, createChat, getChatForUser, getMessageForUser, insertMessage, listAskableFiles, listChatsForUser, listMessages, resolveChatTables } from "./repo";
import { CUSTOMERS_CSV, ORDERS_CSV, addStoredFile } from "./test-support";

let conn: DB;
let dataDir: string;

describe("ask chats: ownership, aliases and file state", () => {
  before(() => {
    ({ db: conn, dataDir } = setupTestEnv());
    insertTestUser(conn, "user_a", "a@example.test");
    insertTestUser(conn, "user_b", "b@example.test");
  });
  after(() => {
    conn.close();
  });

  it("only the owner sees a chat, its messages and its message", async () => {
    const orders = addStoredFile("user_a", "orders.csv", "orders", ORDERS_CSV);
    const chatId = await createChat("user_a", [orders]);
    const msgId = insertMessage({ chatId, role: "user", content: "How many?", status: "done" });

    assert.ok(getChatForUser("user_a", chatId));
    assert.equal(getChatForUser("user_b", chatId), null);
    assert.equal(listMessages("user_b", chatId).length, 0);
    assert.equal(getMessageForUser("user_b", msgId), null);
    assert.ok(getMessageForUser("user_a", msgId));
    assert.deepEqual(
      listChatsForUser("user_b").map((c) => c.id),
      [],
    );
  });

  it("refuses to put another user's file in a chat", async () => {
    const theirs = addStoredFile("user_b", "private.csv", "private_data", "id\n1\n");
    await assert.rejects(createChat("user_a", [theirs]), (err: unknown) => err instanceof AskError && err.code === "not_found");

    const mine = addStoredFile("user_a", "mine.csv", "mine", "id\n1\n");
    const bChat = await createChat("user_b", [await fileFor("user_b")]);
    await assert.rejects(addFileToChat("user_a", bChat, mine), (err: unknown) => err instanceof AskError && err.code === "not_found");
  });

  it("gives each file in a chat a unique alias", async () => {
    const first = addStoredFile("user_a", "orders.csv", "orders", ORDERS_CSV);
    const second = addStoredFile("user_a", "orders (2).csv", "orders", ORDERS_CSV);
    const chatId = await createChat("user_a", [first, second]);
    const { files } = await resolveChatTables("user_a", chatId);
    assert.deepEqual(
      files.map((f) => f.alias).sort(),
      ["orders", "orders_2"],
    );
  });

  it("adds a file under a free alias, and refuses a file that is already there", async () => {
    const customers = addStoredFile("user_a", "customers.csv", "customers", CUSTOMERS_CSV);
    const chatId = await createChat("user_a", [await fileFor("user_a", "orders")]);
    const { alias } = await addFileToChat("user_a", chatId, customers);
    assert.equal(alias, "customers");
    await assert.rejects(addFileToChat("user_a", chatId, customers), (err: unknown) => err instanceof AskError && err.code === "conflict");
  });

  it("reads the cleaned CSV when there is one, and the original otherwise", async () => {
    const cleaned = addStoredFile("user_a", "crm.csv", "crm", "email\nRAW\n", { cleaned: "email\nclean@x.test\n" });
    const chatId = await createChat("user_a", [cleaned, await fileFor("user_a", "orders")]);
    const { files, tables } = await resolveChatTables("user_a", chatId);
    const crm = files.find((f) => f.alias === "crm");
    const orders = files.find((f) => f.alias === "orders");
    assert.equal(crm?.source, "cleaned");
    assert.equal(orders?.source, "original");
    assert.ok(tables.find((t) => t.alias === "crm")?.path.endsWith("cleaned.csv"));
    assert.ok(tables.find((t) => t.alias === "orders")?.path.endsWith("original.csv"));
    assert.ok(tables.every((t) => t.path.startsWith(dataDir)));
  });

  it("keeps deleted files out of tables, with a note, and out of the file picker", async () => {
    const gone = addStoredFile("user_a", "old.csv", "old_data", "id\n1\n", { status: "deleted" });
    const chatId = await createChat("user_a", [await fileFor("user_a", "orders")]);
    conn.prepare("INSERT INTO chat_files (chat_id, file_id, alias) VALUES (?, ?, ?)").run(chatId, gone, "old_data");

    const { files, tables } = await resolveChatTables("user_a", chatId);
    const skipped = files.find((f) => f.alias === "old_data");
    assert.equal(skipped?.source, null);
    assert.match(skipped?.skipNote ?? "", /Deleted/);
    assert.ok(!tables.some((t) => t.alias === "old_data"));

    const picker = await listAskableFiles("user_a");
    assert.ok(!picker.some((f) => f.id === gone));
  });

  it("only lists files that are not already in the chat", async () => {
    const inChat = await fileFor("user_a", "orders");
    const chatId = await createChat("user_a", [inChat]);
    const picker = await listAskableFiles("user_a", chatId);
    assert.ok(!picker.some((f) => f.id === inChat));
    assert.ok(picker.length > 0);
  });

  it("lists the user's chats, newest activity first, with their file counts", async () => {
    const first = await createChat("user_a", [await fileFor("user_a", "orders")]);
    const second = await createChat("user_a", [await fileFor("user_a", "orders"), await fileFor("user_a", "customers")]);
    insertMessage({ chatId: first, role: "user", content: "latest", status: "done" });
    conn.prepare("UPDATE chats SET created_at = ? WHERE id = ?").run(1, first);
    conn.prepare("UPDATE chats SET created_at = ? WHERE id = ?").run(2, second);

    const list = listChatsForUser("user_a");
    assert.equal(list[0].id, first, "the chat with the newest message comes first");
    assert.equal(list.find((c) => c.id === second)?.fileCount, 2);
    assert.ok(list.every((c) => c.updatedAt >= c.createdAt));
  });

  it("rejects an empty chat", async () => {
    await assert.rejects(createChat("user_a", []), (err: unknown) => err instanceof AskError && err.code === "invalid");
  });
});

/** The newest file of a user with the given alias, created by the tests above. */
async function fileFor(userId: string, alias = "orders"): Promise<string> {
  const row = conn
    .prepare("SELECT id FROM files WHERE user_id = ? AND alias = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(userId, alias) as { id: string } | undefined;
  if (!row) return addStoredFile(userId, `${alias}.csv`, alias, ORDERS_CSV);
  return row.id;
}
