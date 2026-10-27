-- Rollback of supabase/migrations/20261030000100_content_upload_tables.sql.
-- RUN BY A HUMAN, only if the content upload has to be taken out again.
--
-- What it does: drops the seven process tables of the content upload, children
-- first (content_upload_applied_rows, content_upload_applies, content_upload_ki_calls,
-- content_upload_decisions, content_upload_proposals, content_upload_files,
-- content_upload_runs). Nothing else is touched: no content table, no storage object,
-- no other table. There is no cascade, so a table that something else still depends
-- on stops the file instead of taking that with it.
--
-- Safety: the file stops with an error and changes nothing if one of the tables holds
-- rows. content_upload_applied_rows is the only record of which content rows an apply
-- wrote, so drop the tables only AFTER the content of the runs was rolled back (the
-- rollback SQL of the content upload, section 8.8 of docs/ki-upload-konzept.md), or
-- if you do not need that record any more. To drop tables that hold rows, set the
-- switch below on purpose: remove the two dashes in front of the line "set local
-- content_upload.rollback_allow_data". Without it only empty tables are dropped.
--
-- Dropping the tables briefly takes an exclusive lock on profiles and training_catalogs
-- (their foreign key triggers go away). The lock timeout below bounds the wait, still run
-- it outside peak time.
--
-- Run it in the Supabase SQL editor as the project owner (role postgres), in one go.
-- First as a try: replace the last statement "commit;" by "rollback;", run it, read
-- the notices, then run it again with "commit;". It can be run twice (drop table if
-- exists).
--
-- Preview: the schema public_preview is rebuilt from the migrations by the Preview
-- reset (docs/release-prozess.md, section 7). Use that instead of this file there,
-- this file names the schema public.
--
-- What it does not remove:
--   * the objects in the private bucket content-upload (empty or delete the bucket by
--     hand in the Supabase dashboard; the application never deletes the bucket),
--   * the record of the migration. The migration stays recorded as applied, so a later
--     "supabase db push" does not create the tables again. To create them again, remove
--     the row with the version 20261030000100 from supabase_migrations.schema_migrations
--     by hand (only if you really want them back) before pushing.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- set local content_upload.rollback_allow_data = 'yes';

do $$
declare
  upload_table text;
  row_count bigint;
  total_rows bigint := 0;
  allow_data text := current_setting('content_upload.rollback_allow_data', true);
begin
  foreach upload_table in array array[
    'content_upload_applied_rows',
    'content_upload_applies',
    'content_upload_ki_calls',
    'content_upload_decisions',
    'content_upload_proposals',
    'content_upload_files',
    'content_upload_runs'
  ] loop
    if to_regclass('public.' || upload_table) is not null then
      execute format('select count(*) from public.%I', upload_table) into row_count;
      raise notice '% holds % row(s)', upload_table, row_count;
      total_rows := total_rows + row_count;
    else
      raise notice '% does not exist', upload_table;
    end if;
  end loop;
  if total_rows > 0 and coalesce(allow_data, '') <> 'yes' then
    raise exception 'the content upload tables hold % row(s), nothing was changed. Roll back the content of the runs first, or set content_upload.rollback_allow_data on purpose (see the header)', total_rows;
  end if;
end $$;

drop table if exists public.content_upload_applied_rows;
drop table if exists public.content_upload_applies;
drop table if exists public.content_upload_ki_calls;
drop table if exists public.content_upload_decisions;
drop table if exists public.content_upload_proposals;
drop table if exists public.content_upload_files;
drop table if exists public.content_upload_runs;

commit;
