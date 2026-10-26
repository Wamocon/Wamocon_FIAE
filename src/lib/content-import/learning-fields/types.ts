// Types of the learning field import (phase 4.5). Types only: this file is
// erased at runtime, so scripts/import/kfbm-learning-fields.mjs can load the
// other modules of this folder with Node's type stripping.

import type { SchoolYear } from './model';

/**
 * What the content import (phase 4.4) holds: the codes of its components and
 * enablers, as the apply plan or the database names them (K6.2, K6.2-d).
 */
export interface ImportIndex {
  /** Components with the paragraph of the regulation ("§ 4 Abs. 2 Nr. 6"). */
  components: Array<{ code: string; reference: string | null }>;
  /** Enabler codes (K6.2-d). */
  enablers: string[];
  /** Component numbers that are not imported on purpose (18 for K18). */
  excludedNumbers: number[];
}

export type SkipCode =
  // the row cannot be assigned to an enabler of the import
  | 'BLOCK_UNKNOWN'
  | 'SECTION_MISMATCH'
  | 'NUMBER_MISMATCH'
  | 'NUMBER_OUT_OF_RANGE'
  | 'COMPONENT_EXCLUDED'
  | 'COMPONENT_NOT_IN_IMPORT'
  | 'REFERENCE_MISMATCH'
  | 'NO_LETTER'
  | 'DUPLICATE_LETTER'
  | 'ENABLER_NOT_IN_IMPORT'
  | 'ENABLER_AMBIGUOUS'
  | 'ORPHAN_REFERENCE'
  // one cell or one number of a row
  | 'UNPARSEABLE_REFERENCE'
  | 'LF_OUT_OF_RANGE'
  | 'YEAR_MISMATCH'
  // found by the run against a database
  | 'ENABLER_NOT_IN_DATABASE';

export type YearColumn = 'C' | 'D' | 'E';

export interface PlanSkip {
  /** Row number in the sheet (the number Excel shows). */
  row: number;
  /** Column of the cell, null when the whole row is skipped. */
  column: YearColumn | null;
  code: SkipCode;
  /** Code of the enabler of the row (K6.2-d) when it is known. */
  enablerCode: string | null;
  componentCode: string | null;
  /** The learning field of a skipped single number (LF14), otherwise null. */
  learningField: string | null;
  /** Mappings that this skip costs (numbers read from the row), 0 if none. */
  pairs: number;
  /** Reason in plain words, never quotes the content of a cell. */
  reason: string;
}

export type NoteCode = 'COMPANY_ONLY' | 'NO_REFERENCE';

/** A row that has no learning field on purpose. Not an error. */
export interface PlanNote {
  row: number;
  code: NoteCode;
  enablerCode: string;
  componentCode: string;
}

export type TitleSource = 'csv' | 'json' | 'placeholder';

export interface PlanLearningField {
  /** LF1 to LF13, written to training_catalog_learning_fields.code. */
  code: string;
  number: number;
  title: string;
  titleSource: TitleSource;
  /** True unless the title came from the owner's titles file. */
  titleProvisional: boolean;
  trainingYear: SchoolYear;
  /** No source names the hours of a learning field: null. */
  hoursBudget: number | null;
  /** Position 1 to 13. */
  orderIndex: number;
}

export interface PlanMapping {
  /** K6.2-d */
  enablerCode: string;
  componentCode: string;
  /** LF3 */
  learningFieldCode: string;
  /** School year of the column the number stood in (always the year of the learning field). */
  schoolYear: SchoolYear;
  row: number;
  column: YearColumn;
}

export interface PositionStatus {
  /** At least one mapping. */
  mapped: number;
  /** No learning field because the position is taught in the company only. */
  companyOnly: number;
  /** All three school year cells are empty. */
  noReference: number;
  /** Skipped (see the skip list). */
  skipped: number;
}

export interface LearningFieldStats {
  sheet: {
    headerRow: number;
    firstDataRow: number;
    lastRow: number;
    sectionRows: number;
    blankRows: number;
  };
  /** Blocks (components of the table) and positions (rows with a letter or text). */
  blocks: number;
  positions: number;
  positionStatus: PositionStatus;
  /** Distinct enabler codes and components that carry at least one mapping. */
  enablersMapped: number;
  componentsMapped: number;
  mappings: number;
  mappingsBySchoolYear: Record<SchoolYear, number>;
  mappingsByLearningField: Record<string, number>;
  skippedByCode: Record<string, number>;
  /** Mappings the skips cost (read from the rows). */
  pairsSkipped: number;
  notesByCode: Record<string, number>;
  learningFields: {
    total: number;
    withProvisionalTitle: number;
    withPlaceholderTitle: number;
    withHours: number;
  };
}

export type OpenPoint =
  | 'HOURS_BUDGET'
  | 'TITLES_PROVISIONAL'
  | 'ALL_LEARNING_FIELDS'
  | 'USE_CASES'
  | 'COMPANY_ONLY';

export interface LearningFieldPlan {
  version: 1;
  /** Only KFBM is accepted. */
  catalog: string;
  generatedAt: string;
  source: {
    sheet: string;
    headerRow: number;
    firstDataRow: number;
    lastRow: number;
  };
  learningFields: PlanLearningField[];
  mappings: PlanMapping[];
  skipped: PlanSkip[];
  notes: PlanNote[];
  stats: LearningFieldStats;
  open: OpenPoint[];
  warnings: string[];
}
