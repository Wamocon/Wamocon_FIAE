// Tests for scripts/db/migration-check.mjs (pure logic, no git, no database).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  check,
  destructiveStatements,
  normalizeVersion,
  readLegacy,
  readLegacyEntries,
} from '../../../scripts/db/migration-check.mjs';
import { appliedLegacyInPlan } from '../../../scripts/db/baseline-guard.mjs';

const base = {
  files: ['20261001000000_old.sql', '20261026000000_last.sql'],
  changed: [],
};
const withNew = (name, sql = 'select 1;', extra = {}) =>
  check({
    files: [...base.files, name],
    contents: { [name]: sql },
    base: { ...base, ...extra },
  });

test('a new, newer migration is fine', () => {
  assert.deepEqual(withNew('20261027000000_new.sql'), []);
});

test('without a base only names are checked', () => {
  assert.deepEqual(
    check({ files: ['20261001000000_a.sql'], contents: {} }),
    []
  );
  assert.equal(check({ files: ['2026_x.sql'], contents: {} }).length, 1);
  assert.equal(
    check({ files: ['20261001000000_Neu.sql'], contents: {} }).length,
    1
  );
});

test('duplicate versions are rejected', () => {
  assert.equal(
    check({
      files: ['20261001000000_a.sql', '20261001000000_b.sql'],
      contents: {},
    }).length,
    1
  );
});

test('an older or equal version than the last one on the base is rejected', () => {
  assert.ok(
    withNew('20261015000000_between.sql').some(e => e.includes('not newer'))
  );
  assert.ok(
    withNew('20261026000000_twin.sql').some(e => e.includes('not newer'))
  );
});

test('a changed existing migration is rejected', () => {
  assert.ok(
    withNew('20261027000000_new.sql', 'select 1;', {
      changed: ['20261001000000_old.sql'],
    }).some(e => e.includes('existing migration'))
  );
});

test('destructive statements need an approval', () => {
  const bad = sql => withNew('20261027000000_x.sql', sql);
  assert.ok(bad('drop table public.foo;').some(e => e.includes('destructive')));
  assert.equal(bad('alter table t drop column a;').length, 1);
  assert.equal(bad('truncate t;').length, 1);
  assert.equal(bad('delete from t;').length, 1);
  assert.equal(bad('delete from t where id = 1;').length, 0);
  assert.equal(bad('-- migration:destructive-ok\ndrop table t;').length, 0);
  assert.equal(bad('-- drop table is not executed here\nselect 1;').length, 0);
  assert.equal(bad("select 'drop table x';").length, 0);
  assert.equal(bad('drop policy p on t; drop function f();').length, 0);
});

test('destructiveStatements lists the kinds', () => {
  assert.deepEqual(
    destructiveStatements('drop table a; truncate b; delete from c;').sort(),
    ['DELETE without WHERE', 'DROP TABLE', 'TRUNCATE']
  );
});

test('a new migration that cannot be rewritten for public_preview is rejected', () => {
  assert.ok(
    withNew('20261027000000_x.sql', 'create role app_x login;').some(e =>
      e.includes('public_preview')
    )
  );
});

test('a new migration with an open catalog query is rejected', () => {
  assert.equal(
    withNew(
      '20261027000000_x.sql',
      "select 1 from pg_class where relname = 'x';"
    ).length,
    1
  );
});

test('migrations with begin/commit are accepted', () => {
  assert.deepEqual(
    withNew(
      '20261027000000_x.sql',
      'begin;\ncreate table public.t (id int);\ncommit;'
    ),
    []
  );
});

test('versions are compared with 14 digits', () => {
  assert.equal(normalizeVersion('202606260001'), '20260626000100');
  assert.equal(normalizeVersion('20261027000000'), '20261027000000');
});

test('legacy list is parsed', () => {
  assert.deepEqual(
    readLegacy(
      '# comment\n\n202606260001_a_b.sql  # reason\nnot a file\n20261027000000_c.sql\n'
    ),
    ['202606260001_a_b.sql', '20261027000000_c.sql']
  );
});

test('legacy entries carry a state, pending is the default', () => {
  assert.deepEqual(
    readLegacyEntries(
      '202606260001_a.sql applied # x\n202610200001_b.sql # y\nnot a file\n'
    ),
    [
      { file: '202606260001_a.sql', state: 'applied' },
      { file: '202610200001_b.sql', state: 'pending' },
    ]
  );
});

test('baseline guard: reports applied baseline files that the plan would apply again', () => {
  const entries = [
    { file: '202606260001_a.sql', state: 'applied' },
    { file: '202610200001_b.sql', state: 'pending' },
  ];
  const plan =
    'Would push these migrations:\n • 202606260001_a.sql\n • 202610200001_b.sql\n • 20261101000000_c.sql';
  assert.deepEqual(appliedLegacyInPlan(entries, plan), ['202606260001_a.sql']);
  assert.deepEqual(
    appliedLegacyInPlan(
      entries,
      'Would push these migrations:\n • 20261101000000_c.sql'
    ),
    []
  );
  assert.deepEqual(
    appliedLegacyInPlan(entries, 'Remote database is up to date.'),
    []
  );
});

test('a known legacy file with a 12 digit prefix is exempt while it exists on the base', () => {
  const legacy = ['202606260001_schema_only.sql'];
  const files = ['202606260001_schema_only.sql', '20261027000000_new.sql'];
  const contents = { '20261027000000_new.sql': 'select 1;' };
  assert.deepEqual(
    check({
      files,
      contents,
      legacy,
      base: { files: ['202606260001_schema_only.sql'], changed: [] },
    }),
    []
  );
});

test('a legacy file is not exempt when it is new on this branch', () => {
  const legacy = ['202610200001_catalog.sql'];
  const errors = check({
    files: ['202610200001_catalog.sql'],
    contents: { '202610200001_catalog.sql': 'select 1;' },
    legacy,
    base: { files: [], changed: [] },
  });
  assert.ok(errors.some(e => e.includes('legacy name')));
});

test('a 12 digit file that is not listed is rejected', () => {
  assert.equal(
    check({ files: ['202610200001_catalog.sql'], contents: {} }).length,
    1
  );
});

test('a new 14 digit migration is newer than a legacy 12 digit one', () => {
  const legacy = ['202610200001_catalog.sql'];
  const errors = check({
    files: ['202610200001_catalog.sql', '20261020000000_early.sql'],
    contents: { '20261020000000_early.sql': 'select 1;' },
    legacy,
    base: { files: ['202610200001_catalog.sql'], changed: [] },
  });
  assert.ok(errors.some(e => e.includes('not newer')));
});

test('alter table ... drop <name> without COLUMN is destructive', () => {
  for (const sql of [
    'alter table public.t drop old_col;',
    'ALTER TABLE IF EXISTS ONLY public.t DROP old_col;',
    'alter table t add x int, drop y;',
    'alter table "my table" drop "Old Col";',
    'alter table t drop if exists old_col;',
    'alter table t alter column a set not null, drop b;',
  ]) {
    assert.ok(destructiveStatements(sql).includes('DROP COLUMN'), sql);
  }
});

test('drop owned is destructive', () => {
  assert.ok(
    destructiveStatements('drop owned by app_role;').includes('DROP OWNED')
  );
});

test('harmless alter table statements are not destructive', () => {
  for (const sql of [
    'alter table t drop constraint c;',
    'alter table t alter column a drop not null;',
    'alter table t alter column a drop default;',
    'alter table t add column drop_flag int;',
    'alter table t add constraint c check (a > 0), add column b int;',
    'alter table t alter column a type numeric(10, 2);',
    'alter table t add column d int default (1 + 2);',
  ]) {
    assert.deepEqual(destructiveStatements(sql), [], sql);
  }
});

test('a new migration with an undeclared drop is rejected, with the approval it passes', () => {
  const files = ['20261001000000_old.sql', '20261027000000_new.sql'];
  const base = { files: [files[0]], changed: [] };
  const run = sql => check({ files, contents: { [files[1]]: sql }, base });
  assert.ok(
    run('alter table public.t drop old_col;').some(e =>
      e.includes('destructive')
    )
  );
  assert.deepEqual(
    run('-- migration:destructive-ok\nalter table public.t drop old_col;'),
    []
  );
});

test('the release workflow checks the migration files against the previous release', () => {
  const release = readFileSync(
    '.github/workflows/release-production.yml',
    'utf8'
  );
  assert.ok(release.includes('gh release list'));
  assert.ok(release.includes('migration-check.mjs --base "refs/tags/$prev"'));
});
