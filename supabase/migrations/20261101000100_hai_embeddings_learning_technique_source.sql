-- HAI index, package B: allow the source type 'learning_technique'.
--
-- Why: the learning technique cards (content/hai/learning-techniques, PR 179) are written into
-- hai_embeddings as platform knowledge without an occupation (source_type 'learning_technique',
-- training_catalog_id and organization_id empty). The check constraint
-- hai_embeddings_source_type_check, which comes from the base schema and is in no migration
-- file, lists only eight values, so every insert of a card fails with a check violation. The
-- cards were released on 01.11.2026 and the first write into the Preview index failed on exactly
-- this constraint.
--
-- What: the constraint is replaced by the same list plus 'learning_technique'. No row changes,
-- every existing row passes. The BEFORE trigger hai_embeddings_set_scope stays as it is: for a
-- card the catalog and organization functions return nothing and the visibility stays 'all'.
-- The search finds a card only through the platform rule of buildScopeCondition
-- (src/lib/hai/vectorSearch.ts: source_type = 'learning_technique' and no occupation and no
-- organization), so this opens no content of any occupation.
--
-- Rollback (only if no card row exists, otherwise delete the rows first):
--   delete from public.hai_embeddings where source_type = 'learning_technique';
--   alter table public.hai_embeddings drop constraint hai_embeddings_source_type_check;
--   alter table public.hai_embeddings add constraint hai_embeddings_source_type_check
--     check (source_type = any (array['enabler','course','document','quiz','use_case',
--       'trainee_profile','trainee_schedule','trainee_progress']));

-- migration:destructive-ok (drops and recreates a check constraint, no data is touched)
alter table public.hai_embeddings
  drop constraint if exists hai_embeddings_source_type_check;

alter table public.hai_embeddings
  add constraint hai_embeddings_source_type_check
  check (
    source_type = any (
      array[
        'enabler',
        'course',
        'document',
        'quiz',
        'use_case',
        'trainee_profile',
        'trainee_schedule',
        'trainee_progress',
        'learning_technique'
      ]
    )
  );
