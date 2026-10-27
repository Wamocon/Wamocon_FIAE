// Reader of a PDF from its bytes (docs/ki-upload-konzept.md, 5.2).
//
// NOT extractTextFromPDF from src/lib/hai/pdfExtractor.ts: that function calls
// every address that begins with http and reads every path on the disk. This
// reader gets bytes and nothing else. It first scans the raw bytes (pdf-scan.ts),
// then reads the text in a thread of its own with a limit of time and memory
// (pdf-worker.ts), then cleans the text with cleanPDFText.
//
// The answer is a status and findings, never an exception. Nothing in the
// findings is a part of the text.

import { cleanPDFText } from '../hai/pdfExtractor';

import {
  finding,
  firstBlocking,
  type Finding,
  type ReadStatus,
} from './findings';
import { READ_LIMITS } from './limits';
import { scanPdf } from './pdf-scan';
import {
  runPdfWorker,
  type PdfWorkerFailure,
  type PdfWorkerOptions,
} from './pdf-worker';

export interface ReadPdfOptions extends PdfWorkerOptions {
  maxInputBytes?: number;
  /** Readable characters below which the PDF is taken for a scan (50). */
  minChars?: number;
}

export interface ReadPdfResult {
  status: ReadStatus;
  /** Code of the first blocking finding, null when the text was read. */
  code: string | null;
  /** The cleaned text of all pages, empty unless the file was read. */
  text: string;
  /** The cleaned text of every page. */
  pages: string[];
  pageCount: number;
  findings: Finding[];
}

const MESSAGES: Record<PdfWorkerFailure | 'NO_TEXT', string> = {
  TIMEOUT: 'The PDF took too long to read and was stopped.',
  WORKER_MEMORY: 'The PDF needed too much memory and was stopped.',
  WORKER_CRASH: 'The reader of the PDF stopped unexpectedly.',
  ENGINE_UNAVAILABLE: 'The reader of the PDF is not available.',
  TOO_MANY_PAGES: 'The PDF has more pages than the limit.',
  TEXT_TOO_LARGE: 'The text of the PDF is longer than the limit.',
  ENCRYPTED: 'The PDF is encrypted.',
  NOT_A_PDF: 'The file is not a PDF.',
  PDF_PARSE_ERROR: 'The PDF could not be read.',
  NO_TEXT: 'The PDF has no readable text, it is probably a scan.',
};

/** Failures that mean the file itself must not be processed. */
const REJECTED: ReadonlySet<string> = new Set(['ENCRYPTED', 'NOT_A_PDF']);

const result = (
  status: ReadStatus,
  findings: Finding[],
  pages: string[] = [],
  pageCount = 0
): ReadPdfResult => ({
  status,
  code: firstBlocking(findings),
  text: pages.join('\n\n').trim(),
  pages,
  pageCount,
  findings,
});

/**
 * White space of a page text in one linear pass before cleanPDFText: the
 * patterns of that function let \s* run across line breaks and cost time with
 * the square of a run of white space, which a hostile PDF can make as long as
 * the text limit allows. After this every run is at most two line breaks.
 */
function squeeze(page: string): string {
  return page
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** Reads the text of a PDF. Never throws. */
export async function readPdf(
  bytes: Uint8Array,
  options: ReadPdfOptions = {}
): Promise<ReadPdfResult> {
  const scan = scanPdf(bytes, { maxInputBytes: options.maxInputBytes });
  const findings = [...scan.findings];
  if (firstBlocking(findings)) return result('rejected', findings);

  // The plain page objects are counted by the scan: a file that has more pages
  // than allowed does not need a thread at all.
  const maxPages = options.maxPages ?? READ_LIMITS.maxPdfPages;
  if (scan.estimatedPages > maxPages) {
    findings.push(
      finding('TOO_MANY_PAGES', 'blocking', MESSAGES.TOO_MANY_PAGES)
    );
    return result('failed', findings);
  }
  const run = await runPdfWorker(bytes, options);
  if (!run.ok) {
    findings.push(finding(run.code, 'blocking', MESSAGES[run.code]));
    return result(REJECTED.has(run.code) ? 'rejected' : 'failed', findings);
  }
  const pages = run.pages.map(page => cleanPDFText(squeeze(page)));
  const minChars = options.minChars ?? READ_LIMITS.minPdfChars;
  if (pages.join('').replace(/\s/g, '').length < minChars) {
    findings.push(finding('NO_TEXT', 'blocking', MESSAGES.NO_TEXT));
    return result('failed', findings, [], run.numPages);
  }
  return result('ok', findings, pages, run.numPages);
}
