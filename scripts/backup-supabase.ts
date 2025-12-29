/**
 * Supabase Full Backup Script
 * 
 * This script creates a comprehensive backup of:
 * 1. All Storage files (PDFs, images, etc.) from all buckets
 * 2. Database dump instructions (using pg_dump externally)
 * 
 * Usage: 
 *   npx ts-node scripts/backup-supabase.ts
 * 
 * Make sure to set environment variables in .env:
 *   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Configuration
const BACKUP_DIR = path.join(__dirname, '..', 'supabase_backup');
const BACKUP_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

// Supabase configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface BackupStats {
  totalBuckets: number;
  totalFiles: number;
  totalSize: number;
  successfulDownloads: number;
  failedDownloads: number;
  errors: string[];
}

// Ensure directory exists
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// List all files in a bucket (recursive)
async function listAllFiles(
  supabase: any,
  bucket: string,
  folderPath: string = ''
): Promise<{ name: string; path: string; size: number }[]> {
  const files: { name: string; path: string; size: number }[] = [];

  const { data, error } = await supabase.storage
    .from(bucket)
    .list(folderPath, { limit: 1000, offset: 0 });

  if (error) {
    console.error(`Error listing ${bucket}/${folderPath}: ${error.message}`);
    return files;
  }

  for (const item of data || []) {
    const itemPath = folderPath ? `${folderPath}/${item.name}` : item.name;

    if (item.id === null) {
      // It's a folder, recurse
      const subFiles = await listAllFiles(supabase, bucket, itemPath);
      files.push(...subFiles);
    } else {
      // It's a file
      files.push({
        name: item.name,
        path: itemPath,
        size: item.metadata?.size || 0,
      });
    }
  }

  return files;
}

// Download a single file
async function downloadFile(
  supabase: any,
  bucket: string,
  filePath: string,
  localPath: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(filePath);

    if (error) {
      console.error(`  ❌ Failed to download ${filePath}: ${error.message}`);
      return false;
    }

    // Ensure parent directory exists
    ensureDir(path.dirname(localPath));

    // Write file
    const buffer = Buffer.from(await data.arrayBuffer());
    fs.writeFileSync(localPath, buffer);

    return true;
  } catch (err: any) {
    console.error(`  ❌ Error downloading ${filePath}: ${err.message}`);
    return false;
  }
}

// Backup all buckets
async function backupStorage(supabase: any): Promise<BackupStats> {
  const stats: BackupStats = {
    totalBuckets: 0,
    totalFiles: 0,
    totalSize: 0,
    successfulDownloads: 0,
    failedDownloads: 0,
    errors: [],
  };

  console.log('\n📦 Listing Storage Buckets...\n');

  // List all buckets
  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();

  if (bucketsError) {
    console.error(`❌ Failed to list buckets: ${bucketsError.message}`);
    stats.errors.push(`Failed to list buckets: ${bucketsError.message}`);
    return stats;
  }

  stats.totalBuckets = buckets.length;
  console.log(`Found ${buckets.length} bucket(s):\n`);

  for (const bucket of buckets) {
    console.log(`\n🗂️  Bucket: ${bucket.name}`);
    console.log(`   Public: ${bucket.public}`);

    // Create bucket backup directory
    const bucketDir = path.join(BACKUP_DIR, 'storage', bucket.name);
    ensureDir(bucketDir);

    // List all files in bucket
    const files = await listAllFiles(supabase, bucket.name);
    console.log(`   Files: ${files.length}`);

    stats.totalFiles += files.length;

    if (files.length === 0) {
      console.log('   (empty bucket)');
      continue;
    }

    // Download each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const localPath = path.join(bucketDir, file.path);

      process.stdout.write(`   [${i + 1}/${files.length}] Downloading: ${file.path.substring(0, 50)}... `);

      const success = await downloadFile(supabase, bucket.name, file.path, localPath);

      if (success) {
        stats.successfulDownloads++;
        stats.totalSize += file.size;
        console.log('✅');
      } else {
        stats.failedDownloads++;
        stats.errors.push(`Failed to download: ${bucket.name}/${file.path}`);
      }
    }
  }

  return stats;
}

// Generate backup manifest
function generateManifest(stats: BackupStats): void {
  const manifest = {
    backupDate: new Date().toISOString(),
    sourceUrl: SUPABASE_URL,
    stats: {
      totalBuckets: stats.totalBuckets,
      totalFiles: stats.totalFiles,
      totalSize: formatBytes(stats.totalSize),
      totalSizeBytes: stats.totalSize,
      successfulDownloads: stats.successfulDownloads,
      failedDownloads: stats.failedDownloads,
    },
    errors: stats.errors,
    instructions: {
      restoreDatabase: 'Use pg_restore or psql to restore the data_backup.sql file',
      restoreStorage: 'Upload files from storage/ folder to respective buckets in target Supabase',
      restoreCommand: 'npx ts-node scripts/restore-to-supabase.ts',
    },
  };

  const manifestPath = path.join(BACKUP_DIR, 'backup_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n📋 Manifest saved to: ${manifestPath}`);
}

// Main execution
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('       SUPABASE FULL BACKUP SCRIPT                     ');
  console.log('═══════════════════════════════════════════════════════\n');

  // Validate credentials
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing Supabase credentials!');
    console.error('   Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  console.log(`📍 Source: ${SUPABASE_URL}`);
  console.log(`📂 Backup Dir: ${BACKUP_DIR}\n`);

  // Create backup directory
  ensureDir(BACKUP_DIR);
  ensureDir(path.join(BACKUP_DIR, 'storage'));

  // Initialize Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Backup Storage
  console.log('\n🔄 STEP 1: Backing up Storage...');
  const storageStats = await backupStorage(supabase);

  // Generate manifest
  generateManifest(storageStats);

  // Summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('                    BACKUP SUMMARY                     ');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`   📦 Buckets: ${storageStats.totalBuckets}`);
  console.log(`   📄 Files: ${storageStats.successfulDownloads} / ${storageStats.totalFiles}`);
  console.log(`   💾 Total Size: ${formatBytes(storageStats.totalSize)}`);

  if (storageStats.failedDownloads > 0) {
    console.log(`   ⚠️  Failed: ${storageStats.failedDownloads}`);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('                  DATABASE BACKUP                      ');
  console.log('═══════════════════════════════════════════════════════');
  console.log('\nTo backup the database, run the following command:\n');

  // Extract connection info from environment
  const dbUrl = process.env.DB_CONNECTION_STRING || '';
  const projectRef = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || 'YOUR_PROJECT';

  console.log(`pg_dump "${dbUrl}" > "${path.join(BACKUP_DIR, 'database_backup.sql')}"\n`);
  console.log('Or use Supabase Dashboard: Project Settings → Database → Backups\n');

  console.log('═══════════════════════════════════════════════════════');
  console.log('✅ Storage backup complete!');
  console.log(`📂 Files saved to: ${BACKUP_DIR}`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
