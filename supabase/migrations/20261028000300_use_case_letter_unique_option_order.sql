-- KfBM content import, model gap 3: one letter per component and a stable order
-- of the answer options.
--
-- 1. training_use_cases (component_id, letter) becomes unique. The letter
--    (a, b, c, ...) names a task inside a component, the importer and the
--    content sync (key component_id + letter) identify a row by it. Until now
--    nothing in the database stopped two rows with the same letter, the key of
--    the content sync would then be ambiguous.
--
-- 2. options.order_index (integer, nullable, no default): the position of an
--    answer option inside its question. Options had no order at all; every
--    read selects them without ORDER BY, so the display order was whatever the
--    heap returned, which changes after an UPDATE. For the multiple choice
--    questions of the import the order is part of the content ("all of the
--    above"). The column is backward compatible: it is nullable, existing rows
--    and writers that do not know it keep working and read NULL, and adding a
--    nullable column without a default is a catalog change only (no table
--    rewrite, no UPDATE). Readers that want the order sort by order_index with
--    NULLS LAST; no reader does that yet, this file only provides the column.
--
-- Precheck: the file stops with an exception that names the number of
-- (component, letter) pairs that occur more than once. Nothing is deleted or
-- merged silently; a human decides which row stays, then runs the file again.
-- The seed of the FIAE components writes each letter once per component, so
-- the check is expected to pass.
--
-- The unique constraint builds its index under a SHARE lock; the table is small
-- (a few hundred rows) and lock_timeout 5s makes the file fail fast instead of
-- waiting behind a long transaction. ADD COLUMN on options needs a short
-- ACCESS EXCLUSIVE lock, lock_timeout applies as well.
--
-- Safe to run twice (if not exists, constraint guarded by a lookup).
--
-- Undo (only if something breaks):
--   alter table public.training_use_cases
--     drop constraint training_use_cases_component_letter_unique;
--   alter table public.options drop column order_index;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  affected integer;
  total integer;
begin
  if to_regclass('public.training_use_cases') is null
     or to_regclass('public.options') is null then
    raise exception
      'The tables public.training_use_cases and public.options are required. Nothing was changed.';
  end if;

  select count(*), coalesce(sum(d.n), 0)
    into affected, total
  from (
    select count(*) as n
    from public.training_use_cases
    group by component_id, letter
    having count(*) > 1
  ) d;

  if affected > 0 then
    raise exception
      '% (component, letter) pair(s) occur more than once in training_use_cases (% rows in total), but a letter may appear only once per component. Keep one row per pair (or rename the letter) and run this file again. Nothing was changed. List them with: select component_id, letter, count(*) from public.training_use_cases group by component_id, letter having count(*) > 1;',
      affected, total;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_use_cases_component_letter_unique'
      and conrelid = 'public.training_use_cases'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_use_cases
      add constraint training_use_cases_component_letter_unique
      unique (component_id, letter);
  end if;
end $$;

alter table public.options
  add column if not exists order_index integer;

comment on column public.options.order_index is
  'Position of the option inside its question (sort ascending, NULLS LAST). NULL for options written before the column existed.';
