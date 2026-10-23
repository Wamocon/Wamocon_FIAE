-- Security hardening: protect the profiles table without relying on privileges
-- (version 2).
--
-- This replaces the function and the trigger of 20261023300000, which covered
-- UPDATE only and still allowed assigned_trainer_id. That file was already
-- applied to the Preview schema when an independent review asked for the changes
-- below. An applied migration is not edited, so the change is a new version.
-- Production gets both files in order, both are safe to run twice.
--
-- 20261023200000 limits UPDATE for anon and authenticated to six columns with
-- column privileges. Measured on 2026-10-23 in the evening: the Data API setting
-- "expose all tables" grants every privilege on every table to anon and
-- authenticated again and silently undid that. For a few hours any signed-in user
-- could change the own role, organization and activation through the REST API
-- (profiles_update_own only checks the row, not the columns). The role
-- distribution is unchanged (6 profiles: 1 admin, 2 trainers, 3 trainees), but
-- that does not prove that organization or activation were left alone, and the
-- API logs could not be queried. The privileges were restored by repeating
-- 20261023200000.
--
-- This migration adds a second, independent layer: a BEFORE trigger on
-- public.profiles that holds whatever the grants say, for the roles anon and
-- authenticated (the roles PostgREST switches to for every API request):
--   - UPDATE: refused if any column outside the five allowed ones changes. The
--     browser writes exactly these (src/contexts/AuthContext.tsx updateProfile):
--     full_name, avatar_url, birth_date, start_of_training_date, updated_at.
--     Every other column, also any column added later, is protected by default.
--   - INSERT and DELETE: refused. The browser never inserts or deletes profiles,
--     that is done by the server (Drizzle as postgres, the admin client as
--     service_role), neither is checked. Deleting an auth user still removes its
--     profile: the foreign key cascade runs as the table owner.
-- assigned_trainer_id is no longer writable from the browser: no code does that,
-- and it would let a trainee assign himself to any trainer, also in another
-- organization (isTraineeVisibleToTrainer only compares the id). The privilege
-- layer follows (revoke below).
--
-- The function must stay SECURITY INVOKER: for SECURITY DEFINER current_user is
-- the function owner and the protection would silently switch itself off.
--
-- Effect: an API request that touches another column, inserts or deletes fails
-- with SQLSTATE 42501. No row, policy or other privilege is changed. Safe to run
-- twice.
--
-- Undo (only if something breaks):
--   drop trigger profiles_protect_columns on public.profiles;
--   drop function public.profiles_protect_columns();
--   grant update (assigned_trainer_id) on table public.profiles to authenticated;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.profiles_protect_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[] := array[
    'full_name',
    'avatar_url',
    'birth_date',
    'start_of_training_date',
    'updated_at'
  ];
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'UPDATE' then
      if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
        raise exception 'Only the profile fields % may be changed with the API credentials.',
          array_to_string(allowed, ', ')
          using errcode = '42501';
      end if;
    else
      raise exception 'Profiles cannot be % with the API credentials.', lower(tg_op)
        using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- A trigger function needs no EXECUTE privilege when it fires. The Supabase
-- default privileges hand EXECUTE to the API roles directly, take it back.
revoke execute on function public.profiles_protect_columns() from public, anon, authenticated;

-- Privilege layer, in line with the trigger (a no-op while a table level UPDATE
-- is granted, the trigger holds in that case).
revoke update (assigned_trainer_id) on table public.profiles from authenticated;

drop trigger if exists profiles_protect_columns on public.profiles;
create trigger profiles_protect_columns
  before insert or update or delete on public.profiles
  for each row
  execute function public.profiles_protect_columns();
