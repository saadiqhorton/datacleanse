export type CsvErrorCode = "empty" | "not_utf8" | "binary" | "no_header" | "too_large" | "duplicate_headers";

/** Format an integer with thousands separators, e.g. 1204 -> "1,204". */
export function formatCount(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/** A file or its contents cannot be read as CSV. `message` is safe to show to the user. */
export class CsvError extends Error {
  readonly code: CsvErrorCode;
  /** 1-based physical line in the file, when the problem is at a specific line. */
  readonly line?: number;

  constructor(code: CsvErrorCode, message?: string, line?: number) {
    super(message ?? defaultMessage(code, line));
    this.name = "CsvError";
    this.code = code;
    this.line = line;
  }
}

function defaultMessage(code: CsvErrorCode, line?: number): string {
  switch (code) {
    case "empty":
      return "This file is empty.";
    case "not_utf8":
      return `Line ${formatCount(line ?? 1)} isn't valid UTF-8. Re-export from your tool as "CSV UTF-8" and try again.`;
    case "binary":
      return "This doesn't look like a CSV file.";
    case "no_header":
      return "The first row has no column names. Add a header row and try again.";
    case "too_large":
      return "This file is too large to process.";
    case "duplicate_headers":
      return "Some column names appear more than once. Rename them and try again.";
  }
}

/** Used by the reader when a file is over its size limit. */
export function tooLargeError(maxBytes: number): CsvError {
  return new CsvError("too_large", `This file is larger than the ${formatMegabytes(maxBytes)} limit.`);
}
