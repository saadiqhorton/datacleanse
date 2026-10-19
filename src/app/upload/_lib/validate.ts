import { formatBytes } from "./format";

/** Same extensions the server accepts (ALLOWED_EXTENSIONS in src/server/files/upload.ts). */
export const ALLOWED_EXTENSIONS = [".csv", ".tsv", ".txt"] as const;

/** Same cap as the server's MAX_FILES in src/app/api/files/route.ts. */
export const MAX_FILES = 20;

export interface Candidate {
  name: string;
  size: number;
}

export interface Rejected {
  name: string;
  message: string;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/** Error text for one file, or null when the file can be uploaded. */
export function checkFile(file: Candidate, maxBytes: number): string | null {
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) {
    return `${file.name} is not a .csv, .tsv or .txt file.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > maxBytes) {
    return `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.`;
  }
  return null;
}

/** Splits a selection into files that can be uploaded and the messages for the rest. */
export function splitSelection<T extends Candidate>(files: T[], maxBytes: number): { valid: T[]; rejected: Rejected[] } {
  const valid: T[] = [];
  const rejected: Rejected[] = [];
  for (const file of files) {
    const message = checkFile(file, maxBytes);
    if (message) rejected.push({ name: file.name, message });
    else valid.push(file);
  }
  return { valid, rejected };
}

/**
 * Checks the whole batch. The server reads the request size against one limit, so the files
 * together must fit in it too, not only one at a time.
 */
export function checkBatch(files: Candidate[], maxBytes: number, maxFiles = MAX_FILES): string | null {
  if (files.length > maxFiles) return `Choose at most ${maxFiles} files at a time.`;
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > maxBytes) {
    return `These files add up to ${formatBytes(total)}. Upload at most ${formatBytes(maxBytes)} at once.`;
  }
  return null;
}

/** Identifies a file in the selection, so choosing the same file twice does not duplicate it. */
export function fileKey(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}
