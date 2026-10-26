-- KfBM content import, model gap 2: stable code for quizzes and a catalog check
-- for quiz links.
--
-- 1. quizzes.code (text, nullable): the stable identifier of a quiz across
--    re-imports. Same format rule as courses.code, enablers.code and
--    use_cases.code (file 20261024000200): 1 to 64 characters, letters, digits,
--    '.', '_' and '-', starting with a letter or digit. Unique per catalog
--    (partial unique index on (training_catalog_id, code), only where a code is
--    set), so the existing quizzes keep code NULL and are untouched.
--
-- 2. Catalog check for enabler_quiz_links: a quiz may only be linked to an
--    enabler of its own catalog. quizzes.training_catalog_id has the default
--    FIAE (file 20261024000600), so a writer that forgets the column would
--    silently file a KfBM quiz under FIAE. The trigger
--    enabler_quiz_links_catalog_check compares the catalog of the quiz with the
--    catalog of the course of the enabler and raises a check_violation with a
--    message that names both catalogs. A second trigger on quizzes stops a
--    later change of training_catalog_id of a quiz that is already linked to an
--    enabler of another catalog. A link whose quiz or enabler does not exist is
--    left to the foreign keys.
--
-- Known limits: the check runs when a link or the catalog of a quiz is written.
-- It does not run when an enabler is moved to a course of another catalog
-- (enablers.course_id), and the two lookups take no row lock, so a write that
-- races with a link insert can slip through. Both are admin level operations
-- that the import and the trainer routes do not perform.
--
-- Precheck: the file stops with an exception that names the number of links
-- whose quiz and enabler belong to different catalogs. Nothing is deleted or
-- corrected silently; a human decides, then runs the file again. Today every
-- writer sets the catalog of the quiz from the enabler (the trainer routes), so
-- the check is expected to pass. The exception is raised before the first
-- change, so a failed run leaves nothing behind.
--
-- The functions run as definer with a fixed search_path (like the derivation
-- triggers of 20261024000300), so they also see the course when row level
-- security hides it from the caller. EXECUTE is revoked from PUBLIC and anon
-- (a trigger function needs no EXECUTE privilege to fire).
--
-- Safe to run twice (if not exists, create or replace, drop trigger if exists).
--
-- Undo (only if something breaks):
--   drop trigger enabler_quiz_links_catalog_check on public.enabler_quiz_links;
--   drop trigger quizzes_catalog_link_check on public.quizzes;
--   drop function public.check_quiz_link_catalog();
--   drop function public.check_quiz_catalog_for_links();
--   drop index public.quizzes_catalog_code_unique;
--   alter table public.quizzes drop constraint quizzes_code_format_check;
--   alter table public.quizzes drop column code;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  violations integer;
begin
  if to_regclass('public.enabler_quiz_links') is null
     or to_regclass('public.courses') is null
     or not exists (
       select 1
       from pg_attribute a
       where a.attrelid = to_regclass('public.quizzes')
         and a.attname = 'training_catalog_id'
         and not a.attisdropped
     ) then
    raise exception
      'Run 20261024000100 and 20261024000600_quiz_catalog_binding.sql first (quizzes.training_catalog_id is missing). Nothing was changed.';
  end if;

  select count(*)
    into violations
  from public.enabler_quiz_links l
  join public.quizzes q on q.id = l.quiz_id
  join public.enablers e on e.id = l.enabler_id
  join public.courses c on c.id = e.course_id
  where q.training_catalog_id <> c.training_catalog_id;

  if violations > 0 then
    raise exception
      '% quiz link(s) join a quiz and an enabler of different training catalogs. Fix the catalog of the quiz or remove the link, then run this file again. Nothing was changed. List them with: select l.id, q.training_catalog_id as quiz_catalog, c.training_catalog_id as enabler_catalog from public.enabler_quiz_links l join public.quizzes q on q.id = l.quiz_id join public.enablers e on e.id = l.enabler_id join public.courses c on c.id = e.course_id where q.training_catalog_id <> c.training_catalog_id;',
      violations;
  end if;
end $$;

alter table public.quizzes
  add column if not exists code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quizzes_code_format_check'
      and conrelid = 'public.quizzes'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.quizzes
      add constraint quizzes_code_format_check
      check (code is null or code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');
  end if;
end $$;

create unique index if not exists quizzes_catalog_code_unique
  on public.quizzes (training_catalog_id, code)
  where code is not null;

-- Link side: the quiz and the enabler of a link belong to the same catalog.
create or replace function public.check_quiz_link_catalog()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  quiz_catalog uuid;
  enabler_catalog uuid;
  quiz_catalog_code text;
  enabler_catalog_code text;
begin
  select q.training_catalog_id
    into quiz_catalog
  from public.quizzes q
  where q.id = new.quiz_id;
  if not found then
    return new;
  end if;

  select c.training_catalog_id
    into enabler_catalog
  from public.enablers e
  join public.courses c on c.id = e.course_id
  where e.id = new.enabler_id;
  if not found then
    return new;
  end if;

  if quiz_catalog <> enabler_catalog then
    select tc.code into quiz_catalog_code
    from public.training_catalogs tc where tc.id = quiz_catalog;
    select tc.code into enabler_catalog_code
    from public.training_catalogs tc where tc.id = enabler_catalog;
    raise exception
      'enabler_quiz_links: quiz % belongs to catalog % but enabler % belongs to catalog %. Set quizzes.training_catalog_id to the catalog of the enabler (the default is FIAE).',
      new.quiz_id, coalesce(quiz_catalog_code, quiz_catalog::text),
      new.enabler_id, coalesce(enabler_catalog_code, enabler_catalog::text)
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Quiz side: the catalog of a quiz cannot move away from its linked enablers.
create or replace function public.check_quiz_catalog_for_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.training_catalog_id is distinct from old.training_catalog_id
     and exists (
       select 1
       from public.enabler_quiz_links l
       join public.enablers e on e.id = l.enabler_id
       join public.courses c on c.id = e.course_id
       where l.quiz_id = new.id
         and c.training_catalog_id <> new.training_catalog_id
     ) then
    raise exception
      'quizzes: quiz % is linked to an enabler of another catalog, its training_catalog_id cannot be changed. Remove the link first.',
      new.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enabler_quiz_links_catalog_check
  on public.enabler_quiz_links;
create trigger enabler_quiz_links_catalog_check
  before insert or update of enabler_id, quiz_id
  on public.enabler_quiz_links
  for each row
  execute function public.check_quiz_link_catalog();

drop trigger if exists quizzes_catalog_link_check on public.quizzes;
create trigger quizzes_catalog_link_check
  before update of training_catalog_id
  on public.quizzes
  for each row
  execute function public.check_quiz_catalog_for_links();

-- No EXECUTE for PUBLIC and anon on the functions of this file. Trigger
-- functions need no EXECUTE privilege when they fire, so nothing breaks.
do $$
declare
  fn text;
begin
  foreach fn in array array[
      'public.check_quiz_link_catalog()',
      'public.check_quiz_catalog_for_links()'
  ] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon', fn);
    end if;
  end loop;
end $$;

comment on column public.quizzes.code is
  'Stable text code, unique per training catalog (partial unique index). NULL for legacy rows.';
comment on function public.check_quiz_link_catalog() is
  'Trigger function: a quiz can only be linked to an enabler of its own training catalog.';
comment on function public.check_quiz_catalog_for_links() is
  'Trigger function: the training catalog of a quiz cannot change to one that differs from the catalog of its linked enablers.';
