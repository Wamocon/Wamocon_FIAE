/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { contentDocuments } from '@/db/migrations/schemas/schema';

/**
 * Static checks of 20261103000200_content_documents_sha256.sql: one additive
 * column for the checksum of the stored file of a document. The conventions of
 * the release pipeline, that nothing is written, dropped or indexed, the pre
 * and post check, the undo in the header and the match with the Drizzle schema
 * and the rollout documents. The SQL is not run here, the Preview migration of
 * the pull request runs it.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const FILE = '20261103000200_content_documents_sha256.sql';

const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, FILE), 'utf-8');
const header = raw
  .split(/\r?\n/)
  .filter(line => line.startsWith('--'))
  .map(line => line.replace(/^--\s?/, ''))
  .join(' ')
  .replace(/\s+/g, ' ');
const sql = raw
  .split(/\r?\n/)
  .filter(line => !line.trim().startsWith('--'))
  .join('\n');
const statements = sql.replace(/'(?:[^']|'')*'/g, "''");

const allFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter(name => name.endsWith('.sql'))
  .sort();

const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), 'utf-8');

describe('content documents sha256 migration: place in the series', () => {
  it('has a 14 digit version, a lowercase name and is the only file of its version', () => {
    expect(FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(allFiles.filter(name => name.startsWith('20261103000200'))).toEqual([
      FILE,
    ]);
  });

  it('sorts behind the school catalog file and behind the rollout gate (GATED_TO)', () => {
    expect(FILE > '20261103000100_school_catalog.sql').toBe(true);
    expect(FILE.slice(0, 14) > '20261030000300').toBe(true);
  });
});

describe('content documents sha256 migration: conventions', () => {
  it('has no explicit transaction control and keeps the timeouts of the series', () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(sql).toMatch(/set\s+local\s+lock_timeout\s*=\s*'5s'/i);
    expect(sql).toMatch(/set\s+local\s+statement_timeout\s*=\s*'60s'/i);
  });

  it('installs no extensions, roles, publications, policies or triggers', () => {
    expect(statements).not.toMatch(
      /\b(create|alter|drop)\s+(extension|role|user|publication|policy|trigger)\b/i
    );
  });

  it('is destructive nowhere and writes no row', () => {
    expect(statements).not.toMatch(/\bdrop\s+(table|column|schema)\b/i);
    expect(statements).not.toMatch(/\b(delete\s+from|truncate)\b/i);
    expect(statements).not.toMatch(/\b(update|insert\s+into)\b/i);
    expect(raw).not.toContain('migration:destructive-ok');
  });

  it('qualifies the table with public. (the preview run rewrites it)', () => {
    expect(sql).toMatch(/to_regclass\('public\.content_documents'\)/);
    expect(sql).toMatch(/'public\.content_documents'::regclass/);
    expect(statements).not.toMatch(/\balter\s+table\s+(?!public\.)/i);
  });

  it('changes no other table than content_documents', () => {
    expect(statements).not.toMatch(
      /\balter\s+table\s+(?!public\.content_documents\b)/i
    );
  });

  it('adds no index, key or uniqueness', () => {
    expect(statements).not.toMatch(/\bcreate\s+(unique\s+)?index\b/i);
    expect(statements).not.toMatch(/\b(unique|foreign\s+key|references)\b/i);
  });

  it('names its purpose, the undo and that it writes no value in the header', () => {
    expect(header).toMatch(/Checksum of the stored file/i);
    expect(header).toMatch(/document\.copy\.identical/);
    expect(header).toMatch(/scripts\/content\/hash-documents\.ts/);
    expect(header).toMatch(/Undo/);
    expect(header).toMatch(
      /alter table public\.content_documents drop column if exists content_sha256/i
    );
    expect(header).toMatch(/Safe to run twice/i);
    expect(header).toMatch(/no value is written/i);
  });

  it('is safe to run twice', () => {
    expect(statements).toMatch(
      /alter\s+table\s+public\.content_documents\s+add\s+column\s+if\s+not\s+exists\s+content_sha256\s+text\s*;/i
    );
  });
});

describe('content documents sha256 migration: the column', () => {
  it('stops with a clear message before anything changes if the table or storage_url is missing', () => {
    const precheck = sql.search(
      /to_regclass\('public\.content_documents'\) is null/
    );
    const addColumn = sql.search(/add column/i);
    expect(precheck).toBeGreaterThan(-1);
    expect(precheck).toBeLessThan(addColumn);
    expect(sql).toMatch(/a\.attname = 'storage_url'/);
    expect(sql).toMatch(/Nothing was changed/);
  });

  it('adds a nullable text column without a default and checks it afterwards', () => {
    expect(statements).not.toMatch(
      /content_sha256\s+text\s+(not\s+null|default)/i
    );
    expect(sql).toMatch(/a\.attname = 'content_sha256'/);
    expect(sql).toMatch(/col\.type_name <> 'text'/);
    expect(sql).toMatch(/col\.attnotnull or col\.atthasdef/);
    expect(sql.search(/add column if not exists content_sha256/i)).toBeLessThan(
      sql.search(/col\.type_name <> 'text'/)
    );
  });

  it('matches the Drizzle schema: a nullable text column without a default', () => {
    const column = getTableConfig(contentDocuments).columns.find(
      c => c.name === 'content_sha256'
    );
    expect(column).toBeDefined();
    expect(column!.notNull).toBe(false);
    expect(column!.hasDefault).toBe(false);
    expect(column!.getSQLType()).toBe('text');
  });
});

describe('content documents sha256 migration: the rollout documents', () => {
  it('N01 lists the version and N02 checks the column', () => {
    const checks = read('docs/kfbm-production-rollout-checks.sql');
    expect(checks).toContain("('20261103000200')");
    expect(checks).toContain('column content_documents.content_sha256');
  });

  it('the runbook and the go list name the file and the new number of files', () => {
    const runbook = read('docs/kfbm-production-rollout.md');
    const go = read('docs/go-checkliste.md');
    expect(runbook).toContain('20261103000200_content_documents_sha256.sql');
    expect(runbook).toMatch(
      /42 Dateien von `20261023100000` bis `20261103000200`/
    );
    expect(go).toMatch(/42 Dateien von `20261023100000` bis `20261103000200`/);
  });
});
