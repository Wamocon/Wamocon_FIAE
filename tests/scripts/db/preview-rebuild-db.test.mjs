// Rebuild of public_preview on a FILLED schema, against a real Postgres.
//
// Not part of the standard CI: db-checks has no database. The test is skipped
// unless PREVIEW_REBUILD_TEST_URL points to a LOCAL throwaway Postgres that the
// caller may do anything in (superuser, e.g. a docker container, see
// docs/release-prozess.md, section 9):
//
//   docker run -d --name pv-test -e POSTGRES_PASSWORD=pw -p 54339:5432 postgres:17
//   PREVIEW_REBUILD_TEST_URL=postgresql://postgres:pw@127.0.0.1:54339/postgres \
//     node --test tests/scripts/db/preview-rebuild-db.test.mjs
//   docker rm -f pv-test
//
// The test creates its own database (dropped at the end) and, cluster wide, the
// roles app_preview and app_preview_migrator (01-preview-role.sql). It refuses
// every host except localhost, never needs a Supabase project and never reads a
// secret. The Supabase CLI is replaced by tests/scripts/db/fixtures/pg-cli.mjs.
//
// What it proves, with a synthetic structure of public (tables that become views,
// a view on a view, a materialized view, a partitioned table, enums, a domain, a
// composite type, sequences, functions, policies, triggers):
//   - a rebuild on an already filled public_preview works (the former error was
//     "view lernfelder does not exist")
//   - rebuilding three times in a row gives the identical structure fingerprint
//   - 01, 02 and 03 of supabase/preview-setup can be run again without a change
//   - public, auth and storage are not touched
//   - "apply" keeps the Preview data, only "rebuild" (the reset) removes it
//   - a dependent object outside public_preview stops the rebuild before anything
//     is dropped
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';

const ADMIN_URL = process.env.PREVIEW_REBUILD_TEST_URL;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const ROOT = resolve('.');
const SCRIPT = join(ROOT, 'scripts/db/preview-migrate.mjs');
const CLI = join(ROOT, 'tests/scripts/db/fixtures/pg-cli.mjs');
const FIXTURE = join(ROOT, 'tests/scripts/db/fixtures/preview-rebuild');
const FINGERPRINT = readFileSync(
  join(ROOT, 'tests/scripts/db/fixtures/schema-fingerprint.sql'),
  'utf8'
);
const setup = name =>
  readFileSync(join(ROOT, 'supabase/preview-setup', name), 'utf8');

// What a Supabase project brings along and the Preview scripts rely on
const SUPABASE_STUBS = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists extensions;
create schema if not exists auth;
do $$ begin
  if to_regprocedure('auth.uid()') is null then
    create function auth.uid() returns uuid language sql stable as 'select null::uuid';
  end if;
  if to_regprocedure('auth.role()') is null then
    create function auth.role() returns text language sql stable as 'select null::text';
  end if;
  if to_regprocedure('auth.jwt()') is null then
    create function auth.jwt() returns jsonb language sql stable as 'select null::jsonb';
  end if;
  if to_regprocedure('auth.email()') is null then
    create function auth.email() returns text language sql stable as 'select null::text';
  end if;
end $$;
create schema if not exists storage;
do $$ begin
  if to_regclass('storage.objects') is null then
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;
  end if;
  if to_regprocedure('storage.foldername(text)') is null then
    create function storage.foldername(name text) returns text[] language sql immutable
      as $f$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $f$;
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
create table public.sentinel (id integer primary key, note text);
insert into public.sentinel values (1, 'production row');
create table public.metrics (day date not null, value integer not null);
create function public.shadow_fn(r public.metrics) returns integer language sql as 'select r.value';
create function public.plain_fn_1() returns integer language sql as 'select 1';
`;

// Facts about the shared schemas that a rebuild must not change
const SHARED_STATE = `select md5(string_agg(line, E'\\n' order by line)) as hash, count(*)::int as n from (
  select 'REL ' || n.nspname || '.' || c.relname || ' ' || c.relkind::text || ' ' || coalesce(c.relacl::text, '') as line
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'auth', 'storage') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  union all
  select 'FN ' || p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid))
    from pg_proc p where p.pronamespace in ('public'::regnamespace, 'auth'::regnamespace, 'storage'::regnamespace) and p.prokind = 'f'
  union all
  select 'POL ' || polrelid::regclass::text || ' ' || polname from pg_policy
   where polrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'auth'::regnamespace, 'storage'::regnamespace))
     and polname not like '%\\_preview'
  union all
  select 'ROW ' || id || ' ' || coalesce(note, '') from public.sentinel
) x`;

describe(
  'rebuild of public_preview on a filled schema (local Postgres)',
  {
    skip: ADMIN_URL
      ? false
      : 'PREVIEW_REBUILD_TEST_URL is not set (needs a local throwaway Postgres)',
  },
  () => {
    let dbName;
    let admin;
    let migrator;
    let migratorUrl;
    let work;
    let sharedBefore;
    const fingerprints = [];

    const withUser = (url, db, user, password) => {
      const u = new URL(url);
      u.pathname = `/${db}`;
      if (user) {
        u.username = user;
        u.password = password;
      }
      return u.toString();
    };

    /** Runs preview-migrate.mjs like the Preview Reset workflow, with the local CLI stand-in. */
    function run(command, ...extra) {
      const result = spawnSync(
        process.execPath,
        [SCRIPT, command, '--db-url-env', 'PV_URL', ...extra],
        {
          cwd: work,
          encoding: 'utf8',
          env: { ...process.env, SUPABASE_CLI: CLI, PV_URL: migratorUrl },
        }
      );
      return {
        status: result.status,
        out: `${result.stdout}${result.stderr}`,
      };
    }

    const rebuild = () =>
      run('rebuild', '--snapshot', join(work, 'snap'), '--execute');

    async function fingerprint() {
      const { rows } = await admin.query(FINGERPRINT);
      const lines = rows.map(r => r.line);
      return {
        lines,
        hash: createHash('sha256').update(lines.join('\n')).digest('hex'),
      };
    }

    /** The human step after every reset: realtime membership and storage policies. */
    const runShared = () => admin.query(setup('03-shared-objects.sql'));

    const count = async table =>
      Number(
        (await admin.query(`select count(*) as n from ${table}`)).rows[0].n
      );

    before(async () => {
      assert.ok(
        LOCAL_HOSTS.has(new URL(ADMIN_URL).hostname),
        'PREVIEW_REBUILD_TEST_URL must point to localhost: this test drops and recreates objects'
      );
      dbName = `pv_rebuild_${process.pid}_${randomBytes(3).toString('hex')}`;
      const root = new pg.Client({ connectionString: ADMIN_URL });
      await root.connect();
      await root.query(`create database ${dbName}`);
      await root.end();

      admin = new pg.Client({
        connectionString: withUser(ADMIN_URL, dbName),
      });
      await admin.connect();
      await admin.query(SUPABASE_STUBS);
      await admin.query(setup('01-preview-role.sql'));
      const password = randomBytes(12).toString('hex');
      await admin.query(
        `alter role app_preview_migrator with password '${password}'`
      );
      migratorUrl = withUser(
        ADMIN_URL,
        dbName,
        'app_preview_migrator',
        password
      );
      // pgvector lives in public in the real project, so public is on the search path of the
      // Preview roles (01-preview-role.sql); the purge must not resolve any name there
      const withPublic = new URL(migratorUrl);
      withPublic.searchParams.set(
        'options',
        '-c search_path=public_preview,extensions,public'
      );
      migratorUrl = withPublic.toString();
      migrator = new pg.Client({ connectionString: migratorUrl });
      await migrator.connect();

      // Working directory of the script: migrations, post clone file and snapshot
      work = mkdtempSync(join(tmpdir(), 'pv-rebuild-'));
      mkdirSync(join(work, 'supabase/preview-setup'), { recursive: true });
      cpSync(
        join(ROOT, 'supabase/preview-setup/02-preview-side.sql'),
        join(work, 'supabase/preview-setup/02-preview-side.sql')
      );
      cpSync(join(FIXTURE, 'migrations'), join(work, 'supabase/migrations'), {
        recursive: true,
      });
      mkdirSync(join(work, 'snap'));
      for (const f of ['public-structure.sql', 'public-ledger.json']) {
        cpSync(join(FIXTURE, f), join(work, 'snap', f));
      }
      sharedBefore = (await admin.query(SHARED_STATE)).rows[0];
    });

    after(async () => {
      await migrator?.end();
      await admin?.end();
      if (dbName) {
        const root = new pg.Client({ connectionString: ADMIN_URL });
        await root.connect();
        await root.query(`drop database if exists ${dbName} with (force)`);
        await root.end();
      }
      if (work) rmSync(work, { recursive: true, force: true });
    });

    test('the first rebuild on an empty schema works', async () => {
      const r = rebuild();
      assert.equal(r.status, 0, r.out);
      await runShared();
      fingerprints.push(await fingerprint());
      const lines = fingerprints[0].lines.join('\n');
      // the catalog migration turned the tables into views
      assert.match(lines, /REL public_preview\.lernfelder kind=v /);
      assert.match(lines, /REL public_preview\.lernfeld_mappings kind=v /);
      assert.match(lines, /REL public_preview\.v_lernfeld_overview kind=v /);
      assert.match(lines, /REL public_preview\.mv_profile_roles kind=m /);
      assert.match(lines, /REL public_preview\.metrics kind=p /);
      assert.match(lines, /REL public_preview\.score_pair kind=c /);
      assert.match(lines, /PUB supabase_realtime public_preview\.profiles/);
    });

    test('a second rebuild on the filled schema works (view lernfelder does not exist)', async () => {
      const r = rebuild();
      assert.equal(r.status, 0, r.out);
      assert.ok(!/does not exist/.test(r.out), r.out);
      await runShared();
      fingerprints.push(await fingerprint());
    });

    test('a third rebuild works and all three leave the identical structure', async () => {
      const r = rebuild();
      assert.equal(r.status, 0, r.out);
      await runShared();
      fingerprints.push(await fingerprint());
      assert.equal(fingerprints.length, 3);
      assert.ok(
        fingerprints[0].lines.length > 60,
        'the fingerprint is not empty'
      );
      for (const f of fingerprints) {
        assert.deepEqual(f.lines, fingerprints[0].lines);
        assert.equal(f.hash, fingerprints[0].hash);
      }
    });

    test('public, auth and storage are the same after the rebuilds', async () => {
      const now = (await admin.query(SHARED_STATE)).rows[0];
      assert.deepEqual(now, sharedBefore);
      assert.equal(await count('public.sentinel'), 1);
    });

    test('the setup files 01, 02 and 03 can be run again without a change', async () => {
      // The constructor functions of a range type belong to the bootstrap superuser (not to the
      // migration role), so the default privileges do not reach them; 01 grants on them once.
      const withoutBootstrapOwned = lines =>
        lines.filter(
          l =>
            !/^FN public_preview\..* owner=(?!app_preview_migrator\b)/.test(l)
        );
      const reference = fingerprints[0].lines;
      const repeat = async () => {
        await admin.query(setup('01-preview-role.sql'));
        await migrator.query(setup('02-preview-side.sql'));
        await runShared();
      };
      const canCall = async role =>
        (
          await admin.query(
            `select has_function_privilege('${role}', 'preview_support.has_preview_profile(uuid)', 'execute') as ok`
          )
        ).rows[0].ok;

      // what an older 01 handed out on has_preview_profile is taken back by 03
      await admin.query(
        'grant execute on function preview_support.has_preview_profile(uuid) to anon, service_role, app_preview'
      );
      assert.equal(await canCall('anon'), true);
      await repeat();
      assert.equal(await canCall('anon'), false);
      assert.equal(await canCall('app_preview'), false);
      assert.equal(await canCall('authenticated'), true);

      // the structure is the one of the rebuild, and a further pass changes nothing at all
      const first = (await fingerprint()).lines;
      assert.deepEqual(
        withoutBootstrapOwned(first),
        withoutBootstrapOwned(reference)
      );
      await repeat();
      await repeat();
      assert.deepEqual((await fingerprint()).lines, first);
      const now = (await admin.query(SHARED_STATE)).rows[0];
      assert.deepEqual(now, sharedBefore);
    });

    test('apply keeps the Preview data, only rebuild removes it', async () => {
      await admin.query(
        `insert into public_preview.profiles (id) values (gen_random_uuid()), (gen_random_uuid())`
      );
      await admin.query(
        `insert into public_preview.catalog_learning_fields (title, code) values ('LF1', 'lf1')`
      );
      assert.equal(await count('public_preview.profiles'), 2);

      // nothing open: apply changes nothing
      let r = run('apply');
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /nothing open/);
      assert.equal(await count('public_preview.profiles'), 2);

      // a new migration arrives: apply runs it and keeps the rows
      mkdirSync(join(work, 'supabase/migrations'), { recursive: true });
      cpSync(
        join(FIXTURE, 'late-migrations/20260301000000_late_table.sql'),
        join(work, 'supabase/migrations/20260301000000_late_table.sql')
      );
      r = run('apply');
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /applied: 20260301000000_late_table\.sql/);
      assert.equal(await count('public_preview.profiles'), 2);
      assert.equal(await count('public_preview.catalog_learning_fields'), 1);
      assert.equal(await count('public_preview.late_table'), 0);

      // and again: nothing is applied twice
      r = run('apply');
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /nothing open/);

      // the reset empties the schema and rebuilds it, the late migration comes back with it
      r = rebuild();
      assert.equal(r.status, 0, r.out);
      assert.equal(await count('public_preview.profiles'), 0);
      assert.equal(await count('public_preview.catalog_learning_fields'), 0);
      assert.equal(await count('public_preview.late_table'), 0);
      const ledger = await admin.query(
        'select version from preview_meta.schema_migrations order by version'
      );
      assert.deepEqual(
        ledger.rows.map(x => x.version),
        ['20260101000000', '20260201000000', '20260301000000']
      );
      assert.equal(await count('public.sentinel'), 1);
      assert.deepEqual((await admin.query(SHARED_STATE)).rows[0], sharedBefore);
    });

    test('a dependent object outside public_preview stops the rebuild before anything is dropped', async () => {
      await runShared();
      await admin.query(
        `insert into public_preview.profiles (id) values (gen_random_uuid())`
      );
      await admin.query(
        `create view public.foreign_dependent as select id from public_preview.profiles`
      );
      const hash = (await fingerprint()).hash;
      try {
        const r = rebuild();
        assert.equal(r.status, 1, r.out);
        assert.match(
          r.out,
          /Rebuild aborted: these objects outside public_preview depend on it/
        );
        assert.match(r.out, /foreign_dependent/);
        // rolled back: structure and rows are as before
        assert.equal((await fingerprint()).hash, hash);
        assert.equal(await count('public_preview.profiles'), 1);
        assert.equal(await count('public.sentinel'), 1);
      } finally {
        await admin.query('drop view if exists public.foreign_dependent');
      }
      // without the dependent object the rebuild goes through again
      const r = rebuild();
      assert.equal(r.status, 0, r.out);
      assert.equal(await count('public_preview.profiles'), 0);
    });
  }
);
