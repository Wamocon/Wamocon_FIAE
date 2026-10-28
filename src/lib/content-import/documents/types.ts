// Types of the PDF import of the KfBM (scripts/import/kfbm-documents.mjs).
//
// The source folder Komponenten_PDF holds, per component folder, four sub folders:
// Enabler (the teaching text), Szenarien (the scenario), Use-Cases (the task) and
// Use-Cases_Musterlösung (the model solution). The sub folder Quizze is not part of
// this import. Every PDF becomes one row of content_documents, in the form that FIAE
// uses for the same kind of document, and one file in the storage.
//
// This module has no runtime import on purpose: the scripts under scripts/import load
// the modules directly with Node's type stripping.

/** What a PDF is, by the folder it lies in. */
export type PdfKind =
  | 'enabler'
  | 'scenario'
  | 'usecase_task'
  | 'usecase_solution';

export const PDF_KINDS: readonly PdfKind[] = [
  'enabler',
  'scenario',
  'usecase_task',
  'usecase_solution',
];

/** Why a file is not imported (the plan names it, nothing is guessed). */
export type SkipStatus =
  /** The folder Quizze, or another folder the import does not use. */
  | 'ignored'
  /** The name does not follow the pattern of the folder (14i.pdf in Szenarien). */
  | 'misnamed'
  /** The name carries a note such as "(aus 23b)": the content may belong to another slot. */
  | 'annotated'
  /** The first heading names another enabler than the file name. */
  | 'heading-mismatch'
  /** The first page shows no enabler id. */
  | 'heading-missing'
  /** Not a PDF (magic bytes), empty, too large, or not read (placeholder). */
  | 'unreadable'
  /** Two files claim the same slot. */
  | 'duplicate';

export type PdfStatus = 'ok' | SkipStatus;

/** What the path of a file says, before the file is read. */
export interface PathClass {
  kind: PdfKind | null;
  /** K6.2 */
  componentCode: string | null;
  /** 6.2d (number, split from the folder, letter) */
  enablerKey: string | null;
  /** K6.2-d */
  enablerCode: string | null;
  /** Number, split and letter as the file name wrote them (the split may be missing). */
  nameId: { number: number; split: number | null; letter: string } | null;
  status: 'ok' | 'ignored' | 'misnamed' | 'annotated';
  /** Fixed text, never the content of a file. */
  reason: string | null;
}

/** A file of the source folder with what was read from it. */
export interface ScannedPdf {
  rel: string;
  size: number;
  /** The file could not be read (placeholder, timeout, error). */
  readError?: string | null;
  /** First bytes are %PDF-. */
  magicOk?: boolean;
  sha256?: string | null;
  pageCount?: number | null;
  /** Text of the first lines of the first page, only used to find the heading id. */
  headText?: string | null;
}

export interface PlanItem {
  rel: string;
  kind: PdfKind | null;
  componentCode: string | null;
  enablerCode: string | null;
  status: PdfStatus;
  reason: string | null;
  size: number;
  sha256: string | null;
  pageCount: number | null;
  /** Enabler key of the heading (for the report), null when none was read. */
  headingKey: string | null;
}

export interface DocumentPlan {
  version: 1;
  items: PlanItem[];
}

export interface PlanCounts {
  total: number;
  byKind: Record<PdfKind, number>;
  byStatus: Record<string, number>;
}

/** The target kinds of a run. */
export type DocumentTarget = 'local' | 'preview';
