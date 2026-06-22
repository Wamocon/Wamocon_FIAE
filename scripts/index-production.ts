/**
 * Standalone Production Data Indexer
 *
 * Connects to the PRODUCTION Supabase database and indexes all content
 * (courses, enablers) and trainee personal data (profiles, schedules, progress)
 * into the vector database using Gemini embeddings.
 *
 * This script overrides DB_CONNECTION_STRING to point at production,
 * while keeping .env.local pointed at QA for normal dev work.
 *
 * Run with:
 *   npx tsx scripts/index-production.ts
 *   npx tsx scripts/index-production.ts --content-only
 *   npx tsx scripts/index-production.ts --trainees-only
 */

// ── 1. Override env vars BEFORE any module imports ──────────────────────────
// Load .env.local first to get GEMINI_API_KEY etc.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Override DB connection to production.
// The production connection string must be supplied via the environment
// (e.g. PROD_DB_CONNECTION_STRING in your shell or .env.local). It is NOT
// hardcoded here to avoid committing database credentials to source control.
const PROD_DB_URL =
  process.env.PROD_DB_CONNECTION_STRING || process.env.PROD_DB_URL || '';
if (!PROD_DB_URL) {
  console.error(
    'ERROR: Set PROD_DB_CONNECTION_STRING (production Supabase pooler URL) before running this script.'
  );
  process.exit(1);
}
process.env.DB_CONNECTION_STRING = PROD_DB_URL;

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  HAI.ai Production Data Indexer');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  DB: Production (ngpsgwwlnlliphfgtrya)`);
console.log(`  Embeddings: Gemini (gemini-embedding-001)`);
console.log(
  `  GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✓ set' : '✗ MISSING'}`
);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (!process.env.GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY is required for embedding generation.');
  process.exit(1);
}

// ── 2. Parse CLI args ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const contentOnly = args.includes('--content-only');
const traineesOnly = args.includes('--trainees-only');
const indexBoth = !contentOnly && !traineesOnly;

// ── 3. Run indexing ─────────────────────────────────────────────────────────
async function main() {
  // Dynamic imports AFTER env override so DB connects to production
  const { indexAllContent, indexAllTrainees } =
    await import('../src/lib/hai/traineeDataIndexer');

  const startTime = Date.now();

  try {
    // Index shared content (courses + enablers)
    if (indexBoth || contentOnly) {
      console.log('\n📚 Indexing shared content (courses + enablers)...\n');
      const contentResult = await indexAllContent();
      console.log('\n✅ Content indexing complete:');
      console.log(`   Courses indexed: ${contentResult.coursesIndexed}`);
      console.log(`   Enablers indexed: ${contentResult.enablersIndexed}`);
      if (contentResult.errors.length > 0) {
        console.log(`   Errors: ${contentResult.errors.length}`);
        contentResult.errors.forEach((e: string) => console.log(`     - ${e}`));
      }
    }

    // Index trainee personal data
    if (indexBoth || traineesOnly) {
      console.log('\n👤 Indexing trainee personal data...\n');
      const traineeResult = await indexAllTrainees();
      console.log('\n✅ Trainee indexing complete:');
      console.log(`   Total trainees: ${traineeResult.totalTrainees}`);
      console.log(
        `   Successfully indexed: ${traineeResult.successfullyIndexed}`
      );
      console.log(`   Failed: ${traineeResult.failed}`);

      // Print per-trainee details
      for (const r of traineeResult.results) {
        const status =
          r.errors.length > 0
            ? '⚠️'
            : r.profileResult.success ||
                r.scheduleResult.success ||
                r.progressResult.success
              ? '✅'
              : '⏭️';
        console.log(
          `   ${status} ${r.traineeName}: profile=${r.profileResult.chunks} chunks, schedule=${r.scheduleResult.chunks} chunks, progress=${r.progressResult.chunks} chunks`
        );
        if (r.errors.length > 0) {
          r.errors.forEach((e: string) => console.log(`       Error: ${e}`));
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Done in ${elapsed}s`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  } catch (error) {
    console.error('\n❌ Fatal error during indexing:');
    console.error(error);
    process.exit(1);
  }

  // Force exit since postgres connections may keep the process alive
  process.exit(0);
}

main();
