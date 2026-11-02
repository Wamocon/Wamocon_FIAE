-- HAI settings of the platform: which speech provider the voice assistant uses.
--
-- Why: the voice assistant of the HAI starts with Soniox (speech recognition and speech
-- output) and falls back to Sokrates (the own server) or to the browser. The platform admin
-- switches the provider in the HAI admin page (/trainer/admin/hai) without a deployment. The
-- choice is global, not per organization (the switch per organization,
-- organizations.voice_assistant_enabled, stays and decides who may use the voice assistant at all).
--
-- What: one small key/value table. One row per setting:
--   key         voice_provider_primary   'soniox' | 'haus' | 'browser'  (default soniox)
--               voice_provider_fallback  'haus' | 'browser'             (default browser)
--   value       the setting as JSON (a string for the two keys above)
--   updated_by  the profile of the platform admin who saved it last (null if the profile is gone)
-- The code reads the defaults when a row is missing (src/lib/hai/voice/settings.ts), so no row
-- is inserted here and nothing changes for an existing installation until an admin saves.
--
-- Access: the table is closed for the API roles. Row level security is on, there is no
-- policy, and every privilege of anon and authenticated is revoked. The app reads and writes it
-- through Drizzle as the role postgres (it bypasses row level security), like auth_attempts.
-- The table holds no secret: keys of Soniox and Sokrates stay in the environment of the server.
--
-- No existing table is changed. Safe to run twice. Production is not migrated by this change,
-- the release applies it (the code works without the table and uses the defaults).
--
-- Undo:
--   drop table if exists public.hai_settings;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.hai_settings (
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint hai_settings_pkey primary key (key),
  constraint hai_settings_key_length check (char_length(key) <= 64)
);

alter table public.hai_settings enable row level security;

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'revoke all on public.hai_settings from %I',
        api_role
      );
    end if;
  end loop;
end $$;

comment on table public.hai_settings is
  'Platform settings of the HAI (key and JSON value), for example the speech provider of the voice assistant. Server only: RLS on, no policy, no grant for anon and authenticated.';
comment on column public.hai_settings.updated_by is
  'Profile of the platform admin who saved the setting last.';
