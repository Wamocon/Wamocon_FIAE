-- Allow JSON and Excel files in the content upload (package UP2).
--
-- Why: the content upload (migration 20261030000100) takes Word and PDF files. The
-- table content_upload_files keeps the kind of every announced file in the column ext
-- and the check content_upload_files_ext_check allowed only 'docx' and 'pdf'. A supply
-- of quizzes as a JSON file (schema 1.0, src/lib/content-import/quiz-json) and of the
-- learning field mapping as an Excel file (.xlsx) could therefore not be announced at
-- all. This file widens that one check to 'docx', 'pdf', 'json' and 'xlsx'.
--
-- What it does, in this order:
--   1. stops with a clear message if the table of the content upload is missing
--      (the file 20261030000100 has to come first) or if a row holds an ext that even
--      the wider list does not know (cannot happen while the old check is in place, it
--      protects a database where the check was dropped by hand)
--   2. drops the check content_upload_files_ext_check if it exists and creates it again
--      with the four values. Both statements run in the transaction of the file, so
--      there is no moment in which the column has no check
--   3. checks the result: the check exists and names all four values
--
-- No column, no other check, no index, no grant and no row of any table is changed or
-- read apart from the count in step 1. The new check allows more values than the old
-- one, so every existing row stays valid and there is no data to move. The table is
-- small (one row per announced file), so the full check of the rows that creating the
-- check performs takes no noticeable time. It does need a short exclusive lock on
-- content_upload_files, the lock timeout below stops the file instead of waiting.
-- NOT VALID plus a later VALIDATE is not needed for a table of this size and kind.
--
-- The values of doc_type stay as they are: a JSON file of enabler quizzes or of global
-- quizzes is a 'quiz' or a 'global_quiz', the Excel file gets the existing value 'other'
-- (the application treats it as a mapping table, never as a document).
--
-- Safe to run twice (drop constraint if exists, add constraint, then the same check
-- of the result). Sorting: behind 20261030000100, so the rollout gate
-- (scripts/db/rollout-gate.mjs, gated from 20261024000100) holds it back in
-- Production together with the series. Production is not migrated by this change; the
-- feature is switched off there.
--
-- Undo (only while no row of content_upload_files has the ext json or xlsx):
--   run supabase/manual/rollback-content-upload-json-xlsx.sql, first as a try with
--   "rollback;" in place of "commit;". The template stops if such a row exists.
--
-- Outside of this file (the owner does it, never an agent): the private bucket
-- content-upload has to accept the MIME types application/json and
-- application/vnd.openxmlformats-officedocument.spreadsheetml.sheet and a file size
-- of 32 MB (it is limited to 25 MB and to PDF and docx today).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Pre check ---------------------------------------------------------------------

do $$
declare
  bad_rows bigint;
begin
  if to_regclass('public.content_upload_files') is null then
    raise exception 'content upload: public.content_upload_files is missing, apply 20261030000100 first';
  end if;
  select count(*) into bad_rows
    from public.content_upload_files
   where ext not in ('docx', 'pdf', 'json', 'xlsx');
  if bad_rows > 0 then
    raise exception 'content upload: % row(s) of content_upload_files hold an ext outside docx, pdf, json, xlsx', bad_rows;
  end if;
end $$;

-- 2. The wider check -----------------------------------------------------------------

alter table public.content_upload_files
  drop constraint if exists content_upload_files_ext_check;

alter table public.content_upload_files
  add constraint content_upload_files_ext_check
    check (ext in ('docx', 'pdf', 'json', 'xlsx'));

-- 3. Check of the result --------------------------------------------------------------

do $$
declare
  definition text;
begin
  select pg_get_constraintdef(c.oid) into definition
    from pg_constraint c
   where c.conrelid = 'public.content_upload_files'::regclass
     and c.connamespace = 'public'::regnamespace
     and c.conname = 'content_upload_files_ext_check';
  if definition is null
     or definition not like '%docx%'
     or definition not like '%pdf%'
     or definition not like '%json%'
     or definition not like '%xlsx%' then
    raise exception 'content upload: content_upload_files_ext_check does not name docx, pdf, json and xlsx';
  end if;
end $$;
