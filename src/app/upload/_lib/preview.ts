import Papa from "papaparse";
import { formatCount } from "./format";

/** How much of the file the browser reads for the preview. */
export const SAMPLE_BYTES = 2048;
export const PREVIEW_ROWS = 5;
export const PREVIEW_COLUMNS = 6;

export type Delimiter = "," | "\t" | ";" | "|";
const DELIMITERS: readonly Delimiter[] = [",", "\t", ";", "|"];
const DELIMITER_NAMES: Record<Delimiter, string> = {
  ",": "comma-separated",
  "\t": "tab-separated",
  ";": "semicolon-separated",
  "|": "pipe-separated",
};

const DETECTION_RECORDS = 20;

export interface CsvPreview {
  delimiter: Delimiter;
  delimiterName: string;
  encoding: "UTF-8" | "UTF-8 with BOM";
  /** Headers of the first PREVIEW_COLUMNS columns. */
  headers: string[];
  /** Up to PREVIEW_ROWS data rows, each padded to headers.length. */
  rows: string[][];
  columnCount: number;
  /** Exact when the whole file was read, otherwise estimated from the average record length. */
  rowCount: { value: number; exact: boolean };
}

export type PreviewResult = { ok: true; preview: CsvPreview } | { ok: false; message: string };

/** Human text for the meta line: "~4,800 rows" or "1 row". */
export function rowCountLabel(rowCount: { value: number; exact: boolean }): string {
  const n = formatCount(rowCount.value);
  if (rowCount.exact) return rowCount.value === 1 ? "1 row" : `${n} rows`;
  return `~${n} rows`;
}

/**
 * Parses the first bytes of a CSV file for the upload preview. Mirrors the server's rules where they
 * affect what the user sees: UTF-8 only (with or without BOM), no NUL bytes, delimiter chosen by
 * the most consistent field count. Problems come back as a message; this never throws.
 *
 * `sample` is the file's first bytes; `fileSize` is the whole file's size.
 */
export function parseSample(sample: Uint8Array, fileSize: number): PreviewResult {
  if (sample.length === 0) return { ok: false, message: "The file is empty." };
  if (sample.includes(0)) return { ok: false, message: "This looks like a binary file, not CSV text." };

  const whole = fileSize <= sample.length;
  const hasBom = sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf;
  let body = hasBom ? sample.subarray(3) : sample;

  if (!whole) {
    // Cut the sample after its last line break so a row cut in half is never parsed.
    const lastBreak = body.lastIndexOf(0x0a);
    if (lastBreak < 0) return { ok: false, message: "The first line is too long to preview." };
    body = body.subarray(0, lastBreak + 1);
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return { ok: false, message: "This file is not UTF-8. Save it as UTF-8 before uploading." };
  }

  const delimiter = detectDelimiter(text);
  const records = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false }).data.filter(
    (r) => !(r.length === 1 && r[0] === ""),
  );
  if (records.length === 0) return { ok: false, message: "No rows found." };

  const header = records[0];
  const data = records.slice(1);
  const width = Math.max(header.length, ...data.slice(0, PREVIEW_ROWS).map((r) => r.length));
  const shown = Math.min(width, PREVIEW_COLUMNS);

  const rowCount = whole
    ? { value: data.length, exact: true }
    : { value: estimateRows(fileSize, body.length, records.length), exact: false };

  return {
    ok: true,
    preview: {
      delimiter,
      delimiterName: DELIMITER_NAMES[delimiter],
      encoding: hasBom ? "UTF-8 with BOM" : "UTF-8",
      headers: padTo(header, shown),
      rows: data.slice(0, PREVIEW_ROWS).map((r) => padTo(r, shown)),
      columnCount: width,
      rowCount,
    },
  };
}

/** The delimiter whose field count agrees most often over the first records. Ties keep the earlier one. */
export function detectDelimiter(text: string): Delimiter {
  let best: Delimiter = ",";
  let bestAgree = 0;
  for (const delimiter of DELIMITERS) {
    const counts = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: true, preview: DETECTION_RECORDS }).data.map(
      (r) => r.length,
    );
    if (counts.length === 0) continue;
    const tally = new Map<number, number>();
    for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1);
    let mode = 0;
    let agree = 0;
    for (const [count, n] of tally) {
      if (n > agree || (n === agree && count > mode)) {
        mode = count;
        agree = n;
      }
    }
    // A delimiter that never splits the lines is not a delimiter.
    if (mode < 2) continue;
    if (agree > bestAgree) {
      best = delimiter;
      bestAgree = agree;
    }
  }
  return best;
}

/** Rows in the whole file, from the bytes per record in the sample. The header is not a row. */
function estimateRows(fileSize: number, sampleBodyBytes: number, sampleRecords: number): number {
  const bytesPerRecord = sampleBodyBytes / sampleRecords;
  return Math.max(0, Math.round(fileSize / bytesPerRecord) - 1);
}

function padTo(cells: string[], width: number): string[] {
  const out = cells.slice(0, width);
  while (out.length < width) out.push("");
  return out;
}
