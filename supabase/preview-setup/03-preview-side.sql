-- =============================================================================
-- Preview setup, step 3 of 4: everything on the Preview side that is not structure
-- =============================================================================
-- WHO/WHEN: run automatically by scripts/db/preview-migrate.mjs (setup and
--           rebuild, i.e. the workflow "Preview Reset") right after the
--           structure of public was cloned into public_preview. A human may also
--           run it by hand. IDEMPOTENT.
-- EFFECT:   touches public_preview and the Preview twins on shared objects
--           (names end in _preview, so a rebuild removes and recreates them).
--           Never changes a Production object.
--
-- Contents: (1) helper functions with fixed search_path, (2) twin trigger for
-- handle_new_user (routing by the sign-up metadata env=preview), (3) realtime
-- publication membership, (4) storage policies for the prefix preview/ in the
-- shared buckets avatar and content.
-- =============================================================================

-- 1. Helper functions of the Preview schema with a fixed search_path.
--    They exist after the structure clone (rewritten copies of the public ones).
do $$
begin
  if to_regprocedure('public_preview.get_user_org_id()') is not null then
    execute 'alter function public_preview.get_user_org_id() set search_path = public_preview, pg_temp';
  end if;
  if to_regprocedure('public_preview.is_platform_owner()') is not null then
    execute 'alter function public_preview.is_platform_owner() set search_path = public_preview, pg_temp';
  end if;
end
$$;

-- 2. Twin trigger: only users created from Preview (env=preview) get their
--    profile in public_preview. The Production trigger skips exactly these users
--    (02-production-side.sql), so every user is handled by exactly one trigger.
do $$
begin
  if to_regprocedure('public_preview.handle_new_user()') is null then
    raise exception 'public_preview.handle_new_user() is missing: clone the structure first (workflow Preview Reset).';
  end if;
  execute 'drop trigger if exists on_auth_user_created_preview on auth.users';
  execute $t$
    create trigger on_auth_user_created_preview
      after insert on auth.users
      for each row
      when ((new.raw_user_meta_data ->> 'env') = 'preview')
      execute function public_preview.handle_new_user()
  $t$;
end
$$;

-- 3. Realtime: the app listens to postgres_changes on notifications and profiles
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

-- 4. Storage: Preview uploads go to preview/<user id>/... in the SHARED buckets
--    avatar and content (no bucket twins). The Production policies expect the user
--    id as first folder, so Preview needs its own policies for the prefix.
--    Names end in _preview (removed and recreated by a rebuild).
--    Check the existing Production policies of these buckets before relying on this.
drop policy if exists avatar_insert_preview on storage.objects;
create policy avatar_insert_preview on storage.objects for insert to authenticated
  with check (bucket_id = 'avatar' and (storage.foldername(name))[1] = 'preview' and (storage.foldername(name))[2] = auth.uid()::text);
drop policy if exists avatar_update_preview on storage.objects;
create policy avatar_update_preview on storage.objects for update to authenticated
  using (bucket_id = 'avatar' and (storage.foldername(name))[1] = 'preview' and (storage.foldername(name))[2] = auth.uid()::text);
drop policy if exists avatar_delete_preview on storage.objects;
create policy avatar_delete_preview on storage.objects for delete to authenticated
  using (bucket_id = 'avatar' and (storage.foldername(name))[1] = 'preview' and (storage.foldername(name))[2] = auth.uid()::text);

drop policy if exists content_insert_preview on storage.objects;
create policy content_insert_preview on storage.objects for insert to authenticated
  with check (bucket_id = 'content' and (storage.foldername(name))[1] = 'preview' and (storage.foldername(name))[2] = auth.uid()::text);
drop policy if exists content_update_preview on storage.objects;
create policy content_update_preview on storage.objects for update to authenticated
  using (bucket_id = 'content' and (storage.foldername(name))[1] = 'preview' and (storage.foldername(name))[2] = auth.uid()::text);
drop policy if exists content_delete_preview on storage.objects;
create policy content_delete_preview on storage.objects for delete to authenticated
  using (bucket_id = 'content' and (storage.foldername(name))[1] = 'preview' and (storage.foldername(name))[2] = auth.uid()::text);

-- 5. Make the new objects reachable for the Preview role (a no-op while the role does not exist)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_preview') then
    execute 'grant usage on schema public_preview to app_preview';
    execute 'grant all on all tables in schema public_preview to app_preview';
    execute 'grant all on all sequences in schema public_preview to app_preview';
    execute 'grant all on all functions in schema public_preview to app_preview';
  end if;
end
$$;
