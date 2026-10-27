// The content upload migration 20261030000100 in the release and Preview pipeline:
// it is gated in Production, it can be rewritten for the schema public_preview
// without a finding, and the rewrite leaves nothing behind that points at public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { rolloutGate } from '../../../scripts/db/rollout-gate.mjs';
import { destructiveStatements } from '../../../scripts/db/migration-check.mjs';
import {
  newMigrationChecks,
  rewrite,
} from '../../../scripts/db/preview-rewrite.mjs';

const FILE = '20261030000100_content_upload_tables.sql';
const sql = readFileSync(`supabase/migrations/${FILE}`, 'utf8');
const noComments = text => text.replace(/--[^\n]*/g, '');
const TABLES = [
  'content_upload_runs',
  'content_upload_files',
  'content_upload_proposals',
  'content_upload_decisions',
  'content_upload_ki_calls',
  'content_upload_applies',
  'content_upload_applied_rows',
];

test('a production release that would apply the file stops until the rollout is approved', () => {
  const plan = `Would push these migrations:\n • ${FILE}\n`;
  assert.equal(rolloutGate(plan, undefined).ok, false);
  assert.equal(rolloutGate(plan, 'yes').ok, false);
  assert.deepEqual(rolloutGate(plan, undefined).blocked, [FILE]);
  assert.equal(rolloutGate(plan, 'true').ok, true);
});

test('the file can be rewritten for public_preview without a single finding', () => {
  const result = rewrite(sql);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(newMigrationChecks(sql), []);
});

test('the rewrite creates the seven tables in public_preview and leaves nothing behind that points at public', () => {
  const { sql: out } = rewrite(sql);
  const code = noComments(out);
  for (const table of TABLES) {
    assert.ok(
      new RegExp(
        `create table if not exists public_preview\\.${table}\\b`
      ).test(code),
      table
    );
    assert.ok(
      new RegExp(
        `alter table public_preview\\.${table} enable row level security`
      ).test(code),
      table
    );
  }
  // the dynamic statements (revoke, privilege check) are renamed as well
  assert.ok(/'revoke all on public_preview\.%I from %I'/.test(code));
  assert.ok(/format\('public_preview\.%I', upload_table\)/.test(code));
  // the foreign keys point at the copies of the Preview schema
  assert.ok(/references public_preview\.training_catalogs \(id\)/.test(code));
  assert.ok(/references public_preview\.profiles \(id\)/.test(code));
  assert.ok(
    !/(?<![\w$"])public\.(?!vector)/.test(code),
    'reference to public.'
  );
  assert.ok(!/schema public(?!_preview)\b/.test(code), 'schema public');
  // the pattern for the target schema survives the rewrite unchanged
  assert.ok(/target_schema ~ '\^public\(_preview\)\?\$'/.test(code));
});

test('the file has no destructive statement that needs an approval', () => {
  assert.deepEqual(destructiveStatements(sql), []);
});

test('only anon and authenticated are revoked, the Preview roles stay out of it', () => {
  // statements only: no comments, no text of "comment on"
  const code = noComments(sql).replace(/'(?:[^']|'')*'/g, "''");
  assert.ok(!/app_preview/.test(code));
  assert.ok(!/service_role/.test(code));
  assert.ok(!/\bgrant\b/i.test(code));
  assert.ok(/array\['anon', 'authenticated'\]/.test(noComments(sql)));
});

test('the tables stay out of the content sync allowlist', () => {
  const list = readFileSync('supabase/content-tables.json', 'utf8');
  for (const table of TABLES) {
    assert.ok(!list.includes(table), table);
  }
});
