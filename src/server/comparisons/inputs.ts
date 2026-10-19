import { CsvError, readCsvFile } from "../csv";
import { getFileRowForUser, listFilesForUser, type FileRow } from "../files/repo";
import { absoluteDataPath, isValidId, storedFileExists } from "../files/storage";
import type { Table } from "../types";
import { CompareError, FILE_NOT_FOUND } from "./errors";

/** A file the user can pick in the Compare picker. */
export interface ComparableFile {
  id: string;
  name: string;
  /** Rows in the version a comparison reads: the cleaned copy when there is one, else the original. */
  rows: number | null;
  hasCleaned: boolean;
}

/** One side of a comparison: the parsed table and where it came from. */
export interface ComparisonInput {
  fileId: string;
  name: string;
  source: "cleaned" | "original";
  table: Table;
  warnings: string[];
}

/** The user's files that still have an original copy on disk, newest first. */
export function listComparableFiles(userId: string): ComparableFile[] {
  return listFilesForUser(userId, { status: "active", limit: 500 })
    .filter((f) => f.hasOriginal)
    .map((f) => ({
      id: f.id,
      name: f.name,
      rows: f.hasCleaned && f.rowsOut !== null ? f.rowsOut : f.rowCount,
      hasCleaned: f.hasCleaned,
    }));
}

/** The file row for an owned, not-deleted file with stored data. Other users' files look missing. */
export function ownedFile(userId: string, fileId: string): FileRow {
  if (!isValidId(fileId)) throw new CompareError("not_found", FILE_NOT_FOUND);
  const row = getFileRowForUser(userId, fileId);
  if (!row) throw new CompareError("not_found", FILE_NOT_FOUND);
  if (row.status === "deleted" || row.storage_path === null) {
    throw new CompareError("gone", `${row.original_name} was deleted. Upload it again to compare it.`);
  }
  return row;
}

/**
 * Reads one side of a comparison. Uses the cleaned copy when asked for and present on disk,
 * otherwise the original upload.
 */
export async function loadComparisonInput(userId: string, fileId: string, useCleaned: boolean): Promise<ComparisonInput> {
  const row = ownedFile(userId, fileId);
  const cleanedAvailable = useCleaned && row.cleaned_path !== null && (await storedFileExists(row.cleaned_path));
  const rel = cleanedAvailable
    ? (row.cleaned_path as string)
    : (await storedFileExists(row.storage_path))
      ? (row.storage_path as string)
      : null;
  if (rel === null) {
    throw new CompareError("gone", `${row.original_name} is no longer on the server. Upload it again to compare it.`);
  }

  let parsed: Awaited<ReturnType<typeof readCsvFile>>;
  try {
    parsed = await readCsvFile(absoluteDataPath(rel));
  } catch (err) {
    if (err instanceof CsvError) {
      throw new CompareError("invalid", `${row.original_name} could not be read: ${err.message}`);
    }
    throw err;
  }
  return {
    fileId,
    name: row.original_name,
    source: cleanedAvailable ? "cleaned" : "original",
    table: parsed.table,
    warnings: parsed.warnings,
  };
}

/** Headers both tables have, in the left table's order, without repeats. */
export function sharedHeaders(left: string[], right: string[]): string[] {
  const inRight = new Set(right);
  return [...new Set(left)].filter((h) => inRight.has(h));
}
