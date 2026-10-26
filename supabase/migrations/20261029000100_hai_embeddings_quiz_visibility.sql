-- HAI index scope, package H2: the trigger lifts only quiz chunks with answer
-- content, not every quiz chunk any more.
--
-- Why: 20261027000100 put EVERY quiz chunk on 'trainer', because the writers
-- (scripts/reindex-gemini.ts and api/hai/embed/route.ts) wrote questions, the
-- options with their check mark or cross, the explanations and the expected
-- answers into one text and split it by size: a continuation chunk could hold
-- the tail of an answer without any marker. From this release on the writers
-- split a quiz BEFORE they chunk by size (src/lib/hai/quizIndexText.ts) and
-- write two parts of chunks:
--   questions  metadata.contentPart = 'questions', visibility 'all'. The text
--              holds the questions and the option texts, no marker of a correct
--              option, no explanation, no expected answer.
--   answers    metadata.contentPart = 'answers', visibility 'trainer', written
--              into its own block of chunk indexes (10000 and up).
-- The writers set the visibility themselves (src/lib/hai/indexScope.ts). This
-- file adapts the safety net in the database: the function
-- hai_embedding_visibility (used by the BEFORE trigger on hai_embeddings and by
-- the backfill of 20261027000100) keeps a quiz chunk on 'trainer' unless it is
-- a declared questions chunk WITHOUT any answer marker (U+2713, U+2717,
-- "Erklaerung:", "Erwartete Antwort:"). Everything else stays fail closed:
--   - a quiz chunk without metadata.contentPart (every chunk that exists today,
--     and any writer that does not know the split) is 'trainer'
--   - an answers chunk is 'trainer', also its continuation chunks (they carry
--     contentPart = 'answers' and no marker)
--   - a questions chunk that contains a marker is 'trainer'
-- The other rules of the function are unchanged (trainer solutions, trainer-only
-- documents).
--
-- The trigger now also runs when a writer updates visibility, training_catalog_id
-- or organization_id of a row (before: only source_type, source_id, content and
-- metadata). The safety net therefore holds for the "rescope" update of the
-- writers (same text, other scope, no new embedding) as well: a NULL column is
-- derived again and the visibility is never below what the rules demand. The
-- trigger still only fills NULL columns and only raises the visibility.
--
-- Existing quiz chunks: they stay 'trainer' until the quiz is indexed again.
-- Nothing is backfilled here and nothing is lowered: the old mixed chunks keep
-- their text and cannot be separated afterwards. A reindex of the quizzes writes
-- the two parts (and removes the old mixed chunks as stale chunks).
--
-- Cost and locks: one CREATE OR REPLACE FUNCTION (the grants of the function
-- stay), one DROP and CREATE of the trigger (SHARE ROW EXCLUSIVE on
-- hai_embeddings for a moment, lock_timeout 5s fails fast). No data is read or
-- changed, no extension, role or policy is touched. Safe to run twice.
--
-- Sorting: behind 20261027000100, so the rollout gate (scripts/db/rollout-gate.mjs)
-- holds it back in Production together with the series. Production is not
-- migrated by this change.
--
-- Undo (only if something breaks; restores the rule of 20261027000100: every
-- quiz chunk is trainer only):
--   create or replace function public.hai_embedding_visibility(
--     p_source_type text, p_source_id uuid, p_content text, p_metadata jsonb)
--   returns text language sql stable security definer set search_path = ''
--   as $f$ <body of 20261027000100 with: when p_source_type = 'quiz' then 'trainer'> $f$;
--   drop trigger if exists hai_embeddings_set_scope on public.hai_embeddings;
--   create trigger hai_embeddings_set_scope
--     before insert or update of source_type, source_id, content, metadata
--     on public.hai_embeddings for each row
--     execute function public.hai_embeddings_set_scope();

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.hai_embeddings') is null
     or to_regprocedure('public.hai_embedding_visibility(text, uuid, text, jsonb)') is null
     or to_regprocedure('public.hai_embeddings_set_scope()') is null then
    raise exception
      'Run 20261027000100_hai_embeddings_scope.sql first (hai_embeddings or its scope functions are missing). Nothing was changed.';
  end if;
end $$;

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
    -- quiz: only a declared questions chunk without any answer marker may be
    -- 'all' (coalesce: a missing contentPart must not turn the test into NULL,
    -- NULL would fall through to 'all'). The markers are the check mark
    -- (U+2713), the cross (U+2717), the explanation and the expected answer.
    when p_source_type = 'quiz' and not (
      coalesce(p_metadata ->> 'contentPart', '') = 'questions'
      and coalesce(p_content, '') !~ (
        '[' || chr(10003) || chr(10007) || ']|Erkl.rung:|Erwartete Antwort:'
      )
    ) then 'trainer'
    else 'all'
  end;
$$;

drop trigger if exists hai_embeddings_set_scope on public.hai_embeddings;
create trigger hai_embeddings_set_scope
  before insert or update of source_type, source_id, content, metadata,
    visibility, training_catalog_id, organization_id
  on public.hai_embeddings
  for each row
  execute function public.hai_embeddings_set_scope();
