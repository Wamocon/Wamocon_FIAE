-- Package 2.4 (part 1): bind quizzes to a training catalog and a component.
--
-- Global quizzes (quiz_type = 'GLOBAL') are separated per occupation:
--   training_catalog_id   NOT NULL, default FIAE (constant default, existing
--                         quizzes read as FIAE without any UPDATE)
--   training_component_id nullable, the training component a global quiz
--                         belongs to (KfBM: one global quiz per component)
-- The composite foreign key (training_component_id, training_catalog_id)
-- makes it impossible to bind a quiz to a component of another catalog.
-- The component key is RESTRICT: a component with quizzes cannot be deleted.
-- At most one global quiz per component (partial unique index).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_components_id_catalog_unique'
      and conrelid = 'public.training_components'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    raise exception
      'Run the files 20261024000100 to 20261024000400 first (training_components_id_catalog_unique is missing).';
  end if;
end $$;

-- Constant default: no table rewrite, no UPDATE of existing quizzes.
alter table public.quizzes
  add column if not exists training_catalog_id uuid not null
    default '00000000-0000-4000-8000-000000000001';

alter table public.quizzes
  add column if not exists training_component_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quizzes_training_catalog_id_training_catalogs_id_fk'
      and conrelid = 'public.quizzes'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.quizzes
      add constraint quizzes_training_catalog_id_training_catalogs_id_fk
      foreign key (training_catalog_id)
      references public.training_catalogs (id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'quizzes_component_catalog_fk'
      and conrelid = 'public.quizzes'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.quizzes
      add constraint quizzes_component_catalog_fk
      foreign key (training_component_id, training_catalog_id)
      references public.training_components (id, training_catalog_id)
      on delete restrict;
  end if;
end $$;

create index if not exists quizzes_training_catalog_id_idx
  on public.quizzes (training_catalog_id);

create unique index if not exists quizzes_global_component_unique
  on public.quizzes (training_component_id)
  where quiz_type = 'GLOBAL' and training_component_id is not null;

comment on column public.quizzes.training_catalog_id is
  'Training catalog (occupation) the quiz belongs to. Existing quizzes are FIAE.';
comment on column public.quizzes.training_component_id is
  'Training component of a global quiz (one global quiz per component). NULL for legacy and lesson quizzes.';
