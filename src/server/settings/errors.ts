import type { z } from "zod";

/** Expected failure with a message that is safe to show to the person who made the request. */
export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

/** First validation message from a zod error, for showing next to a field. */
export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Check the values and try again.";
}

/** SQLite UNIQUE constraint failure, e.g. a duplicate email. */
export function isUniqueViolation(err: unknown, column: string): boolean {
  return err instanceof Error && err.message.includes(`UNIQUE constraint failed: ${column}`);
}
