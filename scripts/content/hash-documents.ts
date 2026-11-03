/**
 * Fills content_documents.content_sha256 from the stored files and lists the documents whose
 * file is missing in the storage (see scripts/content/lib/hash-documents.ts for the rules).
 *
 *   npm run content:hash -- --target preview
 *   npm run content:hash -- --target preview --limit 20
 *   npm run content:hash -- --target preview --apply --confirm-host <host>
 *   npm run content:hash -- --target production --i-know-this-is-production [--apply --confirm-host <host>]
 *
 * The connection comes from PREVIEW_IMPORT_DB_URL (preview) or PRODUCTION_ADMIN_DB_URL
 * (production), the storage from NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY, all read
 * from .env.local. The log names no key, no connection string and no file content.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import postgres from 'postgres';
import {
  BUCKET,
  checkTarget,
  hostOf,
  parseArgs,
  runHash,
  writeReport,
  type StorageAccess,
} from './lib/hash-documents';
import type { ContentReadingClient } from '../../src/lib/storage/contentRead';

const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};

function storageAccess(): StorageAccess | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    supabaseUrl: url,
    reading: client as unknown as ContentReadingClient,
    async exists(path: string) {
      try {
        const { data, error } = await client.storage.from(BUCKET).exists(path);
        if (error) return 'unknown';
        return data === true;
      } catch {
        return 'unknown';
      }
    },
  };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) return fail(parsed.error);
  const options = parsed.options;

  dotenv.config({ path: '.env.local' });
  const url = process.env[options.dbUrlEnv];
  if (!url) return fail(`The variable ${options.dbUrlEnv} is not set.`);
  const host = hostOf(url);

  const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
  try {
    const [{ role }] = await sql`select current_user as role`;
    const problem = checkTarget({ role, dbHost: host, options });
    if (problem) return fail(problem);
    console.log(
      `Target ${options.target}, role ${String(role).split('.')[0]}, host ${host}, mode ${options.apply ? 'APPLY' : 'DRY RUN'}`
    );

    const report = await runHash(options, {
      db: sql,
      storage: storageAccess(),
      host,
      log: line => console.log(line),
    });
    const file = writeReport(report, options.reportDir);
    const c = report.counts;
    console.log(
      `Done in ${(report.durationMs / 1000).toFixed(1)} s: read ${c.read}, hashed ${c.hashed}, written ${c.written}, missing in the storage ${c.missing}, invalid address ${c.invalid}, external ${c.external}, failed ${c.failed}`
    );
    console.log(`Report: ${file}`);
  } finally {
    await sql.end();
  }
}

main().catch(error => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
