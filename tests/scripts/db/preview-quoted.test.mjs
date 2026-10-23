// pg_dump quotes every name ("public"."courses", "auth"."users"). The first real
// run of the Preview reset failed on this: the block rules did not know quoted
// identifiers. These tests use a synthetic dump in the pg_dump style with
// consistently quoted names, plus (only when a file is given) a real structure
// dump.
//
// Real dump (optional, never committed): PREVIEW_REAL_DUMP=<path to public-structure.sql> npm run test:scripts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  canonicalize,
  normalizeQualifiers,
  rewrite,
  rewriteDump,
} from '../../../scripts/db/preview-rewrite.mjs';

const fixture = readFileSync(
  'tests/scripts/fixtures/pg-dump-quoted.sql',
  'utf8'
);
const rejected = sql => rewrite(sql).errors.length > 0;

test('the quoted synthetic dump rewrites without any error', () => {
  const r = rewriteDump(fixture);
  assert.deepEqual(r.errors, []);
  assert.ok(r.sql.length > 1000);
});

test('every reference to public becomes public_preview, only the extension type stays', () => {
  const { sql } = rewriteDump(fixture);
  const stray = [
    ...sql.matchAll(/(.{0,30})\bpublic\b(?!_preview)(.{0,30})/g),
  ].map(m => m[0].replace(/\s+/g, ' '));
  // the text of a comment is never executed and keeps its words
  const code = stray.filter(s => !/ IS '/.test(s));
  assert.equal(code.length, 1, stray.join(' | '));
  assert.ok(code[0].includes('public."vector"(3)'));
  // all the object kinds of the dump
  for (const expected of [
    'CREATE TYPE public_preview."user_role"',
    'CREATE OR REPLACE FUNCTION public_preview."get_user_org_id"()',
    'FROM public_preview.profiles WHERE id =', // function body, unquoted in the source
    'FROM public_preview."profiles" p', // function body, quoted in the source
    'CREATE TABLE IF NOT EXISTS public_preview."profiles"',
    '"role" public_preview."user_role" NOT NULL',
    'CREATE TABLE IF NOT EXISTS public_preview."Lern Felder"',
    'SEQUENCE NAME public_preview."notes_id_seq"',
    'CREATE OR REPLACE VIEW public_preview."org_overview"',
    'FROM public_preview."organizations" "o"',
    'ADD CONSTRAINT "profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES public_preview."organizations"("id")',
    'REFERENCES public_preview."profiles"("id")',
    'CREATE OR REPLACE TRIGGER "profiles_touch" BEFORE UPDATE ON public_preview."profiles"',
    'EXECUTE FUNCTION public_preview."touch_updated_at"()',
    'CREATE POLICY "profiles_select_own_org" ON public_preview."profiles"',
    'public_preview."get_user_org_id"()',
    'GRANT ALL ON FUNCTION public_preview."get_user_org_id"() TO "anon"',
    'GRANT ALL ON TABLE public_preview."profiles" TO "anon"',
    'GRANT ALL ON TABLE public_preview."Lern Felder" TO "authenticated"',
    'GRANT ALL ON SEQUENCE public_preview."notes_id_seq" TO "authenticated"',
  ]) {
    assert.ok(sql.includes(expected), `missing: ${expected}`);
  }
  // text of a comment is not rewritten (it is never executed)
  assert.ok(
    sql.includes("'Profiles, created by public.sync_profile() after sign-in'")
  );
});

test('schema level statements, ownership and default privileges are not replayed', () => {
  const { sql } = rewriteDump(fixture);
  for (const pattern of [
    /CREATE SCHEMA/i,
    /ALTER SCHEMA/i,
    /ON SCHEMA/i,
    /OWNER TO/i,
    /ALTER DEFAULT PRIVILEGES/i,
    /ALTER PUBLICATION/i,
    /^\s*SET\s/im,
    /RESET ALL/i,
    /set_config/i,
  ]) {
    assert.ok(!pattern.test(sql), String(pattern));
  }
});

test('the foreign key to auth.users is left out with a note, the others stay', () => {
  const r = rewriteDump(fixture);
  assert.equal(r.notes.length, 1);
  assert.ok(r.notes[0].includes('profiles_id_users_id_fk'));
  assert.ok(r.notes[0].includes('auth.users'));
  assert.ok(!/profiles_id_users_id_fk/.test(r.sql));
  assert.ok(!/auth\.users|"auth"/.test(r.sql));
  assert.equal([...r.sql.matchAll(/FOREIGN KEY/g)].length, 3);
});

test('policies and functions that call auth.uid() stay, through the wrappers', () => {
  const { sql } = rewriteDump(fixture);
  assert.ok(
    !/auth\.(uid|role|jwt|email)\s*\(/.test(sql),
    'no direct call of auth'
  );
  assert.ok(!/"auth"/.test(sql));
  // policy, subselect in a policy, quoted call in a function body, jwt claim
  assert.ok(sql.includes('("id" = preview_support.auth_uid())'));
  assert.ok(sql.includes('( SELECT preview_support.auth_uid() AS "uid")'));
  assert.ok(sql.includes('p."id" = preview_support.auth_uid()'));
  assert.ok(sql.includes('(preview_support.auth_jwt() ->> '));
  assert.equal([...sql.matchAll(/CREATE POLICY/g)].length, 4);
});

test('the extension type in public keeps pointing at public, a similar name does not', () => {
  assert.ok(
    rewriteDump(fixture).sql.includes('"embedding" public."vector"(3)')
  );
  assert.ok(
    rewrite(
      'create table public.t (e public.vector(3), f public.vector_x);'
    ).sql.includes('e public.vector(3), f public_preview.vector_x')
  );
  // other extension objects can be handed over (snapshot)
  assert.ok(
    rewrite('select public.cosine_distance(a, b) from public.t;', {
      extensionObjects: ['cosine_distance'],
    }).sql.includes('public.cosine_distance(a, b) from public_preview.t')
  );
});

test('writes to public in every quoted form are rewritten, not rejected', () => {
  for (const [sql, expected] of [
    [
      'delete from "public"."t" where id = 1;',
      'delete from public_preview."t"',
    ],
    ['update "public"."t" set a = 1;', 'update public_preview."t"'],
    [
      'insert into "public"."My Table" (a) values (1);',
      'insert into public_preview."My Table"',
    ],
    [
      'truncate "public"."a", "public"."b";',
      'truncate public_preview."a", public_preview."b"',
    ],
    ['delete from "public" . "t";', 'delete from public_preview."t"'],
    [
      'alter table only "public"."t" add constraint c foreign key (a) references "public"."u" (id);',
      'references public_preview."u"',
    ],
  ]) {
    const r = rewrite(sql);
    assert.deepEqual(r.errors, [], sql);
    assert.ok(r.sql.includes(expected), `${sql} -> ${r.sql}`);
  }
});

test('writes to other schemas are rejected in every quoted form, also with odd names', () => {
  for (const sql of [
    'delete from "auth"."users";',
    'delete from "auth" . "users";',
    'update "storage"."objects" set name = name;',
    'delete from "other"."t";',
    'delete from "Other Schema"."t";',
    'delete from "my schema"."My Table";',
    'insert into "1schema"."t" values (1);',
    'insert into "Auth"."Users" values (1);',
    'truncate "public"."a", "Other Schema"."b";',
    'lock table "auth"."users";',
    'drop table "auth"."users";',
    'alter table only "auth"."users" add column x int;',
    'alter table "public"."t" add constraint c foreign key (a) references "auth"."users" (id);',
    'alter table "public"."t" add constraint c foreign key (a) references "Other Schema"."u" (id);',
    'create table "public"."t" (a uuid references "auth"."users"(id));',
    'create policy p on "storage"."objects" for select using (true);',
    'create trigger t after insert on "auth"."users" for each row execute function "public"."f"();',
    'do $$ begin delete from "auth"."users"; end $$;',
    'create function "public"."f"() returns void language plpgsql as $$ begin delete from "auth"."users"; end $$;',
  ]) {
    assert.ok(rejected(sql), sql);
  }
});

test('canonicalize and normalizeQualifiers handle quoted and spaced forms', () => {
  assert.equal(normalizeQualifiers('"public"."courses"'), 'public."courses"');
  assert.equal(normalizeQualifiers('"public" . "courses"'), 'public."courses"');
  assert.equal(normalizeQualifiers('"auth"."users"'), 'auth.users');
  assert.equal(
    canonicalize('delete from "auth"."users"'),
    'delete from auth.users'
  );
  // names that need their quotes keep them, plain lower case names lose them
  assert.equal(canonicalize('"Other Schema"."t"'), '"Other Schema".t');
  assert.equal(
    canonicalize('"Other Schema"."My Table"'),
    '"Other Schema"."My Table"'
  );
  assert.equal(canonicalize('"my_schema" . "t"'), 'my_schema.t');
});

test('the foreign key to another schema is still rejected for a migration, with the skip hint', () => {
  const r = rewrite(
    'alter table "public"."profiles" add constraint f foreign key ("id") references "auth"."users" ("id");'
  );
  assert.equal(r.errors.length, 1);
  assert.ok(r.errors[0].includes('preview:skip'));
});

const realDump = process.env.PREVIEW_REAL_DUMP;
test(
  'a real structure dump rewrites without any error and without a stray reference to public',
  { skip: !realDump || !existsSync(realDump) },
  () => {
    const r = rewriteDump(readFileSync(realDump, 'utf8'));
    assert.deepEqual(r.errors, []);
    const stray = [
      ...r.sql.matchAll(/(.{0,30})\bpublic\b(?!_preview)(.{0,30})/g),
    ].map(m => m[0]);
    // only objects of extensions (pgvector) may still point at public
    for (const s of stray.filter(x => !/ IS '/.test(x))) {
      assert.ok(/public\."?(vector|halfvec|sparsevec)/.test(s), s);
    }
    assert.ok(!/"auth"|auth\.users/.test(r.sql));
    assert.ok(
      r.notes.every(n => n.includes('auth.users') || /references/.test(n))
    );
  }
);
