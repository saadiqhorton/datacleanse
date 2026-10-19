import { compareToCsv } from "../compare";
import { CompareError, COMPARE_NOT_FOUND } from "./errors";
import { getComparisonForUser } from "./repo";
import { exportFileName } from "./view";

const UTF8_BOM = "﻿";

/** The diff as a UTF-8 CSV with a BOM so Excel reads accented names. Owner only. */
export function comparisonExport(userId: string, compareId: string): { filename: string; text: string } {
  const record = getComparisonForUser(userId, compareId);
  if (!record) throw new CompareError("not_found", COMPARE_NOT_FOUND);
  if (!record.result) throw new CompareError("gone", "The results of this comparison can no longer be read. Run it again.");
  return {
    filename: exportFileName(record.result.leftName, record.result.rightName),
    text: UTF8_BOM + compareToCsv(record.result),
  };
}
