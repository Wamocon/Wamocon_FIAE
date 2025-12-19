/**
 * Cleanup Duplicate Import Script
 * 
 * Removes duplicate courses, enablers, and content_documents
 * that were created from running the import twice.
 * 
 * Usage: npx tsx -r dotenv/config scripts/cleanup-duplicates.ts
 */

import 'dotenv/config';
import db from '../src/db';
import { courses, enablers, contentDocuments } from '../src/db/migrations/schemas/schema';
import { sql } from 'drizzle-orm';

async function main() {
    console.log('🧹 Cleanup Duplicates Script');
    console.log('=============================\n');

    // Get counts before
    const [courseCount] = await db.execute(sql`SELECT COUNT(*) as count FROM courses`);
    const [enablerCount] = await db.execute(sql`SELECT COUNT(*) as count FROM enablers`);
    const [docCount] = await db.execute(sql`SELECT COUNT(*) as count FROM content_documents`);

    console.log('📊 Current counts:');
    console.log(`   Courses:   ${(courseCount as any).count}`);
    console.log(`   Enablers:  ${(enablerCount as any).count}`);
    console.log(`   Documents: ${(docCount as any).count}\n`);

    console.log('🔄 Removing duplicates...\n');

    // Step 1: Remove duplicate content_documents (keep oldest by created_at)
    console.log('   📄 Cleaning content_documents...');
    await db.execute(sql`
        DELETE FROM content_documents a
        USING content_documents b
        WHERE a.id > b.id
        AND a.enabler_id = b.enabler_id
        AND a.file_name = b.file_name
    `);

    // Step 2: Remove duplicate enablers (keep oldest by id)
    console.log('   📝 Cleaning enablers...');
    await db.execute(sql`
        DELETE FROM enablers a
        USING enablers b
        WHERE a.id > b.id
        AND a.course_id = b.course_id
        AND a.title = b.title
    `);

    // Step 3: Remove orphaned content_documents (whose enablers were deleted)
    console.log('   🔗 Removing orphaned documents...');
    await db.execute(sql`
        DELETE FROM content_documents
        WHERE enabler_id NOT IN (SELECT id FROM enablers)
    `);

    // Step 4: Remove duplicate courses (keep oldest by id)
    console.log('   📚 Cleaning courses...');
    await db.execute(sql`
        DELETE FROM courses a
        USING courses b
        WHERE a.id > b.id
        AND a.title = b.title
    `);

    // Step 5: Remove orphaned enablers (whose courses were deleted)
    console.log('   🔗 Removing orphaned enablers...');
    await db.execute(sql`
        DELETE FROM enablers
        WHERE course_id NOT IN (SELECT id FROM courses)
    `);

    // Step 6: Remove orphaned content_documents again
    console.log('   🔗 Final orphan cleanup...');
    await db.execute(sql`
        DELETE FROM content_documents
        WHERE enabler_id IS NOT NULL 
        AND enabler_id NOT IN (SELECT id FROM enablers)
    `);

    // Get counts after
    const [courseCountAfter] = await db.execute(sql`SELECT COUNT(*) as count FROM courses`);
    const [enablerCountAfter] = await db.execute(sql`SELECT COUNT(*) as count FROM enablers`);
    const [docCountAfter] = await db.execute(sql`SELECT COUNT(*) as count FROM content_documents`);

    console.log('\n✅ Cleanup complete!\n');
    console.log('📊 Final counts:');
    console.log(`   Courses:   ${(courseCountAfter as any).count} (was ${(courseCount as any).count})`);
    console.log(`   Enablers:  ${(enablerCountAfter as any).count} (was ${(enablerCount as any).count})`);
    console.log(`   Documents: ${(docCountAfter as any).count} (was ${(docCount as any).count})`);

    process.exit(0);
}

main().catch((e) => {
    console.error('❌ Cleanup failed:', e);
    process.exit(1);
});
