// The lockdown migration 20261029000300 in the release and Preview pipeline: it is
// gated in Production, it can be rewritten for the schema public_preview, and the
// Preview setup no longer hands out table rights to the API roles by default.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { rolloutGate } from '../../../scripts/db/rollout-gate.mjs';
import { destructiveStatements } from '../../../scripts/db/migration-check.mjs';
import {
  newMigrationChecks,
  rewrite,
} from '../../../scripts/db/preview-rewrite.mjs';

const FILE = '20261029000300_security_revoke_api_table_access.sql';
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

test('the rewrite leaves nothing behind that points at public', () => {
  const { sql: out } = rewrite(sql);
  const code = noComments(out);
  assert.ok(/public_preview\.rls_lockdown_backup/.test(code));
  assert.ok(
    /alter default privileges in schema public_preview revoke all on tables/.test(
      code
    )
  );
  assert.ok(
    /revoke all on all tables in schema public_preview from anon, authenticated/.test(
      code
    )
  );
  assert.ok(/'public_preview'::regnamespace/.test(code));
  assert.ok(
    !/(?<![\w$"])public\.(?!vector)/.test(code),
    'reference to public.'
  );
  assert.ok(!/schema public(?!_preview)\b/.test(code), 'schema public');
  // the auth helpers go through the wrappers the Preview roles can call
  assert.ok(!/(?<![\w$"])auth\.uid\(/.test(code));
  assert.ok(/preview_support\.auth_uid\(/.test(code));
});

test('the file has no destructive statement that needs an approval', () => {
  assert.deepEqual(destructiveStatements(sql), []);
});

test('the Preview roles stay out of it: only anon, authenticated and PUBLIC are revoked', () => {
  const code = noComments(sql);
  for (const revoke of code.matchAll(/revoke[^;]*?from ([a-z_, ]+)/gi)) {
    const roles = revoke[1].split(',').map(r => r.trim());
    for (const role of roles) {
      assert.ok(['anon', 'authenticated', 'public'].includes(role), role);
    }
  }
  assert.ok(!/app_preview/.test(code));
  assert.ok(!/service_role[^;]*revoke|revoke[^;]*service_role/.test(code));
});

test('the automatic Preview step hands EXECUTE to the API roles no more', () => {
  const side = noComments(
    readFileSync('supabase/preview-setup/02-preview-side.sql', 'utf8')
  );
  for (const statement of side.split(';')) {
    if (/grant execute/i.test(statement)) {
      assert.ok(!/anon|authenticated/.test(statement), statement.trim());
    }
  }
});

test('the Preview role setup grants the API roles nothing on the tables of public_preview by default', () => {
  const setup = noComments(
    readFileSync('supabase/preview-setup/01-preview-role.sql', 'utf8')
  );
  for (const statement of setup.split(';')) {
    if (
      !/alter default privileges for role app_preview_migrator in schema public_preview grant/i.test(
        statement
      )
    )
      continue;
    assert.ok(!/\banon\b|\bauthenticated\b/.test(statement), statement.trim());
  }
  assert.ok(
    /alter default privileges for role app_preview_migrator in schema public_preview revoke all on tables from anon, authenticated/i.test(
      setup
    )
  );
  // re-running the file must not take the browser minimum away from existing tables
  assert.ok(!/revoke all on all tables in schema public_preview/i.test(setup));
  // no grant of table rights to the API roles on public_preview anywhere else in the file
  for (const statement of setup.split(';')) {
    if (
      /\bgrant\b[^;]*\bon (all )?(tables|sequences|functions)\b[^;]*public_preview\b/i.test(
        statement
      )
    ) {
      assert.ok(
        !/\banon\b|\bauthenticated\b/.test(statement),
        statement.trim()
      );
    }
  }
});
