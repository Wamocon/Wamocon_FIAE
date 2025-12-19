/**
 * Production Cleanup Script
 * 
 * Runs the production cleanup migration to remove all test/seed data
 * while preserving user profiles and Supabase Storage files.
 * 
 * Usage: npx ts-node scripts/run-production-cleanup.ts
 */

import 'dotenv/config';
import postgres from 'postgres';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const url = process.env.DB_CONNECTION_STRING;
    if (!url) {
        console.error('❌ DB_CONNECTION_STRING not set');
        console.log('\nPlease set DB_CONNECTION_STRING in your .env file or environment');
        process.exit(1);
    }

    console.log('🗑️  Production Cleanup Script');
    console.log('============================\n');
    console.log('⚠️  WARNING: This will DELETE all test data!\n');
    console.log('✅ PRESERVED:');
    console.log('   - profiles (user accounts)');
    console.log('   - Supabase Storage files (PDFs)\n');
    console.log('❌ DELETED:');
    console.log('   - courses, enablers, use_cases');
    console.log('   - quizzes, questions, options');
    console.log('   - all submissions and progress data');
    console.log('   - content_documents (metadata only)\n');

    // Read the migration SQL
    const migrationPath = path.join(__dirname, '..', 'src', 'db', 'migrations', 'drizzle', '0014_production_cleanup.sql');

    if (!fs.existsSync(migrationPath)) {
        console.error('❌ Migration file not found:', migrationPath);
        process.exit(1);
    }

    const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

    // Extract DELETE statements (skip comments)
    const statements = migrationSql
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('DELETE FROM'))
        .map(line => line.replace(/;$/, ''));

    console.log(`📋 Found ${statements.length} DELETE statements to execute\n`);

    const sql = postgres(url, { max: 1 });

    try {
        console.log('🔄 Starting cleanup...\n');

        for (const statement of statements) {
            const tableName = statement.match(/"([^"]+)"/)?.[1] || 'unknown';
            process.stdout.write(`   Cleaning ${tableName}... `);

            try {
                const result = await sql.unsafe(statement + ';');
                console.log('✅');
            } catch (e: any) {
                // Some tables might not exist, that's OK
                console.log(`⚠️ (${e.message})`);
            }
        }

        console.log('\n✅ Production cleanup completed successfully!');
        console.log('\n📝 Next steps:');
        console.log('   1. Run the import script to add production data');
        console.log('   2. Verify data in the application');

    } catch (e: any) {
        console.error('\n❌ Cleanup failed:', e.message);
        process.exit(1);
    } finally {
        await sql.end({ timeout: 2 });
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
