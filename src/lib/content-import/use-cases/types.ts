// Types of the KfBM use case import (phase 4.6). Types only: this file is
// erased at runtime, so the scripts under scripts/import can load the other
// modules of this folder with Node's type stripping.

import type { Audience } from '../types';
import type { ComponentKind, Conflict } from '../apply/types';

export type { Audience };

/** A use case document, split into the sections of the source format. */
export interface ParsedUseCase {
  /** Code from the heading, for example 4a or 24.1a. */
  code: string | null;
  title: string | null;
  /** Visible for trainees: the topics that the use case repeats. */
  topics: string;
  /** Visible for trainees: the starting situation with its data tables. */
  situation: string;
  /** Visible for trainees: what is asked for. */
  objective: string;
  /** Visible for trainees: the steps to the goal. */
  steps: string;
  /** SOLUTION: trainer only. */
  solution: string;
  /** SOLUTION: trainer only. Empty when the document has no such section. */
  criteria: string;
  /** The situation has the bold line "Eckdaten" (the data table). */
  hasDataTable: boolean;
  visibility: {
    topics: Audience;
    situation: Audience;
    objective: Audience;
    steps: Audience;
    solution: Audience;
    criteria: Audience;
  };
}

export interface TraineeUseCase {
  code: string | null;
  title: string | null;
  topics: string;
  situation: string;
  objective: string;
  steps: string;
}

/** One use case of the plan, ready to be written. */
export interface PlanUseCase {
  /** K6.2-d: component code, hyphen, letter. Also the code of its enabler. */
  code: string;
  componentCode: string;
  /** Code of the enabler that the use case belongs to (1:1). */
  enablerCode: string;
  letter: string;
  title: string;
  /** Visible for trainees, written to use_cases.description_text. */
  description: string;
  /** Visible for trainees, a document row of the type THEORY. Null if none. */
  topics: string | null;
  /** SOLUTION: written only with the switch, as TRAINER_SOLUTION. */
  solution: string;
  /** SOLUTION: written only with the switch, as TRAINER_SOLUTION. */
  criteria: string | null;
  /** Position of the letter in the alphabet (a = 1). */
  orderIndex: number;
  /** Path of the source file below the source folder. */
  source: string;
}

export interface UseCaseSkip {
  /** Path of the file below the source folder, null for a derived item. */
  file: string | null;
  /** Key of the content (use-case:5b) when the file has one. */
  key: string | null;
  code: string;
  /** Reason in plain words. Never quotes the content of a file. */
  reason: string;
}

export interface UseCasePlan {
  version: 1;
  /** Marks the plan as one of the use case import. */
  kind: 'use-cases';
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
  useCases: PlanUseCase[];
  skipped: UseCaseSkip[];
  /** Older copies that lost against a newer one (policy newest). */
  superseded: Array<{ file: string; key: string; keptFile: string }>;
  /** Files that are not part of this package (enablers, PDF, archive, K18). */
  notPlanned: Record<string, number>;
  open: string[];
  warnings: string[];
}

export interface UseCasePlanCounts {
  useCases: number;
  withTopics: number;
  withCriteria: number;
  components: number;
  skipped: number;
  superseded: number;
}

export type { ComponentKind, Conflict };
