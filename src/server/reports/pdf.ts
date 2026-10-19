import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ProposedChange } from "../types";
import { formatCount, formatDateTimeUtc, formatTimeUtc } from "./format";
import { changeColumn, isApplied, ROWS_LABEL, type ChangeSummary } from "./summary";

export interface ReportPdfInput {
  fileName: string;
  approvedBy: string;
  appliedAt: Date;
  summary: ChangeSummary;
  activity: { at: Date; detail: string }[];
  changes: ProposedChange[];
}

/** Applied changes listed in the PDF. The full list is in the change log CSV. */
export const REPORT_PDF_CHANGE_LIMIT = 500;

type Color = ReturnType<typeof rgb>;
type Column = { title: string; width: number };

// US Letter, in points.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const WIDTH = PAGE_W - 2 * MARGIN;
/** Lowest y a content line may reach. The page footer sits below it. */
const FLOOR = MARGIN + 24;

const INK = rgb(0.043, 0.047, 0.055); // #0B0C0E
const MUTED = rgb(0.357, 0.38, 0.42); // #5B616B
const HAIR = rgb(0.933, 0.937, 0.945); // #EEEFF1
const BORDER = rgb(0.89, 0.898, 0.91); // #E3E5E8
const WHITE = rgb(1, 1, 1);

const BY_COLUMN_COLUMNS: Column[] = [
  { title: "Column", width: 150 },
  { title: "Issue", width: 196 },
  { title: "Fixed", width: 80 },
  { title: "Method", width: 90 },
];

const CHANGE_COLUMNS: Column[] = [
  { title: "Row", width: 40 },
  { title: "Column", width: 112 },
  { title: "Change", width: 214 },
  { title: "Reason", width: 150 },
];

/**
 * Makes text safe for pdf-lib's standard fonts (WinAnsi only). Each character is probed against the
 * font itself, so this never disagrees with the encoder and never throws. Arrows and middle dots get
 * ASCII stand-ins; anything else the font cannot draw is dropped; control characters become spaces.
 */
function makeCleaner(font: PDFFont): (text: string) => string {
  const drawable = new Map<string, boolean>();
  const canDraw = (ch: string): boolean => {
    let ok = drawable.get(ch);
    if (ok === undefined) {
      try {
        font.encodeText(ch);
        ok = true;
      } catch {
        ok = false;
      }
      drawable.set(ch, ok);
    }
    return ok;
  };

  return (text: string): string => {
    let out = "";
    for (const ch of text.normalize("NFC")) {
      const cp = ch.codePointAt(0) ?? 0;
      if (ch === "→") out += "->";
      else if (ch === "·") out += "-";
      else if (cp === 0x09 || cp === 0x0a || cp === 0x0d) out += " ";
      else if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) continue;
      else if (canDraw(ch)) out += ch;
    }
    return out.replace(/ {2,}/g, " ").replace(/^ +| +$/g, "");
  };
}

function safeTitle(text: string): string {
  return Array.from(text).slice(0, 200).join("");
}

/** Lays out the report top to bottom, breaking pages as needed. All text goes through `clean`. */
class Report {
  readonly pages: PDFPage[] = [];
  private page!: PDFPage;
  private y = 0;

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
    private readonly clean: (text: string) => string,
  ) {
    this.newPage();
  }

  build(input: ReportPdfInput): void {
    this.header(input);
    this.stats(input.summary);

    this.heading("By column");
    const byColumn = input.summary.byColumn.map((c) => [
      c.column,
      c.issue,
      `${formatCount(c.fixed)} / ${formatCount(c.total)}`,
      c.method,
    ]);
    this.table(BY_COLUMN_COLUMNS, byColumn.length > 0 ? byColumn : [["No value changes", "", "", ""]]);

    this.heading("Activity");
    if (input.activity.length === 0) {
      this.note("No activity recorded.");
    } else {
      this.activity(input.activity);
    }

    this.changes(input.changes);
  }

  footers(): void {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      this.page = page;
      const label = this.clean(`DataCleanse · Page ${i + 1} of ${total}`);
      const width = this.font.widthOfTextAtSize(label, 8);
      this.page.drawText(label, { x: PAGE_W - MARGIN - width, y: 28, size: 8, font: this.font, color: MUTED });
    });
  }

  private newPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN;
  }

  /** Starts a new page when `h` points no longer fit. Returns true when it did. */
  private room(h: number): boolean {
    if (this.y - h >= FLOOR) return false;
    this.newPage();
    return true;
  }

  /** Shortens `text` with an ellipsis until it fits `maxW`. */
  private fit(text: string, font: PDFFont, size: number, maxW: number): string {
    if (font.widthOfTextAtSize(text, size) <= maxW) return text;
    const ellipsis = "…";
    if (font.widthOfTextAtSize(ellipsis, size) > maxW) return "";
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (font.widthOfTextAtSize(text.slice(0, mid) + ellipsis, size) <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return text.slice(0, lo).replace(/\s+$/, "") + ellipsis;
  }

  /** Greedy word wrap. A single word wider than `maxW` is truncated. */
  private wrap(raw: string, font: PDFFont, size: number, maxW: number): string[] {
    const lines: string[] = [];
    let current = "";
    for (const word of this.clean(raw).split(" ")) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxW) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      current = this.fit(word, font, size, maxW);
    }
    lines.push(current);
    return lines;
  }

  /** One line of text whose baseline is `baseline`. Nothing is advanced. */
  private draw(raw: string, x: number, baseline: number, size: number, font: PDFFont, color: Color, maxW: number): void {
    const text = this.fit(this.clean(raw), font, size, maxW);
    if (text.length > 0) this.page.drawText(text, { x, y: baseline, size, font, color });
  }

  private rule(y: number, color: Color): void {
    this.page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: 0.75, color });
  }

  private header(input: ReportPdfInput): void {
    this.doc.setTitle(safeTitle(`Change report - ${input.fileName}`));
    this.doc.setAuthor("DataCleanse");
    this.doc.setCreator("DataCleanse");

    this.room(40);
    this.draw("Change report", MARGIN, this.y - 26, 26, this.bold, INK, WIDTH);
    this.y -= 36;

    const subtitle = `${input.fileName} · Approved by ${input.approvedBy} · ${formatDateTimeUtc(input.appliedAt)}`;
    for (const line of this.wrap(subtitle, this.font, 10.5, WIDTH)) {
      this.room(16);
      this.draw(line, MARGIN, this.y - 11, 10.5, this.font, MUTED, WIDTH);
      this.y -= 16;
    }
    this.y -= 18;
  }

  private stats(s: ChangeSummary): void {
    const items: [string, number][] = [
      ["Applied", s.applied],
      ["Skipped", s.skipped],
      ["Rows removed", s.rowsRemoved],
      ["Rows out", s.rowsOut],
    ];
    const gap = 12;
    const w = (WIDTH - gap * (items.length - 1)) / items.length;
    const h = 60;

    this.room(h + 24);
    items.forEach(([label, value], i) => {
      const x = MARGIN + i * (w + gap);
      this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, color: WHITE, borderColor: BORDER, borderWidth: 0.8 });
      this.draw(label.toUpperCase(), x + 14, this.y - 20, 7.5, this.bold, MUTED, w - 28);
      this.draw(formatCount(value), x + 14, this.y - 46, 20, this.bold, INK, w - 28);
    });
    this.y -= h + 24;
  }

  private heading(text: string): void {
    this.room(40);
    this.draw(text, MARGIN, this.y - 15, 14, this.bold, INK, WIDTH);
    this.y -= 26;
  }

  private note(text: string): void {
    for (const line of this.wrap(text, this.font, 9.5, WIDTH)) {
      this.room(14);
      this.draw(line, MARGIN, this.y - 11, 9.5, this.font, MUTED, WIDTH);
      this.y -= 14;
    }
    this.y -= 6;
  }

  private table(columns: Column[], rows: string[][]): void {
    const HEAD = 24;
    const ROW = 22;
    const PAD = 8;

    const drawHead = () => {
      let x = MARGIN;
      for (const col of columns) {
        this.draw(col.title.toUpperCase(), x + PAD, this.y - 15, 7.5, this.bold, MUTED, col.width - 2 * PAD);
        x += col.width;
      }
      this.rule(this.y - HEAD, BORDER);
      this.y -= HEAD;
    };

    this.room(HEAD + ROW);
    drawHead();
    for (const row of rows) {
      if (this.room(ROW)) drawHead();
      let x = MARGIN;
      columns.forEach((col, i) => {
        this.draw(row[i] ?? "", x + PAD, this.y - 15, 9.5, this.font, INK, col.width - 2 * PAD);
        x += col.width;
      });
      this.rule(this.y - ROW, HAIR);
      this.y -= ROW;
    }
    this.y -= 14;
  }

  private activity(items: { at: Date; detail: string }[]): void {
    const TIME_W = 56;
    for (const item of items) {
      const lines = this.wrap(item.detail, this.font, 10, WIDTH - TIME_W);
      lines.forEach((line, i) => {
        this.room(14);
        if (i === 0) this.draw(formatTimeUtc(item.at), MARGIN, this.y - 11, 8.5, this.font, MUTED, TIME_W - 6);
        this.draw(line, MARGIN + TIME_W, this.y - 11, 10, this.font, INK, WIDTH - TIME_W);
        this.y -= 14;
      });
      this.y -= 4;
    }
    this.y -= 14;
  }

  private changes(changes: ProposedChange[]): void {
    const applied = changes.filter(isApplied);
    const listed = applied.slice(0, REPORT_PDF_CHANGE_LIMIT);

    this.heading("Changes");
    if (applied.length === 0) {
      this.note("No changes were applied.");
      return;
    }
    this.note("Applied value and merge changes. Row numbers match the change log CSV.");
    this.table(
      CHANGE_COLUMNS,
      listed.map((c) => [String(c.rowIndex + 2), changeColumn(c) || ROWS_LABEL, changeText(c), c.reason]),
    );
    if (applied.length > listed.length) {
      this.note(`…and ${formatCount(applied.length - listed.length)} more — see the change log CSV`);
    }
  }
}

function changeText(c: ProposedChange): string {
  if (c.kind === "merge") {
    return c.mergeIntoRow === undefined
      ? "Row removed as duplicate"
      : `Row removed as duplicate of row ${c.mergeIntoRow + 2}`;
  }
  return `${c.before || "(empty)"} -> ${c.after || "(empty)"}`;
}

/**
 * The change report as a US Letter PDF (Helvetica, WinAnsi-safe text). Lists up to
 * REPORT_PDF_CHANGE_LIMIT applied changes; the rest are referred to the change log CSV.
 */
export async function reportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const report = new Report(doc, font, bold, makeCleaner(font));
  report.build(input);
  report.footers();
  return doc.save();
}
