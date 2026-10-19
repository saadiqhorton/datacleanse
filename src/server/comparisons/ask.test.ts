import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { setupTestEnv } from "../testing";
import { CompareError } from "./errors";
import { createAskChat } from "./ask";
import { runComparison } from "./run";
import { LEFT_CSV, RIGHT_CSV, addFile, newUser } from "./test-support";

before(() => {
  setupTestEnv();
});

describe("createAskChat", () => {
  it("creates a chat with both files under their aliases", async () => {
    const owner = newUser();
    const left = await addFile(owner, "customers_sept.csv", LEFT_CSV);
    const right = await addFile(owner, "customers_oct.csv", RIGHT_CSV);
    const compareId = await runComparison(owner, { leftId: left, rightId: right, useCleaned: false });

    const chatId = createAskChat(owner, compareId);
    const chat = db().prepare("SELECT user_id, title FROM chats WHERE id = ?").get(chatId) as { user_id: string; title: string };
    assert.equal(chat.user_id, owner);
    assert.equal(chat.title, "customers_sept.csv vs customers_oct.csv");

    const links = db()
      .prepare("SELECT file_id, alias FROM chat_files WHERE chat_id = ? ORDER BY alias")
      .all(chatId) as { file_id: string; alias: string }[];
    assert.deepEqual(links, [
      { file_id: right, alias: "customers_oct" },
      { file_id: left, alias: "customers_sept" },
    ]);
  });

  it("only works for the owner of the comparison", async () => {
    const owner = newUser();
    const other = newUser();
    const left = await addFile(owner, "a.csv", LEFT_CSV);
    const right = await addFile(owner, "b.csv", RIGHT_CSV);
    const compareId = await runComparison(owner, { leftId: left, rightId: right, useCleaned: false });
    assert.throws(() => createAskChat(other, compareId), (err: unknown) => err instanceof CompareError && err.code === "not_found");
    const chats = db().prepare("SELECT COUNT(*) AS n FROM chats WHERE user_id = ?").get(other) as { n: number };
    assert.equal(chats.n, 0);
  });

  it("refuses when one of the files has been deleted", async () => {
    const owner = newUser();
    const left = await addFile(owner, "a.csv", LEFT_CSV);
    const right = await addFile(owner, "b.csv", RIGHT_CSV);
    const compareId = await runComparison(owner, { leftId: left, rightId: right, useCleaned: false });

    db().prepare("UPDATE files SET status = 'deleted', storage_path = NULL, cleaned_path = NULL, deleted_at = ? WHERE id = ?").run(Date.now(), right);
    assert.throws(() => createAskChat(owner, compareId), (err: unknown) => err instanceof CompareError && err.code === "gone");

    // A hard-deleted file leaves the comparison with no file id at all.
    db().prepare("DELETE FROM files WHERE id = ?").run(left);
    assert.throws(() => createAskChat(owner, compareId), (err: unknown) => err instanceof CompareError && err.code === "gone");
  });
});
