// Counter examples from the security review of the Preview migration: unreviewed
// branch SQL must not reach outside of public_preview. The database role
// app_preview_migrator is the real boundary, these tests pin the early
// rejection and the normalisation of hidden qualifications.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  newMigrationChecks,
  normalizeQualifiers,
  rewrite,
} from '../../../scripts/db/preview-rewrite.mjs';

const rejected = sql => rewrite(sql).errors.length > 0;

test('drop schema is rejected, whatever the schema', () => {
  assert.ok(rejected('drop schema if exists public cascade;'));
  assert.ok(rejected('DROP SCHEMA public;'));
  assert.ok(rejected('drop schema "public" cascade;'));
  assert.ok(rejected('alter schema public rename to x;'));
  assert.ok(rejected('create schema other;'));
});

test('writes to tables of other schemas are rejected, also with spaces, quotes and comments around the dot', () => {
  for (const sql of [
    'delete from auth . users;',
    'delete from auth.users;',
    'delete from "auth"."users";',
    'delete from auth /* x */ . users;',
    'delete from auth -- hidden\n . users;',
    'update auth.users set email = null;',
    'update storage . objects set name = name;',
    'insert into auth . users (id) values (gen_random_uuid());',
    'truncate auth.users;',
    'truncate public.a, auth.users;',
    'lock table auth.users;',
    'lock auth.users in access exclusive mode;',
    'delete from extensions.t;',
    'insert into pg_catalog.pg_class values (1);',
    'merge into auth.users u using public.t s on true when matched then delete;',
    'with d as (delete from auth.users returning *) select * from d;',
  ]) {
    assert.ok(rejected(sql), sql);
  }
});

test('DDL on tables of shared schemas is rejected, also with spaces around the dot', () => {
  for (const sql of [
    'drop table auth . users;',
    'drop table auth.users cascade;',
    'alter table auth.users add column x int;',
    'alter table "auth" . "users" disable row level security;',
    'create table auth.x (id int);',
    'create index i on auth.users (email);',
  ]) {
    assert.ok(rejected(sql), sql);
  }
});

test('triggers and policies on auth.* and storage.* are rejected, not renamed', () => {
  for (const sql of [
    'create trigger t after insert on auth.users for each row execute function public.f();',
    'create trigger t after insert on auth . users for each row execute function public.f();',
    'create trigger slow after insert on auth.users for each row execute function public.sleepy();\ncreate function public.sleepy() returns trigger language plpgsql as $$ begin perform pg_sleep(60); return new; end $$;',
    'drop trigger if exists on_auth_user_created on auth.users;',
    'alter table auth.users disable trigger all;',
    "create policy p on storage.objects for select using (bucket_id = 'content');",
    'drop policy p on storage.objects;',
    'create policy p on storage . objects for all using (true);',
  ]) {
    assert.ok(rejected(sql), sql);
  }
});

test('a function body that changes auth or storage is rejected', () => {
  const sql =
    'create function public.f() returns void language plpgsql as $$ begin delete from auth.users; end $$;\nselect public.f();';
  assert.ok(rejected(sql));
  assert.ok(
    rejected(
      'create function public.f() returns void language sql as $$ update storage.objects set name = name $$;'
    )
  );
  // dynamic SQL in a string is checked too
  assert.ok(rejected("do $$ begin execute 'delete from auth.users'; end $$;"));
  assert.ok(
    rejected(
      'create function public.f() returns void language plpgsql as $$ begin perform auth.delete_user_secretly(); end $$;'
    )
  );
  assert.ok(
    rejected(
      'create function public.f() returns void language plpgsql as $$ begin perform storage.delete_object(); end $$;'
    )
  );
});

test('read only helpers of auth and storage stay allowed in policies and functions', () => {
  assert.deepEqual(
    rewrite(
      "create policy p on public.t for select using (user_id = auth.uid() and auth.role() = 'authenticated' and (storage.foldername(name))[1] = 'x');"
    ).errors,
    []
  );
  assert.deepEqual(
    rewrite("select auth.jwt() ->> 'email', auth.email();").errors,
    []
  );
});

test('foreign keys to other schemas are rejected with a hint', () => {
  const r = rewrite(
    'alter table public.profiles add constraint f foreign key (id) references auth.users (id);'
  );
  assert.equal(r.errors.length, 1);
  assert.ok(r.errors[0].includes('preview:skip'));
  assert.ok(
    rejected('create table public.t (id uuid references auth . users(id));')
  );
  assert.deepEqual(
    rewrite(
      'alter table public.a add constraint f foreign key (b) references public.b (id);'
    ).errors,
    []
  );
});

test('create extension into schema public is rejected, into extensions is fine', () => {
  assert.ok(rejected('create extension if not exists pg_trgm schema public;'));
  assert.ok(
    rejected('create extension if not exists pg_trgm with schema "public";')
  );
  assert.deepEqual(
    rewrite('create extension if not exists pg_trgm with schema extensions;')
      .errors,
    []
  );
});

test('drop owned, reassign owned, copy, set role, cron and administrative functions are rejected', () => {
  for (const sql of [
    'drop owned by app_preview_migrator;',
    'reassign owned by a to b;',
    "copy public.t to '/tmp/x';",
    "copy public.t from program 'ls';",
    'set role postgres;',
    'set session authorization postgres;',
    "select cron.schedule('x', '* * * * *', 'select 1');",
    'select pg_terminate_backend(pid) from pg_stat_activity;',
    "select pg_read_file('/etc/passwd');",
    'alter table public.t set schema auth;',
  ]) {
    assert.ok(rejected(sql), sql);
  }
});

test('"public . name" is rewritten to public_preview, not left pointing at Production', () => {
  const r = rewrite('delete from public . profiles where id = 1;');
  assert.deepEqual(r.errors, []);
  assert.ok(r.sql.includes('public_preview.profiles'));
  assert.ok(
    !/\bpublic\s*\.\s*profiles/.test(r.sql.replace('public_preview', 'X'))
  );
  const q = rewrite(
    'select * from "public" . "t" join public/* c */.u on true;'
  );
  assert.deepEqual(q.errors, []);
  assert.ok(!/"public"\s*\./.test(q.sql));
  assert.ok(q.sql.includes('public_preview'));
  assert.equal(
    rewrite('insert into public . t values (1);').sql.trim(),
    'insert into public_preview.t values (1);'
  );
});

test('normalizeQualifiers closes up the qualification and drops comments', () => {
  assert.equal(normalizeQualifiers('auth /* a */ . users'), 'auth.users');
  assert.equal(normalizeQualifiers('"auth" . "users"'), 'auth.users');
  assert.equal(normalizeQualifiers('public\n.\nt'), 'public.t');
  // a word that merely ends in a schema name is left alone
  assert.equal(normalizeQualifiers('myauth . users'), 'myauth . users');
});

test('data statements on public and plain DDL stay allowed', () => {
  for (const sql of [
    'delete from public.t where id = 1;',
    'update public.t set a = 1;',
    "insert into public.t (a) values ('x') on conflict (a) do update set a = excluded.a;",
    'truncate public.a, public.b;',
    'create trigger t before update on public.x for each row execute function public.f();',
    'create table public.t (id int primary key, a text);',
    'alter table public.t add column b int;',
    'grant select on public.t to authenticated;',
    "comment on table public.t is 'delete from auth.users is not run here';",
  ]) {
    assert.deepEqual(rewrite(sql).errors, [], sql);
  }
});

test('new migrations must not mention public_preview and keep the extension rules', () => {
  assert.equal(
    newMigrationChecks('create table public_preview.t (id int);').length,
    1
  );
});
