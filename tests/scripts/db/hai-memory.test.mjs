// The migration 20261103000300 (the memory of the HAI) in the release and Preview
// pipeline: it is part of the gated series, it can be rewritten for the schema
// public_preview without a finding, it has no destructive statement that needs an
// approval, the rewrite leaves nothing behind that points at public, and the three
// tables stay out of the content sync (the memory of a person never travels).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { rolloutGate } from '../../../scripts/db/rollout-gate.mjs';
import { destructiveStatements } from '../../../scripts/db/migration-check.mjs';
import {
  newMigrationChecks,
  rewrite,
} from '../../../scripts/db/preview-rewrite.mjs';

const FILE = '20261103000300_hai_memory.sql';
const sql = readFileSync(`supabase/migrations/${FILE}`, 'utf8');
const noComments = text => text.replace(/--[^\n]*/g, '');

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

test('the rewrite points every table at public_preview and leaves nothing behind that points at public', () => {
  const code = noComments(rewrite(sql).sql);
  for (const table of [
    'hai_user_memories',
    'hai_global_memories',
    'hai_user_memory_settings',
  ]) {
    assert.ok(
      new RegExp(`create table if not exists public_preview\\.${table}\\b`).test(
        code
      ),
      table
    );
  }
  assert.ok(/references public_preview\.profiles \(id\) on delete cascade/.test(code));
  assert.ok(/to_regclass\('public_preview\.profiles'\)/.test(code));
  assert.ok(
    !/(?<![\w$"])public\.(?!vector)/.test(code),
    'reference to public.'
  );
  assert.ok(!/schema public(?!_preview)\b/.test(code), 'schema public');
});

test('the file has no destructive statement that needs an approval', () => {
  assert.deepEqual(destructiveStatements(sql), []);
});

test('the file changes no existing table and opens nothing for the API roles', () => {
  const code = noComments(sql).replace(/'(?:[^']|'')*'/g, "''");
  assert.ok(!/\bgrant\b/i.test(code));
  assert.ok(!/app_preview|service_role/.test(code));
  const tables = [...code.matchAll(/alter table\s+([\w.]+)/gi)].map(m => m[1]);
  assert.deepEqual([...new Set(tables)].sort(), [
    'public.hai_global_memories',
    'public.hai_user_memories',
    'public.hai_user_memory_settings',
  ]);
});

test('the tables stay out of the content sync allowlist (the memory of a person never travels)', () => {
  const list = readFileSync('supabase/content-tables.json', 'utf8');
  for (const table of [
    'hai_user_memories',
    'hai_global_memories',
    'hai_user_memory_settings',
  ]) {
    assert.ok(!list.includes(table), table);
  }
});
