/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * The database gives anon and authenticated no table access except the minimum the
 * browser really uses (supabase/migrations/20261029000300_security_revoke_api_table_access.sql).
 * This test ties the browser code to that minimum: a new direct supabase-js access
 * to another table, an rpc call, or a write on a table of the list fails here
 * instead of failing in production with "permission denied". To open something on
 * purpose, change the migration (a new one) and this list in the same pull request.
 */

const SRC = path.join(process.cwd(), 'src');
const MIGRATION = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20261029000300_security_revoke_api_table_access.sql'
);

type Access = { select: boolean; update: boolean };

/** The documented minimum of the browser, per table. */
const BROWSER_TABLE_ACCESS: Record<string, Access> = {
  profiles: { select: true, update: true },
  notifications: { select: true, update: false },
  organizations: { select: true, update: false },
};
/** Tables the browser reads or writes with .from('table') on the shared browser client. */
const BROWSER_FROM_TABLES = ['profiles'];
/** Tables the browser listens to (postgres_changes). */
const BROWSER_REALTIME_TABLES = ['notifications', 'profiles'];
/** Storage buckets the browser uploads to. */
const BROWSER_BUCKETS = ['avatar', 'content'];
/**
 * Server files that call .from('table') of supabase-js with the service role (admin
 * client). They are not browser code and are not limited by the grants of anon and
 * authenticated. A new file here needs a look at the key it uses.
 */
const SERVER_ADMIN_CLIENT_FILES = [
  'src/app/api/auth/sync-profile/route.ts',
  'src/app/api/trainer/courses/[courseId]/members/route.ts',
  'src/lib/auth-helpers.ts',
];

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = listSources(SRC).map(file => ({
  rel: path.relative(process.cwd(), file).split(path.sep).join('/'),
  text: fs.readFileSync(file, 'utf-8'),
}));

/** Code that runs in the browser with the public key: client components and everything that uses the shared browser client. */
function isBrowserFile(file: { rel: string; text: string }): boolean {
  if (file.rel === 'src/lib/supabase.ts') return false;
  return (
    /^\s*['"]use client['"]/m.test(file.text) ||
    /from\s+['"]@\/lib\/supabase['"]/.test(file.text) ||
    /createBrowserClient\s*\(/.test(file.text)
  );
}

/** `.from('x')` calls that are table accesses (not `.storage.from('bucket')`). */
function tableAccesses(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\.from\(\s*(['"`])(\w+)\1/g)) {
    const before = text.slice(Math.max(0, match.index - 30), match.index);
    if (!/storage\s*$/.test(before)) found.push(match[2]);
  }
  return found;
}

function bucketAccesses(text: string): string[] {
  return [
    ...text.matchAll(/\.storage\s*\.from\(\s*(['"`])(\w+)\1/g),
    ...text.matchAll(/BUCKET_NAME\s*=\s*(['"`])(\w+)\1/g),
  ].map(match => match[2]);
}

const browserFiles = files.filter(isBrowserFile);

describe('browser access to the database', () => {
  it('finds the browser files this test is about', () => {
    const names = browserFiles.map(file => file.rel);
    expect(names).toEqual(
      expect.arrayContaining([
        'src/contexts/AuthContext.tsx',
        'src/components/profile/Profile.tsx',
        'src/components/ui/NotificationsBell.tsx',
        'src/components/trainer/PdfUploader.tsx',
      ])
    );
  });

  it('reads and writes only the documented tables with .from()', () => {
    const used = new Set<string>();
    for (const file of browserFiles) {
      for (const table of tableAccesses(file.text)) {
        used.add(table);
        expect({ file: file.rel, allowed: BROWSER_FROM_TABLES }).toEqual({
          file: file.rel,
          allowed: expect.arrayContaining([table]),
        });
      }
    }
    expect([...used].sort()).toEqual([...BROWSER_FROM_TABLES].sort());
  });

  it('never inserts, upserts or deletes through the browser client', () => {
    for (const file of browserFiles) {
      const writes = [
        ...file.text.matchAll(
          /\.from\(\s*['"`]\w+['"`]\s*\)\s*\.\s*(insert|upsert|delete)\s*\(/g
        ),
      ].map(match => match[1]);
      expect({ file: file.rel, writes }).toEqual({
        file: file.rel,
        writes: [],
      });
    }
  });

  it('does not build table names at run time and does not reach the REST or GraphQL interface directly', () => {
    for (const file of browserFiles) {
      const dynamic = [
        ...file.text.matchAll(/supabase\s*\.\s*from\(\s*[^'"`\s)]/g),
      ].length;
      expect({
        file: file.rel,
        dynamic,
        direct: /\/rest\/v1|\/graphql\/v1|\.schema\s*\(/.test(file.text),
      }).toEqual({ file: file.rel, dynamic: 0, direct: false });
    }
  });

  it('creates supabase-js clients only in the known files', () => {
    const creators = files
      .filter(file => /@supabase\/(supabase-js|ssr)/.test(file.text))
      .filter(file =>
        /createClient|createBrowserClient|createServerClient/.test(file.text)
      )
      .map(file => file.rel)
      .sort();
    // the browser client, the session check and the admin clients of the server
    // (the staging storage of the content upload uses the secret key for the
    // private bucket content-upload only, on the server; the transfer writes the
    // copies of enabler text originals to the document bucket with it, only in the exact
    // path form of document-storage.ts, upsert off, and only for files that a person
    // named in the apply; solution-storage.ts signs the model solutions of the private
    // bucket content-solutions for the trainer list, server side, ten minutes, only for
    // trainer-only rows; storage/contentUrl.ts signs the files of the bucket content for
    // the lists, server side, 15 to 60 minutes, only objects of that bucket with a strict
    // path from a row the person may see; storage/contentRead.ts reads such a file for the
    // PDF extraction and the certificate logo, server side, never sent to a browser)
    // (a new one needs a look at the key it uses)
    expect(creators).toEqual([
      'src/app/api/admin/users/[userId]/route.ts',
      'src/app/api/admin/users/route.ts',
      'src/app/api/auth/resend-confirmation/route.ts',
      'src/app/api/auth/sync-profile/route.ts',
      'src/app/api/register/route.ts',
      'src/app/api/trainer/courses/[courseId]/members/route.ts',
      // the confirmation of the e-mail address: public key only, no session kept
      'src/app/auth/callback/route.ts',
      'src/lib/auth-helpers.ts',
      'src/lib/auth/session.ts',
      'src/lib/content-upload/staging/storage.ts',
      'src/lib/content-upload/transfer/content-bucket.ts',
      'src/lib/document-file-cleanup.ts',
      'src/lib/solution-storage.ts',
      'src/lib/storage/contentRead.ts',
      'src/lib/storage/contentUrl.ts',
      'src/lib/supabase.ts',
      'src/utils/supabase/server.ts',
    ]);
  });

  it('calls no database function (rpc) from the browser', () => {
    for (const file of browserFiles) {
      expect({
        file: file.rel,
        rpc: /\.rpc\s*\(/.test(file.text),
      }).toEqual({ file: file.rel, rpc: false });
    }
  });

  it('listens only to the tables the realtime subscriptions are granted for', () => {
    const tables = new Set<string>();
    for (const file of browserFiles) {
      for (const match of file.text.matchAll(/table:\s*(['"`])(\w+)\1/g)) {
        tables.add(match[2]);
      }
    }
    expect([...tables].sort()).toEqual([...BROWSER_REALTIME_TABLES].sort());
    for (const table of tables) {
      expect(BROWSER_TABLE_ACCESS[table]?.select).toBe(true);
    }
  });

  it('uploads only to the buckets the storage policies cover', () => {
    const buckets = new Set<string>();
    for (const file of browserFiles) {
      for (const bucket of bucketAccesses(file.text)) buckets.add(bucket);
    }
    expect([...buckets].sort()).toEqual([...BROWSER_BUCKETS].sort());
  });

  it('keeps supabase-js table access of server code to the admin client files', () => {
    const serverFiles = files
      .filter(file => !isBrowserFile(file))
      .filter(file => file.rel !== 'src/lib/supabase.ts')
      .filter(file => tableAccesses(file.text).length > 0)
      .map(file => file.rel)
      .sort();
    expect(serverFiles).toEqual([...SERVER_ADMIN_CLIENT_FILES].sort());
  });

  it('embeds only organization columns the database grants to authenticated', () => {
    const context = files.find(
      file => file.rel === 'src/contexts/AuthContext.tsx'
    )!.text;
    const embeds = [...context.matchAll(/organizations\s*\(([^)]*)\)/g)].map(
      match =>
        match[1]
          .split(',')
          .map(column => column.trim())
          .filter(Boolean)
    );
    expect(embeds.length).toBeGreaterThan(0);
    const sql = fs.readFileSync(MIGRATION, 'utf-8');
    const granted = (
      /grant select \(([^)]+)\)\s+on table public\.organizations to authenticated/i.exec(
        sql
      )?.[1] ?? ''
    )
      .split(',')
      .map(column => column.trim());
    expect(granted.length).toBeGreaterThan(0);
    for (const embed of embeds) {
      for (const column of embed) expect(granted).toContain(column);
    }
  });
});

describe('the documented minimum matches the migration', () => {
  const sql = fs
    .readFileSync(MIGRATION, 'utf-8')
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  it('grants exactly the tables of the list to authenticated and nothing to anon', () => {
    const granted = new Map<string, Access>();
    for (const match of sql.matchAll(
      /grant\s+(select|update)\s*(?:\([^)]*\))?\s+on table public\.(\w+)\s+to\s+([a-z_, ]+);/gi
    )) {
      expect(match[3].trim()).toBe('authenticated');
      const entry = granted.get(match[2]) ?? { select: false, update: false };
      entry[match[1].toLowerCase() as keyof Access] = true;
      granted.set(match[2], entry);
    }
    expect(Object.fromEntries(granted)).toEqual(BROWSER_TABLE_ACCESS);
    expect(sql).not.toMatch(/\bgrant\b[^;]*\bto\b[^;]*\banon\b/i);
  });

  it('updates exactly the profile columns the browser writes', () => {
    const columns = (
      /grant update \(([^)]+)\)\s+on table public\.profiles to authenticated/i.exec(
        sql
      )?.[1] ?? ''
    )
      .split(',')
      .map(column => column.trim())
      .sort();
    expect(columns).toEqual([
      'avatar_url',
      'birth_date',
      'full_name',
      'start_of_training_date',
      'updated_at',
    ]);
  });
});
