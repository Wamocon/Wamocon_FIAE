// The migration 20261030000200 (JSON and Excel in the content upload) in the release and
// Preview pipeline: it is gated in Production, it can be rewritten for the schema
// public_preview without a finding, it has no destructive statement that needs an
// approval, and the rewrite leaves nothing behind that points at public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { rolloutGate } from '../../../scripts/db/rollout-gate.mjs';
import { destructiveStatements } from '../../../scripts/db/migration-check.mjs';
import {
  newMigrationChecks,
  rewrite,
} from '../../../scripts/db/preview-rewrite.mjs';

const FILE = '20261030000200_content_upload_json_xlsx.sql';
const FIRST = '20261030000100_content_upload_tables.sql';
const sql = readFileSync(`supabase/migrations/${FILE}`, 'utf8');
const noComments = text => text.replace(/--[^\n]*/g, '');

test('a production release that would apply the file stops until the rollout is approved', () => {
  const plan = `Would push these migrations:\n • ${FIRST}\n • ${FILE}\n`;
  assert.equal(rolloutGate(plan, undefined).ok, false);
  assert.equal(rolloutGate(plan, 'yes').ok, false);
  assert.deepEqual(rolloutGate(plan, undefined).blocked, [FIRST, FILE]);
  assert.equal(rolloutGate(plan, 'true').ok, true);
  // alone, too: the file is part of the gated series
  assert.deepEqual(rolloutGate(`• ${FILE}\n`, undefined).blocked, [FILE]);
});

test('the file can be rewritten for public_preview without a single finding', () => {
  const result = rewrite(sql);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(newMigrationChecks(sql), []);
});

test('the rewrite widens the check in public_preview and leaves nothing behind that points at public', () => {
  const code = noComments(rewrite(sql).sql);
  assert.ok(
    /alter table public_preview\.content_upload_files\s+drop constraint if exists content_upload_files_ext_check/.test(
      code
    )
  );
  assert.ok(
    /alter table public_preview\.content_upload_files\s+add constraint content_upload_files_ext_check\s+check \(ext in \('docx', 'pdf', 'json', 'xlsx'\)\)/.test(
      code
    )
  );
  assert.ok(/to_regclass\('public_preview\.content_upload_files'\)/.test(code));
  assert.ok(
    !/(?<![\w$"])public\.(?!vector)/.test(code),
    'reference to public.'
  );
  assert.ok(!/schema public(?!_preview)\b/.test(code), 'schema public');
  assert.ok(
    !/regnamespace/.test(code) || /'public_preview'::regnamespace/.test(code)
  );
});

test('the file has no destructive statement that needs an approval (a check is no column)', () => {
  assert.deepEqual(destructiveStatements(sql), []);
});

test('the file changes no table but the one, and no right', () => {
  const code = noComments(sql).replace(/'(?:[^']|'')*'/g, "''");
  assert.ok(!/\bgrant\b|\brevoke\b|\bpolicy\b/i.test(code));
  assert.ok(!/app_preview|service_role/.test(code));
  const tables = [...code.matchAll(/alter table\s+([\w.]+)/gi)].map(m => m[1]);
  assert.deepEqual([...new Set(tables)], ['public.content_upload_files']);
});

test('the tables stay out of the content sync allowlist', () => {
  const list = readFileSync('supabase/content-tables.json', 'utf8');
  assert.ok(!list.includes('content_upload_files'));
});
