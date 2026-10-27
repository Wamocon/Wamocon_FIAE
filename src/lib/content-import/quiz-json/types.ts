// Types of the quiz JSON source (schema 1.0). Types only: this file is erased at
// runtime, so scripts/import/kfbm-apply.mjs can load the other modules of this
// folder with Node's type stripping.

import type { PlanSkip, QuizLevel } from '../apply/types';
import type { SourceFile } from '../apply/plan';

export type FindingSeverity = 'error' | 'warning';

/**
 * One finding of the reader. A finding names the quiz (id like 10a or 24_1a,
 * for a global quiz the component id like 06.1), the level and the question
 * number when there is one, and a reason. It never quotes the content of the
 * file, only ids, counts and field names.
 */
export interface QuizJsonFinding {
  severity: FindingSeverity;
  /** Short code, stable for tests and summaries. */
  code: string;
  /** Quiz id (10a, 24_1a) or component id of a global quiz, null for the file. */
  id: string | null;
  /** Position (from 1) of the entry in the quiz list, for entries that have no id. */
  entry: number | null;
  level: QuizLevel | null;
  question: number | null;
  /** Content key of the Word path (quiz:6.2d:low), when it could be derived. */
  key: string | null;
  message: string;
}

/** Upper limits. Anything above them is refused, nothing is cut off. */
export interface QuizJsonLimits {
  /** Quizzes in one file. */
  maxQuizzes: number;
  /** Questions of one quiz and level. */
  maxQuestionsPerSet: number;
  /** Questions in one file. */
  maxTotalQuestions: number;
  maxQuestionChars: number;
  maxOptionChars: number;
  maxExplanationChars: number;
  /** Titles and the other short strings (source, label). */
  maxTitleChars: number;
}

export interface QuizJsonOptions {
  /** Questions a quiz level should have (lesson quizzes, a deviation is a warning). */
  expectedQuestions?: number;
  /** Questions a global quiz must have (a deviation is an error). */
  expectedGlobalQuestions?: number;
  limits?: Partial<QuizJsonLimits>;
}

/** One quiz level (a "set") with what the report needs. */
export interface QuizJsonSet {
  /** Quiz id (10a) or component id of a global quiz. */
  id: string;
  /** Component code (K6.1), null when the mapping failed. */
  componentCode: string | null;
  level: QuizLevel | null;
  key: string | null;
  questions: number;
  errors: number;
  warnings: number;
}

export interface QuizJsonRead {
  kind: 'lesson' | 'global';
  /**
   * The structure of the file cannot be trusted (wrong schema version, header
   * does not fit, unknown top level field, too large). Nothing was read.
   */
  fatal: boolean;
  /** Entries in the quizzes list. */
  quizzes: number;
  findings: QuizJsonFinding[];
  /**
   * Input of buildImportPlan: one synthetic source file per quiz level, plus
   * one enabler file per quiz (lesson quizzes) where the title names the
   * enabler. The path info of every file comes from the same function as the
   * Word files, so the keys are the same.
   */
  files: SourceFile[];
  /** Errors for quizzes that could not be mapped to a content key at all. */
  unmapped: UnmappedSkip[];
  sets: QuizJsonSet[];
}

/** A skip entry for the plan, with the component it belongs to (for --components). */
export interface UnmappedSkip extends PlanSkip {
  componentCode: string | null;
}
