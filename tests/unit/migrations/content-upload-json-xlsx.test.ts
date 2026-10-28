/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

import { CONTENT_UPLOAD_EXTENSIONS } from '@/db/migrations/schemas/schema';
import { UPLOAD_EXTENSIONS } from '@/lib/content-upload/staging/paths';

/**
 * Static checks of 20261030000200_content_upload_json_xlsx.sql (package UP2): it widens
 * the one check on content_upload_files.ext to 'json' and 'xlsx' and does nothing else.
 * The behavior of the SQL (applied to a database that has the first migration, run twice,
 * the four kinds accepted and another one refused, the rollback template) was run against
 * a throwaway local database (see the pull request).
 */

const ROOT = process.cwd();
const FILE = '20261030000200_content_upload_json_xlsx.sql';
const PREVIOUS = '20261030000100_content_upload_tables.sql';
const raw = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', FILE),
  'utf-8'
);
const rollbackRaw = fs.readFileSync(
  path.join(
    ROOT,
    'supabase',
    'manual',
    'rollback-content-upload-json-xlsx.sql'
  ),
  'utf-8'
);
const strip = (text: string) =>
  text
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
const sql = strip(raw);
/** Statements only: no comments, string literals blanked. */
const statements = sql.replace(/'(?:[^']|'')*'/g, "''");
const header = raw
  .split(/\r?\n/)
  .filter(line => line.startsWith('--'))
  .join(' ')
  .replace(/--\s?/g, '')
  .replace(/\s+/g, ' ');

const quoted = (text: string) =>
  [...text.matchAll(/'([a-z]+)'/g)].map(m => m[1]);

describe('the migration 20261030000200', () => {
  it('sorts behind the first migration of the content upload and is gated with the series', () => {
    const files = fs
      .readdirSync(path.join(ROOT, 'supabase', 'migrations'))
      .filter(name => name.endsWith('.sql'))
      .sort();
    expect(files).toContain(PREVIOUS);
    expect(files.indexOf(FILE)).toBeGreaterThan(files.indexOf(PREVIOUS));
    expect(FILE.slice(0, 14) > PREVIOUS.slice(0, 14)).toBe(true);
    // gated in Production with the whole series (scripts/db/rollout-gate.mjs)
    expect(FILE.slice(0, 14) >= '20261024000100').toBe(true);
  });

  it('sets the timeouts first and keeps to one table, one check', () => {
    expect(statements).toMatch(/^\s*set local lock_timeout = ''/m);
    expect(statements).toMatch(/set local statement_timeout = ''/);
    expect(statements.indexOf('lock_timeout')).toBeLessThan(
      statements.indexOf('alter table')
    );
    const alters = [...statements.matchAll(/alter table\s+([\w.]+)/gi)].map(
      m => m[1]
    );
    expect(alters).toEqual([
      'public.content_upload_files',
      'public.content_upload_files',
    ]);
    expect(statements).not.toMatch(
      /\b(create|drop)\s+(table|index|schema|function|trigger|policy|role|extension)\b/i
    );
    expect(statements).not.toMatch(
      /\b(insert|update|delete|truncate|grant|revoke)\b/i
    );
    expect(statements).not.toMatch(
      /\balter\s+column\b|\badd\s+column\b|\bdrop\s+column\b/i
    );
  });

  it('drops the check if it exists and creates it again with the four kinds, nothing else', () => {
    expect(statements).toMatch(
      /drop constraint if exists content_upload_files_ext_check/
    );
    const create =
      /add constraint content_upload_files_ext_check\s+check \(ext in \(([^)]*)\)\)/.exec(
        sql
      );
    expect(create).not.toBeNull();
    expect(quoted(create![1])).toEqual(['docx', 'pdf', 'json', 'xlsx']);
    // not valid plus validate would be a second step, a table of this size needs none
    expect(statements).not.toMatch(/not valid|validate constraint/i);
    expect(
      [...statements.matchAll(/add constraint\s+(\w+)/gi)].map(m => m[1])
    ).toEqual(['content_upload_files_ext_check']);
  });

  it('keeps the list of the Drizzle schema, of the application and of the check the same', () => {
    const create = /check \(ext in \(([^)]*)\)\)/.exec(sql)!;
    const inMigration = quoted(create[1]);
    expect([...CONTENT_UPLOAD_EXTENSIONS]).toEqual(inMigration);
    expect([...UPLOAD_EXTENSIONS]).toEqual(inMigration);
    // the first migration still says docx and pdf: it is never changed, this one widens it
    const first = fs.readFileSync(
      path.join(ROOT, 'supabase', 'migrations', PREVIOUS),
      'utf-8'
    );
    expect(
      /content_upload_files_ext_check\s+check \(ext in \(([^)]*)\)\)/.exec(
        first
      )?.[1]
    ).toBe("'docx', 'pdf'");
  });

  it('checks first, and checks the result at the end, with a clear message', () => {
    expect(
      sql.indexOf("to_regclass('public.content_upload_files')")
    ).toBeLessThan(sql.indexOf('drop constraint'));
    expect(sql).toMatch(/apply 20261030000100 first/);
    expect(sql).toMatch(/ext not in \('docx', 'pdf', 'json', 'xlsx'\)/);
    expect(sql.lastIndexOf('pg_get_constraintdef')).toBeGreaterThan(
      sql.indexOf('add constraint')
    );
    expect(sql).toMatch(/connamespace = 'public'::regnamespace/);
    expect(sql).toMatch(/raise exception/);
  });

  it('says in its header why, what it does not do, the undo and what the owner does by hand', () => {
    expect(header).toMatch(/Safe to run twice/);
    expect(header).toMatch(/rollout gate/);
    expect(header).toMatch(/rollback-content-upload-json-xlsx\.sql/);
    expect(header).toMatch(/Production is not migrated/);
    expect(header).toMatch(/doc_type stay as they are/);
  });

  it('holds no dash as a sentence break', () => {
    expect(raw).not.toMatch(/[–—]/);
  });
});

describe('the rollback template', () => {
  const code = strip(rollbackRaw);
  const statementsOnly = code.replace(/'(?:[^']|'')*'/g, "''");

  it('deletes nothing: it puts the check back and stops when a row needs it', () => {
    expect(code).toMatch(/begin;/);
    expect(code.trim().endsWith('commit;')).toBe(true);
    expect(code).toMatch(/set local lock_timeout/);
    expect(statementsOnly).not.toMatch(/\b(delete|truncate|insert|update)\b/i);
    expect(statementsOnly).not.toMatch(/drop\s+(table|column|schema)/i);
    expect(code).toMatch(/where ext in \('json', 'xlsx'\)/);
    expect(code).toMatch(/raise exception/);
    expect(code).toMatch(/check \(ext in \('docx', 'pdf'\)\)/);
    expect(code).toMatch(
      /drop constraint if exists content_upload_files_ext_check/
    );
    // the stop comes before the change
    expect(code.indexOf('raise exception')).toBeLessThan(
      code.indexOf('drop constraint')
    );
  });

  it('names what it does not undo', () => {
    expect(rollbackRaw).toMatch(/schema_migrations/);
    expect(rollbackRaw).toMatch(/20261030000200/);
    expect(rollbackRaw).toMatch(/content-upload/);
  });
});
