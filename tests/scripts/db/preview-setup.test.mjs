// Static checks of the SQL templates in supabase/preview-setup (no database).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildSetupScript } from '../../../scripts/db/preview-migrate.mjs';

const read = name => readFileSync(`supabase/preview-setup/${name}`, 'utf8');
const files = ['01-preview-role.sql', '02-preview-side.sql', '03-verify.sql'];
const noComments = sql => sql.replace(/--[^\n]*/g, '');

test('no template contains a password or other secret value', () => {
  for (const f of files) {
    const sql = noComments(read(f));
    assert.ok(!/password\s+'/i.test(sql), `${f}: password literal`);
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(read(f)), `${f}: token-like value`);
    assert.ok(!/sb_secret_/.test(read(f)), `${f}: secret key`);
  }
});

test('the Preview role gets rights on public_preview only, none on public', () => {
  const sql = noComments(read('01-preview-role.sql'));
  const grants = sql
    .split(';')
    .filter(s => /\bgrant\b/i.test(s) && /app_preview/.test(s));
  for (const g of grants) {
    if (/grant\s+app_preview\s+to\s+postgres/i.test(g)) continue;
    assert.ok(!/\bpublic\b(?!_)/i.test(g), `grant on public: ${g.trim()}`);
  }
  assert.ok(
    /revoke all on all tables in schema public from app_preview/i.test(sql)
  );
  assert.ok(
    /alter role app_preview set search_path = public_preview, extensions/i.test(
      sql
    )
  );
});

test('the Preview side template only touches public_preview and Preview twins', () => {
  const sql = noComments(read('02-preview-side.sql'));
  assert.ok(!/public\./.test(sql), 'reference to public.');
  assert.ok(!/search_path\s*=\s*public(?!_)/.test(sql));
  for (const m of sql.matchAll(/create policy (\w+)/gi)) {
    assert.ok(m[1].endsWith('_preview'), `${m[1]} must end in _preview`);
  }
});

test('no template creates or changes a trigger, and none touches public or auth', () => {
  // auth.users has no trigger; profiles are created by /api/auth/sync-profile
  for (const f of files) {
    const sql = noComments(read(f)).replace(/'(?:[^']|'')*'/g, "''");
    assert.ok(!/trigger/i.test(sql), `${f}: trigger`);
    assert.ok(!/auth\./i.test(sql), `${f}: auth schema`);
    assert.ok(
      !/(?:alter|create|drop)\s+(?:or\s+replace\s+)?(?:function|table|policy|trigger)[^;]*public\./i.test(
        sql
      ),
      `${f}: changes an object in public`
    );
  }
});

test('the verify template is read only', () => {
  // strings are blanked: the privilege names in has_table_privilege() are data
  const sql = noComments(read('03-verify.sql')).replace(
    /'(?:[^']|'')*'/g,
    "''"
  );
  assert.ok(
    !/\b(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i.test(
      sql
    )
  );
});

test('the post clone file can be embedded in the setup script', () => {
  const script = buildSetupScript({
    baseline: [],
    localByVersion: new Map(),
    dumpSql: 'select 1;',
    shared: [],
    postClone: read('02-preview-side.sql'),
  });
  assert.ok(!/\$pv_(outer|script)\$/.test(script));
  assert.ok(script.includes('avatar_insert_preview'));
});
