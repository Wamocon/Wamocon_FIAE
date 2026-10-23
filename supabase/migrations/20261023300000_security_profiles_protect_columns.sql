-- Security hardening: protect the sensitive profile columns without relying on privileges.
--
-- 20261023200000 limits UPDATE for anon and authenticated to six columns with
-- column privileges. Measured on 2026-10-23 in the evening: the Data API setting
-- "expose all tables" grants every privilege on every table to anon and
-- authenticated again and silently undid that. For a few hours any signed-in user
-- could change the own role, organization and activation through the REST API
-- (profiles_update_own only checks the row, not the columns). No sign of abuse:
-- 6 profiles (1 admin, 2 trainers, 3 trainees), the same distribution before and
-- after. The privileges were restored by repeating 20261023200000.
--
-- This migration adds a second, independent layer: a BEFORE UPDATE trigger that
-- refuses any change outside the six allowed columns when the statement runs as
-- anon or authenticated (the roles PostgREST switches to for every API request).
-- It holds whatever the grants say. The server is not affected: Drizzle connects
-- as postgres and the admin client uses service_role, neither is checked.
-- The allowed columns are the ones the browser really writes
-- (src/contexts/AuthContext.tsx updateProfile): full_name, avatar_url,
-- birth_date, start_of_training_date, assigned_trainer_id, updated_at. Every
-- other column, also any column added later, is protected by default.
--
-- Effect: an API update that touches another column fails with SQLSTATE 42501.
-- No row, privilege or policy is changed. Safe to run twice.
--
-- Undo (only if something breaks):
--   drop trigger profiles_protect_columns on public.profiles;
--   drop function public.profiles_protect_columns();

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
    'assigned_trainer_id',
    'updated_at'
  ];
begin
  if current_user in ('anon', 'authenticated')
     and (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'Only the profile fields % may be changed with the API credentials.',
      array_to_string(allowed, ', ')
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- A trigger function needs no EXECUTE privilege when it fires.
revoke execute on function public.profiles_protect_columns() from public;

drop trigger if exists profiles_protect_columns on public.profiles;
create trigger profiles_protect_columns
  before update on public.profiles
  for each row
  execute function public.profiles_protect_columns();
