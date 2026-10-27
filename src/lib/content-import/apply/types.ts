// Types of the KfBM apply step (phase 4.4). Types only: this file is erased at
// runtime, so scripts/import/kfbm-apply.mjs can load the other modules of this
// folder with Node's type stripping.

export type ComponentKind = 'pflicht' | 'wahl' | 'integrativ';
export type QuizLevel = 'low' | 'medium' | 'high';

/**
 * Presets of the import (scripts/import/kfbm-decisions.json). They are
 * proposals of the plan that the owner has not confirmed yet, so they live in a
 * file and not in the code.
 */
export interface Decisions {
  version: 1;
  /** Free text: where the presets come from and that they are not confirmed. */
  status: string;
  /** Code of the target catalog. Only KFBM is accepted. */
  catalog: string;
  duplicates: {
    policy: 'newest';
    /**
     * Two copies of one document whose versions are equal and whose
     * modification times lie within this many hours cannot be told apart, both
     * are skipped.
     */
    ambiguousWithinHours: number;
  };
  components: {
    /** Component numbers that are not imported (K18). */
    excludedNumbers: number[];
    mandatoryNumbers: number[];
    electiveNumbers: number[];
    integrativeNumbers: number[];
    /** Phase of a mandatory component by the folder group it lies in. */
    phaseByGroup: { teil1: 1 | 2 | null; teil2: 1 | 2 | null };
    /** Phase of single components by code (K6.2), overrides phaseByGroup. */
    phaseOverrides: Record<string, 1 | 2 | null>;
    /** Weeks and planned hours by component code. Missing = provisional. */
    totalWeeks: Record<string, number>;
    totalHours: Record<string, number>;
    /** Written where no value is known (the columns are NOT NULL). */
    placeholderWeeks: number;
    placeholderHours: number;
  };
  content: {
    /** is_active of imported courses, enablers and quizzes. */
    activate: boolean;
    /** Questions a global quiz must have. */
    globalQuizQuestions: number;
    /** Write the text of the enabler documents into description_text. */
    enablerText: boolean;
  };
  /** Open questions that stay visible in every plan. */
  open: string[];
}

export interface PlanComponent {
  /** K1, K6.1, K24.2 */
  code: string;
  /** 01, 06.1, 24.2 */
  key: string;
  number: number;
  split: number | null;
  title: string;
  /** Paragraph of the regulation, for example "§ 4 Abs. 2 Nr. 6". */
  reference: string | null;
  /** Folder group of the source: teil1, teil2, ganze or wahl. */
  group: string;
  kind: ComponentKind;
  /** 1, 2 or null (integrative and elective components). */
  phase: number | null;
  /** Position in the sorted list of the components, starts at 1. */
  orderIndex: number;
  totalWeeks: number;
  totalHours: number;
  /** True when weeks and hours are placeholders. */
  provisionalTotals: boolean;
}

export interface PlanEnabler {
  /** K6.2-d */
  code: string;
  letter: string;
  componentCode: string;
  title: string;
  /** Position of the letter in the alphabet (a = 1). */
  orderIndex: number;
  /** Text of the enabler document, visible for trainees. */
  descriptionText: string | null;
  source: string;
}

export interface PlanScenario {
  enablerCode: string;
  title: string | null;
  /** Visible for trainees. */
  situation: string;
  /**
   * Visible for trainees, written under the heading "Aufgabe" into the row of
   * the situation. Left out of the plan when the file has no task.
   */
  task?: string;
  /** SOLUTION: trainer only. */
  solution: string;
  /** SOLUTION: trainer only. */
  knowledgeContribution: string;
  source: string;
}

/**
 * The original file of an enabler text (upload, docs/ki-upload-konzept.md 8.5),
 * written as a new document row THEORY/ALL at the enabler. It is not part of the
 * plan file (a plan holds text, this holds a stored file). The caller has copied
 * the file already and checked that it is safe for trainees: the engine only
 * writes the row, and the solution guard still checks its text fields.
 */
export interface EnablerOriginal {
  /** K6.2-d */
  enablerCode: string;
  /** Title of the row, the engine adds nothing to it. */
  title: string;
  /** Name of the stored file (ASCII, no path). */
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageUrl: string;
  storagePath: string;
  pageCount: number | null;
}

export interface PlanOption {
  letter: string;
  text: string;
  /** SOLUTION: written to options.is_correct only. */
  isCorrect: boolean;
  /** SOLUTION: the rationale, only set on the correct option. */
  explanation: string | null;
}

export interface PlanQuestion {
  number: number;
  text: string;
  /** Difficulty band of a global quiz question, otherwise null. */
  difficulty: QuizLevel | null;
  options: PlanOption[];
}

export interface PlanQuiz {
  /** K1-a-low, K1-global */
  code: string;
  kind: 'lesson' | 'global';
  componentCode: string;
  /** Code of the enabler for a lesson quiz, null for a global quiz. */
  enablerCode: string | null;
  level: QuizLevel | null;
  title: string;
  questions: PlanQuestion[];
  source: string;
}

export interface PlanSkip {
  /** Path of the file below the source folder, null for a derived item. */
  file: string | null;
  /** Key of the content (quiz:1a:low) when the file has one. */
  key: string | null;
  type: string;
  /** Short code, stable for tests and summaries. */
  code: string;
  /** Reason in plain words. Never quotes the content of a file. */
  reason: string;
}

export interface ImportPlan {
  version: 1;
  catalog: string;
  generatedAt: string;
  /** Components the run was limited to, empty for all. */
  limitedTo: string[];
  decisions: {
    status: string;
    duplicatesPolicy: string;
    ambiguousWithinHours: number;
    activate: boolean;
  };
  components: PlanComponent[];
  enablers: PlanEnabler[];
  scenarios: PlanScenario[];
  quizzes: PlanQuiz[];
  skipped: PlanSkip[];
  /** Older copies that lost against a newer one (policy newest). */
  superseded: Array<{ file: string; key: string; keptFile: string }>;
  /** Files that are not part of this package (use cases, PDF, archive, K18). */
  notPlanned: Record<string, number>;
  open: string[];
  warnings: string[];
}

export interface PlanCounts {
  components: number;
  enablers: number;
  scenarios: number;
  quizzes: number;
  lessonQuizzes: number;
  globalQuizzes: number;
  questions: number;
  options: number;
  skipped: number;
  superseded: number;
}

export interface Conflict {
  table: string;
  key: string;
  reason: string;
}

export interface Difference {
  table: string;
  key: string;
  columns: string[];
}

export interface TableCount {
  insert: number;
  update: number;
  unchanged: number;
}

export interface RunReport {
  catalog: string;
  tables: Record<string, TableCount>;
  conflicts: Conflict[];
  /** Existing rows that differ from the plan (updated only on request). */
  differences: Difference[];
  /** True when rows were written (inside the transaction). */
  wrote: boolean;
  /**
   * Existing quizzes that get their missing questions (--extend-quizzes): the
   * number of added questions and of existing questions whose position moved.
   */
  extended?: Array<{ quiz: string; added: number; moved: number }>;
}
