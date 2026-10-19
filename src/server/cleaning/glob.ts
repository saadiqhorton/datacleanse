/**
 * Case-insensitive glob matching for column headers.
 *
 * `*` matches any run of characters (including none), `?` matches exactly one,
 * and a backslash makes the next character literal. A pattern without wildcards
 * is an exact, case-insensitive match. Compiled patterns are cached.
 */

const MAX_CACHED = 256;
const cache = new Map<string, RegExp>();

/** Escape one character for use inside a RegExp source. */
function escapeChar(ch: string): string {
  return /[.*+?^${}()|[\]\\/]/.test(ch) ? "\\" + ch : ch;
}

function compile(pattern: string): RegExp {
  const hit = cache.get(pattern);
  if (hit !== undefined) return hit;

  let src = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      i++;
      src += escapeChar(pattern[i]);
    } else if (ch === "*") {
      src += "[\\s\\S]*";
    } else if (ch === "?") {
      src += "[\\s\\S]";
    } else {
      src += escapeChar(ch);
    }
  }

  const re = new RegExp("^" + src + "$", "i");
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(pattern, re);
  return re;
}

/** True when `header` matches `pattern`. "*" matches every header. */
export function globMatch(pattern: string, header: string): boolean {
  if (pattern === "*") return true;
  return compile(pattern).test(header);
}

/** A pattern that matches exactly this header name (wildcards and backslashes escaped). */
export function exactGlob(name: string): string {
  return name.replace(/[*?\\]/g, "\\$&");
}
