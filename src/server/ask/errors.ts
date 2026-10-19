export type AskErrorCode = "not_found" | "invalid" | "conflict";

/** An expected failure that is safe to show to the user. */
export class AskError extends Error {
  readonly code: AskErrorCode;
  constructor(code: AskErrorCode, message: string) {
    super(message);
    this.name = "AskError";
    this.code = code;
  }
}

export const CHAT_NOT_FOUND = "That chat could not be found.";
export const MESSAGE_NOT_FOUND = "That answer could not be found. Refresh the page and try again.";
