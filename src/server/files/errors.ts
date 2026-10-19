export type FileErrorCode = "invalid" | "not_found" | "conflict" | "too_large" | "unsupported" | "gone";

/** A file operation failed for a reason that is safe to show to the user. */
export class FileError extends Error {
  readonly code: FileErrorCode;
  constructor(code: FileErrorCode, message: string) {
    super(message);
    this.name = "FileError";
    this.code = code;
  }
}

export const NOT_FOUND_MESSAGE = "File not found.";
