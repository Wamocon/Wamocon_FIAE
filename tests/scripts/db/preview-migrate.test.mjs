// Tests for the pure parts of scripts/db/preview-migrate.mjs: checksum, plan
// calculation, rebuild plan, setup script and abort SQL (no database).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LEDGER,
  PREVIEW_MIGRATOR_ROLE,
  PREVIEW_ROLE,
  buildSetupScript,
  checksum,
  ensureGrantsSql,
  plan,
  purgeSql,
  rebuildPlan,
} from '../../../scripts/db/preview-migrate.mjs';

const f = (version, content = version) => ({
  version,
  file: `${version}_x.sql`,
  checksum: checksum(content),
});

test('checksum ignores CRLF', () => {
  assert.equal(checksum('a\r\nb'), checksum('a\nb'));
  assert.notEqual(checksum('a'), checksum('b'));
});

test('plan: open migrations in order, nothing else', () => {
  const p = plan(
    [f('20261003000000'), f('20261001000000'), f('20261002000000')],
    [{ version: '20261001000000', checksum: checksum('20261001000000') }]
  );
  assert.deepEqual(
    p.open.map(m => m.version),
    ['20261002000000', '20261003000000']
  );
  assert.equal(p.changed.length, 0);
  assert.equal(p.foreign.length, 0);
});

test('plan: a changed migration is detected', () => {
  const p = plan(
    [f('20261001000000', 'new')],
    [{ version: '20261001000000', checksum: checksum('old') }]
  );
  assert.equal(p.changed.length, 1);
});

test('plan: a missing checksum is filled in, not reported as changed', () => {
  const p = plan(
    [f('20261001000000')],
    [{ version: '20261001000000', checksum: null }]
  );
  assert.equal(p.changed.length, 0);
  assert.equal(p.withoutChecksum.length, 1);
});

test('plan: a foreign row with the same checksum is a rename', () => {
  const content = 'create table t();';
  const p = plan(
    [f('20261005000000', content)],
    [{ version: '20261001000000', checksum: checksum(content) }]
  );
  assert.equal(p.open.length, 0);
  assert.equal(p.renamed.length, 1);
  assert.equal(p.renamed[0].oldVersion, '20261001000000');
});

test('plan: rows of other branches are reported as foreign', () => {
  const p = plan(
    [f('20261001000000')],
    [
      { version: '20261001000000', checksum: checksum('20261001000000') },
      { version: '20261009000000', checksum: checksum('other') },
    ]
  );
  assert.deepEqual(p.foreign, ['20261009000000']);
});

test('plan: an older open migration runs out of order', () => {
  const p = plan(
    [f('20261001000000'), f('20261002000000')],
    [{ version: '20261003000000', checksum: checksum('x') }]
  );
  assert.equal(p.outOfOrder.length, 2);
});

test('rebuild plan: ledger of public becomes the baseline, branch rows are discarded', () => {
  const rp = rebuildPlan(
    [f('20261001000000'), f('20261002000000')],
    [{ version: '20261001000000', name: 'a' }],
    ['20261001000000', '20261009000000']
  );
  assert.deepEqual(
    rp.baseline.map(b => b.version),
    ['20261001000000']
  );
  assert.deepEqual(rp.discarded, ['20261009000000']);
  assert.deepEqual(rp.missingFiles, []);
});

test('rebuild plan: a ledger row without a file is an error unless known', () => {
  const production = [{ version: '20260626103015', name: 'mcp' }];
  assert.deepEqual(rebuildPlan([], production, []).missingFiles, [
    '20260626103015',
  ]);
  assert.deepEqual(
    rebuildPlan([], production, [], ['20260626103015']).missingFiles,
    []
  );
});

test('setup script: structure only, ledger seeded, no row copy', () => {
  const local = new Map([['20261001000000', { name: 'a', checksum: 'abc' }]]);
  const script = buildSetupScript({
    baseline: [
      { version: '20261001000000', name: 'a' },
      { version: '20260626103015', name: "m'cp" },
    ],
    localByVersion: local,
    dumpSql: 'create table public_preview.t (id int);',
    postClone: '-- post clone',
  });
  // the schema itself is created by a human (01-preview-role.sql), the script empties it
  assert.ok(!/create schema/i.test(script));
  assert.ok(script.includes('do $pv_purge$'));
  assert.ok(script.includes(`create table ${LEDGER}`));
  assert.equal(LEDGER, 'preview_meta.schema_migrations');
  assert.ok(script.includes("('20261001000000', 'a', 'abc')"));
  assert.ok(script.includes("('20260626103015', 'm''cp', null)"));
  assert.ok(script.includes('create table public_preview.t (id int);'));
  assert.ok(script.includes('-- post clone'));
  // order: purge, ledger, dump, grants, post clone
  assert.ok(
    script.indexOf('do $pv_purge$') <
      script.indexOf('create table public_preview.t')
  );
  assert.ok(
    script.indexOf('create table public_preview.t') <
      script.indexOf('-- post clone')
  );
  // never copies rows from public
  assert.ok(!/insert into public_preview\.\w+ select/i.test(script));
  assert.ok(!/truncate/i.test(script));
  assert.ok(!/session_replication_role/i.test(script));
});

test('grants for the Preview role only touch public_preview and only if the role exists', () => {
  const sql = ensureGrantsSql();
  assert.ok(sql.includes(`rolname = '${PREVIEW_ROLE}'`));
  assert.ok(sql.includes('in schema public_preview'));
  assert.ok(!/in schema public\b(?!_)/.test(sql));
});

test('purge SQL empties public_preview only, keeps the schema and refuses foreign dependents', () => {
  const sql = purgeSql();
  assert.ok(sql.includes("'public_preview'"));
  // contents are dropped, the schema itself stays (the migration role cannot recreate it)
  assert.ok(!/drop schema/i.test(sql));
  assert.ok(sql.includes(`drop table if exists ${LEDGER}`));
  assert.ok(sql.includes('Rebuild aborted'));
  // nothing of public, auth, storage or cron is touched
  assert.ok(!/\b(auth|storage|cron|supabase_migrations)\./.test(sql));
  assert.ok(!/\bpublic\./.test(sql));
  assert.ok(!/'public'/.test(sql));
});

test('the migration role is named like in the SQL template', () => {
  assert.equal(PREVIEW_MIGRATOR_ROLE, 'app_preview_migrator');
});
