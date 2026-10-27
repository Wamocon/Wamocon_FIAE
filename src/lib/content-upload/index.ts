// Reading of uploaded documents and the excerpt that may leave the platform
// (package U3 of docs/ki-upload-konzept.md).
//
// Pure functions on bytes and text: no file system, no database, no network, no
// model. Server side only: readPdf starts a worker thread, so do not import this
// module into code that runs in the browser.

export {
  buildExcerpt,
  paragraphsFromText,
  protectExcerptLines,
  type BuildExcerptInput,
  type ExcerptDocType,
  type ExcerptReason,
  type ExcerptResult,
} from './excerpt';
export {
  finding,
  firstBlocking,
  type Finding,
  type FindingSeverity,
  type ReadStatus,
} from './findings';
export { EXCERPT_MAX_CHARS, READ_LIMITS } from './limits';
export {
  customerDocumentClasses,
  findInstructionText,
  hasSolutionMarker,
  redactPersonalData,
} from './patterns';
export { scanPdf, type PdfScanResult } from './pdf-scan';
export {
  runPdfWorker,
  type PdfWorkerOptions,
  type PdfWorkerResult,
} from './pdf-worker';
export {
  readDocx,
  type ReadDocxOptions,
  type ReadDocxResult,
} from './read-docx';
export { readPdf, type ReadPdfOptions, type ReadPdfResult } from './read-pdf';
export { foldConfusables, sanitizeExcerptText } from './text-clean';
