/**
 * Import Content Data Script
 * 
 * Imports curriculum content from JSON files exported by export-content-data.ts.
 * Uses UPSERT (ON CONFLICT DO UPDATE) for idempotent re-runs.
 * 
 * IMPORTANT: Run this on the TARGET database (set DB_CONNECTION_STRING accordingly)
 *
 * Training catalogs: courses and quizzes keep their training_catalog_id
 * (rows of older exports are FIAE), courses/enablers/use cases keep their
 * code, use cases their enabler_id and global quizzes their
 * training_component_id. The import never creates catalogs or components;
 * they must exist in the target (catalogs come from the migration series
 * supabase/migrations/20261020*). Content of a non-FIAE catalog is refused if
 * the target has no catalog columns.
 *
 * The --trainer-id parameter is REQUIRED and specifies which trainer profile ID
 * should own the imported courses and quizzes in the target database.
 * 
 * Usage:
 *   npx tsx scripts/import-content-data.ts --trainer-id <uuid>
 *   npx tsx scripts/import-content-data.ts --trainer-id <uuid> --input ./my_export
 *   npx tsx scripts/import-content-data.ts --trainer-id <uuid> --dry-run
 * 
 * Options:
 *   --trainer-id <uuid>  (Required) The trainer profile ID to own imported content
 *   --input <dir>        Input directory (default: ./content_export)
 *   --dry-run            Validate without making changes
 *   --skip-activate      Don't activate enablers/use_cases (keep is_active=false)
 */

import * as fs from 'fs';
import * as path from 'path';
import db from '../src/db';
import { sql } from 'drizzle-orm';
import 'dotenv/config';

// Parse command line args
const args = process.argv.slice(2);

function getArg(name: string): string | null {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1];
  }
  return null;
}

const TRAINER_ID = getArg('trainer-id');
const INPUT_DIR = getArg('input') || path.join(__dirname, '..', 'content_export');
const DRY_RUN = args.includes('--dry-run');
const SKIP_ACTIVATE = args.includes('--skip-activate');

interface ImportStats {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

interface ImportResult {
  table: string;
  stats: ImportStats;
}

function readJsonFile<T>(fileName: string): T[] {
  const filePath = path.join(INPUT_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    console.log(`   ⚠️  File not found: ${fileName}, skipping...`);
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T[];
}

// Helper to escape strings for SQL
function escapeString(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  // Escape single quotes by doubling them
  return `'${String(value).replace(/'/g, "''")}'`;
}

function escapeJson(value: any): string {
  if (value === null || value === undefined) return 'NULL';
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
}

function escapeBool(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  return value ? 'true' : 'false';
}

function escapeInt(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  return String(value);
}

function escapeTimestamp(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  return `'${value}'::timestamptz`;
}

function escapeArray(value: string[] | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  const escaped = value.map(v => `"${v.replace(/"/g, '\\"')}"`).join(',');
  return `ARRAY[${value.map(v => escapeString(v)).join(',')}]::text[]`;
}

// --- Training catalog support -------------------------------------------
// The catalog columns (training_catalog_id, code, enabler_id,
// training_component_id) exist only after the training catalog migration
// series (supabase/migrations/20261020*). Older exports and older target
// databases are handled: missing catalog ids in the export mean FIAE, and
// target databases without the columns are only accepted for FIAE content.

const FIAE_CATALOG_ID = '00000000-0000-4000-8000-000000000001';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TargetColumns = Record<
  'courses' | 'enablers' | 'use_cases' | 'quizzes',
  Set<string>
>;

let targetColumns: TargetColumns = {
  courses: new Set(),
  enablers: new Set(),
  use_cases: new Set(),
  quizzes: new Set(),
};

async function getTableColumns(tableName: string): Promise<Set<string>> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = '${tableName}'`
    )
  )) as unknown as { column_name: string }[];
  return new Set(Array.from(rows, row => row.column_name));
}

interface ExtraColumn {
  name: string;
  value: string;
  updateOnConflict: boolean;
}

/** SQL fragments for the optional catalog columns of an upsert. */
function renderExtraColumns(extras: ExtraColumn[]): {
  insertColumns: string;
  insertValues: string;
  updateAssignments: string;
} {
  return {
    insertColumns: extras.map(extra => `, ${extra.name}`).join(''),
    insertValues: extras.map(extra => `, ${extra.value}`).join(''),
    updateAssignments: extras
      .filter(extra => extra.updateOnConflict)
      .map(extra => `,\n          ${extra.name} = EXCLUDED.${extra.name}`)
      .join(''),
  };
}

function uuidOrNull(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`invalid uuid in export file: ${value}`);
  }
  return `'${value}'::uuid`;
}

/** Catalog id of an exported row; rows of older exports are FIAE. */
function catalogIdOf(row: { training_catalog_id?: string | null }): string {
  return row.training_catalog_id ?? FIAE_CATALOG_ID;
}

let targetColumnsKnown = true;

async function detectTargetColumns(): Promise<void> {
  try {
    targetColumns = {
      courses: await getTableColumns('courses'),
      enablers: await getTableColumns('enablers'),
      use_cases: await getTableColumns('use_cases'),
      quizzes: await getTableColumns('quizzes'),
    };
  } catch (err: any) {
    if (!DRY_RUN) throw err;
    targetColumnsKnown = false;
    console.log(
      `   ⚠️  Dry run without database access (${err.message}); catalog columns are not checked.`
    );
  }
}

/**
 * Refuse to import catalog content that the target cannot hold: ids must be
 * valid, the target needs the catalog columns for non-FIAE content, and every
 * referenced catalog must exist in the target (the import never creates
 * catalogs, they come from the migration with fixed ids).
 */
async function preflightCatalogs(): Promise<void> {
  const referenced = new Set<string>();
  for (const fileName of ['courses.json', 'quizzes.json']) {
    for (const row of readJsonFile<{ training_catalog_id?: string | null }>(
      fileName
    )) {
      if (row.training_catalog_id) referenced.add(row.training_catalog_id);
    }
  }

  for (const catalogId of referenced) {
    if (!UUID_PATTERN.test(catalogId)) {
      throw new Error(`invalid training_catalog_id in export: ${catalogId}`);
    }
  }

  const foreign = [...referenced].filter(id => id !== FIAE_CATALOG_ID);
  if (foreign.length === 0 || !targetColumnsKnown) return;

  if (!targetColumns.courses.has('training_catalog_id')) {
    throw new Error(
      `The export contains content of other training catalogs (${foreign.join(', ')}) but the target database has no catalog columns. Apply the migration series supabase/migrations/20261020* first.`
    );
  }

  const found = (await db.execute(
    sql.raw(
      `SELECT id FROM training_catalogs WHERE id IN (${foreign
        .map(id => `'${id}'`)
        .join(', ')})`
    )
  )) as unknown as { id: string }[];
  const foundIds = new Set(Array.from(found, row => row.id));
  const missing = foreign.filter(id => !foundIds.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Training catalogs missing in the target database: ${missing.join(', ')}.`
    );
  }
}

async function importSkills(): Promise<ImportResult> {
  const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const skills = readJsonFile<{ id: string; name: string }>('skills.json');

  console.log(`📥 Importing ${skills.length} skills...`);

  for (const skill of skills) {
    try {
      const query = `
        INSERT INTO skills (id, name)
        VALUES ('${skill.id}', ${escapeString(skill.name)})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      `;

      if (!DRY_RUN) {
        await db.execute(sql.raw(query));
      }
      stats.inserted++;
    } catch (err: any) {
      stats.errors.push(`skill ${skill.id}: ${err.message}`);
    }
  }

  return { table: 'skills', stats };
}

async function importCourses(): Promise<ImportResult> {
  const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const courses = readJsonFile<any>('courses.json');

  console.log(`📥 Importing ${courses.length} courses...`);

  for (const course of courses) {
    try {
      // Catalog columns exist only in migrated target databases. The catalog
      // of an existing course is never changed by an import.
      const extras: ExtraColumn[] = [];
      if (targetColumns.courses.has('training_catalog_id')) {
        extras.push({
          name: 'training_catalog_id',
          value: uuidOrNull(catalogIdOf(course)),
          updateOnConflict: false,
        });
      }
      if (targetColumns.courses.has('code')) {
        extras.push({
          name: 'code',
          value: escapeString(course.code),
          updateOnConflict: true,
        });
      }
      const extra = renderExtraColumns(extras);

      // Use the provided trainer ID instead of the original created_by_id
      const query = `
        INSERT INTO courses (
          id, title, description, year, chapter, created_by_id,
          is_active, is_published, created_at, updated_at${extra.insertColumns}
        )
        VALUES (
          '${course.id}',
          ${escapeString(course.title)},
          ${escapeString(course.description)},
          ${escapeInt(course.year)},
          ${escapeInt(course.chapter)},
          '${TRAINER_ID}',
          ${escapeBool(course.is_active)},
          ${escapeBool(course.is_published)},
          ${escapeTimestamp(course.created_at)},
          ${escapeTimestamp(course.updated_at)}${extra.insertValues}
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          year = EXCLUDED.year,
          chapter = EXCLUDED.chapter,
          is_active = EXCLUDED.is_active,
          is_published = EXCLUDED.is_published,
          updated_at = NOW()${extra.updateAssignments}
      `;

      if (!DRY_RUN) {
        await db.execute(sql.raw(query));
      }
      stats.inserted++;
    } catch (err: any) {
      stats.errors.push(`course ${course.id}: ${err.message}`);
    }
  }

  return { table: 'courses', stats };
}

async function importCourseSkills(): Promise<ImportResult> {
  const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const courseSkills = readJsonFile<{ course_id: string; skill_id: string }>('course_skills.json');

  console.log(`📥 Importing ${courseSkills.length} course_skills...`);

  for (const cs of courseSkills) {
    try {
      const query = `
        INSERT INTO course_skills (course_id, skill_id)
        VALUES ('${cs.course_id}', '${cs.skill_id}')
        ON CONFLICT (course_id, skill_id) DO NOTHING
      `;

      if (!DRY_RUN) {
        await db.execute(sql.raw(query));
      }
      stats.inserted++;
    } catch (err: any) {
      stats.errors.push(`course_skill ${cs.course_id}/${cs.skill_id}: ${err.message}`);
    }
  }

  return { table: 'course_skills', stats };
}

async function importEnablers(): Promise<ImportResult> {
  const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const enablers = readJsonFile<any>('enablers.json');

  console.log(`📥 Importing ${enablers.length} enablers...`);

  for (const enabler of enablers) {
    try {
      const isActive = SKIP_ACTIVATE ? false : enabler.is_active;
      const activatedAt = SKIP_ACTIVATE ? null : enabler.activated_at;

      // enablers.training_catalog_id is derived from the course by a database
      // trigger and is not written here.
      const extras: ExtraColumn[] = [];
      if (targetColumns.enablers.has('code')) {
        extras.push({
          name: 'code',
          value: escapeString(enabler.code),
          updateOnConflict: true,
        });
      }
      const extra = renderExtraColumns(extras);

      const query = `
        INSERT INTO enablers (
          id, course_id, title, order_index, description_text,
          ppt_url, video_url,
          duration_value, duration_unit, is_active, activated_at,
          created_at, updated_at${extra.insertColumns}
        )
        VALUES (
          '${enabler.id}',
          '${enabler.course_id}',
          ${escapeString(enabler.title)},
          ${escapeInt(enabler.order_index)},
          ${escapeString(enabler.description_text)},
          ${escapeString(enabler.ppt_url)},
          ${escapeString(enabler.video_url)},
          ${escapeInt(enabler.duration_value)},
          ${enabler.duration_unit ? `'${enabler.duration_unit}'` : 'NULL'},
          ${escapeBool(isActive)},
          ${escapeTimestamp(activatedAt)},
          ${escapeTimestamp(enabler.created_at)},
          ${escapeTimestamp(enabler.updated_at)}${extra.insertValues}
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          order_index = EXCLUDED.order_index,
          description_text = EXCLUDED.description_text,
          ppt_url = EXCLUDED.ppt_url,
          video_url = EXCLUDED.video_url,
          duration_value = EXCLUDED.duration_value,
          duration_unit = EXCLUDED.duration_unit,
          is_active = EXCLUDED.is_active,
          activated_at = EXCLUDED.activated_at,
          updated_at = NOW()${extra.updateAssignments}
      `;

      if (!DRY_RUN) {
        await db.execute(sql.raw(query));
      }
      stats.inserted++;
    } catch (err: any) {
      stats.errors.push(`enabler ${enabler.id}: ${err.message}`);
    }
  }

  return { table: 'enablers', stats };
}

async function importUseCases(): Promise<ImportResult> {
  const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const useCases = readJsonFile<any>('use_cases.json');

  console.log(`📥 Importing ${useCases.length} use_cases...`);

  for (const uc of useCases) {
    try {
      const isActive = SKIP_ACTIVATE ? false : uc.is_active;
      const activatedAt = SKIP_ACTIVATE ? null : uc.activated_at;

      // use_cases.training_catalog_id is derived from the course by a database
      // trigger. enabler_id (1:1 link, must be in the same course) is written
      // explicitly; imported enablers come first in the import order.
      const extras: ExtraColumn[] = [];
      if (targetColumns.use_cases.has('code')) {
        extras.push({
          name: 'code',
          value: escapeString(uc.code),
          updateOnConflict: true,
        });
      }
      if (targetColumns.use_cases.has('enabler_id')) {
        extras.push({
          name: 'enabler_id',
          value: uuidOrNull(uc.enabler_id),
          updateOnConflict: true,
        });
      }
      const extra = renderExtraColumns(extras);

      const query = `
        INSERT INTO use_cases (
          id, course_id, title, description_text, order_index,
          duration_value, duration_unit, is_active, activated_at,
          year, training_stage, lernfelder, created_at, updated_at${extra.insertColumns}
        )
        VALUES (
          '${uc.id}',
          '${uc.course_id}',
          ${escapeString(uc.title)},
          ${escapeString(uc.description_text)},
          ${escapeInt(uc.order_index)},
          ${escapeInt(uc.duration_value)},
          ${uc.duration_unit ? `'${uc.duration_unit}'` : 'NULL'},
          ${escapeBool(isActive)},
          ${escapeTimestamp(activatedAt)},
          ${escapeInt(uc.year)},
          ${escapeInt(uc.training_stage)},
          ${uc.lernfelder ? escapeArray(uc.lernfelder) : 'NULL'},
          ${escapeTimestamp(uc.created_at)},
          ${escapeTimestamp(uc.updated_at)}${extra.insertValues}
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          description_text = EXCLUDED.description_text,
          order_index = EXCLUDED.order_index,
          duration_value = EXCLUDED.duration_value,
          duration_unit = EXCLUDED.duration_unit,
          is_active = EXCLUDED.is_active,
          activated_at = EXCLUDED.activated_at,
          year = EXCLUDED.year,
          training_stage = EXCLUDED.training_stage,
          lernfelder = EXCLUDED.lernfelder,
          updated_at = NOW()${extra.updateAssignments}
      `;

      if (!DRY_RUN) {
        await db.execute(sql.raw(query));
      }
      stats.inserted++;
    } catch (err: any) {
      stats.errors.push(`use_case ${uc.id}: ${err.message}`);
    }
  }

  return { table: 'use_cases', stats };
}

async function importContentDocuments(): Promise<ImportResult> {
  const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const docs = readJsonFile<any>('content_documents.json');

  console.log(`📥 Importing ${docs.length} content_documents...`);
  console.log(`   ⚠️  Note: This imports document metadata. Actual files must be in Supabase Storage!`);

  for (const doc of docs) {
    try {
      // Use the provided trainer ID for uploaded_by_id if original is set
      const uploadedById = doc.uploaded_by_id ? TRAINER_ID : null;

      const query = `
        INSERT INTO content_documents (
          id, enabler_id, use_case_id, course_id, title, description,
          document_type, visibility, file_name, file_size, mime_type,
          storage_url, storage_path, page_count, is_indexed_by_hai,
          order_index, uploaded_by_id, created_at, updated_at
        )
        VALUES (
          '${doc.id}',
          ${doc.enabler_id ? `'${doc.enabler_id}'` : 'NULL'},
          ${doc.use_case_id ? `'${doc.use_case_id}'` : 'NULL'},
          ${doc.course_id ? `'${doc.course_id}'` : 'NULL'},
          ${escapeString(doc.title)},
          ${escapeString(doc.description)},
          ${doc.document_type ? `'${doc.document_type}'` : 'NULL'},
          ${doc.visibility ? `'${doc.visibility}'` : 'NULL'},
          ${escapeString(doc.file_name)},
          ${escapeInt(doc.file_size)},
          ${escapeString(doc.mime_type)},
          ${escapeString(doc.storage_url)},
          ${escapeString(doc.storage_path)},
          ${escapeInt(doc.page_count)},
          ${escapeBool(doc.is_indexed_by_hai)},
          ${escapeInt(doc.order_index)},
          ${uploadedById ? `'${uploadedById}'` : 'NULL'},
          ${escapeTimestamp(doc.created_at)},
          ${escapeTimestamp(doc.updated_at)}
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          document_type = EXCLUDED.document_type,
          visibility = EXCLUDED.visibility,
          file_name = EXCLUDED.file_name,
          file_size = EXCLUDED.file_size,
          storage_url = EXCLUDED.storage_url,
          storage_path = EXCLUDED.storage_path,
          page_count = EXCLUDED.page_count,
          is_indexed_by_hai = EXCLUDED.is_indexed_by_hai,
          order_index = EXCLUDED.order_index,
          updated_at = NOW()
      `;

      if (!DRY_RUN) {
        await db.execute(sql.raw(query));
      }
      stats.inserted++;
    } catch (err: any) {
      stats.errors.push(`content_document ${doc.id}: ${err.message}`);
    }
  }

  return { table: 'content_documents', stats };
}

async function importQuizzes(): Promise<ImportResult> {
  const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const quizzes = readJsonFile<any>('quizzes.json');

  console.log(`📥 Importing ${quizzes.length} quizzes...`);

  for (const quiz of quizzes) {
    try {
      // Catalog and component binding of global quizzes (migrated targets
      // only). The component must already exist in the target database.
      const extras: ExtraColumn[] = [];
      if (targetColumns.quizzes.has('training_catalog_id')) {
        extras.push({
          name: 'training_catalog_id',
          value: uuidOrNull(catalogIdOf(quiz)),
          updateOnConflict: false,
        });
      }
      if (targetColumns.quizzes.has('training_component_id')) {
        extras.push({
          name: 'training_component_id',
          value: uuidOrNull(quiz.training_component_id),
          updateOnConflict: false,
        });
      }
      const extra = renderExtraColumns(extras);

      const query = `
        INSERT INTO quizzes (
          id, title, quiz_type, created_by_id, is_active,
          created_at, updated_at${extra.insertColumns}
        )
        VALUES (
          '${quiz.id}',
          ${escapeString(quiz.title)},
          '${quiz.quiz_type}',
          '${TRAINER_ID}',
          ${escapeBool(quiz.is_active)},
          ${escapeTimestamp(quiz.created_at)},
          ${escapeTimestamp(quiz.updated_at)}${extra.insertValues}
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          quiz_type = EXCLUDED.quiz_type,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
      `;

      if (!DRY_RUN) {
        await db.execute(sql.raw(query));
      }
      stats.inserted++;
    } catch (err: any) {
      stats.errors.push(`quiz ${quiz.id}: ${err.message}`);
    }
  }

  return { table: 'quizzes', stats };
}

async function importEnablerQuizzes(): Promise<ImportResult> {
  const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const enablerQuizzes = readJsonFile<{ enabler_id: string; quiz_id: string }>('enabler_quizzes.json');

  console.log(`📥 Importing ${enablerQuizzes.length} enabler_quizzes...`);

  for (const eq of enablerQuizzes) {
    try {
      const query = `
        INSERT INTO enabler_quizzes (enabler_id, quiz_id)
        VALUES ('${eq.enabler_id}', '${eq.quiz_id}')
        ON CONFLICT (enabler_id) DO UPDATE SET quiz_id = EXCLUDED.quiz_id
      `;

      if (!DRY_RUN) {
        await db.execute(sql.raw(query));
      }
      stats.inserted++;
    } catch (err: any) {
      stats.errors.push(`enabler_quiz ${eq.enabler_id}: ${err.message}`);
    }
  }

  return { table: 'enabler_quizzes', stats };
}

async function importEnablerQuizLinks(): Promise<ImportResult> {
  const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const links = readJsonFile<any>('enabler_quiz_links.json');

  console.log(`📥 Importing ${links.length} enabler_quiz_links...`);

  for (const link of links) {
    try {
      const query = `
        INSERT INTO enabler_quiz_links (id, enabler_id, quiz_id, difficulty)
        VALUES ('${link.id}', '${link.enabler_id}', '${link.quiz_id}', '${link.difficulty}')
        ON CONFLICT (id) DO UPDATE SET
          enabler_id = EXCLUDED.enabler_id,
          quiz_id = EXCLUDED.quiz_id,
          difficulty = EXCLUDED.difficulty
      `;

      if (!DRY_RUN) {
        await db.execute(sql.raw(query));
      }
      stats.inserted++;
    } catch (err: any) {
      stats.errors.push(`enabler_quiz_link ${link.id}: ${err.message}`);
    }
  }

  return { table: 'enabler_quiz_links', stats };
}

async function importQuestions(): Promise<ImportResult> {
  const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const questions = readJsonFile<any>('questions.json');

  console.log(`📥 Importing ${questions.length} questions...`);

  for (const q of questions) {
    try {
      const query = `
        INSERT INTO questions (
          id, quiz_id, question_text, question_type, expected_answer, order_index
        )
        VALUES (
          '${q.id}',
          '${q.quiz_id}',
          ${escapeString(q.question_text)},
          '${q.question_type || 'MCQ'}',
          ${escapeString(q.expected_answer)},
          ${escapeInt(q.order_index)}
        )
        ON CONFLICT (id) DO UPDATE SET
          question_text = EXCLUDED.question_text,
          question_type = EXCLUDED.question_type,
          expected_answer = EXCLUDED.expected_answer,
          order_index = EXCLUDED.order_index
      `;

      if (!DRY_RUN) {
        await db.execute(sql.raw(query));
      }
      stats.inserted++;
    } catch (err: any) {
      stats.errors.push(`question ${q.id}: ${err.message}`);
    }
  }

  return { table: 'questions', stats };
}

async function importOptions(): Promise<ImportResult> {
  const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const options = readJsonFile<any>('options.json');

  console.log(`📥 Importing ${options.length} options...`);

  for (const opt of options) {
    try {
      const query = `
        INSERT INTO options (
          id, question_id, option_text, is_correct, explanation
        )
        VALUES (
          '${opt.id}',
          '${opt.question_id}',
          ${escapeString(opt.option_text)},
          ${escapeBool(opt.is_correct)},
          ${escapeString(opt.explanation)}
        )
        ON CONFLICT (id) DO UPDATE SET
          option_text = EXCLUDED.option_text,
          is_correct = EXCLUDED.is_correct,
          explanation = EXCLUDED.explanation
      `;

      if (!DRY_RUN) {
        await db.execute(sql.raw(query));
      }
      stats.inserted++;
    } catch (err: any) {
      stats.errors.push(`option ${opt.id}: ${err.message}`);
    }
  }

  return { table: 'options', stats };
}

async function main() {
  console.log('\n🚀 Content Data Import Script\n');

  // Validate required args
  if (!TRAINER_ID) {
    console.error('❌ Error: --trainer-id is required');
    console.log('\nUsage:');
    console.log('  npx tsx scripts/import-content-data.ts --trainer-id <uuid>');
    console.log('  npx tsx scripts/import-content-data.ts --trainer-id <uuid> --dry-run');
    console.log('\nThe trainer-id should be an existing trainer profile UUID in the target database.');
    process.exit(1);
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(TRAINER_ID)) {
    console.error('❌ Error: --trainer-id must be a valid UUID');
    process.exit(1);
  }

  // Check input directory
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`❌ Error: Input directory not found: ${INPUT_DIR}`);
    console.log('Run export-content-data.ts first to create the export files.');
    process.exit(1);
  }

  console.log(`   Input directory: ${INPUT_DIR}`);
  console.log(`   Trainer ID: ${TRAINER_ID}`);
  console.log(`   Dry run: ${DRY_RUN}`);
  console.log(`   Skip activate: ${SKIP_ACTIVATE}`);
  console.log('');

  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  }

  // Verify trainer exists in target DB
  if (!DRY_RUN) {
    try {
      const result = await db.execute(
        sql.raw(`SELECT id, full_name, role FROM profiles WHERE id = '${TRAINER_ID}'`)
      );
      const rows: any[] = Array.from(result as any);
      if (rows.length === 0) {
        console.error(`❌ Error: Trainer ID ${TRAINER_ID} not found in target database`);
        console.log('Make sure the trainer profile exists before importing content.');
        process.exit(1);
      }
      const trainer = rows[0];
      if (trainer.role !== 'TRAINER') {
        console.error(`❌ Error: Profile ${TRAINER_ID} has role \"${trainer.role}\", expected \"TRAINER\"`);
        process.exit(1);
      }
      console.log(`✅ Verified trainer: ${trainer.full_name} (${TRAINER_ID})\n`);
    } catch (err: any) {
      console.error(`❌ Error verifying trainer: ${err.message}`);
      process.exit(1);
    }
  }

  // Detect the catalog columns of the target and refuse content the target
  // cannot hold (see preflightCatalogs).
  try {
    await detectTargetColumns();
    await preflightCatalogs();
    console.log(
      `   Catalog columns in target: ${
        targetColumns.courses.has('training_catalog_id') ? 'yes' : 'no (FIAE only)'
      }\n`
    );
  } catch (err: any) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }

  const results: ImportResult[] = [];

  // Import in FK-safe order
  results.push(await importSkills());
  results.push(await importCourses());
  results.push(await importCourseSkills());
  results.push(await importEnablers());
  results.push(await importUseCases());
  results.push(await importContentDocuments());
  results.push(await importQuizzes());
  results.push(await importEnablerQuizzes());
  results.push(await importEnablerQuizLinks());
  results.push(await importQuestions());
  results.push(await importOptions());

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Import Summary');
  console.log('='.repeat(60));

  let totalInserted = 0;
  let totalErrors = 0;

  for (const result of results) {
    const errorCount = result.stats.errors.length;
    totalInserted += result.stats.inserted;
    totalErrors += errorCount;

    const status = errorCount > 0 ? '⚠️' : '✅';
    console.log(`   ${status} ${result.table}: ${result.stats.inserted} rows`);

    if (errorCount > 0) {
      for (const err of result.stats.errors.slice(0, 3)) {
        console.log(`      - ${err}`);
      }
      if (errorCount > 3) {
        console.log(`      ... and ${errorCount - 3} more errors`);
      }
    }
  }

  console.log('');
  console.log(`   Total rows processed: ${totalInserted}`);
  console.log(`   Total errors: ${totalErrors}`);

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN - No actual changes were made');
    console.log('   Run without --dry-run to apply changes');
  } else {
    console.log('\n✅ Import complete!');
    console.log('\nNext steps:');
    console.log('1. Verify imported data in the application');
    console.log('2. If content_documents were imported, ensure files exist in Supabase Storage');
    console.log('3. Run HAI reindexing if needed for PDF content');
  }

  console.log('');
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
