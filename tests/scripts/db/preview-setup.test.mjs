// Static checks of the SQL templates in supabase/preview-setup (no database).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildSetupScript } from '../../../scripts/db/preview-migrate.mjs';

const read = name => readFileSync(`supabase/preview-setup/${name}`, 'utf8');
const files = [
  '01-preview-role.sql',
  '02-preview-side.sql',
  '03-shared-objects.sql',
  '04-verify.sql',
];
const noComments = sql => sql.replace(/--[^\n]*/g, '');
const noStrings = sql => sql.replace(/'(?:[^']|'')*'/g, "''");

test('no template contains a password or other secret value', () => {
  for (const f of files) {
    const sql = noComments(read(f));
    assert.ok(!/password\s+'/i.test(sql), `${f}: password literal`);
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(read(f)), `${f}: token-like value`);
    assert.ok(!/sb_secret_/.test(read(f)), `${f}: secret key`);
  }
});

test('the app role gets rights on public_preview only, none on public', () => {
  const sql = noComments(read('01-preview-role.sql'));
  const grants = sql
    .split(';')
    .filter(s => /\bgrant\b/i.test(s) && /app_preview\b/.test(s));
  for (const g of grants) {
    if (/grant\s+app_preview(?:_migrator)?\s+to\s+postgres/i.test(g)) continue;
    assert.ok(!/\bpublic\b(?!_)/i.test(g), `grant on public: ${g.trim()}`);
  }
  assert.ok(
    /revoke all on all tables in schema public from app_preview\b/i.test(sql)
  );
  assert.ok(
    /alter role app_preview set search_path = public_preview, extensions/i.test(
      sql
    )
  );
});

test('the migration role is the boundary: owns only the Preview schemas, no dangerous attributes', () => {
  const sql = noComments(read('01-preview-role.sql'));
  assert.ok(
    /create role app_preview_migrator with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls/i.test(
      sql
    )
  );
  assert.ok(
    /alter schema public_preview owner to app_preview_migrator/i.test(sql)
  );
  assert.ok(
    /alter schema preview_meta owner to app_preview_migrator/i.test(sql)
  );
  // never bypassrls, never superuser for the migration role
  for (const m of sql.matchAll(
    /(?:create|alter) role app_preview_migrator[^;]*/gi
  )) {
    assert.ok(
      !/(?<!no)bypassrls|(?<!no)superuser|(?<!no)createrole/i.test(m[0]),
      m[0]
    );
  }
  for (const schema of ['public', 'auth', 'storage']) {
    assert.ok(
      new RegExp(
        `revoke all on schema ${schema} from app_preview_migrator`,
        'i'
      ).test(sql),
      `revoke on schema ${schema}`
    );
  }
  // no grants to the migration role on anything but extensions (type usage)
  for (const g of sql
    .split(';')
    .filter(
      s => /\bgrant\b/i.test(s) && /to app_preview_migrator\b/i.test(s)
    )) {
    if (/grant\s+app_preview_migrator\s+to\s+postgres/i.test(g)) continue;
    assert.ok(/on schema extensions/i.test(g), `unexpected grant: ${g.trim()}`);
  }
  // functions it creates are not executable by PUBLIC
  assert.ok(
    /alter default privileges for role app_preview_migrator revoke execute on functions from public/i.test(
      sql
    )
  );
});

test('the automatic Preview side template only touches public_preview', () => {
  const sql = noComments(read('02-preview-side.sql'));
  assert.ok(!/public\./.test(sql), 'reference to public.');
  assert.ok(!/search_path\s*=\s*public(?!_)/.test(sql));
  assert.ok(!/\b(storage|auth|realtime)\b\s*\./i.test(noStrings(sql)));
  assert.ok(
    !/create policy/i.test(sql),
    'policies need rights the migration role does not have'
  );
  assert.ok(!/alter publication/i.test(sql));
  assert.ok(/revoke execute on function %s from public/i.test(sql));
});

test('the shared objects template is human-run, additive and scoped to preview/', () => {
  const sql = noComments(read('03-shared-objects.sql'));
  for (const m of sql.matchAll(/create policy (\w+)/gi)) {
    assert.ok(m[1].endsWith('_preview'), `${m[1]} must end in _preview`);
  }
  const policies = [...sql.matchAll(/create policy [\s\S]*?;/gi)].map(
    m => m[0]
  );
  assert.equal(policies.length, 6);
  for (const p of policies) {
    assert.ok(
      /foldername\(name\)\)\[1\] = 'preview'/.test(p),
      'prefix preview/'
    );
    assert.ok(/auth\.uid\(\)::text/.test(p), 'own folder only');
    assert.ok(
      /preview_support\.has_preview_profile\(auth\.uid\(\)\)/.test(p),
      'profile in public_preview'
    );
  }
  // the profile check does not create a dependency on a public_preview table
  assert.ok(
    /execute 'select exists \(select 1 from public_preview\.profiles/.test(sql)
  );
  assert.ok(!/create policy[^;]*public_preview\./i.test(sql));
  assert.ok(!/\bpublic\./.test(noStrings(sql)));
});

test('no template creates or changes a trigger', () => {
  // auth.users has no trigger; profiles are created by /api/auth/sync-profile
  for (const f of files) {
    const sql = noStrings(noComments(read(f)));
    assert.ok(!/\btrigger\b/i.test(sql), `${f}: trigger`);
  }
});

test('the verify template is read only', () => {
  // strings are blanked: the privilege names in has_table_privilege() are data
  const sql = noStrings(noComments(read('04-verify.sql')));
  assert.ok(
    !/\b(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i.test(
      sql
    )
  );
});

test('the verify template checks schema, function and table privileges of both roles', () => {
  const sql = read('04-verify.sql');
  assert.ok(sql.includes('has_schema_privilege'));
  assert.ok(sql.includes('has_function_privilege'));
  assert.ok(sql.includes('has_table_privilege'));
  assert.ok(sql.includes("'app_preview_migrator'"));
  assert.ok(sql.includes("'app_preview'"));
  assert.ok(sql.includes('prosecdef'));
});

test('the post clone file can be embedded in the setup script', () => {
  const script = buildSetupScript({
    baseline: [],
    localByVersion: new Map(),
    dumpSql: 'select 1;',
    postClone: read('02-preview-side.sql'),
  });
  assert.ok(!/\$pv_(outer|script)\$/.test(script));
  assert.ok(script.includes('revoke execute on function'));
});
