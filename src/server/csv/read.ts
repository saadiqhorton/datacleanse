import { readFile, stat } from "node:fs/promises";
import Papa from "papaparse";
import { env } from "../env";
import type { FileProfileData, Table } from "../types";
import { CsvError, formatCount, tooLargeError } from "./errors";

export type CsvDelimiter = FileProfileData["delimiter"];
export type CsvEncoding = FileProfileData["encoding"];

export interface CsvReadOptions {
  /** Files larger than this are rejected with too_large. Defaults to env.maxUploadBytes. */
  maxBytes?: number;
  /** Reject duplicate header names with duplicate_headers instead of renaming them. */
  strictHeaders?: boolean;
}

export interface CsvReadResult {
  table: Table;
  delimiter: CsvDelimiter;
  encoding: CsvEncoding;
  /** User-facing notes about repairs made while reading (renamed headers, padded rows...). */
  warnings: string[];
}

const BINARY_SCAN_BYTES = 64 * 1024;
const DELIMITER_SAMPLE_CHARS = 64 * 1024;
const DELIMITER_SAMPLE_LINES = 20;
const DELIMITERS: readonly CsvDelimiter[] = [",", "\t", ";", "|"];
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });

/** Read a CSV file from disk. Throws CsvError for anything that is not usable CSV. */
export async function readCsvFile(absPath: string, opts: CsvReadOptions = {}): Promise<CsvReadResult> {
  const maxBytes = opts.maxBytes ?? env.maxUploadBytes;
  // Check the size before reading so an oversized upload is never loaded into memory.
  const info = await stat(absPath);
  if (info.size > maxBytes) throw tooLargeError(maxBytes);
  const bytes = await readFile(absPath);
  if (bytes.length > maxBytes) throw tooLargeError(maxBytes);
  return parseCsvBytes(bytes, opts);
}

/** Parse CSV text that is already a string (uploads, tests). Same rules as readCsvFile. */
export function parseCsvText(text: string, opts: CsvReadOptions = {}): CsvReadResult {
  const maxBytes = opts.maxBytes ?? env.maxUploadBytes;
  if (text.length > 0 && Buffer.byteLength(text, "utf8") > maxBytes) throw tooLargeError(maxBytes);
  if (text.length === 0) throw new CsvError("empty");
  const head = text.slice(0, BINARY_SCAN_BYTES);
  if (head.includes("\0")) throw new CsvError("binary");
  const hasBom = text.charCodeAt(0) === 0xfeff;
  return parseDecoded(hasBom ? text.slice(1) : text, hasBom ? "utf-8-bom" : "utf-8", opts);
}

function parseCsvBytes(bytes: Buffer, opts: CsvReadOptions): CsvReadResult {
  if (bytes.length === 0) throw new CsvError("empty");
  if (bytes.subarray(0, BINARY_SCAN_BYTES).includes(0)) throw new CsvError("binary");

  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hasBom ? bytes.subarray(3) : bytes;
  let text: string;
  try {
    text = UTF8_FATAL.decode(body);
  } catch {
    const offset = firstInvalidUtf8(body);
    throw new CsvError("not_utf8", undefined, lineOfOffset(body, offset));
  }
  return parseDecoded(text, hasBom ? "utf-8-bom" : "utf-8", opts);
}

/** Byte offset where the first invalid UTF-8 sequence starts, or -1 when the input is valid. */
function firstInvalidUtf8(buf: Uint8Array): number {
  const n = buf.length;
  let i = 0;
  while (i < n) {
    const b = buf[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    let extra: number;
    // Bounds of the first continuation byte; later ones are always 80-BF.
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) extra = 1;
    else if (b === 0xe0) {
      extra = 2;
      lo = 0xa0;
    } else if (b >= 0xe1 && b <= 0xec) extra = 2;
    else if (b === 0xed) {
      extra = 2;
      hi = 0x9f;
    } else if (b >= 0xee && b <= 0xef) extra = 2;
    else if (b === 0xf0) {
      extra = 3;
      lo = 0x90;
    } else if (b >= 0xf1 && b <= 0xf3) extra = 3;
    else if (b === 0xf4) {
      extra = 3;
      hi = 0x8f;
    } else return i;

    for (let k = 1; k <= extra; k++) {
      const c = buf[i + k];
      const min = k === 1 ? lo : 0x80;
      const max = k === 1 ? hi : 0xbf;
      if (c === undefined || c < min || c > max) return i;
    }
    i += extra + 1;
  }
  return -1;
}

/** 1-based line of a byte offset. Counts LF, and CR not followed by LF. */
function lineOfOffset(buf: Uint8Array, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (buf[i] === 0x0a) line++;
    else if (buf[i] === 0x0d && buf[i + 1] !== 0x0a) line++;
  }
  return line;
}

function isBlank(s: string): boolean {
  return s.trim() === "";
}

/**
 * Pick the delimiter whose field count is most consistent over the first lines.
 * Quoted delimiters are respected because papaparse does the splitting.
 */
function detectDelimiter(text: string): CsvDelimiter {
  const truncated = text.length > DELIMITER_SAMPLE_CHARS;
  const sample = truncated ? text.slice(0, DELIMITER_SAMPLE_CHARS) : text;

  let best: CsvDelimiter = ",";
  let bestShare = 0;
  let bestMode = 0;
  for (const delimiter of DELIMITERS) {
    const records = Papa.parse<string[]>(sample, { delimiter }).data;
    // The last record of a truncated sample may be cut mid-field, so it does not count.
    if (truncated) records.pop();
    const counts: number[] = [];
    for (const rec of records) {
      if (rec.length === 1 && isBlank(rec[0])) continue;
      counts.push(rec.length);
      if (counts.length === DELIMITER_SAMPLE_LINES) break;
    }
    if (counts.length === 0) continue;

    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    let mode = 0;
    let modeFreq = 0;
    for (const [count, f] of freq) {
      if (f > modeFreq || (f === modeFreq && count > mode)) {
        mode = count;
        modeFreq = f;
      }
    }
    if (mode < 2) continue; // a delimiter that never splits the lines is not a delimiter

    const share = modeFreq / counts.length;
    if (share > bestShare || (share === bestShare && mode > bestMode)) {
      best = delimiter;
      bestShare = share;
      bestMode = mode;
    }
  }
  return best;
}

/** Give every name a unique spelling: "email", "email_2", "email_3". */
function makeUnique(names: string[]): { headers: string[]; renamed: [string, string][] } {
  const used = new Set<string>();
  const headers: string[] = [];
  const renamed: [string, string][] = [];
  for (const name of names) {
    let candidate = name;
    if (used.has(name)) {
      let k = 2;
      while (used.has(`${name}_${k}`)) k++;
      candidate = `${name}_${k}`;
      renamed.push([name, candidate]);
    }
    used.add(candidate);
    headers.push(candidate);
  }
  return { headers, renamed };
}

function parseDecoded(text: string, encoding: CsvEncoding, opts: CsvReadOptions): CsvReadResult {
  const warnings: string[] = [];
  const delimiter = detectDelimiter(text);
  const parsed = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false });
  if (parsed.errors.some((e) => e.type === "Quotes")) {
    warnings.push("Some quoted values were not closed properly. Check those rows after cleaning.");
  }

  // Auto newline detection can leave a stray CR on the last field of a mixed CRLF/LF file.
  const records: string[][] = [];
  for (const rec of parsed.data) {
    const last = rec.length - 1;
    if (last >= 0 && rec[last].endsWith("\r")) rec[last] = rec[last].slice(0, -1);
    if (rec.length === 1 && isBlank(rec[0])) continue; // blank line
    records.push(rec);
  }

  if (records.length === 0 || !records.some((r) => r.some((c) => !isBlank(c)))) {
    throw new CsvError("empty");
  }
  const headerRow = records[0];
  if (headerRow.every(isBlank)) throw new CsvError("no_header");

  const rawHeaders = headerRow.map((h) => h.trim());
  if (opts.strictHeaders) {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const h of rawHeaders) {
      if (h === "") continue;
      if (seen.has(h)) dupes.add(h);
      seen.add(h);
    }
    if (dupes.size > 0) {
      const list = [...dupes].map((d) => `"${d}"`).join(", ");
      throw new CsvError(
        "duplicate_headers",
        `These column names appear more than once: ${list}. Rename them and try again.`,
      );
    }
  }

  // Data rows: drop fully blank rows, and find the widest row once trailing blanks are ignored.
  const headerWidth = rawHeaders.length;
  let width = headerWidth;
  let longRows = 0;
  let shortRows = 0;
  const data: string[][] = [];
  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    if (rec.every(isBlank)) continue;
    let eff = rec.length;
    while (eff > headerWidth && isBlank(rec[eff - 1])) eff--;
    if (eff > headerWidth) longRows++;
    if (eff < headerWidth) shortRows++;
    if (eff > width) width = eff;
    data.push(rec);
  }

  const names: string[] = [];
  const unnamed: string[] = [];
  for (let i = 0; i < width; i++) {
    if (i < headerWidth) {
      if (rawHeaders[i] === "") {
        const generated = `column_${i + 1}`;
        unnamed.push(generated);
        names.push(generated);
      } else {
        names.push(rawHeaders[i]);
      }
    } else {
      names.push(`column_${i + 1}`);
    }
  }
  const { headers, renamed } = makeUnique(names);

  if (unnamed.length > 0) {
    warnings.push(`Unnamed columns were given names: ${unnamed.join(", ")}.`);
  }
  if (renamed.length > 0) {
    const list = renamed.map(([from, to]) => `"${from}" is now "${to}"`).join("; ");
    warnings.push(`Duplicate column names were made unique: ${list}.`);
  }
  if (longRows > 0) {
    const extra = headers.slice(headerWidth);
    warnings.push(
      `${formatCount(longRows)} ${longRows === 1 ? "row had" : "rows had"} more values than the header. ` +
        `Extra values were kept in new columns: ${extra.join(", ")}.`,
    );
  }
  if (shortRows > 0) {
    warnings.push(
      `${formatCount(shortRows)} ${shortRows === 1 ? "row had" : "rows had"} fewer values than the header and were padded with blanks.`,
    );
  }

  const rows = new Array<string[]>(data.length);
  for (let r = 0; r < data.length; r++) {
    const rec = data[r];
    const out = new Array<string>(width);
    for (let c = 0; c < width; c++) out[c] = c < rec.length ? rec[c] : "";
    rows[r] = out;
  }

  return { table: { headers, rows }, delimiter, encoding, warnings };
}
