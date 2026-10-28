// Loads the TypeScript modules of the PDF import (src/lib/content-import/documents) for
// scripts/import/kfbm-documents.mjs. Node strips the types while loading them. The hook of
// kfbm-apply-modules.mjs (imported first) adds the file extension to the relative imports.
//
// No network, no database in here: it only loads code.

import {
  ImportAbort,
  parseDecisions,
  selectFiles,
} from './kfbm-apply-modules.mjs';
import { selectUseCaseFiles } from './kfbm-use-cases-modules.mjs';

const load = name =>
  import(
    new URL(
      `../../src/lib/content-import/documents/${name}.ts`,
      import.meta.url
    ).href
  );
const [args, plan, report, job, storage, classify, word, pdfClean] =
  await Promise.all([
    load('args'),
    load('plan'),
    load('report'),
    load('job'),
    load('storage'),
    load('classify'),
    load('word'),
    load('pdf-clean'),
  ]);

export { ImportAbort, parseDecisions, selectFiles, selectUseCaseFiles };
export const { parseDocumentsArgs } = args;
export const {
  buildDocumentPlan,
  countPlan,
  renderPlanSummary,
  validateDocumentPlan,
  MAX_PDF_BYTES,
} = plan;
export const { renderDocumentRunReport } = report;
export const { runDocumentJob } = job;
export const {
  checkConfirmStorageHost,
  checkStorageTarget,
  createSupabaseStorage,
  SOLUTIONS_BUCKET_SETTINGS,
  StorageError,
} = storage;
export const { classifyPdfPath } = classify;
export const { prepareWordDocument, wordPdfName, wordPdfPath } = word;
export const { cleanPdfMetadata } = pdfClean;
