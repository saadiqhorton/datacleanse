/**
 * Ask-your-data types. Safe to import from client components (no server imports here).
 */

export type MessageStatus = "needs_confirmation" | "running" | "done" | "failed" | "blocked";

/** One pair of columns to join on. matchRate is null when it was not measured for this pair. */
export interface JoinPair {
  left: { alias: string; column: string };
  right: { alias: string; column: string };
  matchRate: number | null;
}

/**
 * Stored in chat_messages.joins_json. `question` is what the user asked (planning adds a join hint
 * to it, but the original text is kept here). `tables` are the sorted aliases the plan was made for,
 * so a confirmation only carries over to a chat with the same files. `confirmed` is set when the
 * user clicks "Use these joins".
 */
export interface JoinsState {
  question: string;
  tables: string[];
  joins: JoinPair[];
  candidates: JoinPair[];
  confirmed: boolean;
}

/** Stored in chat_messages.result_json. */
export interface AskResult {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  rowsScanned: number;
  ms: number;
  truncated: boolean;
  /** Plain-language checks shown under the answer, e.g. unmatched rows left out. */
  notes: string[];
}

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  sql: string | null;
  joins: JoinsState | null;
  result: AskResult | null;
  createdAt: number;
}

/** A chat's file as the UI shows it. `source` is null when the file is skipped. */
export interface ChatFileView {
  fileId: string;
  name: string;
  alias: string;
  rows: number | null;
  columns: number | null;
  source: "cleaned" | "original" | null;
  /** Why the file is not used, e.g. "Deleted". */
  skipNote: string | null;
}

export interface AskableFile {
  id: string;
  name: string;
  alias: string;
  rows: number | null;
  columns: number | null;
  cleaned: boolean;
}
