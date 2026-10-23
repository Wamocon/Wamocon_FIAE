-- Storage policies for the buckets content and avatar. RUN BY A HUMAN, ONCE.
--
-- Why not a migration: storage.objects is shared by Production and Preview.
-- Apply it once in the Supabase SQL editor as project owner, after a backup of
-- the policy list (see section 0). It is not run by any workflow.
--
-- Measured read-only on production on 2026-10-23:
--   Bucket content (public = true): four policies "Allow all operations fqilq1_*"
--   let EVERY authenticated user read, insert, change and delete EVERY object of
--   the bucket, including files of other users and trainer solutions. Anyone can
--   self-register without e-mail confirmation (mailer_autoconfirm = true).
--   Bucket avatar: the policy "policy_name" allows every authenticated user to
--   insert anywhere in the bucket, next to the correct folder policy.
--
-- What the code needs (searched in src):
--   - Upload with the user session into the own folder, path <auth uid>/<file>
--     (PdfUploader.tsx for content, Profile.tsx for avatar).
--   - Reading through public URLs (getPublicUrl). They do not depend on policies
--     as long as the bucket stays public.
--   - Deleting files only on the server with the service role key (the two
--     documents routes), which bypasses policies.
--
-- After this file: users can write and delete only inside their own folder and
-- see only their own objects over the API. Public URLs keep working.
-- NOT solved here: the bucket content stays public, so everybody who knows a
-- file URL can open it (trainer solutions included). That needs a private
-- bucket with signed URLs and a migration of the stored links (separate task).

-- 0. READ FIRST (read only), keep the output:
--    select policyname, cmd, roles, qual, with_check from pg_policies
--     where schemaname = 'storage' and tablename = 'objects' order by policyname;

begin;

drop policy if exists "Allow all operations fqilq1_0" on storage.objects;
drop policy if exists "Allow all operations fqilq1_1" on storage.objects;
drop policy if exists "Allow all operations fqilq1_2" on storage.objects;
drop policy if exists "Allow all operations fqilq1_3" on storage.objects;
drop policy if exists "policy_name" on storage.objects;

-- The SELECT policy stays, limited to the own folder. INSERT ... RETURNING in
-- the storage service needs it, and it stops listing other users' files.
create policy "content_select_own_folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'content' and (auth.uid())::text = (storage.foldername(name))[1]);

create policy "content_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'content' and (auth.uid())::text = (storage.foldername(name))[1]);

create policy "content_update_own_folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'content' and (auth.uid())::text = (storage.foldername(name))[1])
  with check (bucket_id = 'content' and (auth.uid())::text = (storage.foldername(name))[1]);

create policy "content_delete_own_folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'content' and (auth.uid())::text = (storage.foldername(name))[1]);

commit;

-- Check: select policyname, cmd from pg_policies
--         where schemaname = 'storage' and tablename = 'objects' order by policyname;
-- Expected for content: the four content_*_own_folder policies, none called
-- "Allow all operations fqilq1_*". For avatar: the four existing avatar policies.

-- UNDO (restores the open state, only if uploads break):
--   begin;
--   drop policy if exists "content_select_own_folder" on storage.objects;
--   drop policy if exists "content_insert_own_folder" on storage.objects;
--   drop policy if exists "content_update_own_folder" on storage.objects;
--   drop policy if exists "content_delete_own_folder" on storage.objects;
--   create policy "Allow all operations fqilq1_0" on storage.objects for insert to authenticated with check (bucket_id = 'content');
--   create policy "Allow all operations fqilq1_1" on storage.objects for select to authenticated using (bucket_id = 'content');
--   create policy "Allow all operations fqilq1_2" on storage.objects for update to authenticated using (bucket_id = 'content');
--   create policy "Allow all operations fqilq1_3" on storage.objects for delete to authenticated using (bucket_id = 'content');
--   create policy "policy_name" on storage.objects for insert to authenticated with check (bucket_id = 'avatar');
--   commit;
