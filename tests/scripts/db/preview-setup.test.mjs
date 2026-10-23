// Static checks of the SQL templates in supabase/preview-setup (no database).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildSetupScript } from '../../../scripts/db/preview-migrate.mjs';

const read = name => readFileSync(`supabase/preview-setup/${name}`, 'utf8');
const files = [
  '01-preview-role.sql',
  '02-production-side.sql',
  '03-preview-side.sql',
  '04-verify.sql',
];
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
  const sql = noComments(read('03-preview-side.sql'));
  assert.ok(!/\bpublic\./.test(sql), 'reference to public.');
  assert.ok(!/search_path\s*=\s*public\b(?!_)/.test(sql));
  for (const m of sql.matchAll(/create policy (\w+)/gi)) {
    assert.ok(m[1].endsWith('_preview'), `${m[1]} must end in _preview`);
  }
  assert.ok(/create trigger on_auth_user_created_preview/i.test(sql));
  assert.ok(/= 'preview'/.test(sql));
});

test('the production side template routes by env=preview and keeps the function', () => {
  const sql = noComments(read('02-production-side.sql'));
  assert.ok(/is distinct from 'preview'/.test(sql));
  assert.ok(/execute function public\.handle_new_user\(\)/.test(sql));
  assert.ok(
    /alter function public\.get_user_org_id\(\) set search_path = public, pg_temp/.test(
      sql
    )
  );
  assert.ok(
    /alter function public\.is_platform_owner\(\) set search_path = public, pg_temp/.test(
      sql
    )
  );
  assert.ok(
    !/create or replace function/i.test(sql),
    'does not redefine function bodies'
  );
});

test('the verify template is read only', () => {
  // strings are blanked: the privilege names in has_table_privilege() are data
  const sql = noComments(read('04-verify.sql')).replace(
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
    postClone: read('03-preview-side.sql'),
  });
  assert.ok(!/\$pv_(outer|script)\$/.test(script));
  assert.ok(script.includes('on_auth_user_created_preview'));
});
