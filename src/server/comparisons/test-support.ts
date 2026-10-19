/** Fixtures for the comparison tests: owned file rows with real CSV copies on disk. */
import { db } from "../db";
import { newId } from "../ids";
import { writeCleaned, writeOriginal } from "../files/storage";
import { insertTestUser } from "../testing";

let counter = 0;

export function newUser(): string {
  counter++;
  const id = `usr_cmp${counter}x`;
  insertTestUser(db(), id, `cmp${counter}@example.com`);
  return id;
}

/** Inserts a ready file for the user with an original copy and, optionally, a cleaned copy. */
export async function addFile(
  userId: string,
  name: string,
  original: string,
  opts: { cleaned?: string; cleanedOnDisk?: boolean } = {},
): Promise<string> {
  const fileId = newId("file");
  const bytes = new TextEncoder().encode(original);
  const { rel } = await writeOriginal(userId, fileId, bytes, 10 * 1024 * 1024);
  let cleanedRel: string | null = null;
  if (opts.cleaned !== undefined) {
    cleanedRel = await writeCleaned(userId, fileId, opts.cleaned);
    if (opts.cleanedOnDisk === false) {
      // Row says the cleaned copy exists, but the file is gone from disk.
      const { rm } = await import("node:fs/promises");
      const { absoluteDataPath } = await import("../files/storage");
      await rm(absoluteDataPath(cleanedRel));
    }
  }
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO files (id, user_id, original_name, alias, size_bytes, row_count, column_count, storage_path,
         cleaned_path, status, rows_out, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`,
    )
    .run(
      fileId,
      userId,
      name,
      name.replace(/\.csv$/, "").replace(/[^a-z0-9]+/gi, "_").toLowerCase(),
      bytes.length,
      Math.max(0, original.trim().split("\n").length - 1),
      original.split("\n")[0].split(",").length,
      rel,
      cleanedRel,
      opts.cleaned !== undefined ? Math.max(0, opts.cleaned.trim().split("\n").length - 1) : null,
      now,
      now + 24 * 60 * 60 * 1000,
    );
  return fileId;
}

export const LEFT_CSV = "email,plan,city\njane@acme.io,starter,Seoul\nbob@acme.io,team,Rome\nold@acme.io,team,Paris\n";
export const RIGHT_CSV = "email,plan,city,lifetime\njane@acme.io,team,Busan,10\nbob@acme.io,team,Rome,5\nnew@acme.io,starter,Oslo,1\n";
/** Cleaned copy of LEFT_CSV where the plan was already fixed. */
export const LEFT_CLEANED_CSV = "email,plan,city\njane@acme.io,team,Seoul\nbob@acme.io,team,Rome\nold@acme.io,team,Paris\n";
