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
