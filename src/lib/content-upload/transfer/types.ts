// Types of the transfer (package U7 of docs/ki-upload-konzept.md, section 8): the
// confirmed files of a run, what the plan builder makes of them and what a dry run
// or an apply reports. Types only.

import type {
  Conflict,
  Difference,
  ImportPlan,
  PlanCounts,
  TableCount,
} from '@/lib/content-import/apply/types';
import type {
  UseCasePlan,
  UseCasePlanCounts,
} from '@/lib/content-import/use-cases/types';
import type {
  FileStock,
  StockCounts,
} from '@/lib/content-upload/transfer/stock';

/** The decision of a person about one file (the current row of content_upload_decisions). */
export interface TransferDecision {
  id: string;
  action: 'accept' | 'reject' | 'defer';
  docType: string | null;
  componentCode: string | null;
  enablerCode: string | null;
  quizLevel: string | null;
  dupChoice: 'keep' | 'skip' | null;
  decisionsVersion: number;
}

/** A file of the run with its current decision. */
export interface TransferFile {
  id: string;
  relPath: string;
  fileName: string;
  ext: 'docx' | 'pdf';
  sizeBytes: number;
  /** Hash of the object, checked against the bucket by the queue. */
  sha256: string;
  /** Time of the file: the browser's value, otherwise the time of the announcement. */
  mtimeMs: number;
  /** Path of the object in the staging bucket. Never part of an answer. */
  storagePath: string;
  status: string;
  /** Content key of the proposal (quiz:1a:low, pdf:enabler:6.2d). */
  dupKey: string | null;
  /** The object is gone from the staging bucket (marker of the cleanup). */
  objectDeleted: boolean;
  decision: TransferDecision;
}

/** A row of training_components as far as the plan builder needs it. */
export interface ComponentFact {
  code: string;
  title: string;
  reference: string | null;
  kind: string | null;
  phase: number | null;
}

/** A file that is not part of the plan, with a stable code and a reason without content. */
export interface ExcludedFile {
  fileId: string;
  code: string;
  reason: string;
}

/** What the planner skipped, mapped to the file (null: a derived item, for example a component). */
export interface SkippedItem {
  fileId: string | null;
  code: string;
  reason: string;
}

export interface TransferPlan {
  importPlan: ImportPlan;
  useCasePlan: UseCasePlan;
  /** Files left out before the planner (not accepted, duplicates, other format). */
  excluded: ExcludedFile[];
  /** Skipped by the planners, mapped to files. */
  skipped: SkippedItem[];
  /** Files that became at least one item of a plan, with their hash. */
  plannedFiles: Array<{ id: string; sha256: string }>;
  /** Source path of a plan item to the id of its file. */
  fileOfSource: ReadonlyMap<string, string>;
  counts: PlanCounts;
  useCaseCounts: UseCasePlanCounts;
}

export type TransferMode = 'dry_run' | 'apply';

/** One original that goes to the document bucket (a confirmed enabler text). */
export interface OriginalPlan {
  fileId: string;
  sha256: string;
  enablerCode: string;
  ext: 'docx' | 'pdf';
  sizeBytes: number;
  pageCount: number | null;
}

export interface OriginalRefusal {
  fileId: string;
  code: string;
  reason: string;
}

/** The status of the supply per file, as far as the comparison reached it. */
export interface StockReport {
  /** Files per status. */
  counts: StockCounts;
  files: Array<FileStock & { fileId: string; fileName: string }>;
}

/** What a dry run or an apply reports to the person. Never a text of a file. */
export interface TransferReport {
  mode: TransferMode;
  /** ok: nothing in the way, conflict: the engines found conflicts (nothing written). */
  status: 'ok' | 'conflict';
  applyId: string | null;
  decisionsHash: string;
  decisionsVersion: number;
  /** The files whose differing rows the person chose to replace (empty: only new and added). */
  replaceFiles: string[];
  /** Status of the supply per file and the counts per status (docs 8.9). */
  stock: StockReport;
  /** Existing quizzes that get missing questions, with the numbers (the quiz code is no secret). */
  extended: Array<{ quiz: string; added: number; moved: number }>;
  tables: Record<string, TableCount>;
  conflicts: Conflict[];
  differences: Difference[];
  skipped: SkippedItem[];
  excluded: ExcludedFile[];
  useCasesSkippedInDb: Array<{
    code: string;
    useCaseCode: string;
    reason: string;
  }>;
  originals: { published: number; refused: OriginalRefusal[] };
  /** True for an apply that was committed. */
  wrote: boolean;
  /** The apply is allowed next: a dry run without conflicts. */
  readyToApply: boolean;
}
