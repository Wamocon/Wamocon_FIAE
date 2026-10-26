-- Server-side counter for failed secret checks (PIN, later perhaps others).
--
-- Why: /api/hai/verify-pin compared the admin PIN with a plain string and let a
-- caller try as often as they liked. The counter has to work across serverless
-- instances, so it lives in the database, not in the memory of one instance
-- (src/lib/rate-limit.ts only slows a warm instance down).
--
-- One row per (scope, subject): scope names the check ('hai-admin-pin'),
-- subject names the one who tries ('user:<profile id>' or 'ip:<hash of the
-- address>'). The row is written by ONE statement per attempt
-- (src/lib/auth/attempt-limiter.ts, INSERT .. ON CONFLICT DO UPDATE), so
-- parallel attempts are counted one by one and cannot slip through between a
-- check and a write. The time comes from now() of the database, not from the
-- clock of an instance.
--   failures         attempts counted since the last success (the row is reset
--                    after a quiet window and deleted after a success)
--   locked_until     the lock set by the attempt that reached the threshold, kept
--                    unchanged while attempts are refused
--   last_attempt_at  the last attempt that was let through (not a refused one)
--   last_allowed     whether the last attempt was let through, written by the same
--                    statement so its RETURNING can tell the caller
--
-- The table holds no secret and no PIN. It is closed for the API roles: row
-- level security is on, there is no policy, and every privilege of anon and
-- authenticated is revoked. The app reads and writes it through Drizzle as the
-- role postgres (it bypasses row level security), like hai_reindex_jobs.
--
-- No existing table is changed. Safe to run twice. Sorting: behind
-- 20261029000100, so the rollout gate (scripts/db/rollout-gate.mjs) holds it
-- back in Production together with the series. Production is not migrated by
-- this change.
--
-- Undo (only if something breaks; the verify-pin route then answers 503 until
-- the table exists again):
--   drop table if exists public.auth_attempts;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.auth_attempts (
  scope text not null,
  subject text not null,
  failures integer not null default 0,
  locked_until timestamptz,
  last_attempt_at timestamptz not null default now(),
  last_allowed boolean not null default true,
  constraint auth_attempts_pkey primary key (scope, subject),
  constraint auth_attempts_scope_length check (char_length(scope) <= 64),
  constraint auth_attempts_subject_length check (char_length(subject) <= 128),
  constraint auth_attempts_failures_check check (failures >= 0)
);

-- No index on last_attempt_at on purpose: the table stays tiny (one row per
-- person or address that ever typed a wrong PIN), the cleanup of old rows scans
-- it, and an index on a column that changes with every counted attempt would
-- make every update a non-HOT update.

alter table public.auth_attempts enable row level security;

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'revoke all on public.auth_attempts from %I',
        api_role
      );
    end if;
  end loop;
end $$;

comment on table public.auth_attempts is
  'Failed attempts per check and person or address, for the lock after too many wrong secrets. Server only: RLS on, no policy, no grant for anon and authenticated.';
comment on column public.auth_attempts.subject is
  'user:<profile id> or ip:<hash of the address>, never the secret that was tried.';
