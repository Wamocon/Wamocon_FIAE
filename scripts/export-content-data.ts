/**
 * Export Content Data Script
 * 
 * Exports all curriculum content from the database to JSON files for migration.
 * This exports in FK-safe order so data can be imported without violating constraints.
 * 
 * Tables exported (in order):
 * 1. skills - Standalone skill definitions
 * 2. courses - Course definitions (createdById stored but needs remapping on import)
 * 3. course_skills - Many-to-many course-skill links
 * 4. enablers - Learning enablers
 * 5. use_cases - Use case content
 * 6. content_documents - PDFs and documents (Note: actual files need separate backup)
 * 7. quizzes - Quiz definitions
 * 8. enabler_quizzes - Legacy 1:1 enabler-quiz links
 * 9. enabler_quiz_links - New multi-difficulty enabler-quiz links
 * 10. questions - Quiz questions
 * 11. options - Answer options
 * 
 * Usage:
 *   npx tsx scripts/export-content-data.ts
 *   npx tsx scripts/export-content-data.ts --output ./my_export
 * 
 * Output: JSON files in ./content_export/ directory
 */

import * as fs from 'fs';
import * as path from 'path';
import db from '../src/db';
import { sql } from 'drizzle-orm';
import 'dotenv/config';

// Parse command line args
const args = process.argv.slice(2);
const outputDirIndex = args.indexOf('--output');
const EXPORT_DIR = outputDirIndex !== -1 && args[outputDirIndex + 1]
  ? args[outputDirIndex + 1]
  : path.join(__dirname, '..', 'content_export');

interface ExportManifest {
  exportedAt: string;
  sourceDb: string;
  tables: {
    name: string;
    count: number;
    exportedAt: string;
  }[];
  warnings: string[];
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function exportTable<T>(
  tableName: string,
  query: string,
  manifest: ExportManifest
): Promise<T[]> {
  console.log(`📦 Exporting ${tableName}...`);
  
  try {
    const rows = (await db.execute(sql.raw(query))) as T[];
    
    // Write to JSON file
    const filePath = path.join(EXPORT_DIR, `${tableName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf-8');
    
    manifest.tables.push({
      name: tableName,
      count: rows.length,
      exportedAt: new Date().toISOString(),
    });
    
    console.log(`   ✅ ${rows.length} rows exported to ${tableName}.json`);
    return rows;
  } catch (error: any) {
    console.error(`   ❌ Error exporting ${tableName}: ${error.message}`);
    manifest.warnings.push(`Failed to export ${tableName}: ${error.message}`);
    return [];
  }
}

async function main() {
  console.log('\n🚀 Content Data Export Script\n');
  console.log(`   Output directory: ${EXPORT_DIR}\n`);

  ensureDir(EXPORT_DIR);

  const manifest: ExportManifest = {
    exportedAt: new Date().toISOString(),
    sourceDb: process.env.DB_CONNECTION_STRING?.replace(/:[^:@]+@/, ':***@') || 'unknown',
    tables: [],
    warnings: [],
  };

  // 1. Export skills (no FK dependencies)
  await exportTable(
    'skills',
    'SELECT id, name FROM skills ORDER BY name',
    manifest
  );

  // 2. Export courses (store createdById for reference, will need remapping on import)
  await exportTable(
    'courses',
    `SELECT id, title, description, year, chapter, created_by_id, 
            is_active, is_published, created_at, updated_at 
     FROM courses ORDER BY year, chapter, title`,
    manifest
  );

  // 3. Export course_skills (composite FK)
  await exportTable(
    'course_skills',
    'SELECT course_id, skill_id FROM course_skills',
    manifest
  );

  // 4. Export enablers
  await exportTable(
    'enablers',
    `SELECT id, course_id, title, order_index, description_text, ppt_url, 
            video_url, scenario_text, hint_text, scenario_image_url, scenarios,
            duration_value, duration_unit, is_active, activated_at, 
            created_at, updated_at 
     FROM enablers ORDER BY course_id, order_index`,
    manifest
  );

  // 5. Export use_cases
  await exportTable(
    'use_cases',
    `SELECT id, course_id, title, description_text, order_index, 
            duration_value, duration_unit, is_active, activated_at,
            year, training_stage, lernfelder, created_at, updated_at
     FROM use_cases ORDER BY course_id, order_index`,
    manifest
  );

  // 6. Export content_documents (file URLs - actual files need separate backup!)
  const docs = await exportTable(
    'content_documents',
    `SELECT id, enabler_id, use_case_id, course_id, title, description,
            document_type, visibility, file_name, file_size, mime_type,
            storage_url, storage_path, page_count, is_indexed_by_hai,
            order_index, uploaded_by_id, created_at, updated_at
     FROM content_documents ORDER BY enabler_id, use_case_id, order_index`,
    manifest
  );

  if (docs.length > 0) {
    manifest.warnings.push(
      `${docs.length} content_documents exported. Remember to also backup the actual files from Supabase Storage!`
    );
  }

  // 7. Export quizzes (store createdById for reference, will need remapping on import)
  await exportTable(
    'quizzes',
    `SELECT id, title, quiz_type, created_by_id, is_active, 
            created_at, updated_at 
     FROM quizzes ORDER BY title`,
    manifest
  );

  // 8. Export enabler_quizzes (legacy 1:1 link)
  await exportTable(
    'enabler_quizzes',
    'SELECT enabler_id, quiz_id FROM enabler_quizzes',
    manifest
  );

  // 9. Export enabler_quiz_links (new multi-difficulty links)
  await exportTable(
    'enabler_quiz_links',
    'SELECT id, enabler_id, quiz_id, difficulty FROM enabler_quiz_links',
    manifest
  );

  // 10. Export questions
  await exportTable(
    'questions',
    `SELECT id, quiz_id, question_text, question_type, expected_answer, order_index
     FROM questions ORDER BY quiz_id, order_index`,
    manifest
  );

  // 11. Export options
  await exportTable(
    'options',
    `SELECT id, question_id, option_text, is_correct, explanation
     FROM options ORDER BY question_id`,
    manifest
  );

  // Write manifest
  const manifestPath = path.join(EXPORT_DIR, 'export_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Export Summary');
  console.log('='.repeat(60));
  console.log(`   Exported at: ${manifest.exportedAt}`);
  console.log(`   Output directory: ${EXPORT_DIR}`);
  console.log(`   Tables exported: ${manifest.tables.length}`);
  
  let totalRows = 0;
  for (const table of manifest.tables) {
    console.log(`   - ${table.name}: ${table.count} rows`);
    totalRows += table.count;
  }
  console.log(`   Total rows: ${totalRows}`);

  if (manifest.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    for (const warning of manifest.warnings) {
      console.log(`   - ${warning}`);
    }
  }

  console.log('\n✅ Export complete!\n');
  console.log('Next steps:');
  console.log('1. Review exported JSON files in:', EXPORT_DIR);
  console.log('2. Backup Supabase Storage files if needed (see backup-supabase.ts)');
  console.log('3. Run import-content-data.ts on the target database');
  console.log('');

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
