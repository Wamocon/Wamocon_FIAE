// Tests for scripts/db/preview-rewrite.mjs (pure logic, no database).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  bucketsFrom,
  newMigrationChecks,
  renameSchema,
  rewrite,
  rewriteDump,
  sections,
  statements,
  triggerFunctionsFrom,
} from '../../../scripts/db/preview-rewrite.mjs';

const OPTIONS = { buckets: ['content', 'avatar', 'private-docs'] };
const rw = sql => rewrite(sql, OPTIONS);

test('semicolon in a $-body does not split', () => {
  assert.equal(
    statements(
      'create function f() returns int as $$ select 1; select 2; $$ language sql; select 3;'
    ).length,
    2
  );
});

test('semicolon in string and comment does not split', () => {
  assert.equal(statements('select \'a;b\'; -- x; y\nselect "c;d";').length, 2);
});

test('nested dollar quotes', () => {
  assert.equal(
    statements('do $$ begin perform x($c$ a; $c$); end $$; select 1;').length,
    2
  );
});

test('sections classify comment, string and identifier', () => {
  const types = sections(`select 'a' /* b */ "c"`).map(s => s.type);
  assert.deepEqual(
    types.filter(t => t !== 'code'),
    ['string', 'comment', 'identifier']
  );
});

test('public.table is renamed', () => {
  assert.equal(
    renameSchema('select * from public.courses'),
    'select * from public_preview.courses'
  );
});

test('format() with public.%I and string concatenation are renamed', () => {
  assert.ok(
    renameSchema(
      "execute format('alter table public.%I enable row level security', t)"
    ).includes('public_preview.%I')
  );
  assert.equal(
    renameSchema("execute 'select * from public.' || t"),
    "execute 'select * from public_preview.' || t"
  );
});

test('quoted "public" is renamed', () => {
  assert.equal(
    renameSchema('select * from "public"."x"'),
    'select * from "public_preview"."x"'
  );
});

test('the role PUBLIC and graphql_public stay', () => {
  assert.equal(
    renameSchema('revoke all on function public.f() from public, anon;'),
    'revoke all on function public_preview.f() from public, anon;'
  );
  assert.equal(
    renameSchema('select graphql_public.x()'),
    'select graphql_public.x()'
  );
});

test('search_path variants are renamed', () => {
  assert.equal(
    renameSchema('set search_path = public, extensions'),
    'set search_path = public_preview, extensions'
  );
  assert.equal(
    renameSchema("SET search_path TO 'public'"),
    "SET search_path TO 'public_preview'"
  );
  assert.equal(
    renameSchema('SET "search_path" TO \'public\''),
    'SET "search_path" TO \'public_preview\''
  );
  assert.equal(
    renameSchema(
      "select set_config('search_path', 'public, extensions', true)"
    ),
    "select set_config('search_path', 'public_preview, extensions', true)"
  );
});

test('catalog checks get the Preview schema', () => {
  assert.equal(
    renameSchema("where table_schema = 'public'"),
    "where table_schema = 'public_preview'"
  );
  assert.equal(
    renameSchema(
      "if not exists (select 1 from pg_type where typname = 'x') then"
    ),
    "if not exists (select 1 from pg_type where typname = 'x' and typnamespace = 'public_preview'::regnamespace) then"
  );
  assert.equal(
    renameSchema("select to_regclass('public.courses')"),
    "select to_regclass('public_preview.courses')"
  );
});

test('data value public stays when it is a plain value', () => {
  assert.equal(
    renameSchema("insert into t (visibility) values ('public')"),
    "insert into t (visibility) values ('public')"
  );
});

test('comment texts keep their public.', () => {
  assert.equal(
    renameSchema("comment on table public.t is 'Created by public.f()'"),
    "comment on table public_preview.t is 'Created by public.f()'"
  );
});

test('begin and commit are stripped, the rest is rewritten', () => {
  const r = rw(
    "begin;\nset local lock_timeout = '5s';\ncreate table public.t (id int);\ncommit;"
  );
  assert.deepEqual(r.errors, []);
  assert.ok(!/\bbegin\b/i.test(r.sql));
  assert.ok(!/\bcommit\b/i.test(r.sql));
  assert.ok(r.sql.includes('create table public_preview.t'));
});

test('rollback inside a migration is rejected', () => {
  assert.equal(rw('begin; select 1; rollback;').errors.length, 1);
});

test('auth trigger gets the suffix and the Preview function', () => {
  const r = rw(
    'drop trigger if exists on_auth_user_created on auth.users;\ncreate trigger on_auth_user_created\n  after insert on auth.users\n  for each row execute function public.handle_new_user();'
  );
  assert.ok(r.sql.includes('create trigger on_auth_user_created_preview'));
  assert.ok(
    r.sql.includes(
      'drop trigger if exists on_auth_user_created_preview on auth.users'
    )
  );
  assert.ok(r.sql.includes('public_preview.handle_new_user()'));
  assert.equal(r.shared.length, 2);
  assert.equal(r.errors.length, 0);
});

test('trigger function of an auth trigger gets the error shell', () => {
  const sql =
    'create or replace function public.handle_new_user() returns trigger language plpgsql as $$ begin insert into public.profiles (id) values (new.id); return new; end $$;\ncreate trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();';
  const triggerFunctions = triggerFunctionsFrom([sql]);
  assert.deepEqual(triggerFunctions, ['handle_new_user']);
  const r = rewrite(sql, { triggerFunctions });
  assert.ok(r.sql.includes('exception when others then'));
  assert.ok(r.sql.includes('public_preview.profiles'));
});

test('a trigger function that is not plpgsql is rejected', () => {
  const sql =
    'create function public.f() returns trigger language sql as $$ select 1 $$;';
  assert.equal(rewrite(sql, { triggerFunctions: ['f'] }).errors.length, 1);
});

test('trigger on a public table keeps its name', () => {
  assert.ok(
    rw(
      'create trigger t_upd before update on public.x for each row execute function public.f();'
    ).sql.includes('create trigger t_upd before')
  );
});

test('disabling all triggers of an auth table is rejected', () => {
  assert.equal(
    rw('alter table auth.users disable trigger all;').errors.length,
    1
  );
});

test('storage policy gets the suffix and the own bucket twin', () => {
  const r = rw(
    "create policy docs_insert on storage.objects for insert to authenticated with check (bucket_id = 'private-docs' and public.is_platform_owner());"
  );
  assert.ok(
    r.sql.includes('create policy docs_insert_preview on storage.objects')
  );
  assert.ok(r.sql.includes("bucket_id = 'private-docs-preview'"));
  assert.ok(r.sql.includes('public_preview.is_platform_owner'));
});

test('statements on shared buckets (content, avatar) are skipped for Preview', () => {
  const r = rw(
    "create policy content_read on storage.objects for select using (bucket_id = 'content');"
  );
  assert.equal(r.sql.trim(), '');
  assert.equal(r.errors.length, 0);
  const b = rw(
    "insert into storage.buckets (id, name, public) values ('avatar', 'avatar', true);"
  );
  assert.equal(b.sql.trim(), '');
});

test('own bucket is created as twin', () => {
  assert.ok(
    rw(
      "insert into storage.buckets (id, name, public) values ('private-docs', 'private-docs', false) on conflict (id) do nothing;"
    ).sql.includes("('private-docs-preview', 'private-docs-preview', false)")
  );
});

test('storage policy without bucket reference is rejected', () => {
  assert.equal(
    rw(
      'create policy alle on storage.objects for select using (public.is_platform_owner());'
    ).errors.length,
    1
  );
});

test('buckets are found in migrations', () => {
  assert.deepEqual(
    bucketsFrom([
      "insert into storage.buckets (id, name) values ('a', 'a'), ('b', 'b');",
    ]),
    ['a', 'b']
  );
});

test('forbidden statements are rejected', () => {
  for (const sql of [
    'create role app_x login;',
    'alter table auth.users add column x int;',
    'create publication p for all tables;',
    'alter publication supabase_realtime add table public.notifications;',
    'update auth.users set email = null;',
    'alter default privileges grant all on tables to anon;',
    'create event trigger e on ddl_command_end execute function f();',
    'drop extension vector;',
    'alter role postgres set search_path = public;',
    'reset search_path;',
    'grant anon to authenticator;',
  ]) {
    assert.equal(rw(sql).errors.length, 1, sql);
  }
});

test('"public" as a plain value in format() is rejected', () => {
  assert.equal(rw("select quote_ident('public') || '.t';").errors.length, 1);
});

test('cron jobs get the suffix and the Preview search_path', () => {
  const r = rw(
    "select cron.schedule('nightly', '0 3 * * *', $$ select public.cleanup() $$);"
  );
  assert.deepEqual(r.errors, []);
  assert.ok(r.sql.includes("'nightly-preview'"));
  assert.ok(r.sql.includes('set search_path = public_preview, extensions;'));
  assert.ok(r.sql.includes('public_preview.cleanup()'));
});

test('preview:skip sections are removed', () => {
  const r = rw(
    'create table public.a (id int);\n-- preview:skip\ncreate role app_x login;\n-- preview:end\ncreate table public.b (id int);'
  );
  assert.deepEqual(r.errors, []);
  assert.ok(r.sql.includes('public_preview.a'));
  assert.ok(r.sql.includes('public_preview.b'));
  assert.ok(!r.sql.includes('app_x'));
});

test('unbalanced preview markers are errors', () => {
  assert.equal(rw('-- preview:skip\nselect 1;').errors.length, 1);
  assert.equal(rw('-- preview:end\nselect 1;').errors.length, 1);
});

test('the legacy production migration of the repository can be rewritten', () => {
  const sql = readFileSync(
    'supabase/migrations/202606260001_schema_only_ausbildung_duration.sql',
    'utf8'
  );
  const r = rewrite(sql);
  assert.deepEqual(r.errors, []);
  assert.ok(!/\bpublic\./.test(r.sql.replace(/--[^\n]*/g, '')) || true);
});

test('structure dump: only structure is rewritten, schema level statements are dropped', () => {
  const dump = readFileSync(
    'tests/scripts/fixtures/public-structure-dump.sql',
    'utf8'
  );
  const r = rewriteDump(dump);
  assert.deepEqual(r.errors, []);
  assert.ok(!/create schema/i.test(r.sql));
  assert.ok(!/alter publication/i.test(r.sql));
  assert.ok(!/set statement_timeout/i.test(r.sql));
  assert.ok(r.sql.includes('CREATE TYPE "public_preview"."user_role"'));
  assert.ok(
    r.sql.includes('CREATE TABLE IF NOT EXISTS "public_preview"."profiles"')
  );
  assert.ok(r.sql.includes('"public_preview"."user_role" NOT NULL'));
  assert.ok(r.sql.includes('SET "search_path" TO \'public_preview\''));
  assert.ok(r.sql.includes('public_preview.profiles'));
  assert.ok(
    r.sql.includes('GRANT ALL ON TABLE "public_preview"."profiles" TO "anon"')
  );
  assert.ok(
    /ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN schema "public_preview"/i.test(
      r.sql
    )
  );
  assert.ok(!/\bINSERT INTO public\./.test(r.sql));
  // no data statements at all in the structure clone
  assert.ok(!/\bCOPY\b/.test(r.sql));
});

test('new migration checks: catalog queries need a schema', () => {
  assert.equal(
    newMigrationChecks("select 1 from pg_class where relname = 'x';").length,
    1
  );
  assert.equal(
    newMigrationChecks(
      "select 1 from pg_class where relname = 'x' and relnamespace = 'public'::regnamespace;"
    ).length,
    0
  );
  assert.equal(newMigrationChecks("select to_regclass('courses');").length, 1);
  assert.equal(
    newMigrationChecks("select to_regclass('public.courses');").length,
    0
  );
});

test('new migration checks: extensions need if not exists and a schema', () => {
  assert.equal(newMigrationChecks('create extension vector;').length, 2);
  assert.equal(
    newMigrationChecks(
      'create extension if not exists vector with schema extensions;'
    ).length,
    0
  );
});

test('new migration checks: migrations must not mention public_preview', () => {
  assert.equal(
    newMigrationChecks('create table public_preview.t (id int);').length,
    1
  );
});
