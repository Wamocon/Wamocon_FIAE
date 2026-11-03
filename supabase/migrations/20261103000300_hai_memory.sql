-- HAI memory (Gedächtnis der HAI): three new tables, nothing existing is changed.
--
-- Why: the HAI can remember two kinds of things, both only after a person agreed.
--   1. The memory of ONE user (hai_user_memories): preferences and learning style
--      (answer length, informal or formal address, style of explanation, preferred form of
--      learning, speaking or typing) and learning state and weaknesses (derived from quiz and
--      progress data, topics only, never solution text). Nothing is saved silently: the HAI asks
--      in the chat (yes, no, change), only a confirmed entry (status active) has an effect. The
--      entries are kept per occupation (training_catalog_id), so an entry of occupation A never
--      reaches occupation B. ONLY the user sees and changes the own entries, trainers and admins
--      do not (no policy for them, no admin route). Deleting the account deletes the memory
--      (foreign key on delete cascade).
--   2. The shared memory for all users (hai_global_memories): short hints for the style and the
--      emphasis of answers. The HAI may only PROPOSE them (origin auto, from counters without any
--      person: how many different users in an occupation, never which ones); a platform admin
--      approves, rejects, changes or creates them in the admin area. Only approved entries act.
-- hai_user_memory_settings holds the switch of one user ("Gedächtnis ein oder aus", default on, a
-- missing row counts as on). Switched off: nothing is loaded and nothing is proposed.
-- The whole feature is behind the environment switch HAI_MEMORY (default off), see
-- docs/hai-gedaechtnis.md.
--
-- Columns that are not in the first draft and why:
--   hai_user_memories.proposal_key  stable key of what was proposed (for example pref.length.short,
--                                   weak.<topic>, state.progress). It makes "a rejected proposal
--                                   never comes back" a rule of the database (unique per user and
--                                   occupation) and does not depend on the wording of the text
--   hai_global_memories.proposal_key  the same for the shared proposals (one open proposal per key)
--   hai_global_memories.updated_at  when an admin changed the row last
-- The foreign key hai_user_memories.user_id exists in this migration only (the Drizzle schema
-- declares a plain id): a pre-created profile never talked to the HAI, so the merge of two
-- profiles (src/lib/profile-identity.ts) has nothing to move, and the sign-in must not touch a
-- table that does not exist yet where this migration is not applied (Production gets it with the
-- release). created_by and approved_by of the shared memory are plain ids for the same reason
-- (an audit note must not hold up the deletion of a profile).
--
-- Access: Row level security is on for all three tables. hai_user_memories has one policy, the
-- row belongs to the own user (user_id = auth.uid()), for reading and writing, and NO policy for
-- trainers or admins. No privilege is granted to anon or authenticated (and every privilege is
-- revoked), so the policy is a safety net only: the app reads and writes through Drizzle as the
-- role postgres. This is on purpose: a direct write through the REST interface would bypass the
-- check that discards requests for solutions. hai_global_memories and hai_user_memory_settings
-- have no policy: they are read on the server only, the shared memory is written only through
-- the routes behind the platform admin check (requireSuperAdmin).
--
-- Safe to run twice (create if not exists, guarded policy, the same check of the result).
-- Sorting: behind 20261103000200 and behind GATED_TO (20261030000300), so it needs no extra
-- approval of the rollout gate. Until then the gate (scripts/db/rollout-gate.mjs, gated from
-- 20261024000100) holds it back together with the series. Production is not migrated by this
-- change. Without the migration the app works as before (the switch HAI_MEMORY is off, and
-- with the switch on every read of the memory fails closed to "no memory").
--
-- Order for Preview and Production: see docs/hai-gedaechtnis.md (migration first, then the code,
-- the switch last).
--
-- Undo (all memory entries are lost, nothing else changes):
--   drop table if exists public.hai_user_memory_settings;
--   drop table if exists public.hai_global_memories;
--   drop table if exists public.hai_user_memories;
--   The app of this change reads the tables only behind the switch HAI_MEMORY, so switch it off first.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Pre check ---------------------------------------------------------------------

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'hai memory: public.profiles is missing. Nothing was changed.';
  end if;
  if to_regclass('public.training_catalogs') is null then
    raise exception 'hai memory: public.training_catalogs is missing. Nothing was changed.';
  end if;
end $$;

-- 2. The memory of one user ---------------------------------------------------------

create table if not exists public.hai_user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  training_catalog_id uuid not null references public.training_catalogs (id) on delete cascade,
  kind text not null,
  proposal_key text not null,
  content text not null,
  source text not null,
  status text not null default 'proposed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint hai_user_memories_kind_check
    check (kind in ('preference', 'learning_style', 'learning_state', 'weakness')),
  constraint hai_user_memories_source_check
    check (source in ('stated', 'derived')),
  constraint hai_user_memories_status_check
    check (status in ('proposed', 'active', 'rejected')),
  constraint hai_user_memories_content_length
    check (char_length(content) between 1 and 300),
  constraint hai_user_memories_content_plain
    check (content !~ '[[:cntrl:]]'),
  constraint hai_user_memories_key_length
    check (char_length(proposal_key) between 1 and 120),
  constraint hai_user_memories_active_confirmed
    check (status <> 'active' or confirmed_at is not null),
  constraint hai_user_memories_user_catalog_key_unique
    unique (user_id, training_catalog_id, proposal_key)
);

create index if not exists hai_user_memories_user_catalog_status_idx
  on public.hai_user_memories (user_id, training_catalog_id, status);

-- the counters of the shared proposals: how many different users hold an active entry with a key
create index if not exists hai_user_memories_catalog_key_status_idx
  on public.hai_user_memories (training_catalog_id, proposal_key, status);

alter table public.hai_user_memories enable row level security;

do $$
begin
  if not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'hai_user_memories'
       and policyname = 'hai_user_memories_own'
  ) then
    create policy hai_user_memories_own
      on public.hai_user_memories
      for all
      to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

-- 3. The shared memory for all users ------------------------------------------------

create table if not exists public.hai_global_memories (
  id uuid primary key default gen_random_uuid(),
  training_catalog_id uuid references public.training_catalogs (id) on delete cascade,
  proposal_key text,
  content text not null,
  status text not null default 'proposed',
  origin text not null,
  support_count integer not null default 0,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hai_global_memories_status_check
    check (status in ('proposed', 'approved', 'rejected')),
  constraint hai_global_memories_origin_check
    check (origin in ('auto', 'manual')),
  constraint hai_global_memories_content_length
    check (char_length(content) between 1 and 400),
  constraint hai_global_memories_content_plain
    check (content !~ '[[:cntrl:]]'),
  constraint hai_global_memories_support_count_check
    check (support_count >= 0),
  constraint hai_global_memories_key_length
    check (proposal_key is null or char_length(proposal_key) between 1 and 120),
  constraint hai_global_memories_approved_check
    check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

-- one row per proposal key and occupation: a proposal that was rejected stays rejected, a new
-- calculation only raises the count of an open one
create unique index if not exists hai_global_memories_catalog_key_unique
  on public.hai_global_memories (training_catalog_id, proposal_key)
  where proposal_key is not null;

create index if not exists hai_global_memories_status_catalog_idx
  on public.hai_global_memories (status, training_catalog_id);

alter table public.hai_global_memories enable row level security;

-- 4. The switch of one user ---------------------------------------------------------

create table if not exists public.hai_user_memory_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.hai_user_memory_settings enable row level security;

-- 5. Closed for the API roles -------------------------------------------------------

do $$
declare
  api_role text;
  tbl text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      foreach tbl in array array[
        'hai_user_memories',
        'hai_global_memories',
        'hai_user_memory_settings'
      ] loop
        execute format(
          'revoke all on public.%I from %I',
          tbl,
          api_role
        );
      end loop;
    end if;
  end loop;
end $$;

comment on table public.hai_user_memories is
  'Memory of the HAI for ONE user and occupation (preferences, learning style, learning state, weaknesses). Only confirmed entries (status active) act. Visible to the user only: no policy for trainers or admins. Deleted with the account.';
comment on table public.hai_global_memories is
  'Shared memory of the HAI for all users (style and emphasis of answers), optionally for one occupation. Proposed from counters without any person, approved by a platform admin. Server only.';
comment on table public.hai_user_memory_settings is
  'Switch of one user for the memory of the HAI (a missing row counts as on). Server only.';
comment on column public.hai_user_memories.proposal_key is
  'Stable key of the proposal (for example pref.length.short or weak.<topic>), unique per user and occupation, so a rejected proposal never comes back.';
comment on column public.hai_global_memories.support_count is
  'Number of different users a proposal rests on. A number only, never the users.';

-- 6. Check of the result ------------------------------------------------------------

do $$
declare
  missing text;
begin
  select string_agg(t.name, ', ')
    into missing
    from (values
      ('hai_user_memories'),
      ('hai_global_memories'),
      ('hai_user_memory_settings')
    ) as t(name)
   where to_regclass('public.' || t.name) is null
      or not (
        select c.relrowsecurity
          from pg_class c
         where c.oid = to_regclass('public.' || t.name)
      );
  if missing is not null then
    raise exception
      'hai memory: table missing or row level security off for: %.', missing;
  end if;

  if (
    select count(*)
      from pg_policies
     where schemaname = 'public'
       and tablename = 'hai_user_memories'
  ) <> 1 then
    raise exception
      'hai memory: hai_user_memories must have exactly one policy (the own user).';
  end if;
  if exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename in ('hai_global_memories', 'hai_user_memory_settings')
  ) then
    raise exception
      'hai memory: hai_global_memories and hai_user_memory_settings must have no policy.';
  end if;
end $$;
