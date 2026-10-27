// Shared types of the KfBM content import (phase 4). Types only: this file is
// erased at runtime, so the scripts under scripts/import can load the other
// modules directly with Node's type stripping.

/** One paragraph of a source document. */
export interface Paragraph {
  text: string;
  /** True when the whole paragraph is bold (every text run carries bold). */
  bold: boolean;
  /**
   * Set for a paragraph inside a table: running number of the table row (all
   * paragraphs of one row share it) and of the cell. Absent outside tables.
   */
  row?: number;
  cell?: number;
}

/**
 * Input of the parsers: plain text (one paragraph per line, a line wrapped in
 * `**` counts as bold) or a list of paragraphs (strings or Paragraph objects).
 */
export type SourceInput = string | ReadonlyArray<string | Paragraph>;

export type IssueSeverity = 'error' | 'warning';

export interface ImportIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  /** Number of the question the issue belongs to, when there is one. */
  question?: number;
}

/** Result of a parser: the best effort value plus every issue found. */
export interface ParseResult<T> {
  value: T;
  issues: ImportIssue[];
  /** True when no issue has the severity error (warnings are allowed). */
  ok: boolean;
}

export type Difficulty = 'low' | 'medium' | 'high';

export interface QuizOption {
  letter: string;
  text: string;
}

export interface QuizQuestion {
  number: number;
  text: string;
  options: QuizOption[];
  /** SOLUTION: never show to trainees. */
  correctLetter: string | null;
  /** SOLUTION: never show to trainees. */
  rationale: string | null;
  /** Only set for global quizzes (difficulty band by question number). */
  difficulty: Difficulty | null;
}

export type QuizKind = 'enabler' | 'global' | 'unknown';

export interface ParsedQuiz {
  kind: QuizKind;
  /** Code from the heading, for example 1b or 24.1a. Null for global quizzes. */
  enablerCode: string | null;
  /** Component number from the heading of a global quiz, for example 06.1. */
  componentKey: string | null;
  title: string | null;
  difficulty: Difficulty | 'mixed' | null;
  questions: QuizQuestion[];
  /** The fields of every question that are solutions (trainer only). */
  solutionFields: readonly ['correctLetter', 'rationale'];
}

export type Audience = 'trainee' | 'trainer';

export interface ParsedScenario {
  /** Code from the heading, for example 1b or 24.1a. */
  code: string | null;
  title: string | null;
  /** Visible for trainees. */
  situation: string;
  /** SOLUTION: trainer only. */
  solution: string;
  /** SOLUTION: trainer only. */
  knowledgeContribution: string;
  visibility: {
    situation: Audience;
    solution: Audience;
    knowledgeContribution: Audience;
  };
}

export type SourceGroup = 'global' | 'teil1' | 'teil2' | 'ganze' | 'wahl';

export type SourceType =
  | 'enabler'
  | 'quiz'
  | 'scenario'
  | 'use-case'
  | 'global-quiz'
  | 'overview'
  | 'pdf'
  | 'archive'
  | 'other';

export interface ComponentRef {
  number: number;
  /** Second number of a split component (06.1 and 06.2), otherwise null. */
  split: number | null;
  /** Sortable key with a two digit number, for example 01, 06.1, 24.2. */
  key: string;
  /** Short code without padding, for example K1, K6.1, K24.2. */
  code: string;
  elective: boolean;
  /** K18 is not part of the import. */
  excluded: boolean;
}

export interface PathInfo {
  /** Group by the top folder (global, teil1, teil2, ganze), wahl for K10 to K19. */
  group: SourceGroup | null;
  /** The group of the folder as found on disk, before the elective rule. */
  folderGroup: Exclude<SourceGroup, 'wahl'> | null;
  component:
    | (ComponentRef & { title: string | null; paragraph: string | null })
    | null;
  /** Letter of the enabler, for example b. */
  enablerLetter: string | null;
  /** Number, optional split and letter, for example 1b or 6.2d. */
  enablerKey: string | null;
  /** Code of the plan, for example K1-b or K6.2-d. */
  enablerCode: string | null;
  type: SourceType;
  difficulty: Difficulty | null;
  format: string;
  /** Version number from a suffix like _v2, otherwise null. */
  version: number | null;
  /** Key that identifies the content, files with the same key are duplicates. */
  key: string | null;
  /** Notes that are not a problem, for example misplaced or version. */
  flags: string[];
  /** Reasons why the path does not fit the expected scheme. */
  issues: string[];
}
