// Types of the KfBM apply step (phase 4.4). Types only: this file is erased at
// runtime, so scripts/import/kfbm-apply.mjs can load the other modules of this
// folder with Node's type stripping.

export type ComponentKind = 'pflicht' | 'wahl' | 'integrativ';
export type QuizLevel = 'low' | 'medium' | 'high';

/**
 * An enabler whose teaching text carries the bare line "Lösung" (a table cell
 * label, no solution part) and was checked by the owner. It releases exactly the
 * pattern of that line for the text of this one enabler, no other marker.
 */
export interface ReviewedSolutionWord {
  /** Code of the enabler, for example K24.2-e. */
  enabler: string;
  /** Why the line is no solution part. Plain text, one line. */
  reason: string;
}

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
    /**
     * Enablers whose bare line "Lösung" was checked and is no solution part.
     * Never applies to scenarios, quizzes or use cases.
     */
    reviewedSolutionWordFalsePositives: ReviewedSolutionWord[];
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
  /**
   * Where totalWeeks comes from: the training framework plan
   * (component-weeks.ts), a decision of the owner, none (the plan prints no
   * weeks for the component, 0 is the right value) or a placeholder (nobody
   * named a value). Plans of older runs have no such field.
   */
  weeksSource?: 'rahmenplan' | 'decision' | 'none' | 'placeholder';
  /** True when the weeks or the hours are placeholders. */
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

/** An enabler text that passed the guard with a reviewed bare line "Lösung". */
export interface PlanReviewedMarker {
  enablerCode: string;
  /** The only pattern a review can release: a line of just the word. */
  pattern: 'bare-solution-line';
  reason: string;
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
  /**
   * Enabler texts that carry a reviewed bare line "Lösung" (see
   * ReviewedSolutionWord). Absent when there are none. The apply step lets the
   * texts of exactly these enablers pass that one marker.
   */
  reviewedMarkers?: PlanReviewedMarker[];
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
  /**
   * The columns of this difference that a run writes even without
   * --update-existing (tables.ts fillWhenEmpty: the value is still empty).
   */
  filled?: string[];
}

export interface TableCount {
  insert: number;
  update: number;
  unchanged: number;
}

/**
 * What an engine finds out about one item of a plan when it compares the plan
 * with the target (the status of a supply of content, docs/ki-upload-konzept.md
 * section 8.9):
 *  - new        the row does not exist and is inserted
 *  - unchanged  the row exists and equals the plan
 *  - extended   an existing quiz lacks questions that the plan has (added)
 *  - differs    the row exists and an updatable column differs from the plan
 *  - conflict   the row exists with another meaning, nothing is written
 */
export type ItemStatus =
  | 'new'
  | 'unchanged'
  | 'extended'
  | 'differs'
  | 'conflict';

/** One finding of an engine, keyed like the differences and conflicts of its report. */
export interface ItemEvent {
  table: string;
  key: string;
  status: ItemStatus;
  /** Questions added to an existing quiz (status extended). */
  added?: number;
  /** Existing questions whose position moves on (status extended). */
  moved?: number;
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
