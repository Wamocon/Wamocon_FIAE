// Shared types of the rule stage of the assignment (package U4 of
// docs/ki-upload-konzept.md, sections 6.1 and 6.2). Types and constants only.
//
// The values of the lists match the CHECK constraints of the migration
// 20261030000100_content_upload_tables.sql (doc_type, quiz_level, band, source and
// the file status of section 2.3), so a result can be written to the proposals
// table as it is.

import type { SourceGroup } from '../../content-import/types';

/**
 * Document types of the upload. The database also knows 'other', the rule stage
 * never proposes it (a file of no known type is left unclear instead).
 */
export type UploadDocType =
  | 'enabler'
  | 'quiz'
  | 'global_quiz'
  | 'scenario'
  | 'use_case'
  | 'pdf_original';

/** The type a PDF original is a copy of. */
export type OriginalType = Exclude<UploadDocType, 'pdf_original'>;

export type QuizLevelCode = 'low' | 'medium' | 'high';

/** content_upload_proposals.band */
export type ProposalBand = 'high' | 'medium' | 'low' | 'conflict';

/** content_upload_proposals.source (the rule stage never writes 'ki') */
export type ProposalSource = 'path' | 'content' | 'path_content';

/**
 * The file status after the rule stage (section 2.3): a proposal exists
 * (proposed_rules), the rules could not settle it (unclear) or the file is left
 * out (skipped, with a status code).
 */
export type RuleFileStatus = 'proposed_rules' | 'unclear' | 'skipped';

export type { SourceGroup };

/** A reason of a proposal: a stable code and a short German text. */
export interface Reason {
  code: string;
  /** At most 200 characters, never a part of the document. */
  text: string;
}

/** What an assignment names about a file. */
export interface AssignmentFields {
  docType: UploadDocType | null;
  /** K1, K6.2 */
  componentCode: string | null;
  /** K6.2-d. Null for a global quiz. */
  enablerCode: string | null;
  /** Only for a quiz (or the original of a quiz). */
  quizLevel: QuizLevelCode | null;
}

/**
 * The confidences of the rule stage (section 6.2). Fixed values for ordered
 * bands, not probabilities.
 */
export const CONFIDENCE = Object.freeze({
  /** path and content name the same, code on the list, parser without errors */
  agree: 0.99,
  /** content alone, parser without errors, code on the list, unique */
  content: 0.95,
  /** path alone without issues, code on the list */
  path: 0.9,
  /** warnings, a new code of the plan, errors of the parser, path not confirmed */
  medium: 0.7,
  /** a type is known but the assignment is incomplete or not on the list */
  low: 0.5,
  /** path and content contradict each other */
  conflict: 0.3,
  /** nothing was recognized */
  none: 0,
} as const);

/** Longest reason text that the proposals table gets. */
export const REASON_TEXT_MAX = 200;
