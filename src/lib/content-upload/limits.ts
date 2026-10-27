// Limits of the reading and of the excerpt (docs/ki-upload-konzept.md, 5.4).
// A file above a limit ends as rejected or failed with a code, never as an
// abort of the run.

export const READ_LIMITS = Object.freeze({
  /** Input of one file, in bytes. */
  maxInputBytes: 25 * 1024 * 1024,
  /** Unpacked word/document.xml, in bytes. */
  maxXmlBytes: 16 * 1024 * 1024,
  /** Entries of a zip. */
  maxEntries: 2000,
  /** Paragraphs of a Word file (a source file has up to 650). */
  maxParagraphs: 50000,
  /** Pages of a PDF. */
  maxPdfPages: 300,
  /** Characters of the text of a file. */
  maxTextChars: 2 * 1024 * 1024,
  /** A PDF with less readable characters is taken for a scan. */
  minPdfChars: 50,
  /** Time the PDF reader may take, in milliseconds. */
  pdfTimeoutMs: 20000,
  /** Memory of the PDF reader thread, in megabytes. */
  pdfMemoryMb: 256,
});

/** Largest excerpt that may leave the platform, in characters. */
export const EXCERPT_MAX_CHARS = 2500;

/**
 * Limits of the reading of an Excel file (package UP2). A mapping table has a few hundred
 * rows in the columns A to E, so the limits are far below what a workbook of that kind
 * needs. A file above a limit ends as rejected with a code, never as an abort of the run.
 */
export const XLSX_LIMITS = Object.freeze({
  /** Input of one file, in bytes. */
  maxInputBytes: 5 * 1024 * 1024,
  /** Entries of the zip (a workbook of a table has about ten). */
  maxEntries: 200,
  /** One unpacked XML part (sheet, shared strings, workbook), in bytes. */
  maxPartBytes: 8 * 1024 * 1024,
  /** Sum of the declared unpacked sizes of all entries, in bytes. */
  maxUnpackedBytes: 40 * 1024 * 1024,
  /** Unpacked size to packed size of one entry above 1 MB unpacked (a zip bomb packs far tighter). */
  maxRatio: 100,
  /** Sheets of the workbook. */
  maxSheets: 20,
  /** Sheets that are looked at for the mapping table. */
  maxSheetsRead: 5,
  /** Cells of one sheet. */
  maxCells: 100_000,
  /** Rows with content of one sheet. */
  maxRows: 10_000,
  /** The last column of a cell (CV is 100). */
  maxColumn: 100,
  /** Time the whole reading may take, in milliseconds. */
  timeoutMs: 15_000,
});
