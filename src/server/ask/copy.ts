/** User-facing text for Ask. No server imports, so client components can use it too. */

export const AI_OFF_MESSAGE = "AI is off. Turn it on in Settings to ask questions.";
export const NO_FILES_MESSAGE = "None of this chat's files are still available. Add a file to ask a question.";
export const FALLBACK_ANSWER = "Here are the results.";
export const NO_ROWS_NOTE = "The query returned no rows.";

/** Longest question accepted, in characters. */
export const QUESTION_MAX_LENGTH = 2000;
/** Rows of a result shown in the table. */
export const PREVIEW_ROWS = 50;
/** Rows a query may return; the CSV and the stored result hold at most this many. */
export const ASK_MAX_ROWS = 1000;
/** Budget for one query, loading the CSVs included. */
export const ASK_TIMEOUT_MS = 10_000;
/** Files in one chat. */
export const MAX_CHAT_FILES = 20;
