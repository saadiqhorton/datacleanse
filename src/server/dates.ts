/**
 * Date detection and parsing for CSV cells.
 *
 * parseDate runs over millions of cells, so every pattern is a module-level
 * regex and each call does only the work the input needs.
 */

export type DateOrder = "mdy" | "dmy";

/** m and d are 1-based. */
export interface DateParts {
  y: number;
  m: number;
  d: number;
}

export interface ParsedDate {
  parts: DateParts;
  /** Human layout label of the input, e.g. "YYYY-MM-DD", "MM/DD/YY", "DD/MM/YYYY", "D Mon YYYY", "Mon D, YYYY", "YYYY-MM-DDThh:mm" */
  layout: string;
  /** true when day and month could be swapped (both <= 12, numeric, not equal) */
  ambiguous: boolean;
}

/** YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, optionally followed by a time (T or space separated). */
const ISO_RE =
  /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?:([T ])(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/;
/** D/M/Y or M/D/Y with one consistent separator, 2 or 4 digit year. */
const NUM_RE = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4}|\d{2})$/;
/** "4 Mar 2022", "04-Mar-2022", "4 March 2022", "4 Mar, 2022" */
const DAY_FIRST_RE = /^(\d{1,2})[ \t-]+([A-Za-z]{3,9})\.?[ \t,-]+(\d{4}|\d{2})$/;
/** "Mar 4, 2022", "March 4 2022", "Mar 4 22" */
const MONTH_FIRST_RE = /^([A-Za-z]{3,9})\.?[ \t-]+(\d{1,2}),?[ \t-]+(\d{4}|\d{2})$/;

/** Lowercase accepted spellings per month (index 0 = January). */
const MONTH_NAMES: readonly (readonly string[])[] = [
  ["jan", "january"],
  ["feb", "february"],
  ["mar", "march"],
  ["apr", "april"],
  ["may"],
  ["jun", "june"],
  ["jul", "july"],
  ["aug", "august"],
  ["sep", "sept", "september"],
  ["oct", "october"],
  ["nov", "november"],
  ["dec", "december"],
];

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Result shared by parseDate, dateLayoutOf and the layout signature. */
interface Analysis {
  parts: DateParts;
  layout: string;
  sig: string;
  ambiguous: boolean;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const max = m === 2 && isLeap(y) ? 29 : DAYS_IN_MONTH[m - 1];
  return d <= max;
}

/** 00-69 -> 20xx, 70-99 -> 19xx. */
function pivotYear(yy: number): number {
  return yy <= 69 ? 2000 + yy : 1900 + yy;
}

function eqIgnoreCase(lower: string, s: string): boolean {
  for (let i = 0; i < lower.length; i++) {
    if ((s.charCodeAt(i) | 32) !== lower.charCodeAt(i)) return false;
  }
  return true;
}

/** 1-based month for an English month name, short or long, any case; 0 if unknown. */
function monthIndex(word: string): number {
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    for (const name of MONTH_NAMES[i]) {
      if (name.length === word.length && eqIgnoreCase(name, word)) return i + 1;
    }
  }
  return 0;
}

function fromIso(m: RegExpExecArray): Analysis | null {
  const y = Number(m[1]);
  const mo = Number(m[3]);
  const d = Number(m[4]);
  if (!validYmd(y, mo, d)) return null;
  const timeSep = m[5];
  if (timeSep !== undefined) {
    if (Number(m[6]) > 23 || Number(m[7]) > 59) return null;
    if (m[8] !== undefined && Number(m[8]) > 59) return null;
  }
  const sep = m[2];
  const dateLayout = "YYYY" + sep + "MM" + sep + "DD";
  const layout =
    timeSep === undefined ? dateLayout : dateLayout + (timeSep === "T" ? "Thh:mm" : " hh:mm");
  return { parts: { y, m: mo, d }, layout, sig: layout, ambiguous: false };
}

function fromNumeric(m: RegExpExecArray, order: DateOrder | "auto"): Analysis | null {
  const a = Number(m[1]);
  const b = Number(m[3]);
  const sep = m[2];
  const yStr = m[4];
  const y = yStr.length === 2 ? pivotYear(Number(yStr)) : Number(yStr);
  // Under "auto", a part above 12 settles the order; otherwise read month/day.
  const mdy = order === "mdy" || (order === "auto" && !(a > 12 && b <= 12));
  const mo = mdy ? a : b;
  const d = mdy ? b : a;
  if (!validYmd(y, mo, d)) return null;
  const yTok = yStr.length === 2 ? "YY" : "YYYY";
  const first = mdy ? "MM" : "DD";
  const second = mdy ? "DD" : "MM";
  return {
    parts: { y, m: mo, d },
    layout: first + sep + second + sep + yTok,
    sig: "NN" + sep + "NN" + sep + yTok,
    ambiguous: a <= 12 && b <= 12 && a !== b,
  };
}

function fromNamed(day: number, monthWord: string, yearStr: string, dayFirst: boolean): Analysis | null {
  const mo = monthIndex(monthWord);
  if (mo === 0) return null;
  const y = yearStr.length === 2 ? pivotYear(Number(yearStr)) : Number(yearStr);
  if (!validYmd(y, mo, day)) return null;
  const yTok = yearStr.length === 2 ? "YY" : "YYYY";
  const layout = dayFirst ? "D Mon " + yTok : "Mon D, " + yTok;
  return { parts: { y, m: mo, d: day }, layout, sig: layout, ambiguous: false };
}

/**
 * Full analysis of one value. With "auto", a numeric value is read as dmy only
 * when a part above 12 forces it; otherwise mdy (flagged ambiguous if swappable).
 */
function analyze(value: string, order: DateOrder | "auto"): Analysis | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s.length < 6 || s.length > 40) return null;
  const c0 = s.charCodeAt(0);
  if (c0 >= 48 && c0 <= 57) {
    const iso = ISO_RE.exec(s);
    if (iso !== null) return fromIso(iso);
    const num = NUM_RE.exec(s);
    if (num !== null) return fromNumeric(num, order);
    const dayFirst = DAY_FIRST_RE.exec(s);
    return dayFirst !== null ? fromNamed(Number(dayFirst[1]), dayFirst[2], dayFirst[3], true) : null;
  }
  const monthFirst = MONTH_FIRST_RE.exec(s);
  return monthFirst !== null ? fromNamed(Number(monthFirst[2]), monthFirst[1], monthFirst[3], false) : null;
}

/** Parse one value. With "auto", ambiguous numeric dates are read as mdy and flagged ambiguous. null if not a valid date. */
export function parseDate(value: string, order: DateOrder | "auto" = "auto"): ParsedDate | null {
  const norm = order === "mdy" || order === "dmy" ? order : "auto";
  const a = analyze(value, norm);
  if (a === null) return null;
  return { parts: a.parts, layout: a.layout, ambiguous: a.ambiguous };
}

/** Decide mdy vs dmy for a column from its values using unambiguous evidence (a part > 12). */
export function detectColumnOrder(values: string[]): { order: DateOrder; confidence: number; evidence: string } {
  let dmy = 0;
  let mdy = 0;
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const s = raw.trim();
    if (s.length < 6 || s.length > 40) continue;
    const m = NUM_RE.exec(s);
    if (m === null) continue;
    const a = Number(m[1]);
    const b = Number(m[3]);
    const y = m[4].length === 2 ? pivotYear(Number(m[4])) : Number(m[4]);
    if (a > 12 && b <= 12) {
      if (validYmd(y, b, a)) dmy++;
    } else if (b > 12 && a <= 12) {
      if (validYmd(y, a, b)) mdy++;
    }
  }

  const total = dmy + mdy;
  if (total === 0) {
    return { order: "mdy", confidence: 0.5, evidence: "No unambiguous dates; assumed month/day" };
  }

  const order: DateOrder = dmy > mdy ? "dmy" : "mdy";
  const majority = Math.max(dmy, mdy);
  const confidence = Math.round((majority / total) * 100) / 100;

  let evidence: string;
  if (dmy === 0 || mdy === 0) {
    const pos = order === "dmy" ? "first" : "second";
    evidence = `${majority} ${majority === 1 ? "date has" : "dates have"} a day above 12 in the ${pos} position`;
  } else {
    evidence =
      `${dmy} ${dmy === 1 ? "date" : "dates"} read day-first, ` +
      `${mdy} ${mdy === 1 ? "date" : "dates"} read month-first`;
  }
  return { order, confidence, evidence };
}

/** "2022-03-04" */
export function toIsoDate(p: DateParts): string {
  return `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Order-free layout signature used for profiling, e.g. "NN/NN/YY", "YYYY-MM-DD", "D Mon YYYY"; null if not a date. */
export function dateLayoutOf(value: string): string | null {
  const a = analyze(value, "auto");
  return a === null ? null : a.sig;
}
