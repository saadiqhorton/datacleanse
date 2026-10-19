import { dateLayoutOf, parseDate, toIsoDate } from "../dates";
import type { ColumnStats, FileProfileData, InferredType, Table } from "../types";

/** Exact distinct counting up to this many distinct values per column; beyond it the count is a lower bound. */
const MAX_DISTINCT = 1_000_000;
const TOP_VALUES = 10;
const TOP_VALUE_CHARS = 80;
const SAMPLE_ROWS = 20;
const MAX_DATE_FORMATS = 5;
/** Share of non-empty values that must match a type for the column to take it. */
const TYPE_THRESHOLD = 0.8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Digits with optional leading +, spaces, dashes, parens and an "x"/"ext" extension. Dots are not allowed. */
const PHONE_RE = /^\+?[\d\s()-]*\d[\d\s()-]*(?:(?:x|ext\.?)\s*\d{1,6})?$/i;
/** 1,234  1234  1,234.5  -0.25  .5 (thousands separators must be in groups of three). */
const NUMBER_RE = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?$/;
const BOOLEAN_WORDS = new Set(["true", "false", "yes", "no", "y", "n", "0", "1"]);
const PII_TOKENS = new Set([
  "name",
  "firstname",
  "lastname",
  "fullname",
  "address",
  "street",
  "ssn",
  "social",
  "dob",
  "birth",
  "birthdate",
  "passport",
]);
const PHONE_HEADER_TOKENS = new Set(["mobile", "cell", "tel", "telephone", "fax"]);

export function profileTable(
  table: Table,
): Pick<FileProfileData, "rowCount" | "columnCount" | "columns" | "sample"> {
  const columns = table.headers.map((name, c) => profileColumn(name, table.rows, c));
  return {
    rowCount: table.rows.length,
    columnCount: table.headers.length,
    columns,
    sample: sampleRows(table),
  };
}

/** Header tokens: "firstName" -> ["first", "name"], "date_of_birth" -> ["date", "of", "birth"]. */
function headerTokens(header: string): string[] {
  return header
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
}

function profileColumn(name: string, rows: string[][], c: number): ColumnStats {
  const tokens = headerTokens(name);
  const phoneHint = tokens.some((t) => t.startsWith("phone") || PHONE_HEADER_TOKENS.has(t));

  const counts = new Map<string, number>();
  let nullCount = 0;
  let nonEmpty = 0;
  let emailN = 0;
  let dateN = 0;
  let phoneN = 0;
  let intN = 0;
  let boolN = 0;
  let numberN = 0;
  const dateFormats: string[] = [];
  let numMin = Infinity;
  let numMinStr = "";
  let numMax = -Infinity;
  let numMaxStr = "";
  let dateMin = "";
  let dateMax = "";

  for (let r = 0; r < rows.length; r++) {
    const v = (rows[r][c] ?? "").trim();
    if (v.length === 0) {
      nullCount++;
      continue;
    }
    nonEmpty++;

    const prev = counts.get(v);
    if (prev !== undefined) counts.set(v, prev + 1);
    else if (counts.size < MAX_DISTINCT) counts.set(v, 1);

    // One cheap character scan decides which of the regexes below can possibly match.
    const len = v.length;
    let digits = 0;
    let letters = 0;
    let hasAt = false;
    for (let i = 0; i < len; i++) {
      const code = v.charCodeAt(i);
      if (code >= 48 && code <= 57) digits++;
      else if ((code | 32) >= 97 && (code | 32) <= 122) letters++;
      else if (code === 64) hasAt = true;
    }

    if (hasAt && len <= 254 && EMAIL_RE.test(v)) emailN++;

    // Every date form needs a separator, so an all-digit value cannot be a date.
    if (digits > 0 && digits < len && len >= 6 && len <= 40) {
      const layout = dateLayoutOf(v);
      if (layout !== null) {
        dateN++;
        if (dateFormats.length < MAX_DATE_FORMATS && !dateFormats.includes(layout)) dateFormats.push(layout);
        const parsed = parseDate(v);
        if (parsed !== null) {
          const iso = toIsoDate(parsed.parts);
          if (dateMin === "" || iso < dateMin) dateMin = iso;
          if (dateMax === "" || iso > dateMax) dateMax = iso;
        }
      }
    }

    // Plain digit runs are often IDs, so they count as phones only when the header says phone.
    if ((digits !== len || phoneHint) && digits >= 7 && digits <= 15 && len <= 25 && PHONE_RE.test(v)) {
      phoneN++;
    }

    const c0 = v.charCodeAt(0);
    const signed = c0 === 43 || c0 === 45; // + or -
    const isInt = digits === len || (signed && len > 1 && digits === len - 1);
    const isNumber = isInt || (letters === 0 && digits > 0 && len <= 40 && NUMBER_RE.test(v));
    if (isInt) intN++;
    if (isNumber) {
      numberN++;
      const n = Number(v.indexOf(",") >= 0 ? v.replace(/,/g, "") : v);
      if (!Number.isNaN(n)) {
        if (n < numMin) {
          numMin = n;
          numMinStr = v;
        }
        if (n > numMax) {
          numMax = n;
          numMaxStr = v;
        }
      }
    }

    if (len <= 5 && BOOLEAN_WORDS.has(v.toLowerCase())) boolN++;
  }

  const share = (n: number) => (nonEmpty === 0 ? 0 : n / nonEmpty);
  const piiHeader = tokens.some((t) => PII_TOKENS.has(t));

  let type: InferredType;
  let typeConfidence: number;
  if (nonEmpty === 0) {
    type = "empty";
    typeConfidence = 1;
  } else if (share(emailN) >= TYPE_THRESHOLD) {
    type = "email";
    typeConfidence = share(emailN);
  } else if (share(dateN) >= TYPE_THRESHOLD) {
    type = "date";
    typeConfidence = share(dateN);
  } else if (share(phoneN) >= TYPE_THRESHOLD) {
    type = "phone";
    typeConfidence = share(phoneN);
  } else if (share(intN) >= TYPE_THRESHOLD) {
    type = "integer";
    typeConfidence = share(intN);
  } else if (share(boolN) >= TYPE_THRESHOLD) {
    type = "boolean";
    typeConfidence = share(boolN);
  } else if (share(numberN) >= TYPE_THRESHOLD) {
    type = "number";
    typeConfidence = share(numberN);
  } else {
    // Every value is representable as a string, so the match share is 1 by definition.
    type = "string";
    typeConfidence = 1;
  }

  const stats: ColumnStats = {
    name,
    type,
    nullCount,
    distinctCount: counts.size,
    topValues: topValues(counts),
    typeConfidence,
    pii: type === "email" || type === "phone" || piiHeader,
  };
  if (type === "date") {
    stats.dateFormats = dateFormats;
    if (dateMin !== "") {
      stats.min = dateMin;
      stats.max = dateMax;
    }
  } else if ((type === "integer" || type === "number") && numMin !== Infinity) {
    stats.min = numMinStr;
    stats.max = numMaxStr;
  }
  return stats;
}

/** The TOP_VALUES most frequent values, most frequent first. Ties keep first-seen order. */
function topValues(counts: Map<string, number>): string[] {
  const top: [string, number][] = [];
  for (const entry of counts) {
    if (top.length < TOP_VALUES) {
      top.push(entry);
      continue;
    }
    let min = 0;
    for (let k = 1; k < top.length; k++) if (top[k][1] < top[min][1]) min = k;
    if (entry[1] > top[min][1]) top[min] = entry;
  }
  top.sort((a, b) => b[1] - a[1]);
  return top.map(([value]) => value.slice(0, TOP_VALUE_CHARS));
}

/** First rows as header -> raw value objects. defineProperty keeps headers like "__proto__" as plain keys. */
function sampleRows(table: Table): Record<string, string>[] {
  const count = Math.min(SAMPLE_ROWS, table.rows.length);
  const out: Record<string, string>[] = [];
  for (let r = 0; r < count; r++) {
    const obj: Record<string, string> = {};
    for (let c = 0; c < table.headers.length; c++) {
      Object.defineProperty(obj, table.headers[c], {
        value: table.rows[r][c] ?? "",
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    out.push(obj);
  }
  return out;
}
