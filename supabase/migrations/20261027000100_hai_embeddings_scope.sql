-- HAI index scope: occupation, visibility and organization on hai_embeddings.
--
-- Why: the vector index of the AI coach (hai_embeddings) had no notion of the
-- occupation (training catalog), of who may see a chunk, or of the owning
-- organization. Every search was global: a trainee of one occupation could get
-- chunks of another occupation, and trainer solutions (use case solution PDFs,
-- quiz answers and expected answers) were part of the index that trainees
-- search. The search now filters in SQL (before LIMIT) by these columns, see
-- src/lib/hai/vectorSearch.ts.
--
-- New columns on public.hai_embeddings:
--   training_catalog_id  uuid, NULL until derived. Foreign key to
--                        training_catalogs. The search matches only rows whose
--                        catalog is in the caller's scope, so a NULL row is
--                        visible to nobody (fail closed).
--   visibility           text not null default 'all', check in ('all','trainer').
--                        'trainer' = never shown to trainees, not in the prompt
--                        and not in citations.
--   organization_id      uuid, NULL = platform content visible to every
--                        organization. Foreign key to organizations,
--                        ON DELETE CASCADE (a deviation from "set null": the
--                        documents of an organization are deleted with it, and
--                        set null would turn its orphaned chunks into content
--                        that every organization can see).
-- and the index idx_hai_embeddings_scope on (training_catalog_id, visibility).
--
-- Derivation (pure SQL, no model call, nothing is embedded again). The helper
-- functions below are used by the backfill in this file and by a BEFORE trigger
-- on hai_embeddings, so rows written later by the existing writers (embeddings.ts,
-- ingestUseCase.ts, scripts/reindex-gemini.ts, which do not set the new columns
-- yet) get the same values. The trigger only fills NULL columns and only raises
-- the visibility to 'trainer', never lowers it.
--
--   catalog       by source_id, whatever the source_type says (the writers store
--                 learning fields as 'enabler' or 'document'): enablers, courses,
--                 use_cases, quizzes (their own training_catalog_id), documents
--                 (content_documents through enabler, use case or course),
--                 learning fields (training_catalog_learning_fields), training
--                 components (training_components). Personal rows (trainee_*,
--                 source_id = trainee id): the catalog of the enrollment of the
--                 trainee (latest start), otherwise FIAE.
--   organization  content_documents.organization_id of the document the row
--                 belongs to (source_id or metadata.documentId), otherwise NULL.
--   visibility    'trainer' for metadata.documentType TRAINER_SOLUTION, for rows
--                 of a document whose content_documents row is TRAINER_SOLUTION or
--                 visibility TRAINER_ONLY, and for EVERY quiz chunk. The writers
--                 (reindex-gemini.ts and api/hai/embed/route.ts) put questions,
--                 the options with their check mark or cross (U+2713, U+2717), the
--                 explanations ("Erklaerung:") and the expected answers
--                 ("Erwartete Antwort:") into the same text and split it into
--                 chunks by size, so a continuation chunk can hold the tail of an
--                 answer without any marker. Detecting answers per chunk by
--                 marker would leak such tails, therefore the whole quiz is
--                 'trainer' until the writers produce separate chunks for the
--                 questions (follow-up package H2).
--                 The trigger on content_documents (below) raises the visibility
--                 and follows the organization when a document is changed later.
--
-- Rows whose catalog cannot be derived (source deleted, unknown source): at the
-- time of this migration only FIAE content exists, so they are assigned to FIAE.
-- The file reports the number per source_type with RAISE NOTICE and never aborts
-- because of them. Enabler chunks stay 'all' on purpose: the hint of a scenario
-- (enablers.hint_text) is part of the enabler chunk written by reindex-gemini.ts
-- and cannot be separated here, see the pull request.
--
-- Sorting: the file sorts behind the catalog series (20261024*), so the rollout
-- gate (scripts/db/rollout-gate.mjs, from 20261024000100) holds it back in
-- Production until the owner approves the rollout. Production is not migrated by
-- this change.
--
-- Cost and locks: ALTER TABLE adds three columns (the default of visibility is a
-- constant, so no table rewrite) and two foreign keys; lock_timeout 5s makes the
-- file fail fast instead of queueing behind a long query. The ALTER TABLE lock
-- (ACCESS EXCLUSIVE on hai_embeddings, SHARE ROW EXCLUSIVE on organizations and
-- training_catalogs) is held until the file commits, that is during the backfill
-- as well: run it in a maintenance window (the rollout is an owner run with a
-- backup anyway). One UPDATE touches every row that needs a value once, under the
-- statement_timeout. The indexes are built after the UPDATE without CONCURRENTLY
-- (it cannot run in a transaction block, and every file of the series runs in
-- one). The UPDATE also sets updated_at (existing trigger hai_embeddings_updated_at).
--
-- No extension, role or policy is touched. The helper functions are SECURITY
-- DEFINER with an empty search_path and without EXECUTE for PUBLIC, anon and
-- authenticated. Safe to run twice (if not exists, create or replace, updates
-- only where a value is missing).
--
-- Undo (only if something breaks; drops the new columns and their data):
--   drop trigger if exists content_documents_follow_hai_scope on public.content_documents;
--   drop function if exists public.hai_embeddings_follow_document();
--   drop trigger if exists hai_embeddings_set_scope on public.hai_embeddings;
--   drop function if exists public.hai_embeddings_set_scope();
--   drop function if exists public.hai_embedding_visibility(text, uuid, text, jsonb);
--   drop function if exists public.hai_embedding_organization(uuid, jsonb);
--   drop function if exists public.hai_embedding_catalog(text, uuid, jsonb);
--   drop index if exists public.idx_hai_embeddings_scope;
--   drop index if exists public.idx_hai_embeddings_organization;
--   alter table public.hai_embeddings
--     drop column if exists organization_id,
--     drop column if exists visibility,
--     drop column if exists training_catalog_id;
-- The application code of this change needs the columns: undo it only together
-- with the code (without the columns every search returns nothing and logs an
-- error).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.hai_embeddings') is null then
    raise exception
      'The table public.hai_embeddings is missing. Nothing was changed.';
  end if;
  if to_regclass('public.training_catalogs') is null
     or to_regclass('public.training_catalog_learning_fields') is null
     or to_regclass('public.trainee_enrollments') is null then
    raise exception
      'Run the catalog series first (20261024000100 to 20261026000100): training_catalogs, training_catalog_learning_fields or trainee_enrollments is missing. Nothing was changed.';
  end if;
  if not exists (
    select 1 from public.training_catalogs
    where id = '00000000-0000-4000-8000-000000000001'
  ) then
    raise exception
      'The FIAE catalog (00000000-0000-4000-8000-000000000001) is missing in training_catalogs. Nothing was changed.';
  end if;
end $$;

-- 1. Columns ------------------------------------------------------------------

alter table public.hai_embeddings
  add column if not exists training_catalog_id uuid
    constraint hai_embeddings_training_catalog_fk
    references public.training_catalogs (id) on delete restrict,
  add column if not exists visibility text not null default 'all'
    constraint hai_embeddings_visibility_check
    check (visibility in ('all', 'trainer')),
  add column if not exists organization_id uuid
    constraint hai_embeddings_organization_fk
    references public.organizations (id) on delete cascade;

comment on column public.hai_embeddings.training_catalog_id is
  'Occupation (training catalog) of the chunk. NULL = not derived yet, visible to nobody (the search filters by catalog).';
comment on column public.hai_embeddings.visibility is
  'all = may be shown to trainees, trainer = trainer level only (solutions, quiz answers).';
comment on column public.hai_embeddings.organization_id is
  'Owning organization (content_documents.organization_id). NULL = platform content for every organization.';

-- 2. Derivation functions -----------------------------------------------------

create or replace function public.hai_embedding_catalog(
  p_source_type text,
  p_source_id uuid,
  p_metadata jsonb
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.training_catalog_id from public.enablers e where e.id = p_source_id),
    (select c.training_catalog_id from public.courses c where c.id = p_source_id),
    (select u.training_catalog_id from public.use_cases u where u.id = p_source_id),
    (select q.training_catalog_id from public.quizzes q where q.id = p_source_id),
    (
      select coalesce(de.training_catalog_id, du.training_catalog_id, dc.training_catalog_id)
      from public.content_documents d
      left join public.enablers de on de.id = d.enabler_id
      left join public.use_cases du on du.id = d.use_case_id
      left join public.courses dc on dc.id = d.course_id
      where d.id = p_source_id
         or d.id = case when p_metadata ->> 'documentId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        then (p_metadata ->> 'documentId')::uuid end
      limit 1
    ),
    (select lf.training_catalog_id from public.training_catalog_learning_fields lf where lf.id = p_source_id),
    (select tc.training_catalog_id from public.training_components tc where tc.id = p_source_id),
    case
      when p_source_type like 'trainee\_%' then coalesce(
        (
          select te.training_catalog_id
          from public.trainee_enrollments te
          where te.trainee_id = p_source_id
          order by te.start_date desc nulls last
          limit 1
        ),
        '00000000-0000-4000-8000-000000000001'::uuid
      )
    end
  );
$$;

create or replace function public.hai_embedding_organization(
  p_source_id uuid,
  p_metadata jsonb
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.organization_id
  from public.content_documents d
  where d.id = p_source_id
     or d.id = case when p_metadata ->> 'documentId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    then (p_metadata ->> 'documentId')::uuid end
  limit 1;
$$;

create or replace function public.hai_embedding_visibility(
  p_source_type text,
  p_source_id uuid,
  p_content text,
  p_metadata jsonb
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_metadata ->> 'documentType' = 'TRAINER_SOLUTION' then 'trainer'
    when exists (
      select 1
      from public.content_documents d
      where (
              d.id = p_source_id
              or d.id = case when p_metadata ->> 'documentId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                             then (p_metadata ->> 'documentId')::uuid end
            )
        and (d.document_type = 'TRAINER_SOLUTION' or d.visibility = 'TRAINER_ONLY')
    ) then 'trainer'
    -- the whole quiz: questions and answers are mixed in the chunks (see header);
    -- p_content stays in the signature for the follow-up package H2
    when p_source_type = 'quiz' then 'trainer'
    else 'all'
  end;
$$;

create or replace function public.hai_embeddings_set_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.training_catalog_id is null then
    new.training_catalog_id := public.hai_embedding_catalog(new.source_type, new.source_id, new.metadata);
  end if;
  if new.organization_id is null then
    new.organization_id := public.hai_embedding_organization(new.source_id, new.metadata);
  end if;
  if new.visibility is distinct from 'trainer'
     and public.hai_embedding_visibility(new.source_type, new.source_id, new.content, new.metadata) = 'trainer' then
    new.visibility := 'trainer';
  end if;
  return new;
end;
$$;

drop trigger if exists hai_embeddings_set_scope on public.hai_embeddings;
create trigger hai_embeddings_set_scope
  before insert or update of source_type, source_id, content, metadata
  on public.hai_embeddings
  for each row
  execute function public.hai_embeddings_set_scope();

-- A document that becomes a trainer solution or trainer-only later, or changes the
-- organization, must take its chunks along: the chunk writers skip unchanged text,
-- so no upsert would run the trigger above. Visibility only goes up here.
create or replace function public.hai_embeddings_follow_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.document_type = 'TRAINER_SOLUTION' or new.visibility = 'TRAINER_ONLY' then
    update public.hai_embeddings h
    set visibility = 'trainer'
    where h.visibility <> 'trainer'
      and (h.source_id = new.id or h.metadata ->> 'documentId' = new.id::text);
  end if;
  if new.organization_id is distinct from old.organization_id then
    update public.hai_embeddings h
    set organization_id = new.organization_id
    where h.source_id = new.id or h.metadata ->> 'documentId' = new.id::text;
  end if;
  return null;
end;
$$;

drop trigger if exists content_documents_follow_hai_scope on public.content_documents;
create trigger content_documents_follow_hai_scope
  after update of document_type, visibility, organization_id
  on public.content_documents
  for each row
  execute function public.hai_embeddings_follow_document();

-- The functions are called by the triggers (no EXECUTE needed) and by this file
-- (as the owner). Nobody else needs them, least of all the API roles.
do $$
declare
  fn text;
  role_name text;
begin
  foreach fn in array array[
      'public.hai_embedding_catalog(text, uuid, jsonb)',
      'public.hai_embedding_organization(uuid, jsonb)',
      'public.hai_embedding_visibility(text, uuid, text, jsonb)',
      'public.hai_embeddings_set_scope()',
      'public.hai_embeddings_follow_document()'
  ] loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('revoke execute on function %s from %I', fn, role_name);
      end if;
    end loop;
  end loop;
end $$;

-- 3. Backfill (one UPDATE; only rows that still need a value) -----------------

update public.hai_embeddings h
set training_catalog_id = coalesce(
      h.training_catalog_id,
      public.hai_embedding_catalog(h.source_type, h.source_id, h.metadata)
    ),
    organization_id = coalesce(
      h.organization_id,
      public.hai_embedding_organization(h.source_id, h.metadata)
    ),
    visibility = case
      when public.hai_embedding_visibility(
             h.source_type, h.source_id, h.content, h.metadata
           ) = 'trainer' then 'trainer'
      else h.visibility
    end
where h.training_catalog_id is null
   or (h.organization_id is null
       and public.hai_embedding_organization(h.source_id, h.metadata) is not null)
   or (h.visibility <> 'trainer'
       and public.hai_embedding_visibility(
             h.source_type, h.source_id, h.content, h.metadata
           ) = 'trainer');

create index if not exists idx_hai_embeddings_scope
  on public.hai_embeddings (training_catalog_id, visibility);

-- the foreign key to organizations (delete of an organization cascades here)
create index if not exists idx_hai_embeddings_organization
  on public.hai_embeddings (organization_id)
  where organization_id is not null;

-- Rows whose catalog cannot be derived: only FIAE content exists today. Report
-- the number per source_type, never abort.
do $$
declare
  r record;
  fallback_total integer := 0;
begin
  for r in
    select h.source_type, count(*) as n
    from public.hai_embeddings h
    where h.training_catalog_id is null
    group by h.source_type
    order by h.source_type
  loop
    raise notice
      'hai_embeddings scope: % row(s) of source_type % have no derivable catalog and are assigned to FIAE.',
      r.n, r.source_type;
    fallback_total := fallback_total + r.n;
  end loop;

  update public.hai_embeddings
  set training_catalog_id = '00000000-0000-4000-8000-000000000001'
  where training_catalog_id is null;

  raise notice
    'hai_embeddings scope: % row(s) assigned to FIAE without a derivable source.', fallback_total;

  for r in
    select h.source_type, h.visibility, count(*) as n
    from public.hai_embeddings h
    group by h.source_type, h.visibility
    order by h.source_type, h.visibility
  loop
    raise notice
      'hai_embeddings scope: source_type % visibility %: % row(s).',
      r.source_type, r.visibility, r.n;
  end loop;
end $$;
