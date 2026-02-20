/**
 * migrate-use-cases-to-prod.ts
 *
 * Migrates use_cases and TRAINER_SOLUTION content_documents from QA to Production.
 * Uses the Supabase Management API (no psql required).
 *
 * Steps:
 *  1. Fetch missing courses from QA and insert into production
 *  2. Insert all use_cases (ON CONFLICT DO NOTHING — keeps same UUIDs)
 *  3. Insert TRAINER_SOLUTION content_documents with storage URL rewritten to production
 *
 * Usage:
 *   npx tsx scripts/migrate-use-cases-to-prod.ts
 *   npx tsx scripts/migrate-use-cases-to-prod.ts --dry-run
 */

const PAT = 'sbp_v0_0b1b9efc97e0fe7d45edcd2e6c071e882ce56f75';
const QA_PROJECT  = 'thzssnabxgchzbsnbgoh';
const PROD_PROJECT = 'ngpsgwwlnlliphfgtrya';

const QA_HOST   = `https://${QA_PROJECT}.supabase.co`;
const PROD_HOST = `https://${PROD_PROJECT}.supabase.co`;

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Helpers ────────────────────────────────────────────────────────────────

function esc(v: string | null | undefined): string {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function escInt(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'NULL';
  return String(Math.floor(v));
}

function escBool(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return 'NULL';
  return v ? 'true' : 'false';
}

function escArray(v: string[] | null | undefined): string {
  if (!v || v.length === 0) return 'NULL';
  return `ARRAY[${v.map(esc).join(',')}]::text[]`;
}

async function queryDB(project: string, sql: string): Promise<any[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DB query failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function execProd(sql: string, label: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`   [DRY-RUN] ${label}`);
    return;
  }
  await queryDB(PROD_PROJECT, sql);
}

// ─── Step 1: Missing courses ─────────────────────────────────────────────────

async function migrateMissingCourses(): Promise<void> {
  console.log('\n[1/3] Checking for missing courses...');

  const qaCourses   = await queryDB(QA_PROJECT,   'SELECT id FROM courses');
  const prodCourses = await queryDB(PROD_PROJECT, 'SELECT id FROM courses');

  const prodIds = new Set(prodCourses.map((r: any) => r.id));
  const missingIds = qaCourses.map((r: any) => r.id).filter((id: string) => !prodIds.has(id));

  if (missingIds.length === 0) {
    console.log('   All QA courses already exist in production. Nothing to insert.');
    return;
  }

  console.log(`   Found ${missingIds.length} course(s) missing in production: ${missingIds.join(', ')}`);

  // Fetch full course data from QA
  const rows = await queryDB(
    QA_PROJECT,
    `SELECT id, title, description, year, chapter, created_by_id,
            is_active, is_published, created_at, updated_at
     FROM courses
     WHERE id IN (${missingIds.map(esc).join(',')})`
  );

  // Get a valid trainer/owner from production to assign created_by_id
  const prodTrainers = await queryDB(PROD_PROJECT, `SELECT id FROM profiles WHERE role = 'TRAINER' LIMIT 1`);
  const fallbackTrainerId = prodTrainers.length > 0 ? prodTrainers[0].id : null;

  for (const c of rows) {
    const createdById = fallbackTrainerId ? `'${fallbackTrainerId}'` : 'NULL';
    const sql = `
      INSERT INTO courses (id, title, description, year, chapter, created_by_id,
                           is_active, is_published, created_at, updated_at)
      VALUES (
        '${c.id}',
        ${esc(c.title)},
        ${esc(c.description)},
        ${escInt(c.year)},
        ${escInt(c.chapter)},
        ${createdById},
        ${escBool(c.is_active)},
        ${escBool(c.is_published)},
        ${c.created_at ? esc(c.created_at) + '::timestamptz' : 'NOW()'},
        ${c.updated_at ? esc(c.updated_at) + '::timestamptz' : 'NOW()'}
      )
      ON CONFLICT (id) DO NOTHING
    `;
    await execProd(sql, `INSERT course '${c.title}'`);
    console.log(`   Inserted course: ${c.title} (${c.id})`);
  }
}

// ─── Step 2: use_cases ───────────────────────────────────────────────────────

async function migrateUseCases(): Promise<void> {
  console.log('\n[2/3] Migrating use_cases...');

  const rows = await queryDB(
    QA_PROJECT,
    `SELECT id, course_id, title, description_text, order_index,
            duration_value, duration_unit, is_active, year, training_stage, lernfelder
     FROM use_cases
     ORDER BY course_id, order_index`
  );

  console.log(`   Found ${rows.length} use_cases in QA.`);

  let inserted = 0;
  let skipped  = 0;
  const errors: string[] = [];

  for (const uc of rows) {
    try {
      const sql = `
        INSERT INTO use_cases (
          id, course_id, title, description_text, order_index,
          duration_value, duration_unit, is_active,
          year, training_stage, lernfelder,
          created_at, updated_at
        )
        VALUES (
          '${uc.id}',
          '${uc.course_id}',
          ${esc(uc.title)},
          ${esc(uc.description_text)},
          ${escInt(uc.order_index)},
          ${escInt(uc.duration_value)},
          ${uc.duration_unit ? `'${uc.duration_unit}'` : 'NULL'},
          ${escBool(uc.is_active)},
          ${escInt(uc.year)},
          ${escInt(uc.training_stage)},
          ${escArray(uc.lernfelder)},
          NOW(),
          NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `;
      await execProd(sql, `INSERT use_case '${uc.title}'`);
      inserted++;
    } catch (err: any) {
      errors.push(`use_case ${uc.id} (${uc.title}): ${err.message}`);
    }
  }

  console.log(`   Inserted: ${inserted}, Errors: ${errors.length}`);
  for (const e of errors) console.error(`   ERROR: ${e}`);
}

// ─── Step 3: TRAINER_SOLUTION content_documents ──────────────────────────────

async function migrateTrainerSolutions(): Promise<void> {
  console.log('\n[3/3] Migrating TRAINER_SOLUTION content_documents...');

  const rows = await queryDB(
    QA_PROJECT,
    `SELECT id, use_case_id, title, description, document_type, file_name,
            file_size, mime_type, storage_url, storage_path, order_index, uploaded_by_id
     FROM content_documents
     WHERE document_type = 'TRAINER_SOLUTION'
     ORDER BY use_case_id, order_index`
  );

  console.log(`   Found ${rows.length} TRAINER_SOLUTION docs in QA.`);

  let inserted = 0;
  const errors: string[] = [];

  for (const doc of rows) {
    try {
      // Replace QA storage hostname with production hostname
      const prodStorageUrl = doc.storage_url
        ? doc.storage_url.replace(QA_HOST, PROD_HOST)
        : null;

      const sql = `
        INSERT INTO content_documents (
          id, use_case_id, title, description, document_type,
          file_name, file_size, mime_type,
          storage_url, storage_path, order_index,
          is_indexed_by_hai,
          created_at, updated_at
        )
        VALUES (
          '${doc.id}',
          ${doc.use_case_id ? `'${doc.use_case_id}'` : 'NULL'},
          ${esc(doc.title)},
          ${esc(doc.description)},
          'TRAINER_SOLUTION',
          ${esc(doc.file_name)},
          ${escInt(doc.file_size)},
          ${esc(doc.mime_type)},
          ${esc(prodStorageUrl)},
          ${esc(doc.storage_path)},
          ${escInt(doc.order_index)},
          false,
          NOW(),
          NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `;
      await execProd(sql, `INSERT doc '${doc.title}'`);
      inserted++;
    } catch (err: any) {
      errors.push(`doc ${doc.id}: ${err.message}`);
    }
  }

  console.log(`   Inserted: ${inserted}, Errors: ${errors.length}`);
  for (const e of errors) console.error(`   ERROR: ${e}`);
}

// ─── Verify ──────────────────────────────────────────────────────────────────

async function verify(): Promise<void> {
  console.log('\n--- Verification (production) ---');

  const [ucCount, tsCount, urlSample] = await Promise.all([
    queryDB(PROD_PROJECT, 'SELECT COUNT(*) AS n FROM use_cases'),
    queryDB(PROD_PROJECT, "SELECT COUNT(*) AS n FROM content_documents WHERE document_type = 'TRAINER_SOLUTION'"),
    queryDB(PROD_PROJECT, "SELECT storage_url FROM content_documents WHERE document_type = 'TRAINER_SOLUTION' LIMIT 3"),
  ]);

  console.log(`   use_cases:                 ${ucCount[0].n}`);
  console.log(`   TRAINER_SOLUTION docs:     ${tsCount[0].n}`);
  console.log(`   Sample storage URLs:`);
  for (const r of urlSample) {
    const ok = (r.storage_url as string).startsWith(PROD_HOST) ? 'OK' : 'WRONG HOST';
    console.log(`     [${ok}] ${r.storage_url}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('  Use-Case Migration: QA → Production');
  console.log(`  QA:   ${QA_PROJECT}`);
  console.log(`  PROD: ${PROD_PROJECT}`);
  if (DRY_RUN) console.log('  MODE: DRY RUN — no changes will be made');
  console.log('='.repeat(60));

  await migrateMissingCourses();
  await migrateUseCases();
  await migrateTrainerSolutions();
  await verify();

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
