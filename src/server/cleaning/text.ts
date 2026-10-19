/**
 * Text helpers for the cleaning rules. All functions are pure.
 */

const BLANK_RUN_ALL = /[ \t]{2,}/g;
const TRAILING_PUNCT = /[.,\s]+$/;

/** Words that are always written in capitals when they appear as whole words. */
const KNOWN_ACRONYMS = new Set([
  "AI", "API", "BBC", "CEO", "CFO", "COO", "EU", "IBM", "LLC", "LLP", "NASA", "NYC", "PLC", "UK", "USA",
]);

/** Lowercase when not the first word of a value. */
const MINOR_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with",
]);

/** One name part that is already well cased: "Acme", "McDonald", "iPhone", "O", "DeWitt". */
const PROPER_PART = /^[a-z]?[A-Z][a-z]*(?:[A-Z][a-z]+)*$/;

/** Lowercase, non-alphanumeric runs to "_": "First Name" -> "first_name". */
export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Trim, then collapse runs of spaces and tabs to a single space. */
export function trimWhitespace(value: string): string {
  const t = value.trim();
  return t.indexOf("  ") === -1 && t.indexOf("\t") === -1 ? t : t.replace(BLANK_RUN_ALL, " ");
}

/** Letters, spaces and punctuation only: no digits, '@', '/', ':', '\\' or '_'. */
export function isNameLike(value: string): boolean {
  return !/[\d@/:\\_]/.test(value);
}

/**
 * Title case for names and companies. Trims and collapses spaces, strips trailing
 * "." and "," from name-like values, keeps known acronyms and short all-caps
 * tokens (IBM, LLC) in mixed-case input, keeps well-formed mixed-case words
 * (McDonald, iPhone) untouched, and handles O'Brien, Jean-Luc and Mc prefixes.
 */
export function titleCase(input: string): string {
  let s = trimWhitespace(input);
  if (s === "") return "";
  if (isNameLike(s)) {
    const stripped = s.replace(TRAILING_PUNCT, "");
    if (stripped !== "") s = stripped;
  }
  const valueHasLower = /[a-z]/.test(s);
  const words = s.split(" ");
  for (let i = 0; i < words.length; i++) {
    words[i] = titleWord(words[i], i, valueHasLower);
  }
  return words.join(" ");
}

function titleWord(word: string, index: number, valueHasLower: boolean): string {
  if (word === "" || /\d/.test(word)) return word;
  const lower = word.toLowerCase();
  const upper = word.toUpperCase();
  const allCaps = word === upper;
  if (KNOWN_ACRONYMS.has(upper)) return upper;
  if (index > 0 && MINOR_WORDS.has(lower) && (word === lower || allCaps)) return lower;
  if (allCaps) {
    // Short all-caps tokens stay only when the rest of the value is mixed case ("ACME Corp").
    return valueHasLower && /^[A-Z]{2,4}$/.test(word) ? word : capitalizeWord(lower);
  }
  if (word.split(/['-]/).every((part) => part === "" || PROPER_PART.test(part))) return word;
  return capitalizeWord(lower);
}

function capFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Capitalize a lowercase word: each hyphen part starts with a capital, and an apostrophe
 * capitalizes the letter after it only after a 1-2 letter prefix (O'Brien, D'Angelo).
 * Possessives ("mcdonald's") keep a lowercase "s". Mc surnames get a capital after "Mc".
 */
function capitalizeWord(lower: string): string {
  let out = lower
    .split("-")
    .map((seg) => {
      const apos = seg.indexOf("'");
      if (apos >= 1 && apos <= 2 && apos < seg.length - 1) {
        return capFirst(seg.slice(0, apos)) + "'" + capFirst(seg.slice(apos + 1));
      }
      return capFirst(seg);
    })
    .join("-");
  if (/^mc[a-z]/.test(lower)) {
    out = out.slice(0, 2) + out.charAt(2).toUpperCase() + out.slice(3);
  }
  return out;
}

/**
 * Optimal-string-alignment edit distance (Damerau-Levenshtein with adjacent
 * transpositions). Returns `max + 1` when the true distance is above `max`.
 */
export function editDistance(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0 || lb === 0) {
    const d = Math.max(la, lb);
    return d <= max ? d : max + 1;
  }

  let prev2 = new Int32Array(lb + 1);
  let prev = new Int32Array(lb + 1);
  let cur = new Int32Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      if (ins < v) v = ins;
      const sub = prev[j - 1] + (ca === cb ? 0 : 1);
      if (sub < v) v = sub;
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) {
        const tr = prev2[j - 2] + 1;
        if (tr < v) v = tr;
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const spare = prev2;
    prev2 = prev;
    prev = cur;
    cur = spare;
  }
  return prev[lb] <= max ? prev[lb] : max + 1;
}
