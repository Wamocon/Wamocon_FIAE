-- Rollback of supabase/migrations/20261030000200_content_upload_json_xlsx.sql.
-- RUN BY A HUMAN, only if JSON and Excel files have to be taken out of the content
-- upload again.
--
-- What it does: puts the check content_upload_files_ext_check back to the two values
-- of the first version, 'docx' and 'pdf'. Nothing else is touched: no other check, no
-- column, no row, no storage object.
--
-- Safety: the file stops with an error and changes nothing if one row of
-- content_upload_files has the ext json or xlsx. Such a row cannot satisfy the old
-- check, and this file does not delete rows (they hold the protocol of what a run
-- transferred). Roll back the content of the runs first (section 8.8 of
-- docs/ki-upload-konzept.md), discard the runs and wait until the cleanup has deleted
-- their rows (docs/kfbm-upload-runbook.md), or remove the rows by hand if you really
-- do not need them. This file never deletes a row.
--
-- Run it in the Supabase SQL editor as the project owner (role postgres), in one go.
-- First as a try: replace the last statement "commit;" by "rollback;", run it, read
-- the notice, then run it again with "commit;". It can be run twice.
--
-- Adding the check takes a short exclusive lock on content_upload_files and reads all
-- its rows once. The lock timeout below bounds the wait.
--
-- Preview: the schema public_preview is rebuilt from the migrations by the Preview
-- reset (docs/release-prozess.md, section 7). Use that instead of this file there,
-- this file names the schema public.
--
-- What it does not remove: the record of the migration. It stays recorded as applied,
-- so a later "supabase db push" does not widen the check again. To widen it again,
-- remove the row with the version 20261030000200 from
-- supabase_migrations.schema_migrations by hand (only if you really want it back)
-- before pushing. The bucket content-upload is not changed either: take the MIME types
-- application/json and the Excel type out of its list by hand in the Supabase
-- dashboard.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  extra_rows bigint;
begin
  if to_regclass('public.content_upload_files') is null then
    raise notice 'public.content_upload_files does not exist, nothing to do';
    return;
  end if;
  select count(*) into extra_rows
    from public.content_upload_files
   where ext in ('json', 'xlsx');
  raise notice 'content_upload_files holds % row(s) with the ext json or xlsx', extra_rows;
  if extra_rows > 0 then
    raise exception 'content_upload_files holds % row(s) with the ext json or xlsx, nothing was changed. Roll back and discard the runs first (see the header)', extra_rows;
  end if;
end $$;

alter table if exists public.content_upload_files
  drop constraint if exists content_upload_files_ext_check;

alter table if exists public.content_upload_files
  add constraint content_upload_files_ext_check
    check (ext in ('docx', 'pdf'));

commit;
