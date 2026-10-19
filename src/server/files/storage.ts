import { mkdir, open, rm, access, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env";
import { FileError, NOT_FOUND_MESSAGE } from "./errors";

/** Ids from ids.ts: a prefix, an underscore, then lowercase letters, digits and "x". */
export const ID_PATTERN = /^[a-z]+_[a-z0-9x]+$/;
const MAX_ID_LENGTH = 64;

const FILES_ROOT = "files";
const ORIGINAL_NAME = "original.csv";
const CLEANED_NAME = "cleaned.csv";

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length <= MAX_ID_LENGTH && ID_PATTERN.test(id);
}

/** Throws not_found for anything that is not a well-formed id, so probing reveals nothing. */
export function assertId(id: unknown): string {
  if (!isValidId(id)) throw new FileError("not_found", NOT_FOUND_MESSAGE);
  return id;
}

/** Directory of one file: files/<userId>/<fileId>, relative to DATA_DIR. */
export function fileDirRel(userId: string, fileId: string): string {
  return path.posix.join(FILES_ROOT, assertId(userId), assertId(fileId));
}

export function originalRel(userId: string, fileId: string): string {
  return path.posix.join(fileDirRel(userId, fileId), ORIGINAL_NAME);
}

export function cleanedRel(userId: string, fileId: string): string {
  return path.posix.join(fileDirRel(userId, fileId), CLEANED_NAME);
}

/**
 * Absolute path for a path stored in the database (relative to DATA_DIR). Refuses anything
 * that resolves outside DATA_DIR/files, so a corrupted row cannot point elsewhere.
 */
export function absoluteDataPath(rel: string): string {
  const root = path.resolve(env.dataDir, FILES_ROOT);
  const abs = path.resolve(env.dataDir, rel);
  if (!abs.startsWith(root + path.sep)) {
    throw new FileError("invalid", "The stored file path is outside the data folder.");
  }
  return abs;
}

export async function storedFileExists(rel: string | null): Promise<boolean> {
  if (!rel) return false;
  try {
    await access(absoluteDataPath(rel));
    return true;
  } catch {
    return false;
  }
}

type ChunkSource = Uint8Array | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

async function* chunksOf(source: ChunkSource): AsyncGenerator<Uint8Array> {
  if (source instanceof Uint8Array) {
    yield source;
    return;
  }
  if (source instanceof ReadableStream) {
    const reader = source.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      // Runs on early exit too (size limit), so the client stream is not left open.
      reader.cancel().catch(() => {});
    }
  }
  yield* source;
}

/**
 * Writes the original upload. The size limit is enforced while streaming, so an oversized
 * upload never reaches disk in full. On any failure the file directory is removed.
 */
export async function writeOriginal(
  userId: string,
  fileId: string,
  source: ChunkSource,
  maxBytes: number,
): Promise<{ rel: string; size: number }> {
  const rel = originalRel(userId, fileId);
  const abs = absoluteDataPath(rel);
  await mkdir(path.dirname(abs), { recursive: true });
  let size = 0;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(abs, "wx", 0o600);
    for await (const chunk of chunksOf(source)) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new FileError("too_large", tooLargeMessage(maxBytes));
      await handle.writeFile(chunk);
    }
    await handle.close();
    handle = undefined;
    return { rel, size };
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await removeFileDir(userId, fileId).catch(() => {});
    throw err;
  }
}

export function tooLargeMessage(maxBytes: number): string {
  const mb = maxBytes / (1024 * 1024);
  return `This file is larger than the ${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB limit.`;
}

/** Writes the cleaned CSV next to the original. Overwrites a previous apply. */
export async function writeCleaned(userId: string, fileId: string, text: string): Promise<string> {
  const rel = cleanedRel(userId, fileId);
  await writeFile(absoluteDataPath(rel), text, { encoding: "utf8", mode: 0o600 });
  return rel;
}

/** Deletes the file's directory (original and cleaned copies). Other files are untouched. */
export async function removeFileDir(userId: string, fileId: string): Promise<void> {
  await rm(absoluteDataPath(fileDirRel(userId, fileId)), { recursive: true, force: true });
}
