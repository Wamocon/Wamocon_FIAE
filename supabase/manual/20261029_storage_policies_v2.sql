-- Storage policies for the buckets content and avatar, version 2. RUN BY A HUMAN, ONCE.
-- Replaces supabase/manual/20261023_storage_policies.sql (that file stays as history;
-- if it was applied already this file is the follow-up, if it was not, this file is
-- enough).
--
-- Why not a migration: storage.objects is shared by Production and Preview and belongs
-- to the storage service. Run it once in the Supabase SQL editor as project owner
-- (role postgres). No workflow runs it. It covers Production and Preview in one go,
-- because both use the same buckets (Preview works under the prefix preview/<user id>/).
--
-- What the code needs (searched in src, checked again for this version):
--   - upload with the user session into the own folder, path <auth uid>/<file>
--     (PdfUploader.tsx for content, Profile.tsx for avatar), upsert is false,
--   - reading through public URLs (getPublicUrl), they do not depend on policies as
--     long as the bucket is public,
--   - deleting files only on the server with the service role key (the two documents
--     routes), which bypasses policies,
--   - Preview: the same under preview/<user id>/ (policies *_preview of
--     supabase/preview-setup/03-shared-objects.sql, they are kept by this file).
--
-- What this file does:
--   1. drops every policy of storage.objects that applies to the buckets content or
--      avatar, or to all buckets (no bucket_id in it), except the *_preview policies
--      of the Preview setup (recognised by their definition, they call
--      preview_support.has_preview_profile). Policies that refer to other buckets only
--      are kept. Every dropped and every kept policy is reported (RAISE NOTICE, shown in
--      the editor under "Messages" or "Results" depending on the version).
--   2. creates the own-folder policies for authenticated users: select, insert, update,
--      delete, for content and for avatar (own folder = first folder is the auth uid).
--      The select policy is needed because the storage service reads the new row back
--      after an insert. It lets a user see (and list) only the own folder.
--   3. creates select policies for the Preview prefix (only if the Preview setup
--      exists), so that Preview uploads keep working after the public avatar listing is
--      gone.
--   anon gets no policy at all. Public URLs of public buckets keep working without one.
--
-- What it does NOT do: the bucket content stays public, public URLs keep working. A
-- private bucket needs signed URLs created on the server and a change of the stored
-- links (content_documents.storage_url holds the public URL today), which is application
-- work. The statements for that are at the end of this file, commented, with the order
-- that is required.
--
-- ORDER with the database lockdown (migration 20261029000300): independent of each
-- other. Suggested: 1. supabase/manual/verify-rls-lockdown.sql (save the output),
-- 2. this file, 3. the release with the migration, 4. verify again, 5. smoke test:
-- sign in and out, profile loads, avatar upload, PDF upload in the content editor,
-- document opens, notifications bell. Do the smoke test in Production and in Preview.
--
-- 0. READ FIRST (read only), keep the output:
--    select policyname, cmd, roles, qual, with_check from pg_policies
--     where schemaname = 'storage' and tablename = 'objects' order by policyname;
--    select id, public, file_size_limit, allowed_mime_types from storage.buckets;

begin;

set local lock_timeout = '5s';

do $$
declare
  z record;
begin
  for z in
    select policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as definition
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
    order by policyname
  loop
    if z.policyname like '%\_preview' and position('has_preview_profile' in z.definition) > 0 then
      raise notice 'kept (Preview setup): %', z.policyname;
    elsif position('''content''' in z.definition) > 0
       or position('''avatar''' in z.definition) > 0
       or position('bucket_id' in z.definition) = 0 then
      execute format('drop policy %I on storage.objects', z.policyname);
      raise notice 'dropped: %', z.policyname;
    else
      raise notice 'kept (other bucket): %', z.policyname;
    end if;
  end loop;
end $$;

-- own folder policies, content
create policy content_select_own_folder on storage.objects
  for select to authenticated
  using (bucket_id = 'content' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy content_insert_own_folder on storage.objects
  for insert to authenticated
  with check (bucket_id = 'content' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy content_update_own_folder on storage.objects
  for update to authenticated
  using (bucket_id = 'content' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'content' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy content_delete_own_folder on storage.objects
  for delete to authenticated
  using (bucket_id = 'content' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- own folder policies, avatar
create policy avatar_select_own_folder on storage.objects
  for select to authenticated
  using (bucket_id = 'avatar' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatar_insert_own_folder on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatar' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatar_update_own_folder on storage.objects
  for update to authenticated
  using (bucket_id = 'avatar' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatar' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatar_delete_own_folder on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatar' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Preview prefix: select (the insert, update and delete policies exist already in
-- supabase/preview-setup/03-shared-objects.sql). Only if the Preview setup is there.
do $$
begin
  if to_regprocedure('preview_support.has_preview_profile(uuid)') is not null then
    drop policy if exists content_select_preview on storage.objects;
    drop policy if exists avatar_select_preview on storage.objects;
    execute $p$
      create policy content_select_preview on storage.objects
        for select to authenticated
        using (bucket_id = 'content' and (storage.foldername(name))[1] = 'preview'
               and (storage.foldername(name))[2] = (select auth.uid())::text
               and preview_support.has_preview_profile((select auth.uid())))
    $p$;
    execute $p$
      create policy avatar_select_preview on storage.objects
        for select to authenticated
        using (bucket_id = 'avatar' and (storage.foldername(name))[1] = 'preview'
               and (storage.foldername(name))[2] = (select auth.uid())::text
               and preview_support.has_preview_profile((select auth.uid())))
    $p$;
  end if;
end $$;

-- Proof before the commit: without a session and with the session of a user who owns
-- nothing the buckets show no object. The file stops (and changes nothing) otherwise.
do $$
declare
  visible bigint;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select count(*) into visible from storage.objects where bucket_id in ('content', 'avatar');
  reset role;
  if visible > 0 then
    raise exception 'anon still sees % object(s) of the buckets content or avatar', visible;
  end if;

  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', gen_random_uuid()), true);
  set local role authenticated;
  select count(*) into visible from storage.objects where bucket_id in ('content', 'avatar');
  reset role;
  if visible > 0 then
    raise exception 'a user without files still sees % object(s) of the buckets content or avatar', visible;
  end if;
end $$;

commit;

-- Check (read only): select policyname, cmd, roles from pg_policies
--  where schemaname = 'storage' and tablename = 'objects' order by policyname;
-- Expected: content_{select,insert,update,delete}_own_folder, avatar_{select,insert,update,delete}_own_folder,
-- the *_preview policies of the Preview setup (including content_select_preview and
-- avatar_select_preview if the Preview setup exists), and nothing else for these buckets.
-- Run supabase/manual/verify-rls-lockdown.sql, check 9 and 10.
--
-- The file can be run again: step 1 drops the policies of its own earlier run (they apply
-- to the buckets), step 2 creates them again, the two Preview select policies are dropped
-- and created in the last block.
--
-- UNDO (only if uploads break). Recreate the policies of your saved list from section 0.
-- The own folder policies of the earlier file 20261023_storage_policies.sql are:
--   begin;
--   drop policy if exists content_select_own_folder on storage.objects;
--   drop policy if exists content_insert_own_folder on storage.objects;
--   drop policy if exists content_update_own_folder on storage.objects;
--   drop policy if exists content_delete_own_folder on storage.objects;
--   drop policy if exists avatar_select_own_folder on storage.objects;
--   drop policy if exists avatar_insert_own_folder on storage.objects;
--   drop policy if exists avatar_update_own_folder on storage.objects;
--   drop policy if exists avatar_delete_own_folder on storage.objects;
--   drop policy if exists content_select_preview on storage.objects;
--   drop policy if exists avatar_select_preview on storage.objects;
--   create policy "Users can upload their own avatar" on storage.objects for insert to authenticated with check (bucket_id = 'avatar' and (auth.uid())::text = (storage.foldername(name))[1]);
--   create policy "Users can update their own avatar" on storage.objects for update to authenticated using (bucket_id = 'avatar' and (auth.uid())::text = (storage.foldername(name))[1]);
--   create policy "Users can delete their own avatar" on storage.objects for delete to authenticated using (bucket_id = 'avatar' and (auth.uid())::text = (storage.foldername(name))[1]);
--   create policy content_select_own_folder on storage.objects for select to authenticated using (bucket_id = 'content' and (auth.uid())::text = (storage.foldername(name))[1]);
--   create policy content_insert_own_folder on storage.objects for insert to authenticated with check (bucket_id = 'content' and (auth.uid())::text = (storage.foldername(name))[1]);
--   create policy content_update_own_folder on storage.objects for update to authenticated using (bucket_id = 'content' and (auth.uid())::text = (storage.foldername(name))[1]);
--   create policy content_delete_own_folder on storage.objects for delete to authenticated using (bucket_id = 'content' and (auth.uid())::text = (storage.foldername(name))[1]);
--   commit;
--
-- ---------------------------------------------------------------------------------
-- LATER, NOT NOW: private bucket content (needs application work first)
-- ---------------------------------------------------------------------------------
-- Required order:
--   1. App release that creates signed URLs on the server (src/app/api/.../documents)
--      and no longer uses or stores public URLs of the bucket content: the column
--      content_documents.storage_url holds .../storage/v1/object/public/content/... today;
--      uploads then store only the path.
--   2. Check Preview and Production: documents open, uploads work.
--   3. Only then switch the flag (Production and Preview share the bucket, so this is
--      one switch for both and Preview must be on the same release):
--        update storage.buckets set public = false where id = 'content';
--   Rollback of step 3 (immediately effective, public URLs work again):
--        update storage.buckets set public = true where id = 'content';
--   Before step 1 is done the switch breaks every document link of the platform.
--
-- Optional, independent of the above: limits of the buckets (the client checks
-- 10 MB and the file types already; with a limit in the bucket the server enforces it too).
-- Check the file types of your data first, the profile page accepts png, jpg, jpeg, pdf and zip today:
--   update storage.buckets set file_size_limit = 10485760 where id in ('content', 'avatar');
--   update storage.buckets set allowed_mime_types = array['application/pdf'] where id = 'content';
--   update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg'] where id = 'avatar';
