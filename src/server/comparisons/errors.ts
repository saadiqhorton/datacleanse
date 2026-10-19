export type CompareErrorCode = "invalid" | "not_found" | "gone";

/** A comparison operation failed for a reason that is safe to show to the user. */
export class CompareError extends Error {
  readonly code: CompareErrorCode;
  constructor(code: CompareErrorCode, message: string) {
    super(message);
    this.name = "CompareError";
    this.code = code;
  }
}

export const COMPARE_NOT_FOUND = "Comparison not found.";
export const FILE_NOT_FOUND = "File not found.";
