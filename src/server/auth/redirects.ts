export const DEFAULT_AFTER_SIGN_IN = "/files";

/**
 * Returns `next` when it is a same-origin relative path, otherwise the default landing page.
 * Rejects absolute URLs, protocol-relative "//host", backslash tricks, and control characters.
 */
export function safeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return DEFAULT_AFTER_SIGN_IN;
  if (!next.startsWith("/")) return DEFAULT_AFTER_SIGN_IN;
  if (next.startsWith("//") || next.includes("\\")) return DEFAULT_AFTER_SIGN_IN;
  if (/[\u0000-\u001f\u007f]/.test(next)) return DEFAULT_AFTER_SIGN_IN;
  return next;
}
