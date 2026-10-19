import { compareTables } from "../compare";
import { audit } from "../audit";
import { JobBlocked } from "../jobs/queue";
import { runTracked } from "../jobs/tracked";
import { isValidId } from "../files/storage";
import type { CompareResult } from "../types";
import { CompareError, FILE_NOT_FOUND } from "./errors";
import { loadComparisonInput, ownedFile, sharedHeaders, type ComparisonInput } from "./inputs";
import { saveComparison } from "./repo";

export interface CompareRequest {
  leftId: string;
  rightId: string;
  /** Read the cleaned copy of each file when it exists. */
  useCleaned: boolean;
  /** A column both files share, used to match rows. Empty or missing means auto-detect. */
  keyColumn?: string | null;
}

/** The columns both files share, for the key picker. Reads both files, so call it only when they are picked. */
export async function sharedColumns(userId: string, leftId: string, rightId: string, useCleaned: boolean): Promise<string[]> {
  requireOwnedPair(userId, leftId, rightId);
  const left = await loadComparisonInput(userId, leftId, useCleaned);
  const right = await loadComparisonInput(userId, rightId, useCleaned);
  return sharedHeaders(left.table.headers, right.table.headers);
}

/**
 * Compares two of the user's files and saves the result. Ownership is checked before the job is
 * recorded. Expected problems (unknown key column, unreadable file) end the job as blocked and are
 * thrown as CompareError for the caller to show.
 */
export async function runComparison(userId: string, req: CompareRequest): Promise<string> {
  requireOwnedPair(userId, req.leftId, req.rightId);
  const keyColumn = req.keyColumn?.trim() ? req.keyColumn.trim() : null;

  try {
    return await runTracked("compare", userId, { fileCount: 2 }, async () => {
      try {
        const left = await loadComparisonInput(userId, req.leftId, req.useCleaned);
        const right = await loadComparisonInput(userId, req.rightId, req.useCleaned);
        const result = buildResult(left, right, keyColumn);
        const id = saveComparison(userId, req.leftId, req.rightId, result);
        audit("compare.run", summaryLine(result), { actor: userId, fileId: req.leftId });
        return id;
      } catch (err) {
        if (err instanceof CompareError) throw new JobBlocked(err.message);
        throw err;
      }
    });
  } catch (err) {
    if (err instanceof JobBlocked) throw new CompareError("invalid", err.message);
    throw err;
  }
}

/** Pure part of a comparison: the engine call with the key check. Exported for tests. */
export function buildResult(left: ComparisonInput, right: ComparisonInput, keyColumn: string | null): CompareResult {
  if (keyColumn !== null && !sharedHeaders(left.table.headers, right.table.headers).includes(keyColumn)) {
    throw new CompareError("invalid", `"${keyColumn}" is not a column both files share.`);
  }
  return compareTables(left.table, right.table, {
    leftName: left.name,
    rightName: right.name,
    keyColumns: keyColumn !== null ? [keyColumn] : undefined,
  });
}

function requireOwnedPair(userId: string, leftId: string, rightId: string): void {
  if (!isValidId(leftId) || !isValidId(rightId)) throw new CompareError("not_found", FILE_NOT_FOUND);
  if (leftId === rightId) throw new CompareError("invalid", "Choose two different files to compare.");
  ownedFile(userId, leftId);
  ownedFile(userId, rightId);
}

function summaryLine(result: CompareResult): string {
  const c = result.counts;
  return `${result.leftName} vs ${result.rightName}: ${c.changed} changed, ${c.added} added, ${c.removed} removed`;
}
