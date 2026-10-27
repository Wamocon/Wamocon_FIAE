-- Data model of the AI assisted content upload (package U1 of docs/ki-upload-konzept.md).
--
-- Why: the content upload (a page for platform administrators that takes Word and
-- PDF files, sorts them, shows a review list and hands the confirmed files to the
-- apply engine) needs a place to keep its process data: the runs, the announced
-- files with their queue state, the proposals, the decisions of the reviewers, the
-- log of every transmission of an excerpt to Sokrates, and the log of every dry
-- run and apply with the ids of the rows it wrote (basis of the rollback SQL).
-- This file only creates that place. No route, no page and no job uses it yet.
--
-- Seven new tables (names, columns and states follow sections 2.3 and 3 of the
-- concept):
--   content_upload_runs          one upload run per occupation (catalog)
--   content_upload_files         one row per announced file, doubles as the queue
--                                (status, locked_until, attempts, claim_id)
--   content_upload_proposals     what the rules or the model propose per file
--                                (history, one current row per file)
--   content_upload_decisions     what a reviewer decided per file (history, one
--                                current row per file)
--   content_upload_ki_calls      log of each transmission to Sokrates: the exact
--                                excerpt (wiped after 30 days, hash and length stay),
--                                model, host, status and timings; no key, no header,
--                                no file name, no file content
--   content_upload_applies       log of every dry run and apply: counts, conflicts,
--                                target schema, hash of the decision state
--   content_upload_applied_rows  one row per row of a content table that an apply
--                                wrote (row_id has no foreign key, it points at one
--                                of several tables), with the values before an update
--
-- Rules that the database itself keeps (cheap guards, the state machines live in
-- the application): fixed value lists for every status, mode and type column, the
-- length limits of the concept, sha256 as 64 lower case hex characters, at most one
-- current proposal and one current decision per file, at most one running apply per
-- run, a proposal of the model is capped at 0.80 and is never "high", a snapshot
-- before an update exists exactly for updates, and the row protocol only names the
-- tables of src/lib/content-import/apply/tables.ts. A run that has applies cannot be
-- deleted (on delete restrict), the protocol must outlive it. Deleting a profile
-- that created, decided or applied something is refused for the same reason.
--
-- The tables are closed for the API roles: row level security is on, there is no
-- policy, and every privilege of anon and authenticated is revoked (checked again at
-- the end). The app reads and writes them on the server through Drizzle as the role
-- postgres (Production) or app_preview (Preview), like auth_attempts and
-- hai_reindex_jobs; both come to their rights as owner or by the default privileges of
-- the migration role, so nothing is granted here. The browser never talks to these
-- tables, not even through realtime.
--
-- Process data, not content: the tables are not part of supabase/content-tables.json
-- and are never copied between public_preview and public by the release.
--
-- No existing table is changed, no data is read or written. Safe to run twice (create
-- table if not exists, create index if not exists, alter table .. enable row level
-- security and revoke can be repeated). Creating the foreign keys takes a short lock on
-- training_catalogs and profiles, the lock timeout below stops the file instead of
-- waiting. Sorting: behind 20261029000300, so the rollout gate
-- (scripts/db/rollout-gate.mjs) holds it back in Production together with the series.
-- Production is not migrated by this change; the feature is switched off there.
--
-- Undo (the tables are empty until the feature is used; the template stops if they
-- hold rows):
--   run supabase/manual/rollback-content-upload-tables.sql, first as a try with
--   "rollback;" in place of "commit;". By hand and only for empty tables:
--   drop table if exists public.content_upload_applied_rows,
--     public.content_upload_applies, public.content_upload_ki_calls,
--     public.content_upload_decisions, public.content_upload_proposals,
--     public.content_upload_files, public.content_upload_runs;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Runs ------------------------------------------------------------------------

create table if not exists public.content_upload_runs (
  id uuid not null default gen_random_uuid(),
  training_catalog_id uuid not null,
  created_by_id uuid not null,
  label text not null,
  status text not null default 'draft',
  ki_enabled boolean not null default true,
  declaration_accepted_at timestamptz not null,
  storage_prefix text not null,
  decisions_version integer not null default 0,
  last_dry_run_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  purge_after timestamptz,
  constraint content_upload_runs_pkey primary key (id),
  constraint content_upload_runs_training_catalog_id_fk
    foreign key (training_catalog_id)
    references public.training_catalogs (id)
    on delete restrict,
  constraint content_upload_runs_created_by_id_fk
    foreign key (created_by_id)
    references public.profiles (id)
    on delete restrict,
  constraint content_upload_runs_storage_prefix_key unique (storage_prefix),
  constraint content_upload_runs_label_check
    check (char_length(label) between 1 and 120),
  constraint content_upload_runs_status_check
    check (status in ('draft', 'uploading', 'processing', 'review', 'applying', 'applied', 'failed', 'discarded')),
  constraint content_upload_runs_storage_prefix_check
    check (char_length(storage_prefix) between 1 and 200),
  constraint content_upload_runs_decisions_version_check
    check (decisions_version >= 0),
  constraint content_upload_runs_dry_run_hash_check
    check (last_dry_run_hash is null or char_length(last_dry_run_hash) <= 128)
);

create index if not exists content_upload_runs_status_idx
  on public.content_upload_runs (status);
create index if not exists content_upload_runs_created_by_idx
  on public.content_upload_runs (created_by_id, created_at desc);

-- 2. Files (and the queue) ---------------------------------------------------------

create table if not exists public.content_upload_files (
  id uuid not null default gen_random_uuid(),
  run_id uuid not null,
  rel_path text not null,
  file_name text not null,
  ext text not null,
  size_bytes bigint not null,
  sha256 text not null,
  client_mtime_ms bigint,
  storage_path text not null,
  status text not null default 'announced',
  status_code text,
  attempts integer not null default 0,
  locked_until timestamptz,
  claim_id uuid,
  duplicate_of_id uuid,
  similar_group text,
  doc_type text,
  page_count integer,
  char_count integer,
  parse_summary jsonb,
  dup_key text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  processed_at timestamptz,
  constraint content_upload_files_pkey primary key (id),
  constraint content_upload_files_run_id_fk
    foreign key (run_id)
    references public.content_upload_runs (id)
    on delete cascade,
  constraint content_upload_files_duplicate_of_id_fk
    foreign key (duplicate_of_id)
    references public.content_upload_files (id)
    on delete set null,
  constraint content_upload_files_run_path_hash_key
    unique (run_id, rel_path, sha256),
  constraint content_upload_files_storage_path_key unique (storage_path),
  constraint content_upload_files_rel_path_check
    check (char_length(rel_path) between 1 and 500),
  constraint content_upload_files_file_name_check
    check (char_length(file_name) between 1 and 200),
  constraint content_upload_files_ext_check
    check (ext in ('docx', 'pdf')),
  constraint content_upload_files_size_bytes_check
    check (size_bytes >= 0),
  constraint content_upload_files_sha256_check
    check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint content_upload_files_storage_path_check
    check (char_length(storage_path) between 1 and 300),
  constraint content_upload_files_status_check
    check (status in ('announced', 'uploaded', 'verified', 'extracted', 'proposed_rules', 'unclear', 'ki_pending', 'proposed_ki', 'decided', 'applied', 'failed', 'rejected', 'expired', 'merged', 'skipped', 'superseded')),
  constraint content_upload_files_status_code_check
    check (status_code is null or char_length(status_code) <= 64),
  constraint content_upload_files_attempts_check
    check (attempts >= 0),
  constraint content_upload_files_doc_type_check
    check (doc_type is null or doc_type in ('enabler', 'quiz', 'global_quiz', 'scenario', 'use_case', 'pdf_original', 'other')),
  constraint content_upload_files_counts_check
    check ((page_count is null or page_count >= 0) and (char_count is null or char_count >= 0)),
  constraint content_upload_files_keys_check
    check ((dup_key is null or char_length(dup_key) <= 200) and (similar_group is null or char_length(similar_group) <= 200)),
  constraint content_upload_files_not_self_duplicate_check
    check (duplicate_of_id is null or duplicate_of_id <> id)
);

create index if not exists content_upload_files_queue_idx
  on public.content_upload_files (run_id, status, locked_until);
create index if not exists content_upload_files_run_dup_key_idx
  on public.content_upload_files (run_id, dup_key);
create index if not exists content_upload_files_sha256_idx
  on public.content_upload_files (sha256);
create index if not exists content_upload_files_duplicate_of_idx
  on public.content_upload_files (duplicate_of_id);

-- 3. Proposals (history, only is_current changes) ----------------------------------

create table if not exists public.content_upload_proposals (
  id uuid not null default gen_random_uuid(),
  file_id uuid not null,
  source text not null,
  doc_type text,
  component_code text,
  enabler_code text,
  quiz_level text,
  confidence numeric(3,2) not null,
  band text not null,
  reasons jsonb not null default '[]'::jsonb,
  model text,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  constraint content_upload_proposals_pkey primary key (id),
  constraint content_upload_proposals_file_id_fk
    foreign key (file_id)
    references public.content_upload_files (id)
    on delete cascade,
  constraint content_upload_proposals_source_check
    check (source in ('path', 'content', 'path_content', 'ki')),
  constraint content_upload_proposals_doc_type_check
    check (doc_type is null or doc_type in ('enabler', 'quiz', 'global_quiz', 'scenario', 'use_case', 'pdf_original', 'other')),
  constraint content_upload_proposals_quiz_level_check
    check (quiz_level is null or quiz_level in ('low', 'medium', 'high')),
  constraint content_upload_proposals_confidence_check
    check (confidence between 0 and 1),
  constraint content_upload_proposals_band_check
    check (band in ('high', 'medium', 'low', 'conflict')),
  -- the model alone never makes a proposal sure (concept 6.2: cap 0.80, never high)
  constraint content_upload_proposals_ki_limits_check
    check (source <> 'ki' or (confidence <= 0.80 and band in ('medium', 'low'))),
  constraint content_upload_proposals_reasons_check
    check (jsonb_typeof(reasons) = 'array'),
  constraint content_upload_proposals_code_length_check
    check ((component_code is null or char_length(component_code) <= 32) and (enabler_code is null or char_length(enabler_code) <= 32) and (model is null or char_length(model) <= 200))
);

create unique index if not exists content_upload_proposals_current_uidx
  on public.content_upload_proposals (file_id)
  where is_current;
create index if not exists content_upload_proposals_file_idx
  on public.content_upload_proposals (file_id, created_at desc);

-- 4. Decisions (history, only is_current changes) ----------------------------------

create table if not exists public.content_upload_decisions (
  id uuid not null default gen_random_uuid(),
  run_id uuid not null,
  file_id uuid not null,
  proposal_id uuid,
  decisions_version integer not null,
  decided_by_id uuid not null,
  action text not null,
  doc_type text,
  component_code text,
  enabler_code text,
  quiz_level text,
  dup_choice text,
  note text,
  is_current boolean not null default true,
  decided_at timestamptz not null default now(),
  constraint content_upload_decisions_pkey primary key (id),
  constraint content_upload_decisions_run_id_fk
    foreign key (run_id)
    references public.content_upload_runs (id)
    on delete cascade,
  constraint content_upload_decisions_file_id_fk
    foreign key (file_id)
    references public.content_upload_files (id)
    on delete cascade,
  constraint content_upload_decisions_proposal_id_fk
    foreign key (proposal_id)
    references public.content_upload_proposals (id)
    on delete set null,
  constraint content_upload_decisions_decided_by_id_fk
    foreign key (decided_by_id)
    references public.profiles (id)
    on delete restrict,
  constraint content_upload_decisions_decisions_version_check
    check (decisions_version >= 0),
  constraint content_upload_decisions_action_check
    check (action in ('accept', 'reject', 'defer')),
  constraint content_upload_decisions_doc_type_check
    check (doc_type is null or doc_type in ('enabler', 'quiz', 'global_quiz', 'scenario', 'use_case', 'pdf_original', 'other')),
  constraint content_upload_decisions_quiz_level_check
    check (quiz_level is null or quiz_level in ('low', 'medium', 'high')),
  constraint content_upload_decisions_dup_choice_check
    check (dup_choice is null or dup_choice in ('keep', 'skip')),
  constraint content_upload_decisions_note_check
    check (note is null or char_length(note) <= 500),
  constraint content_upload_decisions_code_length_check
    check ((component_code is null or char_length(component_code) <= 32) and (enabler_code is null or char_length(enabler_code) <= 32)),
  -- an accepted file needs the final type it is applied with
  constraint content_upload_decisions_accept_values_check
    check (action <> 'accept' or doc_type is not null)
);

create unique index if not exists content_upload_decisions_current_uidx
  on public.content_upload_decisions (file_id)
  where is_current;
create index if not exists content_upload_decisions_run_idx
  on public.content_upload_decisions (run_id);
create index if not exists content_upload_decisions_file_idx
  on public.content_upload_decisions (file_id, decided_at desc);
create index if not exists content_upload_decisions_proposal_idx
  on public.content_upload_decisions (proposal_id)
  where proposal_id is not null;

-- 5. Log of the transmissions to Sokrates ------------------------------------------
-- The excerpt is the exact text that was sent (at most 2500 characters by the rules
-- of the application; the bound here is a safety net). It is wiped after 30 days,
-- excerpt_chars and excerpt_sha256 stay. Nothing here may hold a key, a header, a
-- file name or more than the host of the address.

create table if not exists public.content_upload_ki_calls (
  id uuid not null default gen_random_uuid(),
  run_id uuid not null,
  file_id uuid not null,
  requested_at timestamptz not null default now(),
  stage text not null,
  model text,
  endpoint_host text,
  excerpt text,
  excerpt_chars integer not null,
  excerpt_sha256 text not null,
  redactions integer not null default 0,
  status text not null,
  http_status integer,
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  attempt integer not null default 1,
  answer_excerpt text,
  constraint content_upload_ki_calls_pkey primary key (id),
  constraint content_upload_ki_calls_run_id_fk
    foreign key (run_id)
    references public.content_upload_runs (id)
    on delete cascade,
  constraint content_upload_ki_calls_file_id_fk
    foreign key (file_id)
    references public.content_upload_files (id)
    on delete cascade,
  constraint content_upload_ki_calls_stage_check
    check (stage in ('type_component', 'enabler')),
  constraint content_upload_ki_calls_status_check
    check (status in ('ok', 'invalid_json', 'not_in_whitelist', 'timeout', 'http_error', 'refused_by_guard', 'skipped')),
  constraint content_upload_ki_calls_model_check
    check (model is null or char_length(model) <= 200),
  constraint content_upload_ki_calls_endpoint_host_check
    check (endpoint_host is null or (char_length(endpoint_host) <= 260 and endpoint_host ~ '^[a-z0-9.-]+(:[0-9]{1,5})?$')),
  constraint content_upload_ki_calls_excerpt_check
    check (excerpt is null or char_length(excerpt) <= 5000),
  constraint content_upload_ki_calls_excerpt_chars_check
    check (excerpt_chars >= 0),
  constraint content_upload_ki_calls_excerpt_sha256_check
    check (excerpt_sha256 ~ '^[0-9a-f]{64}$'),
  constraint content_upload_ki_calls_redactions_check
    check (redactions >= 0),
  constraint content_upload_ki_calls_http_status_check
    check (http_status is null or http_status between 100 and 599),
  constraint content_upload_ki_calls_measures_check
    check ((latency_ms is null or latency_ms >= 0) and (prompt_tokens is null or prompt_tokens >= 0) and (completion_tokens is null or completion_tokens >= 0)),
  constraint content_upload_ki_calls_attempt_check
    check (attempt >= 1),
  constraint content_upload_ki_calls_answer_check
    check (answer_excerpt is null or char_length(answer_excerpt) <= 500)
);

create index if not exists content_upload_ki_calls_run_idx
  on public.content_upload_ki_calls (run_id);
create index if not exists content_upload_ki_calls_file_idx
  on public.content_upload_ki_calls (file_id);

-- 6. Log of dry runs and applies ---------------------------------------------------

create table if not exists public.content_upload_applies (
  id uuid not null default gen_random_uuid(),
  run_id uuid not null,
  mode text not null,
  started_by_id uuid not null,
  decisions_version integer not null,
  decisions_hash text not null,
  update_existing boolean not null default false,
  status text not null default 'running',
  target_schema text not null,
  counts jsonb not null default '{}'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint content_upload_applies_pkey primary key (id),
  constraint content_upload_applies_run_id_fk
    foreign key (run_id)
    references public.content_upload_runs (id)
    on delete restrict,
  constraint content_upload_applies_started_by_id_fk
    foreign key (started_by_id)
    references public.profiles (id)
    on delete restrict,
  constraint content_upload_applies_mode_check
    check (mode in ('dry_run', 'apply')),
  constraint content_upload_applies_decisions_version_check
    check (decisions_version >= 0),
  constraint content_upload_applies_decisions_hash_check
    check (char_length(decisions_hash) between 1 and 128),
  constraint content_upload_applies_status_check
    check (status in ('running', 'ok', 'conflict', 'failed')),
  -- the two allowed schema names as one pattern: the Preview rewrite rejects a
  -- literal 'public' and every mention of the Preview schema in a migration
  constraint content_upload_applies_target_schema_check
    check (target_schema ~ '^public(_preview)?$'),
  constraint content_upload_applies_counts_check
    check (jsonb_typeof(counts) = 'object'),
  constraint content_upload_applies_conflicts_check
    check (jsonb_typeof(conflicts) = 'array')
);

create index if not exists content_upload_applies_run_idx
  on public.content_upload_applies (run_id, started_at desc);
-- a run has at most one dry run or apply in progress
create unique index if not exists content_upload_applies_running_uidx
  on public.content_upload_applies (run_id)
  where status = 'running';

-- 7. Rows written by an apply (basis of the rollback SQL) --------------------------
-- row_id has no foreign key: it points at a row of one of the content tables. The
-- list of table names is the write surface of src/lib/content-import/apply/tables.ts.

create table if not exists public.content_upload_applied_rows (
  id uuid not null default gen_random_uuid(),
  apply_id uuid not null,
  table_name text not null,
  row_id uuid not null,
  action text not null,
  before jsonb,
  file_id uuid,
  constraint content_upload_applied_rows_pkey primary key (id),
  constraint content_upload_applied_rows_apply_id_fk
    foreign key (apply_id)
    references public.content_upload_applies (id)
    on delete cascade,
  constraint content_upload_applied_rows_file_id_fk
    foreign key (file_id)
    references public.content_upload_files (id)
    on delete set null,
  constraint content_upload_applied_rows_row_key
    unique (apply_id, table_name, row_id),
  -- table_name::text and not table_name: the new-migration check of the Preview
  -- rewrite reads "table_name in (...)" as a lookup in information_schema
  constraint content_upload_applied_rows_table_name_check
    check (table_name::text in ('training_components', 'courses', 'enablers', 'quizzes', 'questions', 'options', 'enabler_quiz_links', 'content_documents', 'use_cases', 'training_catalog_learning_fields', 'training_catalog_content_mappings')),
  constraint content_upload_applied_rows_action_check
    check (action in ('insert', 'update')),
  -- the values before the write exist exactly for an update
  constraint content_upload_applied_rows_before_check
    check ((action = 'insert' and before is null) or (action = 'update' and before is not null))
);

-- Which later apply touched the same row (the rollback may only run in reverse order)
create index if not exists content_upload_applied_rows_table_row_idx
  on public.content_upload_applied_rows (table_name, row_id);

-- 8. Closed for the API roles --------------------------------------------------------

alter table public.content_upload_runs enable row level security;
alter table public.content_upload_files enable row level security;
alter table public.content_upload_proposals enable row level security;
alter table public.content_upload_decisions enable row level security;
alter table public.content_upload_ki_calls enable row level security;
alter table public.content_upload_applies enable row level security;
alter table public.content_upload_applied_rows enable row level security;

-- Every privilege of anon and authenticated is revoked, only for roles that exist
-- (the file also runs on plain PostgreSQL). No policy is created.
do $$
declare
  upload_table text;
  api_role text;
begin
  foreach upload_table in array array[
    'content_upload_runs',
    'content_upload_files',
    'content_upload_proposals',
    'content_upload_decisions',
    'content_upload_ki_calls',
    'content_upload_applies',
    'content_upload_applied_rows'
  ] loop
    foreach api_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = api_role) then
        execute format(
          'revoke all on public.%I from %I',
          upload_table,
          api_role
        );
      end if;
    end loop;
  end loop;
end $$;

-- Fail closed: stop the file if an API role still holds a privilege on one of the
-- tables (for example through a default privilege of a role this file cannot change).
do $$
declare
  upload_table text;
  api_role text;
begin
  foreach upload_table in array array[
    'content_upload_runs',
    'content_upload_files',
    'content_upload_proposals',
    'content_upload_decisions',
    'content_upload_ki_calls',
    'content_upload_applies',
    'content_upload_applied_rows'
  ] loop
    foreach api_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = api_role)
         and (
           has_table_privilege(
             api_role,
             format('public.%I', upload_table),
             'select, insert, update, delete, truncate, references, trigger'
           )
           or has_any_column_privilege(
             api_role,
             format('public.%I', upload_table),
             'select, insert, update, references'
           )
         ) then
        raise exception 'content upload: % still holds a privilege on public.%', api_role, upload_table;
      end if;
    end loop;
  end loop;
end $$;

comment on table public.content_upload_runs is
  'One run of the content upload per occupation (catalog). Server only: RLS on, no policy, no grant for anon and authenticated.';
comment on table public.content_upload_files is
  'Announced files of a run, also the processing queue (status, locked_until, attempts, claim_id). Server only.';
comment on table public.content_upload_proposals is
  'Proposals of the rules or of the model per file. History, one current row per file. Server only.';
comment on table public.content_upload_decisions is
  'Decisions of the reviewers per file. History, one current row per file. Server only.';
comment on table public.content_upload_ki_calls is
  'Log of each transmission of an excerpt to Sokrates. No key, no header, no file name, no file content. Server only.';
comment on table public.content_upload_applies is
  'Log of each dry run and apply of a run. Server only.';
comment on table public.content_upload_applied_rows is
  'Rows of the content tables written by an apply, with the values before an update. Basis of the rollback SQL. Server only.';
comment on column public.content_upload_files.rel_path is
  'Relative path as announced by the browser, cleaned. Display and path rule only, never a storage path.';
comment on column public.content_upload_ki_calls.excerpt is
  'Exact text that was sent. Set to NULL after 30 days, excerpt_chars and excerpt_sha256 stay.';
comment on column public.content_upload_applied_rows.row_id is
  'Id of a row in table_name. No foreign key, the table varies.';
