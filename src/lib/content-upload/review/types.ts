// Types of the review list of the content upload (package U6 of
// docs/ki-upload-konzept.md, section 7). The records are what the repository
// reads (a file with its current proposal and its current decision), the DTOs are
// what a route answers. A DTO never carries the storage path, the claim, the hash
// of a file beyond the short form, an excerpt or any text of a document: only
// metadata, the type and assignment, the reasons (code and fixed German text) and
// the confidence of a proposal. Parts of a solution do not appear anywhere in the
// review (decision O13: excerpt and display without solution parts).

import type {
  ProposalBand,
  ProposalSource,
  QuizLevelCode,
  Reason,
  UploadDocType,
} from '@/lib/content-upload/classify/types';
import type { FileStatus } from '@/lib/content-upload/staging/status';
import type { StockStatus } from '@/lib/content-upload/transfer/stock';
import type { FileRow } from '@/lib/content-upload/staging/types';

export type DecisionAction = 'accept' | 'reject' | 'defer';
export const DECISION_ACTIONS: readonly DecisionAction[] = [
  'accept',
  'reject',
  'defer',
];

export type DupChoice = 'keep' | 'skip';

/** What a person may assign: the six types of the rule stage (never "other"). */
export const ASSIGNABLE_DOC_TYPES: readonly UploadDocType[] = [
  'enabler',
  'quiz',
  'global_quiz',
  'scenario',
  'use_case',
  'pdf_original',
];

export const QUIZ_LEVELS: readonly QuizLevelCode[] = ['low', 'medium', 'high'];

/** One row of content_upload_proposals (the current one of a file). */
export interface ProposalRecord {
  id: string;
  fileId: string;
  source: ProposalSource | 'ki';
  docType: string | null;
  componentCode: string | null;
  enablerCode: string | null;
  quizLevel: string | null;
  confidence: number;
  band: ProposalBand;
  reasons: Reason[];
  model: string | null;
  createdAt: Date;
}

/** One row of content_upload_decisions (the current one of a file). */
export interface DecisionRecord {
  id: string;
  fileId: string;
  proposalId: string | null;
  decisionsVersion: number;
  decidedById: string;
  action: DecisionAction;
  docType: string | null;
  componentCode: string | null;
  enablerCode: string | null;
  quizLevel: string | null;
  dupChoice: DupChoice | null;
  note: string | null;
  decidedAt: Date;
}

/** A file of a run with its current proposal and its current decision. */
export interface ReviewRecord {
  file: FileRow;
  proposal: ProposalRecord | null;
  decision: DecisionRecord | null;
}

/** The columns the rule stage (or later the model) writes for a proposal. */
export interface ProposalWrite {
  source: ProposalSource | 'ki';
  docType: string | null;
  componentCode: string | null;
  enablerCode: string | null;
  quizLevel: string | null;
  confidence: number;
  band: ProposalBand;
  reasons: Reason[];
  model: string | null;
}

/** A component of the catalog in the database with its enablers. */
export interface CatalogComponentRow {
  code: string;
  title: string | null;
  kind: 'pflicht' | 'wahl' | 'integrativ' | null;
  phase: number | null;
  enablers: { code: string; title: string | null }[];
}

// ---------------------------------------------------------------------------
// What the routes answer
// ---------------------------------------------------------------------------

export interface AssignmentDto {
  docType: string | null;
  componentCode: string | null;
  enablerCode: string | null;
  quizLevel: string | null;
}

export interface ProposalDto extends AssignmentDto {
  source: string;
  band: ProposalBand;
  confidence: number;
  reasons: Reason[];
  /** The component or the enabler exists only in the plan of the folder tree. */
  isNew: boolean;
}

export interface DecisionDto extends AssignmentDto {
  action: DecisionAction;
  dupChoice: DupChoice | null;
  decidedAt: string;
}

export interface DerivedDto {
  kind: 'pflicht' | 'wahl' | 'integrativ' | null;
  phase: 1 | 2 | null;
}

export interface RowDuplicateDto {
  /** The content key (quiz:1a:low), also the id of the group in the routes. */
  key: string;
  size: number;
  /** This file is the suggested version of its group. */
  suggested: boolean;
  /** The group has no suggestion (equal versions, unknown time, ...). */
  ambiguous: boolean;
}

/**
 * The status of the supply of a file: what the comparison with the database found
 * (docs/ki-upload-konzept.md 8.9). Codes and numbers only.
 */
export interface StockDto {
  status: StockStatus;
  /** Questions an existing quiz would get. */
  added: number;
  /** ISO time of the comparison. */
  at: string;
  /** The assignment changed after the comparison: the status may not hold any more. */
  stale: boolean;
}

/**
 * How the model stage ended for a file that the rules left unclear (the marker
 * `kiState` in the summary of the file). A proposal of the model is not listed
 * here: it is the proposal itself, with the source `ki`.
 */
export const KI_STATES = [
  'proposed',
  'conflict',
  'not_sent',
  'failed',
  'invalid',
  'no_result',
] as const;
export type KiStateName = (typeof KI_STATES)[number];

/**
 * What a quiz JSON or an Excel mapping file holds, as numbers only (the file itself is
 * never shown). `kind` names the sort, `variant` the form of a quiz file (lesson,
 * global), `numbers` the counts the page shows.
 */
export interface ContentsDto {
  kind: 'quiz_json' | 'mapping_xlsx';
  variant: string | null;
  numbers: Record<string, number>;
}

export interface ReviewRowDto {
  id: string;
  fileName: string;
  relPath: string;
  ext: string;
  sizeBytes: number;
  pageCount: number | null;
  status: FileStatus;
  statusCode: string | null;
  /** Time of change from the browser. Not trustworthy, shown with that remark. */
  clientMtimeMs: number | null;
  proposal: ProposalDto | null;
  /** What counts now: the decision if there is one, else the proposal. */
  effective: AssignmentDto;
  decision: DecisionDto | null;
  derived: DerivedDto | null;
  duplicate: RowDuplicateDto | null;
  /** Exact copy of another file of the run (the copy has no object of its own). */
  copyOfId: string | null;
  /** Status of the supply from the last comparison, null before there was one. */
  stock: StockDto | null;
  /** The end of the model stage for this file, or null when it did not take part. */
  ki: KiStateName | null;
  /** What a JSON or Excel file holds (counts), null for a Word or PDF file. */
  contents: ContentsDto | null;
}

export interface ReviewCounts {
  total: number;
  /** Band of the proposal. */
  high: number;
  medium: number;
  low: number;
  conflict: number;
  /** Files in a duplicate group of two or more. */
  duplicates: number;
  /** Failed, rejected or expired files (no proposal). */
  problems: number;
  /** Merged copies, skipped and superseded files. */
  skipped: number;
  /** Files with a decision, by action. */
  accepted: number;
  rejected: number;
  deferred: number;
  /** Files that can be decided and have no decision yet. */
  open: number;
  /** What "accept all safe ones" would take: band high, no decision, no other version. */
  acceptableHigh: number;
  /**
   * Files by the status of the supply. `none` counts the files without a comparison
   * or with a stale one.
   */
  stock: Record<StockStatus | 'none', number>;
  /** What "accept new and added" would take: new or extended, safe, no decision. */
  acceptableStock: number;
  /**
   * The proposals of the band medium that a click may take, grouped by the same
   * reasons (the codes of the reasons, sorted, joined by +): what "confirm all with the
   * same reasons" would take. Never band low or conflict, never an unchecked content.
   */
  mediumGroups: MediumGroupDto[];
}

/** A group of proposals in the band medium with the same reasons. */
export interface MediumGroupDto {
  /** The sorted reason codes joined by +, also the id of the group in the command. */
  key: string;
  /** The reason texts (fixed German text of the rule stage) joined by a middle dot. */
  text: string;
  count: number;
}

/** The status filter of the list. */
export const STATUS_FILTERS = [
  'all',
  'open',
  'accepted',
  'rejected',
  'deferred',
  'problems',
  'skipped',
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** The filter by the status of the supply. `none`: not compared yet or stale. */
export const STOCK_FILTERS = [
  'new',
  'extended',
  'differs',
  'unchanged',
  'conflict',
  'none',
] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

export const BAND_FILTERS = ['high', 'medium', 'low', 'conflict'] as const;

export const SORTS = ['path', 'name', 'band', 'status'] as const;
export type SortKey = (typeof SORTS)[number];

export interface ReviewFilter {
  band?: ProposalBand;
  docType?: string;
  component?: string;
  status?: StatusFilter;
  stock?: StockFilter;
  duplicates?: boolean;
  /** Free text in the file name and the relative path. */
  query?: string;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export interface ReviewFacets {
  components: string[];
  docTypes: string[];
}

export interface ReviewPage {
  rows: ReviewRowDto[];
  /** Rows that match the filter. */
  matching: number;
  page: number;
  pageSize: number;
  pages: number;
}

/** Options for the selects of the review: only what is on the positive list. */
export interface ReviewOptions {
  docTypes: string[];
  quizLevels: string[];
  components: {
    code: string;
    title: string | null;
    isNew: boolean;
    enablers: { code: string; title: string | null; isNew: boolean }[];
  }[];
}

export interface DuplicateMemberDto {
  fileId: string;
  fileName: string;
  relPath: string;
  sizeBytes: number;
  pageCount: number | null;
  clientMtimeMs: number | null;
  /** Version from the name or folder (_v2), 0 when there is none. */
  version: number;
  suggested: boolean;
  decision: { action: DecisionAction; dupChoice: DupChoice | null } | null;
}

export interface DuplicateGroupDto {
  key: string;
  label: AssignmentDto;
  members: DuplicateMemberDto[];
  suggestedId: string | null;
  ambiguous: boolean;
  reasons: Reason[];
  /** Every member has a decision. */
  resolved: boolean;
}
