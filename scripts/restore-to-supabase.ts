/**
 * Supabase Restore Script
 * 
 * This script restores a backup to a target Supabase instance:
 * 1. Uploads all Storage files from backup to target buckets
 * 
 * Usage: 
 *   Set TARGET_* environment variables in .env.test
 *   npx ts-node scripts/restore-to-supabase.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Configuration - reads from .env.test for target
const BACKUP_DIR = path.join(__dirname, '..', 'supabase_backup');
const STORAGE_BACKUP_DIR = path.join(BACKUP_DIR, 'storage');

// Target Supabase configuration (from .env.test)
// Override source .env with target credentials
const TARGET_SUPABASE_URL = process.env.TARGET_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const TARGET_SERVICE_KEY = process.env.TARGET_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

interface RestoreStats {
    totalBuckets: number;
    totalFiles: number;
    successfulUploads: number;
    failedUploads: number;
    errors: string[];
}

// Ensure bucket exists, create if not
async function ensureBucket(
    supabase: any,
    bucketName: string,
    isPublic: boolean = true
): Promise<boolean> {
    // Check if bucket exists
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();

    if (listError) {
        console.error(`   ❌ Failed to list buckets: ${listError.message}`);
        return false;
    }

    const exists = buckets?.some((b: any) => b.name === bucketName);

    if (!exists) {
        console.log(`   Creating bucket: ${bucketName}...`);
        const { error } = await supabase.storage.createBucket(bucketName, {
            public: isPublic,
        });

        if (error) {
            console.error(`   ❌ Failed to create bucket: ${error.message}`);
            return false;
        }
        console.log(`   ✅ Bucket created`);
    }

    return true;
}

// Get all files in a directory recursively
function getAllFiles(dirPath: string, basePath: string = ''): { localPath: string; storagePath: string }[] {
    const files: { localPath: string; storagePath: string }[] = [];

    if (!fs.existsSync(dirPath)) return files;

    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const item of items) {
        const localPath = path.join(dirPath, item.name);
        const storagePath = basePath ? `${basePath}/${item.name}` : item.name;

        if (item.isDirectory()) {
            files.push(...getAllFiles(localPath, storagePath));
        } else {
            files.push({ localPath, storagePath });
        }
    }

    return files;
}

// Upload a single file
async function uploadFile(
    supabase: any,
    bucket: string,
    localPath: string,
    storagePath: string
): Promise<boolean> {
    try {
        const fileBuffer = fs.readFileSync(localPath);
        const ext = path.extname(localPath).toLowerCase();

        // Determine content type
        const contentTypes: Record<string, string> = {
            '.pdf': 'application/pdf',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.json': 'application/json',
            '.txt': 'text/plain',
        };

        const { error } = await supabase.storage
            .from(bucket)
            .upload(storagePath, fileBuffer, {
                contentType: contentTypes[ext] || 'application/octet-stream',
                upsert: true,
            });

        if (error) {
            console.error(`   ❌ Failed: ${error.message}`);
            console.error(`      Path: ${storagePath}`);
            console.error(`      Error details: ${JSON.stringify(error)}`);
            return false;
        }

        return true;
    } catch (err: any) {
        console.error(`   ❌ Error: ${err.message}`);
        return false;
    }
}

// Restore all storage
async function restoreStorage(supabase: any): Promise<RestoreStats> {
    const stats: RestoreStats = {
        totalBuckets: 0,
        totalFiles: 0,
        successfulUploads: 0,
        failedUploads: 0,
        errors: [],
    };

    console.log('\n📦 Restoring Storage from backup...\n');

    // List bucket folders in backup
    if (!fs.existsSync(STORAGE_BACKUP_DIR)) {
        console.error('❌ Storage backup directory not found!');
        console.error(`   Expected at: ${STORAGE_BACKUP_DIR}`);
        return stats;
    }

    const bucketFolders = fs.readdirSync(STORAGE_BACKUP_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

    stats.totalBuckets = bucketFolders.length;
    console.log(`Found ${bucketFolders.length} bucket(s) to restore:\n`);

    for (const bucketName of bucketFolders) {
        console.log(`\n🗂️  Restoring bucket: ${bucketName}`);

        // Ensure bucket exists
        const bucketReady = await ensureBucket(supabase, bucketName, true);
        if (!bucketReady) {
            stats.errors.push(`Failed to create bucket: ${bucketName}`);
            continue;
        }

        const bucketPath = path.join(STORAGE_BACKUP_DIR, bucketName);
        const files = getAllFiles(bucketPath);

        console.log(`   Files to upload: ${files.length}`);
        stats.totalFiles += files.length;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            process.stdout.write(`   [${i + 1}/${files.length}] ${file.storagePath.substring(0, 50)}... `);

            const success = await uploadFile(supabase, bucketName, file.localPath, file.storagePath);

            if (success) {
                stats.successfulUploads++;
                console.log('✅');
            } else {
                stats.failedUploads++;
                stats.errors.push(`${bucketName}/${file.storagePath}`);
            }
        }
    }

    return stats;
}

// Main execution
async function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('       SUPABASE RESTORE SCRIPT                         ');
    console.log('═══════════════════════════════════════════════════════\n');

    // Validate credentials
    if (!TARGET_SUPABASE_URL || !TARGET_SERVICE_KEY) {
        console.error('❌ Missing target Supabase credentials!');
        console.error('   Set TARGET_SUPABASE_URL and TARGET_SERVICE_ROLE_KEY');
        console.error('   Or use NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    console.log(`📍 Target: ${TARGET_SUPABASE_URL}`);
    console.log(`📂 Backup Dir: ${BACKUP_DIR}\n`);

    // Confirm before proceeding
    console.log('⚠️  This will upload files to the target Supabase instance.');
    console.log('   Existing files with same paths will be overwritten.\n');

    // Initialize Supabase client
    const supabase = createClient(TARGET_SUPABASE_URL, TARGET_SERVICE_KEY);

    // Restore Storage
    console.log('\n🔄 Restoring Storage...');
    const stats = await restoreStorage(supabase);

    // Summary
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('                   RESTORE SUMMARY                     ');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`   📦 Buckets: ${stats.totalBuckets}`);
    console.log(`   📄 Files: ${stats.successfulUploads} / ${stats.totalFiles}`);

    if (stats.failedUploads > 0) {
        console.log(`   ⚠️  Failed: ${stats.failedUploads}`);
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('                   DATABASE RESTORE                    ');
    console.log('═══════════════════════════════════════════════════════');
    console.log('\nTo restore the database, run:\n');
    console.log(`psql "YOUR_TARGET_DB_CONNECTION_STRING" < "${path.join(BACKUP_DIR, 'database_backup.sql')}"\n`);

    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ Storage restore complete!');
    console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
