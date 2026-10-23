-- =============================================================================
-- Preview setup, step 2 of 4: the two changes on the PRODUCTION side
-- =============================================================================
-- WHO/WHEN: a human, ONCE, in the Supabase SQL editor as project owner, after
--           reading the current state (section 0) and after a backup. Not run by
--           any workflow.
-- EFFECT:   (a) fixes the search_path of the two RLS helper functions in public,
--           (b) lets an EXISTING Production auth trigger skip users that were created
--           from Preview. Both are small and reversible (see the end of the file).
--
-- WHY (b): Preview and Production share ONE auth (same users table). A user
-- who signs up from Preview carries the sign-up metadata env=preview (set by the
-- app, src/lib/db-schema.ts signupMetadata). Production must then NOT create a
-- profile in public, the twin trigger from 03-preview-side.sql creates it in
-- public_preview instead. All other users behave exactly as before.
-- =============================================================================

-- 0. READ FIRST (read only): what exists today?
--    select tgname, pg_get_triggerdef(oid) from pg_trigger
--     where tgrelid = 'auth.users'::regclass and not tgisinternal;
--    select proname, proconfig from pg_proc
--     where pronamespace = 'public'::regnamespace and proname in ('get_user_org_id', 'is_platform_owner', 'handle_new_user');
--    If the trigger is not called on_auth_user_created, or does more than
--    "after insert ... execute function public.handle_new_user()", adapt
--    section 2 to the real definition before running it.

-- 1. Fixed search_path for the SECURITY DEFINER helpers (no body change, policies keep working)
alter function public.get_user_org_id() set search_path = public, pg_temp;
alter function public.is_platform_owner() set search_path = public, pg_temp;

-- 2. Production trigger skips Preview users. Same function, one added condition.
--    GUARDED: a read-only measurement on 2026-10-23 found NO trigger on
--    auth.users in Production (profiles are created by /api/auth/sync-profile).
--    This block only changes an existing on_auth_user_created and never creates
--    a new trigger, because a failing trigger on auth.users blocks every sign-up.
do $$
begin
  if exists (
    select 1 from pg_trigger
     where tgrelid = 'auth.users'::regclass
       and tgname = 'on_auth_user_created'
       and not tgisinternal
  ) then
    drop trigger on_auth_user_created on auth.users;
    create trigger on_auth_user_created
      after insert on auth.users
      for each row
      when ((new.raw_user_meta_data ->> 'env') is distinct from 'preview')
      execute function public.handle_new_user();
  else
    raise notice 'No on_auth_user_created trigger on auth.users, nothing to change.';
  end if;
end
$$;

-- UNDO (only if needed):
--   alter function public.get_user_org_id() reset search_path;
--   alter function public.is_platform_owner() reset search_path;
--   drop trigger if exists on_auth_user_created on auth.users;
--   create trigger on_auth_user_created after insert on auth.users
--     for each row execute function public.handle_new_user();
