// Tests for the run of scripts/db/content-sync.mjs that is limited to one
// occupation (--catalog) and for the guarantee that a run without --catalog is
// unchanged (pure logic, no database).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildScript,
  parseCatalogCode,
  validateConfig,
} from '../../../scripts/db/content-sync.mjs';

const FIXTURES = 'tests/scripts/db/fixtures';
const realConfig = () =>
  JSON.parse(readFileSync('supabase/content-tables.json', 'utf8'));
const baselineConfig = () =>
  JSON.parse(readFileSync(`${FIXTURES}/content-tables.baseline.json`, 'utf8'));

const col = name => ({
  name,
  dataType: 'text',
  udtSchema: 'pg_catalog',
  udtName: 'text',
  generated: false,
});
/** Column metadata of both schemas, derived from the columns of the allowlist. */
function metaFor(config) {
  const tables = {};
  for (const t of config.tables) {
    tables[t.name] = [...new Set(['id', ...t.columns])].map(col);
  }
  for (const [name, spec] of Object.entries(config.lookups ?? {})) {
    tables[name] = ['id', ...spec.matchOn].map(col);
  }
  return { public_preview: tables, public: tables };
}
const build = (config, extra = {}) =>
  buildScript({
    config,
    meta: metaFor(config),
    from: 'public_preview',
    to: 'public',
    ownerEmail: 'owner@example.test',
    rollback: true,
    ...extra,
  });
/** Snapshots are text files; a checkout with CRLF must not matter. */
const readSnapshot = file =>
  readFileSync(file, 'utf8').split('\r\n').join('\n');
const squash = sql => sql.replace(/\s+/g, ' ');

const CATALOG_ID_SQL =
  "(select c.id from public_preview.training_catalogs c where lower(c.code) = lower('KFBM'))";

// ---------------------------------------------------------------------------
// A run without --catalog is unchanged
// ---------------------------------------------------------------------------

test('snapshot: a run without --catalog produces exactly the SQL of before (insert only)', () => {
  const config = baselineConfig();
  const built = build(config, { updateMode: 'never' });
  assert.deepEqual(built.errors, []);
  const file = `${FIXTURES}/content-sync-never.snapshot.sql`;
  if (process.env.UPDATE_SNAPSHOT === '1' || !existsSync(file)) {
    writeFileSync(file, built.sql);
  }
  assert.equal(built.sql, readSnapshot(file));
});

test('snapshot: a run without --catalog produces exactly the SQL of before (configured, committed)', () => {
  const config = baselineConfig();
  const built = build(config, { updateMode: 'configured', rollback: false });
  assert.deepEqual(built.errors, []);
  const file = `${FIXTURES}/content-sync-configured.snapshot.sql`;
  if (process.env.UPDATE_SNAPSHOT === '1' || !existsSync(file)) {
    writeFileSync(file, built.sql);
  }
  assert.equal(built.sql, readSnapshot(file));
});

test('without --catalog the new allowlist keys and scope fields change nothing in the keys of FIAE', () => {
  const before = Object.fromEntries(
    baselineConfig().tables.map(t => [t.name, t.key])
  );
  const after = Object.fromEntries(
    realConfig().tables.map(t => [t.name, t.key])
  );
  for (const [name, key] of Object.entries(before)) {
    assert.deepEqual(after[name], key, name);
  }
  const sql = squash(build(realConfig(), { updateMode: 'never' }).sql);
  assert.ok(!sql.includes('lower(c.code)'), 'no catalog filter');
  assert.ok(!sql.includes('without a code'), 'no code check');
  // the key of courses is still the natural key
  assert.ok(sql.includes('group by s.title, s.year, s.chapter'));
});

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

test('the allowlist is valid and still ordered by foreign keys', () => {
  const config = realConfig();
  assert.deepEqual(validateConfig(config), []);
  const index = new Map(config.tables.map((t, i) => [t.name, i]));
  for (const t of config.tables) {
    for (const spec of Object.values(t.remap ?? {})) {
      if (spec.table in (config.lookups ?? {})) continue;
      assert.ok(
        index.get(spec.table) < index.get(t.name),
        `${t.name} -> ${spec.table}`
      );
    }
  }
});

test('the allowlist carries the new columns of the KfBM model', () => {
  const tables = Object.fromEntries(realConfig().tables.map(t => [t.name, t]));
  const has = (table, ...cols) => {
    for (const c of cols) {
      assert.ok(tables[table].columns.includes(c), `${table}.${c}`);
    }
  };
  has('courses', 'code', 'training_component_id', 'training_catalog_id');
  has('enablers', 'code');
  has('use_cases', 'code', 'enabler_id');
  has('quizzes', 'code', 'training_catalog_id', 'training_component_id');
  has('training_components', 'phase', 'kind', 'training_catalog_id', 'code');
  has('training_use_cases', 'letter', 'planned_hours');
  has('options', 'order_index');
  has(
    'training_catalogs',
    'occupation_code',
    'regulation_version',
    'elective_pick_count',
    'settings'
  );
  // ids of parents are translated, not copied
  const remap = (table, column) => tables[table].remap?.[column]?.table;
  assert.equal(remap('use_cases', 'enabler_id'), 'enablers');
  assert.equal(
    remap('courses', 'training_component_id'),
    'training_components'
  );
  assert.equal(
    remap('quizzes', 'training_component_id'),
    'training_components'
  );
  assert.equal(remap('quizzes', 'training_catalog_id'), 'training_catalogs');
  // derived by a database trigger, never copied
  assert.ok(!tables.enablers.columns.includes('training_catalog_id'));
  assert.ok(!tables.use_cases.columns.includes('training_catalog_id'));
  // the HAI index flag stays out
  assert.ok(!tables.content_documents.columns.includes('is_indexed_by_hai'));
});

test('the catalog is never activated by the sync: training_catalogs is insert only', () => {
  const t = realConfig().tables.find(x => x.name === 'training_catalogs');
  assert.equal(t.update, 'never');
  // a catalog that is missing in the target is inserted inactive (the default)
  assert.ok(!t.columns.includes('is_active'));
});

test('the run limited to one occupation has a key with code and a scope for every content table', () => {
  const tables = Object.fromEntries(realConfig().tables.map(t => [t.name, t]));
  assert.deepEqual(tables.courses.catalogKey, ['training_catalog_id', 'code']);
  assert.deepEqual(tables.enablers.catalogKey, ['course_id', 'code']);
  assert.deepEqual(tables.use_cases.catalogKey, ['course_id', 'code']);
  assert.deepEqual(tables.quizzes.catalogKey, ['training_catalog_id', 'code']);
  assert.deepEqual(tables.training_components.catalogKey, [
    'training_catalog_id',
    'code',
  ]);
  for (const name of [
    'training_catalogs',
    'training_components',
    'training_use_cases',
    'courses',
    'enablers',
    'use_cases',
    'content_documents',
    'quizzes',
    'enabler_quiz_links',
    'questions',
    'options',
    'training_catalog_learning_fields',
    'training_catalog_content_mappings',
  ]) {
    assert.ok(tables[name].catalogScope, `${name} has a catalogScope`);
  }
  // the legacy tables of the FIAE learning fields are not part of an occupation run
  assert.ok(!tables.lernfelder.catalogScope);
  assert.ok(!tables.lernfeld_mappings.catalogScope);
});

test('config: catalogScope and catalogKey are validated', () => {
  const base = () => ({
    tables: [
      { name: 'a', key: ['id'], columns: ['id', 'code', 'cat'] },
      {
        name: 'b',
        key: ['id'],
        columns: ['id', 'a_id', 'code'],
        remap: { a_id: { table: 'a', onMissing: 'skip' } },
      },
    ],
  });
  const withB = (a, b) => {
    const config = base();
    Object.assign(config.tables[0], a);
    Object.assign(config.tables[1], b);
    return validateConfig(config);
  };
  assert.deepEqual(
    withB(
      { catalogScope: { column: 'cat' } },
      { catalogScope: { parents: [{ column: 'a_id', table: 'a' }] } }
    ),
    []
  );
  assert.ok(withB({ catalogScope: { column: 'x; drop' } }, {}).length > 0);
  assert.ok(withB({ catalogScope: {} }, {}).length > 0);
  assert.ok(
    withB({ catalogScope: { column: 'cat', self: 'code' } }, {}).length > 0
  );
  // a parent that is not a table of the allowlist, or has no scope itself
  assert.ok(
    withB({}, { catalogScope: { parents: [{ column: 'a_id', table: 'a' }] } })
      .length > 0
  );
  assert.ok(
    withB(
      { catalogScope: { column: 'cat' } },
      { catalogScope: { parents: [{ column: 'a_id', table: 'zzz' }] } }
    ).length > 0
  );
  // the parent column must be a column that is copied
  assert.ok(
    withB(
      { catalogScope: { column: 'cat' } },
      { catalogScope: { parents: [{ column: 'nope', table: 'a' }] } }
    ).length > 0
  );
  // catalogKey columns must be copied columns
  assert.ok(withB({ catalogKey: ['id', 'missing'] }, {}).length > 0);
  assert.ok(withB({ catalogKey: [] }, {}).length > 0);
});

// ---------------------------------------------------------------------------
// --catalog
// ---------------------------------------------------------------------------

test('catalog code: letters, digits and . _ - only, no quote', () => {
  assert.equal(parseCatalogCode('KFBM'), 'KFBM');
  assert.equal(parseCatalogCode('KfBM'), 'KfBM');
  for (const bad of [
    "x'; drop table y; --",
    '',
    ' ',
    'a b',
    undefined,
    null,
    'x'.repeat(65),
  ]) {
    assert.throws(() => parseCatalogCode(bad), /catalog/i, String(bad));
  }
});

test('--catalog: the run is built, only allowlist tables, never a delete', () => {
  const built = build(realConfig(), { updateMode: 'never', catalog: 'KFBM' });
  assert.deepEqual(built.errors, []);
  assert.ok(built.tables.includes('courses'));
  assert.ok(built.tables.includes('options'));
  assert.ok(!built.tables.includes('lernfelder'));
  assert.ok(!built.tables.includes('lernfeld_mappings'));
  assert.ok(built.notes.some(n => n.startsWith('lernfelder: skipped')));
  // (the temporary id maps end with "on commit drop", that is no data change)
  const written = built.sql.replaceAll('on commit drop', '');
  assert.ok(!/\bdelete\b|\btruncate\b|\bdrop\b/i.test(written));
  assert.ok(!/profiles|organizations/.test(built.tables.join(' ')));
});

test('--catalog: the catalog must exist in both schemas, checked before anything is written', () => {
  const sql = squash(build(realConfig(), { catalog: 'KFBM' }).sql);
  const first = sql.indexOf('training_catalogs');
  assert.ok(first > 0);
  assert.ok(
    sql.includes(
      "if not exists (select 1 from public_preview.training_catalogs where lower(code) = lower('KFBM'))"
    )
  );
  assert.ok(
    sql.includes(
      "if not exists (select 1 from public.training_catalogs where lower(code) = lower('KFBM'))"
    )
  );
  assert.ok(sql.indexOf("lower('KFBM'))") < sql.indexOf('insert into'));
});

test('--catalog: the uniqueness check only reads the rows of the occupation (FIAE rows with code NULL cannot abort it)', () => {
  const sql = squash(build(realConfig(), { catalog: 'KFBM' }).sql);
  // source side: filter first, then group by the key with the code
  assert.ok(
    sql.includes(
      `from public_preview.courses s where s.training_catalog_id = ${CATALOG_ID_SQL} group by s.training_catalog_id, s.code having count(*) > 1`
    )
  );
  // target side: same filter on the target schema
  assert.ok(
    sql.includes(
      "from public.courses d where d.training_catalog_id = (select c.id from public.training_catalogs c where lower(c.code) = lower('KFBM')) group by d.training_catalog_id, d.code having count(*) > 1"
    )
  );
  // the unfiltered check of the plain run does not appear
  assert.ok(!sql.includes('from public_preview.courses s group by'));
  assert.ok(!sql.includes('from public.courses d group by'));
  assert.ok(!sql.includes('group by s.title, s.year, s.chapter'));
});

test('--catalog: a row without a code in the source aborts with a clear message', () => {
  const sql = squash(build(realConfig(), { catalog: 'KFBM' }).sql);
  for (const table of [
    'courses',
    'enablers',
    'use_cases',
    'quizzes',
    'training_components',
  ]) {
    assert.ok(
      new RegExp(
        `if exists \\(select 1 from public_preview\\.${table} s where [^;]*s\\.code is null\\) then raise exception 'content-sync: [^']*without a code`
      ).test(sql),
      table
    );
  }
  // tables that are keyed without a code have no such check
  assert.ok(!/public_preview\.options s where [^;]*s\.code is null/.test(sql));
});

test('--catalog: the key with code is used for the match, the insert and the id map', () => {
  const sql = squash(build(realConfig(), { catalog: 'KFBM' }).sql);
  assert.ok(
    /insert into public\.courses \([^)]*\) select [^;]* from public_preview\.courses s where not exists \(select 1 from public\.courses d where d\.training_catalog_id is not distinct from \(select m\.dst_id from _map_training_catalogs m where m\.src_id = s\.training_catalog_id\) and d\.code is not distinct from s\.code\)/.test(
      sql
    )
  );
  assert.ok(
    /create temp table _map_courses on commit drop as select distinct on \(s\.id\) s\.id as src_id, d\.id as dst_id from public_preview\.courses s join public\.courses d on [^;]* where s\.training_catalog_id = /.test(
      sql
    )
  );
});

test('--catalog: tables below a course are filtered through their parents', () => {
  const sql = squash(build(realConfig(), { catalog: 'KFBM' }).sql);
  // one level: enablers -> courses (catalog column)
  assert.ok(
    sql.includes(
      `from public_preview.enablers s where exists (select 1 from public_preview.courses p1 where p1.id = s.course_id and p1.training_catalog_id = ${CATALOG_ID_SQL})`
    )
  );
  // three levels: options -> questions -> quizzes (catalog column)
  assert.ok(
    sql.includes(
      `from public_preview.options s where exists (select 1 from public_preview.questions p1 where p1.id = s.question_id and exists (select 1 from public_preview.quizzes p2 where p2.id = p1.quiz_id and p2.training_catalog_id = ${CATALOG_ID_SQL}))`
    )
  );
  // a document hangs on an enabler, a use case or a course: any of them
  assert.ok(
    /from public_preview\.content_documents s where \(exists \(select 1 from public_preview\.enablers p1 where p1\.id = s\.enabler_id [^;]*\) or exists \(select 1 from public_preview\.use_cases p1 where p1\.id = s\.use_case_id [^;]*\) or exists \(select 1 from public_preview\.courses p1 where p1\.id = s\.course_id [^;]*\)\)/.test(
      sql
    )
  );
  // the catalog table itself is matched by its code
  assert.ok(
    sql.includes(
      "from public_preview.training_catalogs s where lower(s.code) = lower('KFBM') group by s.code"
    )
  );
});

test('--catalog: the filter is applied to the inserted rows and to the rows counted as missing', () => {
  const sql = squash(build(realConfig(), { catalog: 'KFBM' }).sql);
  const insert = /insert into public\.enablers [^;]*;/.exec(sql)[0];
  assert.ok(insert.includes('p1.training_catalog_id = '));
  const count =
    /select count\(\*\) into n_skip from public_preview\.enablers s where [^;]*;/.exec(
      sql
    )[0];
  assert.ok(count.includes('p1.training_catalog_id = '));
});

test('--catalog: use_cases.enabler_id is translated through the enabler map', () => {
  const sql = squash(build(realConfig(), { catalog: 'KFBM' }).sql);
  const insert =
    /insert into public\.use_cases \(([^)]*)\) select ([^;]*?) from public_preview\.use_cases s where [^;]*;/.exec(
      sql
    );
  assert.ok(insert, 'insert for use_cases');
  assert.ok(insert[1].includes('enabler_id'));
  assert.ok(
    insert[2].includes(
      '(select m.dst_id from _map_enablers m where m.src_id = s.enabler_id)'
    )
  );
  // an unlinked use case (enabler_id NULL) is not skipped
  assert.ok(
    insert[0].includes(
      '(s.enabler_id is null or (select m.dst_id from _map_enablers m'
    )
  );
  // the enabler map exists before the use cases are written
  assert.ok(
    sql.indexOf('create temp table _map_enablers') <
      sql.indexOf('insert into public.use_cases')
  );
});

test('--catalog: course, quiz and component links are translated, the code is copied', () => {
  const sql = squash(build(realConfig(), { catalog: 'KFBM' }).sql);
  const courses =
    /insert into public\.courses \(([^)]*)\) select ([^;]*?) from public_preview\.courses s where [^;]*;/.exec(
      sql
    );
  assert.ok(
    courses[1].includes('training_component_id') && courses[1].includes(' code')
  );
  assert.ok(
    courses[2].includes(
      '_map_training_components m where m.src_id = s.training_component_id'
    )
  );
  const quizzes =
    /insert into public\.quizzes \(([^)]*)\) select ([^;]*?) from public_preview\.quizzes s where [^;]*;/.exec(
      sql
    );
  assert.ok(
    quizzes[2].includes(
      '_map_training_catalogs m where m.src_id = s.training_catalog_id'
    )
  );
  assert.ok(
    quizzes[2].includes(
      '_map_training_components m where m.src_id = s.training_component_id'
    )
  );
});

test('--catalog: the catalog row is only inserted when missing, never updated', () => {
  const sql = squash(
    build(realConfig(), { catalog: 'KFBM', updateMode: 'configured' }).sql
  );
  assert.ok(!sql.includes('update public.training_catalogs'));
});

test('--catalog works in the other direction as well (filters follow the source schema)', () => {
  const sql = squash(
    build(realConfig(), {
      catalog: 'KFBM',
      from: 'public',
      to: 'public_preview',
    }).sql
  );
  assert.ok(
    sql.includes(
      'from public.courses s where s.training_catalog_id = (select c.id from public.training_catalogs c'
    )
  );
});

test('--catalog with an invalid code is an error of the build', () => {
  const built = build(realConfig(), { catalog: "x'; select 1; --" });
  assert.ok(built.errors.some(e => /catalog/i.test(e)));
  assert.equal(built.sql, '');
});

test('--catalog: a table without scope is skipped with a note, also when it is required', () => {
  const config = {
    tables: [
      {
        name: 'training_catalogs',
        key: ['code'],
        columns: ['code'],
        catalogScope: { self: 'code' },
      },
      { name: 'legacy', key: ['id'], columns: ['id'] },
    ],
  };
  const built = build(config, { catalog: 'KFBM' });
  assert.deepEqual(built.errors, []);
  assert.deepEqual(built.tables, ['training_catalogs']);
  assert.ok(built.notes.some(n => n.startsWith('legacy: skipped')));
});
