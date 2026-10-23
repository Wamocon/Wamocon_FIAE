// Tests for scripts/db/content-sync.mjs (pure logic, no database).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DIRECTIONS,
  buildScript,
  castExpression,
  parseReport,
  summarize,
  validateConfig,
} from '../../../scripts/db/content-sync.mjs';

const CONFIG_FILE = 'supabase/content-tables.json';
const realConfig = () => JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));

const col = (name, extra = {}) => ({
  name,
  dataType: 'text',
  udtSchema: 'pg_catalog',
  udtName: 'text',
  generated: false,
  ...extra,
});
const enumCol = (name, schema, type) =>
  col(name, { dataType: 'USER-DEFINED', udtSchema: schema, udtName: type });

// Small content model: courses (remapped creator) -> enablers (remapped course)
const config = {
  lookups: { profiles: { matchOn: ['email'], pk: 'id' } },
  tables: [
    {
      name: 'courses',
      key: ['title'],
      columns: [
        'title',
        'description',
        'created_by_id',
        'created_at',
        'updated_at',
      ],
      remap: { created_by_id: { table: 'profiles', onMissing: 'owner' } },
    },
    {
      name: 'enablers',
      key: ['course_id', 'title'],
      columns: ['course_id', 'title', 'duration_unit', 'updated_at'],
      remap: { course_id: { table: 'courses', onMissing: 'skip' } },
    },
  ],
};
const courseCols = schema => [
  col('id'),
  col('title'),
  col('created_by_id'),
  col('created_at'),
  col('updated_at'),
  col('description'),
  col('legacy_flag'),
];
const enablerCols = schema => [
  col('id'),
  col('course_id'),
  col('title'),
  enumCol('duration_unit', schema, 'duration_unit'),
  col('updated_at'),
];
const meta = {
  public_preview: {
    courses: courseCols('public_preview'),
    enablers: enablerCols('public_preview'),
  },
  public: { courses: courseCols('public'), enablers: enablerCols('public') },
};
const build = (extra = {}) =>
  buildScript({
    config,
    meta,
    from: 'public_preview',
    to: 'public',
    ownerEmail: 'owner@example.test',
    rollback: true,
    updateMode: 'configured',
    ...extra,
  });

test('the allowlist file is valid', () => {
  assert.deepEqual(validateConfig(realConfig()), []);
});

test('the allowlist file contains no user data tables', () => {
  const names = realConfig().tables.map(t => t.name);
  for (const forbidden of [
    'profiles',
    'organizations',
    'course_members',
    'quiz_submissions',
    'quiz_submission_answers',
    'quiz_assignments',
    'use_case_submissions',
    'enabler_submissions',
    'work_certificates',
    'weekly_evaluations',
    'notifications',
    'hai_embeddings',
    'hai_chat_messages',
    'progress',
  ]) {
    assert.ok(!names.includes(forbidden), forbidden);
  }
  assert.ok(names.includes('courses') && names.includes('training_components'));
});

test('user data tables are refused even if someone adds them', () => {
  for (const name of [
    'profiles',
    'organizations',
    'hai_embeddings',
    'work_certificates',
    'quiz_submissions',
    'course_members',
    'trainee_achieved_skills',
    'activity_reports',
    'notifications',
    'user_tokens',
  ]) {
    const errors = validateConfig({
      tables: [{ name, key: ['id'] }],
    });
    assert.ok(
      errors.some(e => e.includes('refused')),
      name
    );
  }
});

test('config errors: invalid identifiers, empty key, unknown lookup, bad order', () => {
  assert.ok(
    validateConfig({ tables: [{ name: 'x; drop table y', key: ['id'] }] })
      .length > 0
  );
  assert.ok(validateConfig({ tables: [{ name: 'a', key: [] }] }).length > 0);
  assert.ok(
    validateConfig({
      lookups: { auth_users: { matchOn: ['email'] } },
      tables: [{ name: 'a', key: ['id'] }],
    }).length > 0
  );
  assert.ok(
    validateConfig({
      tables: [
        { name: 'b', key: ['id'], remap: { a_id: { table: 'a' } } },
        { name: 'a', key: ['id'] },
      ],
    }).some(e => e.includes('earlier table'))
  );
  assert.ok(
    validateConfig({
      tables: [{ name: 'a', key: ['id'], update: 'sometimes' }],
    }).length > 0
  );
});

test('the real allowlist is ordered by foreign keys', () => {
  const c = realConfig();
  const index = new Map(c.tables.map((t, i) => [t.name, i]));
  for (const t of c.tables) {
    for (const spec of Object.values(t.remap ?? {})) {
      if (spec.table in (c.lookups ?? {})) continue;
      assert.ok(
        index.get(spec.table) < index.get(t.name),
        `${t.name} -> ${spec.table}`
      );
    }
  }
});

test('only the two schemas, in two different directions', () => {
  assert.deepEqual(DIRECTIONS['preview-to-production'], [
    'public_preview',
    'public',
  ]);
  assert.deepEqual(DIRECTIONS['production-to-preview'], [
    'public',
    'public_preview',
  ]);
  assert.ok(
    buildScript({ config, meta, from: 'public', to: 'public', rollback: true })
      .errors.length > 0
  );
  assert.ok(
    buildScript({ config, meta, from: 'auth', to: 'public', rollback: true })
      .errors.length > 0
  );
});

test('script: inserts and updates only, never deletes or truncates', () => {
  const { sql, errors, tables } = build();
  assert.deepEqual(errors, []);
  assert.deepEqual(tables, ['courses', 'enablers']);
  assert.ok(!/\bdelete\b/i.test(sql));
  assert.ok(!/\btruncate\b/i.test(sql));
  assert.ok(!/\bdrop\b/i.test(sql.replace(/on commit drop/g, '')));
  assert.ok(sql.includes('insert into public.courses'));
  assert.ok(sql.includes('update public.courses d set'));
  assert.ok(sql.includes('from public_preview.courses s'));
});

test('script: runs in one transaction under an advisory lock and rolls back in a dry run', () => {
  const dry = build({ rollback: true }).sql;
  const real = build({ rollback: false }).sql;
  assert.ok(dry.includes("pg_advisory_xact_lock(hashtext('content_sync'))"));
  assert.ok(dry.includes("raise exception 'CONTENT_SYNC_REPORT:%'"));
  assert.ok(!real.includes('CONTENT_SYNC_REPORT'));
  assert.ok(real.startsWith('do $content_sync$'));
});

test('script: key uniqueness is checked on both sides', () => {
  const { sql } = build();
  assert.ok(sql.includes('is not unique in public_preview.courses'));
  assert.ok(sql.includes('is not unique in public.courses'));
});

test('script: ids are not copied when the key is not the id (target generates them)', () => {
  const { sql } = build();
  const insert = sql
    .split('\n')
    .find(l => l.includes('insert into public.courses'));
  assert.ok(!/\(id,/.test(insert));
  assert.ok(insert.includes('title'));
});

test('script: foreign keys are translated through id maps, user rows are only looked up', () => {
  const { sql } = build();
  assert.ok(sql.includes('create temp table _map_profiles'));
  assert.ok(sql.includes('lower(sp.email::text) = lower(d.email::text)'));
  assert.ok(sql.includes('create temp table _map_courses'));
  assert.ok(sql.includes('from _map_courses m where m.src_id = s.course_id'));
  // the profiles lookup creates no insert or update into profiles
  assert.ok(!/insert into public\.profiles/.test(sql));
  assert.ok(!/update public\.profiles/.test(sql));
});

test('script: creator falls back to the owner profile, otherwise rows are skipped', () => {
  const { sql } = build();
  assert.ok(sql.includes("lower('owner@example.test')"));
  assert.ok(sql.includes('is not null)'));
});

test('script: enum columns are cast through text to the target type', () => {
  const { sql } = build();
  assert.ok(sql.includes('s.duration_unit::text::public.duration_unit'));
});

test('script: update mode newer compares updated_at, never touches created_at or the key', () => {
  const { sql } = build();
  const update = sql
    .split('\n')
    .find(l => l.includes('update public.enablers d set'));
  assert.ok(update.includes('s.updated_at > d.updated_at'));
  assert.ok(!/set[^;]*created_at/.test(update));
  assert.ok(!/set[^;]*\btitle =/.test(update));
});

test('script: creator columns are never overwritten on update', () => {
  const { sql } = build();
  const update = sql
    .split('\n')
    .find(l => l.includes('update public.courses d set'));
  assert.ok(update);
  assert.ok(!/set[^;]*created_by_id/.test(update));
});

test('script: update mode never writes no update', () => {
  const c = structuredClone(config);
  c.tables[0].update = 'never';
  const { sql } = buildScript({
    config: c,
    meta,
    from: 'public_preview',
    to: 'public',
    rollback: true,
  });
  assert.ok(!sql.includes('update public.courses'));
});

test('script: only the listed columns are copied, a shared column that is not listed is not', () => {
  const { sql } = build();
  // legacy_flag exists on both sides but is not in the allowlist
  assert.ok(!sql.includes('legacy_flag'));
  assert.ok(sql.includes('description'));
  assert.ok(sql.includes('title'));
  // a listed column that does not exist on one side is simply not copied
  const m = structuredClone(meta);
  m.public_preview.courses = m.public_preview.courses.filter(
    c => c.name !== 'created_at'
  );
  assert.ok(!build({ meta: m }).sql.includes('created_at'));
});

test('script: a column that is not in the allowlist is never copied, even a new one', () => {
  const m = structuredClone(meta);
  m.public_preview.courses.push(col('internal_notes'));
  m.public.courses.push(col('internal_notes'));
  assert.ok(!build({ meta: m }).sql.includes('internal_notes'));
});

test('config: every table needs an explicit columns list with its key and remap columns', () => {
  const noColumns = structuredClone(config);
  delete noColumns.tables[0].columns;
  assert.ok(validateConfig(noColumns).some(e => e.includes('columns must be')));
  const noKey = structuredClone(config);
  noKey.tables[0].columns = ['created_by_id'];
  assert.ok(validateConfig(noKey).some(e => e.includes('key column title')));
  const noRemap = structuredClone(config);
  noRemap.tables[0].columns = ['title'];
  assert.ok(
    validateConfig(noRemap).some(e => e.includes('remap column created_by_id'))
  );
  const secret = structuredClone(config);
  secret.tables[0].columns.push('api_token');
  assert.ok(validateConfig(secret).some(e => e.includes('secret')));
});

test('script: a copied foreign key to a user table without a remap rule aborts', () => {
  const c = structuredClone(config);
  c.tables[0].columns.push('owner_org_id');
  const m = structuredClone(meta);
  m.public_preview.courses.push(col('owner_org_id'));
  m.public.courses.push(col('owner_org_id'));
  const fks = {
    public_preview: {
      courses: [
        {
          column: 'owner_org_id',
          refSchema: 'public_preview',
          refTable: 'organizations',
        },
      ],
    },
    public: {
      courses: [
        {
          column: 'owner_org_id',
          refSchema: 'public',
          refTable: 'organizations',
        },
      ],
    },
  };
  const r = buildScript({
    config: c,
    meta: m,
    fks,
    from: 'public_preview',
    to: 'public',
    rollback: true,
  });
  assert.ok(
    r.errors.some(e => e.includes('owner_org_id') && e.includes('user table'))
  );
  assert.equal(r.sql, '');
  // with a remap rule the same column is fine
  c.tables[0].remap.owner_org_id = { table: 'profiles', onMissing: 'null' };
  assert.deepEqual(
    buildScript({
      config: c,
      meta: m,
      fks,
      from: 'public_preview',
      to: 'public',
      rollback: true,
    }).errors,
    []
  );
  // the existing remapped creator column does not trigger it
  const withCreator = {
    public_preview: {
      courses: [
        {
          column: 'created_by_id',
          refSchema: 'public_preview',
          refTable: 'profiles',
        },
      ],
    },
    public: {},
  };
  assert.deepEqual(build({ fks: withCreator }).errors, []);
  // a foreign key to auth.* is refused as well
  const toAuth = {
    public_preview: {
      enablers: [{ column: 'title', refSchema: 'auth', refTable: 'users' }],
    },
    public: {},
  };
  assert.ok(build({ fks: toAuth }).errors.some(e => e.includes('user table')));
});

test('script: the default update mode is never, an update statement is only written for configured', () => {
  const never = buildScript({
    config,
    meta,
    from: 'public_preview',
    to: 'public',
    rollback: true,
  });
  assert.deepEqual(never.errors, []);
  assert.ok(!/update public\./.test(never.sql));
  assert.ok(never.sql.includes('insert into public.courses'));
  assert.ok(/update public\.courses d set/.test(build().sql));
  assert.ok(
    buildScript({
      config,
      meta,
      from: 'public_preview',
      to: 'public',
      rollback: true,
      updateMode: 'sometimes',
    }).errors.length > 0
  );
});

test('the allowlist file lists columns for every table and not the HAI index flag', () => {
  for (const tbl of realConfig().tables) {
    assert.ok(Array.isArray(tbl.columns) && tbl.columns.length > 0, tbl.name);
    for (const k of tbl.key)
      assert.ok(tbl.columns.includes(k), `${tbl.name}.${k}`);
  }
  const docs = realConfig().tables.find(x => x.name === 'content_documents');
  assert.ok(!docs.columns.includes('is_indexed_by_hai'));
});

test('the release workflow only inserts, the manual workflow chooses the update mode', () => {
  const release = readFileSync(
    '.github/workflows/release-production.yml',
    'utf8'
  );
  assert.ok(
    release.includes(
      'content-sync.mjs --linked --apply --direction preview-to-production --update never'
    )
  );
  const manual = readFileSync('.github/workflows/content-sync.yml', 'utf8');
  assert.ok(manual.includes('update_mode:'));
  assert.ok(/--update "\$mode"/.test(manual));
});

test('script: a column that exists in only one schema is not copied', () => {
  const m = structuredClone(meta);
  m.public_preview.courses.push(col('only_in_preview'));
  const { sql } = buildScript({
    config,
    meta: m,
    from: 'public_preview',
    to: 'public',
    rollback: true,
  });
  assert.ok(!sql.includes('only_in_preview'));
});

test('script: an optional table that is missing is skipped with a note, a required one is an error', () => {
  const c = structuredClone(config);
  c.tables.push({
    name: 'training_catalogs',
    key: ['code'],
    columns: ['code'],
    optional: true,
  });
  const r = buildScript({
    config: c,
    meta,
    from: 'public_preview',
    to: 'public',
    rollback: true,
  });
  assert.deepEqual(r.errors, []);
  assert.ok(r.notes.some(n => n.includes('training_catalogs')));
  const c2 = structuredClone(config);
  c2.tables.push({
    name: 'training_catalogs',
    key: ['code'],
    columns: ['code'],
  });
  assert.ok(
    buildScript({
      config: c2,
      meta,
      from: 'public_preview',
      to: 'public',
      rollback: true,
    }).errors.length > 0
  );
});

test('script: a remap for a column that does not exist is ignored', () => {
  const c = structuredClone(config);
  c.tables[0].columns.push('training_catalog_id');
  c.tables[0].remap.training_catalog_id = {
    table: 'profiles',
    onMissing: 'skip',
  };
  assert.deepEqual(
    buildScript({
      config: c,
      meta,
      from: 'public_preview',
      to: 'public',
      rollback: true,
    }).errors,
    []
  );
});

test('script: a parent that is not part of the run is an error', () => {
  const r = build({ only: ['enablers'] });
  assert.ok(r.errors.length > 0);
});

test('script: array columns of user defined types are refused loudly', () => {
  assert.throws(() =>
    castExpression(
      's',
      col('x', { dataType: 'ARRAY', udtSchema: 'public', udtName: '_mood' }),
      col('x')
    )
  );
});

test('report is read out of the error message and summarised', () => {
  const message =
    'ERROR: CONTENT_SYNC_REPORT:{"courses": {"inserted": 2, "updated": 1, "unmatched": 0}} (SQLSTATE P0001)';
  const report = parseReport(message);
  assert.deepEqual(report, {
    courses: { inserted: 2, updated: 1, unmatched: 0 },
  });
  const s = summarize(report);
  assert.equal(s.inserted, 2);
  assert.equal(s.updated, 1);
  assert.equal(parseReport('ERROR: something else'), null);
});
