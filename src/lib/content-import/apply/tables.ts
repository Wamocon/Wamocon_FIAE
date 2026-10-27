// The tables the apply step may touch, with the columns it may write. This
// list is the whole write surface: a table or column that is not listed here
// cannot be read or written through PgDb. There is no delete anywhere.
//
// The content import (TABLE_ORDER) writes the first eight tables. The use case
// import (phase 4.6, src/lib/content-import/use-cases) writes use_cases and
// more rows of content_documents. The learning field import (phase 4.5,
// src/lib/content-import/learning-fields) writes training_catalog_learning_fields
// and training_catalog_content_mappings.

export type TableName =
  | 'training_components'
  | 'courses'
  | 'enablers'
  | 'quizzes'
  | 'questions'
  | 'options'
  | 'enabler_quiz_links'
  | 'content_documents'
  | 'use_cases'
  | 'training_catalog_learning_fields'
  | 'training_catalog_content_mappings';

export interface TableSpec {
  /** Columns of a row without the id (all of them may be inserted). */
  columns: readonly string[];
  /**
   * The only columns that --update-existing may change. Everything else
   * (is_active, ids, authors, storage columns) is never overwritten.
   */
  updatable: readonly string[];
  /** Columns of the type uuid (for array comparisons). */
  uuid: readonly string[];
  /** The table has an updated_at column that an update refreshes. */
  touch: boolean;
}

export const TABLES: Record<TableName, TableSpec> = {
  training_components: {
    columns: [
      'training_catalog_id',
      'code',
      'title',
      'description',
      'total_weeks',
      'total_hours',
      'training_year',
      'phase',
      'kind',
      'order_index',
    ],
    updatable: ['title', 'description', 'phase', 'kind', 'order_index'],
    uuid: ['id', 'training_catalog_id'],
    touch: false,
  },
  courses: {
    columns: [
      'training_catalog_id',
      'code',
      'training_component_id',
      'title',
      'description',
      'year',
      'chapter',
      'exam_part',
      'created_by_id',
      'is_active',
      'is_published',
    ],
    updatable: ['title', 'description'],
    uuid: [
      'id',
      'training_catalog_id',
      'training_component_id',
      'created_by_id',
    ],
    touch: true,
  },
  enablers: {
    columns: [
      'course_id',
      'training_catalog_id',
      'code',
      'title',
      'order_index',
      'description_text',
      'is_active',
    ],
    updatable: ['title', 'description_text', 'order_index'],
    uuid: ['id', 'course_id', 'training_catalog_id'],
    touch: true,
  },
  quizzes: {
    columns: [
      'code',
      'title',
      'quiz_type',
      'created_by_id',
      'is_active',
      'training_catalog_id',
      'training_component_id',
    ],
    updatable: ['title'],
    uuid: [
      'id',
      'created_by_id',
      'training_catalog_id',
      'training_component_id',
    ],
    touch: true,
  },
  questions: {
    columns: [
      'quiz_id',
      'question_text',
      'question_type',
      'expected_answer',
      'order_index',
    ],
    updatable: ['question_text'],
    uuid: ['id', 'quiz_id'],
    touch: false,
  },
  options: {
    columns: [
      'question_id',
      'option_text',
      'is_correct',
      'explanation',
      'order_index',
    ],
    updatable: ['option_text', 'is_correct', 'explanation'],
    uuid: ['id', 'question_id'],
    touch: false,
  },
  enabler_quiz_links: {
    columns: ['enabler_id', 'quiz_id', 'difficulty'],
    updatable: [],
    uuid: ['id', 'enabler_id', 'quiz_id'],
    touch: false,
  },
  content_documents: {
    columns: [
      'enabler_id',
      'use_case_id',
      'course_id',
      'organization_id',
      'title',
      'description',
      'document_type',
      'visibility',
      'file_name',
      'file_size',
      'mime_type',
      'storage_url',
      'storage_path',
      'page_count',
      'order_index',
      'uploaded_by_id',
    ],
    updatable: ['description'],
    uuid: [
      'id',
      'enabler_id',
      'use_case_id',
      'course_id',
      'organization_id',
      'uploaded_by_id',
    ],
    touch: true,
  },
  use_cases: {
    columns: [
      'course_id',
      'training_catalog_id',
      'enabler_id',
      'code',
      'title',
      'description_text',
      'order_index',
      'is_active',
    ],
    // The course, the enabler link, the code and the activation are part of
    // the identity of a use case, only the visible texts and the position are
    // updated. The solution texts are not here: they live in content_documents.
    updatable: ['title', 'description_text', 'order_index'],
    uuid: ['id', 'course_id', 'training_catalog_id', 'enabler_id'],
    touch: true,
  },
  training_catalog_learning_fields: {
    columns: [
      'training_catalog_id',
      'code',
      'title',
      'description',
      'training_year',
      'hours_budget',
      'order_index',
    ],
    // Only the title and the hours (official time guideline) are updated. The
    // school year and the order are part of the identity of a learning field.
    updatable: ['title', 'hours_budget'],
    uuid: ['id', 'training_catalog_id'],
    touch: true,
  },
  training_catalog_content_mappings: {
    columns: [
      'learning_field_id',
      'enabler_id',
      'use_case_id',
      'training_catalog_id',
    ],
    updatable: [],
    uuid: [
      'id',
      'learning_field_id',
      'enabler_id',
      'use_case_id',
      'training_catalog_id',
    ],
    touch: false,
  },
};

/** The tables of the content import, in the order they are written. */
export const TABLE_ORDER: TableName[] = [
  'training_components',
  'courses',
  'enablers',
  'quizzes',
  'questions',
  'options',
  'enabler_quiz_links',
  'content_documents',
];
