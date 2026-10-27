-- =============================================================================
-- Preview setup, step 3 of 4: shared objects (realtime and storage)
-- =============================================================================
-- WHO/WHEN: a human, in the Supabase SQL editor as project owner (role
--           postgres), after the first "Preview Reset" (execute) and again after
--           every later reset (a reset drops the Preview tables and with them
--           their realtime membership). NOT run by any workflow: it changes
--           objects of the shared schemas realtime and storage, which the
--           Preview roles must not touch.
-- EFFECT:   (1) adds the Preview tables notifications and profiles to the
--           realtime publication, (2) creates storage policies that let a signed
--           in user with a profile in public_preview upload, change and delete
--           files under preview/<user id>/ in the shared buckets avatar and
--           content. Production paths are not touched.
--           (3) adds one helper function to the schema preview_support (created by 01).
--           Additive. Reversible (see the end of the file).
--
-- DESIGN NOTE: the profile check is a function with DYNAMIC SQL, so the storage
-- policies do not depend on a table of public_preview. A reset can then drop and
-- recreate public_preview without dropping the policies (policies that refer to a
-- table directly would block the reset or vanish with it).
-- =============================================================================

-- 1. Realtime: the app listens to postgres_changes on notifications and profiles
--    in the schema of its environment (src/lib/db-schema.ts DB_SCHEMA).
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['notifications', 'profiles'] loop
      if to_regclass('public_preview.' || t) is not null
         and not exists (
           select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public_preview' and tablename = t
         ) then
        execute format('alter publication supabase_realtime add table public_preview.%I', t);
      end if;
    end loop;
  end if;
end
$$;

-- 2. Helper: does the user have a profile in public_preview? Dynamic SQL on purpose
--    (no dependency on the table). SECURITY DEFINER with a fixed search_path; only
--    signed in users may call it, and it answers only about the caller's own id.
-- the schema preview_support exists since 01-preview-role.sql (wrappers of auth.uid() and friends)
create schema if not exists preview_support;
grant usage on schema preview_support to authenticated;

create or replace function preview_support.has_preview_profile(uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  found boolean;
begin
  if uid is null or uid is distinct from auth.uid() then
    return false;
  end if;
  execute 'select exists (select 1 from public_preview.profiles where id = $1)' into found using uid;
  return coalesce(found, false);
exception
  when undefined_table or insufficient_privilege then
    return false;
end
$fn$;
revoke all on function preview_support.has_preview_profile(uuid) from public;
-- Only authenticated may call it. Converges after an older version of 01, which granted EXECUTE on
-- every function of the schema to the roles below (a no-op otherwise).
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'service_role', 'app_preview_migrator', 'app_preview'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function preview_support.has_preview_profile(uuid) from %I', r);
    end if;
  end loop;
end
$$;
grant execute on function preview_support.has_preview_profile(uuid) to authenticated;

-- 3. Storage: Preview uploads go to preview/<user id>/... in the SHARED buckets
--    avatar and content (no bucket twins). The Production policies expect the user
--    id as first folder, so Preview needs its own policies for the prefix, and only
--    for users who have a profile in public_preview.
--    Names end in _preview. Check the existing Production policies of these
--    buckets before relying on this.
drop policy if exists avatar_insert_preview on storage.objects;
create policy avatar_insert_preview on storage.objects for insert to authenticated
  with check (bucket_id = 'avatar' and (storage.foldername(name))[1] = 'preview' and (storage.foldername(name))[2] = auth.uid()::text and preview_support.has_preview_profile(auth.uid()));
drop policy if exists avatar_update_preview on storage.objects;
create policy avatar_update_preview on storage.objects for update to authenticated
  using (bucket_id = 'avatar' and (storage.foldername(name))[1] = 'preview' and (storage.foldername(name))[2] = auth.uid()::text and preview_support.has_preview_profile(auth.uid()));
drop policy if exists avatar_delete_preview on storage.objects;
create policy avatar_delete_preview on storage.objects for delete to authenticated
  using (bucket_id = 'avatar' and (storage.foldername(name))[1] = 'preview' and (storage.foldername(name))[2] = auth.uid()::text and preview_support.has_preview_profile(auth.uid()));

drop policy if exists content_insert_preview on storage.objects;
create policy content_insert_preview on storage.objects for insert to authenticated
  with check (bucket_id = 'content' and (storage.foldername(name))[1] = 'preview' and (storage.foldername(name))[2] = auth.uid()::text and preview_support.has_preview_profile(auth.uid()));
drop policy if exists content_update_preview on storage.objects;
create policy content_update_preview on storage.objects for update to authenticated
  using (bucket_id = 'content' and (storage.foldername(name))[1] = 'preview' and (storage.foldername(name))[2] = auth.uid()::text and preview_support.has_preview_profile(auth.uid()));
drop policy if exists content_delete_preview on storage.objects;
create policy content_delete_preview on storage.objects for delete to authenticated
  using (bucket_id = 'content' and (storage.foldername(name))[1] = 'preview' and (storage.foldername(name))[2] = auth.uid()::text and preview_support.has_preview_profile(auth.uid()));

-- The storage service reads a new row back after an insert, so every upload also needs a
-- select policy for the same path (the production policies cover only <user id>/...).
drop policy if exists avatar_select_preview on storage.objects;
create policy avatar_select_preview on storage.objects for select to authenticated
  using (bucket_id = 'avatar' and (storage.foldername(name))[1] = 'preview' and (storage.foldername(name))[2] = auth.uid()::text and preview_support.has_preview_profile(auth.uid()));
drop policy if exists content_select_preview on storage.objects;
create policy content_select_preview on storage.objects for select to authenticated
  using (bucket_id = 'content' and (storage.foldername(name))[1] = 'preview' and (storage.foldername(name))[2] = auth.uid()::text and preview_support.has_preview_profile(auth.uid()));

-- UNDO (only if needed):
--   drop policy if exists avatar_insert_preview on storage.objects;  (and the seven others above)
--   drop function if exists preview_support.has_preview_profile(uuid);
--   drop schema if exists preview_support;
--   alter publication supabase_realtime drop table public_preview.notifications, public_preview.profiles;
