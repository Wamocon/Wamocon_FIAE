/**
 * The content of ONE training catalog as the script checks read it: plain rows
 * in memory, so every rule is a pure function that a test can feed with a small
 * data set (script-checks.ts).
 *
 * Reading rules: one statement per group of rules (catalog, courses, enablers,
 * use cases, quizzes, questions, documents, learning fields and mappings,
 * phase plan components), never one query per enabler or quiz. Every statement
 * is bound to the catalog through the catalog column of its own table (or an
 * `exists` on such a table), never through a join that could multiply rows.
 * Every statement starts with a comment `/* cc:<name> *\/`, so a test can tell
 * the statements apart. Read only, nothing is written, nothing is stored.
 *
 * What is NOT read: the files in the storage (the storage access of the
 * platform only downloads, and a download of every file would be far too
 * heavy for a page of the admin) and a checksum of the documents (the table
 * content_documents has none).
 */

import { sql } from 'drizzle-orm';
import db from '@/db';
import { withDbRetry } from '@/lib/db-retry';

/** What the snapshot reads from the database: only `execute`. */
export type SnapshotExecutor = Pick<typeof db, 'execute'>;

export type QuizDifficulty = 'LOW' | 'MEDIUM' | 'HIGH';

export interface SnapshotCatalog {
  id: string;
  code: string;
  title: string;
  isActive: boolean;
  durationYears: number;
  settings: unknown;
}

export interface SnapshotCourse {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  trainingComponentId: string | null;
  isActive: boolean;
}

export interface SnapshotEnabler {
  id: string;
  courseId: string;
  catalogId: string;
  /** Catalog of the course of the enabler, null when the course is missing. */
  courseCatalogId: string | null;
  code: string | null;
  title: string;
  orderIndex: number;
  description: string | null;
  /** The old single scenario PDF is filled (blanks do not count). */
  hasScenarioPdf: boolean;
  isActive: boolean;
}

export interface SnapshotUseCase {
  id: string;
  courseId: string;
  catalogId: string;
  enablerId: string | null;
  code: string | null;
  title: string;
  description: string | null;
  orderIndex: number;
  isActive: boolean;
}

export interface SnapshotQuiz {
  id: string;
  code: string | null;
  title: string;
  type: 'LESSON' | 'GLOBAL';
  isActive: boolean;
  catalogId: string;
  /** The enabler the quiz is linked to (enabler_quiz_links), null if none. */
  enablerId: string | null;
  enablerCatalogId: string | null;
  difficulty: QuizDifficulty | null;
  questionCount: number;
}

export interface SnapshotQuestion {
  id: string;
  quizId: string;
  type: 'MCQ' | 'TEXT';
  /** Trimmed, cut at 500 characters. */
  text: string;
  optionCount: number;
  correctCount: number;
  emptyOptionCount: number;
}

export interface SnapshotDocument {
  id: string;
  enablerId: string | null;
  useCaseId: string | null;
  courseId: string | null;
  title: string;
  type: string;
  fileName: string;
  /** The stored address is not blank. */
  hasFile: boolean;
  /**
   * The description is not blank. The KfBM import keeps the text of a scenario
   * part (starting situation, background knowledge) in the description and
   * stores no file for it, so a document with text is no document without content.
   */
  hasText: boolean;
  fileSize: number | null;
  pageCount: number | null;
}

export interface SnapshotLearningField {
  id: string;
  code: string;
  title: string;
}

export interface SnapshotMapping {
  learningFieldId: string;
  enablerId: string | null;
  useCaseId: string | null;
}

export interface SnapshotComponent {
  id: string;
  code: string;
  title: string;
  totalWeeks: number;
  totalHours: number;
  phase: number | null;
  kind: string;
}

export interface ContentSnapshot {
  catalog: SnapshotCatalog;
  courses: SnapshotCourse[];
  enablers: SnapshotEnabler[];
  useCases: SnapshotUseCase[];
  quizzes: SnapshotQuiz[];
  questions: SnapshotQuestion[];
  documents: SnapshotDocument[];
  learningFields: SnapshotLearningField[];
  mappings: SnapshotMapping[];
  components: SnapshotComponent[];
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : num(value);
const str = (value: unknown): string =>
  typeof value === 'string' ? value : '';
const strOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

type Row = Record<string, unknown>;

/**
 * Reads the snapshot of one catalog, or null when the catalog does not exist.
 * The statements run one after the other on the one connection (a page of the
 * admin needs no parallel load, and the memory of the machine is small).
 */
export async function loadContentSnapshot(
  q: SnapshotExecutor,
  catalogId: string
): Promise<ContentSnapshot | null> {
  const id = sql`${catalogId}::uuid`;
  const run = async (statement: ReturnType<typeof sql>): Promise<Row[]> =>
    (await withDbRetry(() => q.execute(statement))) as unknown as Row[];

  const catalogRows = await run(sql`
    /* cc:catalog */
    select c.id, c.code, c.title, c.is_active, c.duration_years, c.settings
    from training_catalogs c
    where c.id = ${id}
  `);
  if (catalogRows.length === 0) return null;
  const c = catalogRows[0];

  const courses = await run(sql`
    /* cc:courses */
    select x.id, x.code, x.title, x.description, x.training_component_id,
      x.is_active
    from courses x
    where x.training_catalog_id = ${id}
    order by x.year nulls last, x.chapter nulls last, x.title, x.id
  `);

  // An enabler of this catalog, or of a course of this catalog (a mismatch of
  // the two is a finding, so both directions are read)
  const enablers = await run(sql`
    /* cc:enablers */
    select e.id, e.course_id, e.training_catalog_id,
      k.training_catalog_id as course_catalog_id,
      e.code, e.title, e.order_index, e.description_text,
      (nullif(btrim(e.scenario_pdf_url), '') is not null) as has_scenario_pdf,
      e.is_active
    from enablers e
    left join courses k on k.id = e.course_id
    where e.training_catalog_id = ${id} or k.training_catalog_id = ${id}
    order by e.course_id, e.order_index, e.id
  `);

  const useCases = await run(sql`
    /* cc:use_cases */
    select u.id, u.course_id, u.training_catalog_id, u.enabler_id, u.code,
      u.title, u.description_text, u.order_index, u.is_active
    from use_cases u
    where u.training_catalog_id = ${id}
    order by u.course_id, u.order_index, u.id
  `);

  const quizzes = await run(sql`
    /* cc:quizzes */
    select z.id, z.code, z.title, z.quiz_type::text as quiz_type, z.is_active,
      z.training_catalog_id, l.enabler_id,
      e.training_catalog_id as enabler_catalog_id,
      l.difficulty::text as difficulty,
      (select count(*) from questions qu where qu.quiz_id = z.id)::int
        as question_count
    from quizzes z
    left join enabler_quiz_links l on l.quiz_id = z.id
    left join enablers e on e.id = l.enabler_id
    where z.training_catalog_id = ${id} or e.training_catalog_id = ${id}
    order by z.id
  `);

  const questions = await run(sql`
    /* cc:questions */
    select qu.id, qu.quiz_id, qu.question_type::text as question_type,
      left(btrim(qu.question_text), 500) as text,
      (select count(*) from options o where o.question_id = qu.id)::int
        as option_count,
      (select count(*) from options o
        where o.question_id = qu.id and o.is_correct)::int as correct_count,
      (select count(*) from options o
        where o.question_id = qu.id and btrim(o.option_text) = '')::int
        as empty_option_count
    from questions qu
    join quizzes z on z.id = qu.quiz_id
    where z.training_catalog_id = ${id}
    order by qu.quiz_id, qu.order_index nulls last, qu.id
  `);

  // Documents of the platform (no organization): the ones of an organization
  // are its own and no platform content (same rule as the statistics)
  const documents = await run(sql`
    /* cc:documents */
    select d.id, d.enabler_id, d.use_case_id, d.course_id, d.title,
      d.document_type::text as document_type, d.file_name,
      (nullif(btrim(d.storage_url), '') is not null) as has_file,
      (nullif(btrim(d.description), '') is not null) as has_text,
      d.file_size, d.page_count
    from content_documents d
    where d.organization_id is null
      and (
        d.enabler_id in (
          select x.id from enablers x where x.training_catalog_id = ${id})
        or d.use_case_id in (
          select x.id from use_cases x where x.training_catalog_id = ${id})
        or d.course_id in (
          select x.id from courses x where x.training_catalog_id = ${id})
      )
    order by d.enabler_id, d.use_case_id, d.order_index nulls last, d.id
  `);

  const learningFields = await run(sql`
    /* cc:learning_fields */
    select f.id, f.code, f.title
    from training_catalog_learning_fields f
    where f.training_catalog_id = ${id}
    order by f.order_index
  `);

  const mappings = await run(sql`
    /* cc:mappings */
    select m.learning_field_id, m.enabler_id, m.use_case_id
    from training_catalog_content_mappings m
    where m.training_catalog_id = ${id}
  `);

  const components = await run(sql`
    /* cc:components */
    select t.id, t.code, t.title, t.total_weeks, t.total_hours, t.phase, t.kind
    from training_components t
    where t.training_catalog_id = ${id}
    order by t.order_index, t.code
  `);

  return {
    catalog: {
      id: str(c.id),
      code: str(c.code),
      title: str(c.title),
      isActive: c.is_active === true,
      durationYears: num(c.duration_years),
      settings: c.settings,
    },
    courses: courses.map(r => ({
      id: str(r.id),
      code: strOrNull(r.code),
      title: str(r.title),
      description: strOrNull(r.description),
      trainingComponentId: strOrNull(r.training_component_id),
      isActive: r.is_active === true,
    })),
    enablers: enablers.map(r => ({
      id: str(r.id),
      courseId: str(r.course_id),
      catalogId: str(r.training_catalog_id),
      courseCatalogId: strOrNull(r.course_catalog_id),
      code: strOrNull(r.code),
      title: str(r.title),
      orderIndex: num(r.order_index),
      description: strOrNull(r.description_text),
      hasScenarioPdf: r.has_scenario_pdf === true,
      isActive: r.is_active === true,
    })),
    useCases: useCases.map(r => ({
      id: str(r.id),
      courseId: str(r.course_id),
      catalogId: str(r.training_catalog_id),
      enablerId: strOrNull(r.enabler_id),
      code: strOrNull(r.code),
      title: str(r.title),
      description: strOrNull(r.description_text),
      orderIndex: num(r.order_index),
      isActive: r.is_active === true,
    })),
    quizzes: quizzes.map(r => ({
      id: str(r.id),
      code: strOrNull(r.code),
      title: str(r.title),
      type: r.quiz_type === 'GLOBAL' ? 'GLOBAL' : 'LESSON',
      isActive: r.is_active === true,
      catalogId: str(r.training_catalog_id),
      enablerId: strOrNull(r.enabler_id),
      enablerCatalogId: strOrNull(r.enabler_catalog_id),
      difficulty:
        r.difficulty === 'LOW' ||
        r.difficulty === 'MEDIUM' ||
        r.difficulty === 'HIGH'
          ? r.difficulty
          : null,
      questionCount: num(r.question_count),
    })),
    questions: questions.map(r => ({
      id: str(r.id),
      quizId: str(r.quiz_id),
      type: r.question_type === 'TEXT' ? 'TEXT' : 'MCQ',
      text: str(r.text),
      optionCount: num(r.option_count),
      correctCount: num(r.correct_count),
      emptyOptionCount: num(r.empty_option_count),
    })),
    documents: documents.map(r => ({
      id: str(r.id),
      enablerId: strOrNull(r.enabler_id),
      useCaseId: strOrNull(r.use_case_id),
      courseId: strOrNull(r.course_id),
      title: str(r.title),
      type: str(r.document_type),
      fileName: str(r.file_name),
      hasFile: r.has_file === true,
      hasText: r.has_text === true,
      fileSize: numOrNull(r.file_size),
      pageCount: numOrNull(r.page_count),
    })),
    learningFields: learningFields.map(r => ({
      id: str(r.id),
      code: str(r.code),
      title: str(r.title),
    })),
    mappings: mappings.map(r => ({
      learningFieldId: str(r.learning_field_id),
      enablerId: strOrNull(r.enabler_id),
      useCaseId: strOrNull(r.use_case_id),
    })),
    components: components.map(r => ({
      id: str(r.id),
      code: str(r.code),
      title: str(r.title),
      totalWeeks: num(r.total_weeks),
      totalHours: num(r.total_hours),
      phase: numOrNull(r.phase),
      kind: str(r.kind),
    })),
  };
}
