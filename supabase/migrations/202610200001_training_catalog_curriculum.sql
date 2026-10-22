-- Add an occupation-specific training catalog without changing existing
-- course, content, or training-use-case records.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.courses') is null
     or to_regclass('public.training_components') is null
     or to_regclass('public.enablers') is null
     or to_regclass('public.use_cases') is null then
    raise exception
      'Required curriculum tables are missing; stop and verify the target schema before applying this migration.';
  end if;

  if to_regprocedure('public.is_platform_owner()') is null then
    raise exception
      'Required RLS helper public.is_platform_owner() is missing.';
  end if;
end $$;

create table public.training_catalogs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text,
  duration_years integer not null default 3
    check (duration_years > 0),
  is_active boolean not null default false,
  created_at timestamp not null default now(),
  updated_at timestamp default now()
);

insert into public.training_catalogs (id, code, title, is_active)
values
  (
    '00000000-0000-4000-8000-000000000001',
    'FIAE',
    'Fachinformatiker/in Anwendungsentwicklung',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'KFBM',
    'Kaufmann/-frau für Büromanagement',
    false
  );

alter table public.courses
  add column training_catalog_id uuid;

update public.courses
set training_catalog_id = '00000000-0000-4000-8000-000000000001'
where training_catalog_id is null;

alter table public.courses
  alter column training_catalog_id
    set default '00000000-0000-4000-8000-000000000001',
  alter column training_catalog_id set not null,
  add constraint courses_training_catalog_id_training_catalogs_id_fk
    foreign key (training_catalog_id)
    references public.training_catalogs (id)
    on delete restrict;

create index courses_training_catalog_id_idx
  on public.courses (training_catalog_id);

alter table public.training_components
  add column training_catalog_id uuid;

update public.training_components
set training_catalog_id = '00000000-0000-4000-8000-000000000001'
where training_catalog_id is null;

alter table public.training_components
  alter column training_catalog_id
    set default '00000000-0000-4000-8000-000000000001',
  alter column training_catalog_id set not null,
  add constraint training_components_training_catalog_id_training_catalogs_id_fk
    foreign key (training_catalog_id)
    references public.training_catalogs (id)
    on delete restrict;

alter table public.training_components
  drop constraint training_components_code_unique,
  add constraint training_components_catalog_code_unique
    unique (training_catalog_id, code);

create index training_components_training_catalog_id_idx
  on public.training_components (training_catalog_id);

create table public.training_catalog_learning_fields (
  id uuid primary key default gen_random_uuid(),
  training_catalog_id uuid not null
    references public.training_catalogs (id) on delete cascade,
  code text not null,
  title text not null,
  description text,
  training_year integer not null
    check (training_year between 1 and 3),
  hours_budget integer
    check (hours_budget is null or hours_budget >= 0),
  order_index integer not null,
  created_at timestamp not null default now(),
  updated_at timestamp default now(),
  constraint training_catalog_learning_fields_catalog_code_unique
    unique (training_catalog_id, code),
  constraint training_catalog_learning_fields_catalog_order_unique
    unique (training_catalog_id, order_index)
);

create table public.training_catalog_content_mappings (
  id uuid primary key default gen_random_uuid(),
  learning_field_id uuid not null
    references public.training_catalog_learning_fields (id) on delete cascade,
  enabler_id uuid
    references public.enablers (id) on delete cascade,
  use_case_id uuid
    references public.use_cases (id) on delete cascade,
  created_at timestamp not null default now(),
  constraint training_catalog_content_mappings_exactly_one_content_check
    check ((enabler_id is not null) <> (use_case_id is not null)),
  constraint training_catalog_content_mappings_learning_field_enabler_unique
    unique (learning_field_id, enabler_id),
  constraint training_catalog_content_mappings_learning_field_use_case_unique
    unique (learning_field_id, use_case_id)
);

create index training_catalog_content_mappings_enabler_id_idx
  on public.training_catalog_content_mappings (enabler_id);

create index training_catalog_content_mappings_use_case_id_idx
  on public.training_catalog_content_mappings (use_case_id);

alter table public.training_catalogs enable row level security;
create policy training_catalogs_select_all
  on public.training_catalogs for select using (true);
create policy training_catalogs_manage_platform_owner
  on public.training_catalogs for all using (public.is_platform_owner());

alter table public.training_catalog_learning_fields enable row level security;
create policy training_catalog_learning_fields_select_all
  on public.training_catalog_learning_fields for select using (true);
create policy training_catalog_learning_fields_manage_platform_owner
  on public.training_catalog_learning_fields
  for all using (public.is_platform_owner());

alter table public.training_catalog_content_mappings enable row level security;
create policy training_catalog_content_mappings_select_all
  on public.training_catalog_content_mappings for select using (true);
create policy training_catalog_content_mappings_manage_platform_owner
  on public.training_catalog_content_mappings
  for all using (public.is_platform_owner());

comment on table public.training_catalogs is
  'Occupation-specific training catalog; existing FIAE courses and training components remain assigned to FIAE.';
comment on table public.training_catalog_learning_fields is
  'Learning fields owned by a training catalog, independent of other occupations using the same codes.';
comment on table public.training_catalog_content_mappings is
  'Links one catalog learning field to one enabler or use case.';

commit;
