-- Package 2.3: one learning field model.
--
-- Target model: public.training_catalog_learning_fields and
-- public.training_catalog_content_mappings. The legacy tables public.lernfelder
-- and public.lernfeld_mappings are migrated into them and then replaced by
-- compatible views of the same name, so existing routes and scripts keep
-- working without code changes.
--
-- Legacy shape (drizzle 0026): lernfelder(id, title, description, label,
-- created_at, updated_at). It has no code, year or order. Mapping rules:
--   code        = trimmed label, for example 'LF-1' (blank labels become
--                 'LF-<first 8 id characters>'; repeated labels get ' #2',
--                 ' #3', ... in created_at order)
--   training_year (NOT NULL in the target) is derived from the number in the
--                 label with the year assignment of scripts/seed-lernfelder.ts
--                 (LERNFELDER_DATA): LF1 to LF5 = year 1, LF6 to LF9 and LF10a
--                 = year 2, LF11a and LF12a = year 3. Generalised to numbers:
--                 1 to 5 = 1, 6 to 10 = 2, 11 and above = 3. Labels without a
--                 number default to year 1 and are reported by a NOTICE.
--   order_index = position by label number, then label, created_at, id
--   hours_budget stays NULL (the legacy table has no hours)
--   id and created_at are kept, so ids stay valid for links and notes.
-- Mapping rows move to training_catalog_content_mappings. A legacy row that
-- links an enabler and a use case at once becomes two rows. Rows without a
-- content link or with an unknown learning field cannot be represented and stay
-- in the legacy backup table (reported by a NOTICE).
--
-- Behaviour changes (intended): a repeated label is rejected by the unique
-- (training_catalog_id, code) key; deleting an enabler or use case now
-- removes its mapping rows (ON DELETE CASCADE) instead of nulling the link.
--
-- The legacy tables are renamed to lernfelder_legacy and
-- lernfeld_mappings_legacy (kept for rollback, drop them in a later cleanup).
-- The text array columns courses.lernfelder and use_cases.lernfelder are NOT
-- migrated (follow-up work).
--
-- Requires PostgreSQL 15 (security_invoker views), checked in the first file.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  lf_kind "char";
  map_kind "char";
begin
  select c.relkind into lf_kind
  from pg_class c
  where c.oid = to_regclass('public.lernfelder');
  select c.relkind into map_kind
  from pg_class c
  where c.oid = to_regclass('public.lernfeld_mappings');

  if lf_kind is null or map_kind is null then
    raise exception
      'public.lernfelder or public.lernfeld_mappings is missing; stop and verify the target schema.';
  end if;

  if lf_kind = 'v' or map_kind = 'v' then
    raise exception
      'public.lernfelder or public.lernfeld_mappings is already a view; this migration was already applied.';
  end if;

  if lf_kind <> 'r' or map_kind <> 'r' then
    raise exception
      'public.lernfelder and public.lernfeld_mappings must be ordinary tables.';
  end if;

  if exists (
    select 1 from pg_attribute a
    where a.attrelid = to_regclass('public.lernfelder')
      and a.attname = 'code'
      and not a.attisdropped
  ) then
    raise exception
      'public.lernfelder still has the old seed shape (column code). Apply the drizzle migration 0026_add_lernfelder_table first.';
  end if;

  if (
    select count(*) from pg_attribute a
    where a.attrelid = to_regclass('public.lernfelder')
      and a.attname in ('id', 'title', 'description', 'label', 'created_at', 'updated_at')
      and not a.attisdropped
  ) <> 6 then
    raise exception
      'public.lernfelder does not have the expected columns (id, title, description, label, created_at, updated_at).';
  end if;

  if (
    select count(*) from pg_attribute a
    where a.attrelid = to_regclass('public.lernfeld_mappings')
      and a.attname in ('id', 'lernfeld_id', 'enabler_id', 'use_case_id', 'created_at')
      and not a.attisdropped
  ) <> 5 then
    raise exception
      'public.lernfeld_mappings does not have the expected columns (id, lernfeld_id, enabler_id, use_case_id, created_at).';
  end if;

  if not exists (
    select 1 from pg_attribute a
    where a.attrelid = to_regclass('public.training_catalog_content_mappings')
      and a.attname = 'training_catalog_id'
      and not a.attisdropped
  ) then
    raise exception
      'Run the files 20261020000100 to 20261020000400 first (catalog consistency columns are missing).';
  end if;

  if to_regclass('public.lernfelder_legacy') is not null
     or to_regclass('public.lernfeld_mappings_legacy') is not null then
    raise exception
      'A legacy backup table already exists; this migration was already applied. Stop and verify the target schema.';
  end if;
end $$;

-- Year assignment for a legacy label (see the header for the source).
create or replace function public.lernfeld_label_training_year(label text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when parsed.n is null then 1
    when parsed.n <= 5 then 1
    when parsed.n <= 10 then 2
    else 3
  end
  from (
    select nullif(substring(label from '(?i)^\s*LF[\s._-]*([0-9]{1,3})'), '')::integer as n
  ) as parsed;
$$;

-- 1. Learning fields ----------------------------------------------------------

do $$
declare
  legacy_count integer;
  inserted_count integer;
  fallback_year_count integer;
  blank_label_count integer;
  duplicate_label_count integer;
begin
  select count(*) into legacy_count from public.lernfelder;

  select count(*) into fallback_year_count
  from public.lernfelder l
  where substring(l.label from '(?i)^\s*LF[\s._-]*([0-9]{1,3})') is null;

  select count(*) into blank_label_count
  from public.lernfelder l
  where btrim(l.label) = '';

  select count(*) into duplicate_label_count
  from (
    select btrim(l.label)
    from public.lernfelder l
    where btrim(l.label) <> ''
    group by btrim(l.label)
    having count(*) > 1
  ) as d;

  with source_rows as (
    select
      l.id,
      l.title,
      l.description,
      l.created_at,
      l.updated_at,
      coalesce(nullif(btrim(l.label), ''), 'LF-' || substr(l.id::text, 1, 8))
        as base_code,
      (btrim(l.label) = '') as is_blank,
      nullif(substring(l.label from '(?i)^\s*LF[\s._-]*([0-9]{1,3})'), '')::integer
        as lf_number,
      coalesce(
        substring(l.label from '(?i)^\s*LF[\s._-]*[0-9]{1,3}\s*([a-z])'),
        ''
      ) as lf_suffix
    from public.lernfelder l
  ),
  ranked as (
    select
      s.*,
      row_number() over (
        partition by s.base_code
        order by s.created_at, s.id
      ) as duplicate_rank
    from source_rows s
  ),
  final_rows as (
    select
      r.*,
      case
        when r.duplicate_rank = 1 then r.base_code
        else r.base_code || ' #' || r.duplicate_rank
      end as code,
      row_number() over (
        order by r.lf_number nulls last, r.lf_suffix, r.base_code,
                 r.created_at, r.id
      ) as pos
    from ranked r
  )
  insert into public.training_catalog_learning_fields (
    id,
    training_catalog_id,
    code,
    title,
    description,
    training_year,
    hours_budget,
    order_index,
    created_at,
    updated_at
  )
  select
    f.id,
    '00000000-0000-4000-8000-000000000001',
    f.code,
    f.title,
    f.description,
    -- a generated code (blank label) must not be parsed: its id fragment may
    -- start with digits
    case
      when f.is_blank then 1
      else public.lernfeld_label_training_year(f.base_code)
    end,
    null,
    f.pos + coalesce((
      select max(lf.order_index)
      from public.training_catalog_learning_fields lf
      where lf.training_catalog_id = '00000000-0000-4000-8000-000000000001'
    ), 0),
    f.created_at,
    f.updated_at
  from final_rows f
  on conflict do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count <> legacy_count
     or exists (
       select 1
       from public.lernfelder l
       where not exists (
         select 1
         from public.training_catalog_learning_fields lf
         where lf.id = l.id
       )
     ) then
    raise exception
      'Could not migrate all learning fields (% of % inserted; conflict with existing FIAE learning fields). Stop and review.',
      inserted_count, legacy_count;
  end if;

  raise notice
    'lernfelder migrated: % rows (% without a recognisable LF number defaulted to training_year 1, % blank labels, % repeated labels suffixed).',
    inserted_count, fallback_year_count, blank_label_count, duplicate_label_count;
end $$;

-- 2. Mappings -------------------------------------------------------------------

do $$
declare
  legacy_count integer;
  enabler_rows integer;
  use_case_rows integer;
  skipped_rows integer;
begin
  select count(*) into legacy_count from public.lernfeld_mappings;

  insert into public.training_catalog_content_mappings (
    id,
    learning_field_id,
    enabler_id,
    use_case_id,
    training_catalog_id,
    created_at
  )
  select
    m.id,
    m.lernfeld_id,
    m.enabler_id,
    null,
    '00000000-0000-4000-8000-000000000001',
    m.created_at
  from public.lernfeld_mappings m
  where m.enabler_id is not null
    and exists (
      select 1
      from public.training_catalog_learning_fields lf
      where lf.id = m.lernfeld_id
        and lf.training_catalog_id = '00000000-0000-4000-8000-000000000001'
    )
    and exists (
      select 1
      from public.enablers e
      where e.id = m.enabler_id
        and e.training_catalog_id = '00000000-0000-4000-8000-000000000001'
    )
  on conflict do nothing;

  get diagnostics enabler_rows = row_count;

  -- A legacy row with both links keeps its id on the enabler row; the use case
  -- row gets a new id.
  insert into public.training_catalog_content_mappings (
    id,
    learning_field_id,
    enabler_id,
    use_case_id,
    training_catalog_id,
    created_at
  )
  select
    case when m.enabler_id is null then m.id else gen_random_uuid() end,
    m.lernfeld_id,
    null,
    m.use_case_id,
    '00000000-0000-4000-8000-000000000001',
    m.created_at
  from public.lernfeld_mappings m
  where m.use_case_id is not null
    and exists (
      select 1
      from public.training_catalog_learning_fields lf
      where lf.id = m.lernfeld_id
        and lf.training_catalog_id = '00000000-0000-4000-8000-000000000001'
    )
    and exists (
      select 1
      from public.use_cases u
      where u.id = m.use_case_id
        and u.training_catalog_id = '00000000-0000-4000-8000-000000000001'
    )
  on conflict do nothing;

  get diagnostics use_case_rows = row_count;

  select count(*) into skipped_rows
  from public.lernfeld_mappings m
  where not (
    (
      m.enabler_id is not null
      and exists (
        select 1 from public.training_catalog_content_mappings t
        where t.learning_field_id = m.lernfeld_id and t.enabler_id = m.enabler_id
      )
    )
    or (
      m.use_case_id is not null
      and exists (
        select 1 from public.training_catalog_content_mappings t
        where t.learning_field_id = m.lernfeld_id and t.use_case_id = m.use_case_id
      )
    )
  );

  raise notice
    'lernfeld_mappings migrated: % legacy rows -> % enabler rows + % use case rows; % legacy rows not representable (no content link or unknown learning field) stay in lernfeld_mappings_legacy.',
    legacy_count, enabler_rows, use_case_rows, skipped_rows;
end $$;

-- 3. Keep the legacy tables as backup and publish compatible views ----------

alter table public.lernfelder rename to lernfelder_legacy;
alter table public.lernfeld_mappings rename to lernfeld_mappings_legacy;

comment on table public.lernfelder_legacy is
  'Backup of the legacy lernfelder table from before the catalog learning field model. Replaced by the compatibility view public.lernfelder. Drop in a later cleanup.';
comment on table public.lernfeld_mappings_legacy is
  'Backup of the legacy lernfeld_mappings table from before the catalog learning field model. Replaced by the compatibility view public.lernfeld_mappings. Drop in a later cleanup.';

-- The legacy tables are backups only. Their original policies (select for
-- public with USING (true), drizzle 0016) made them readable for anonymous API
-- callers. Drop every policy, keep row level security enabled (no policy means
-- no access for the API roles) and revoke the privileges of anon and
-- authenticated. The server (postgres, BYPASSRLS) is not affected.
do $$
declare
  legacy_table text;
  legacy_policy record;
  api_role text;
begin
  foreach legacy_table in array array['lernfelder_legacy', 'lernfeld_mappings_legacy'] loop
    for legacy_policy in
      select pol.polname as policyname
      from pg_policy pol
      where pol.polrelid = to_regclass(format('public.%I', legacy_table))
    loop
      execute format(
        'drop policy %I on public.%I',
        legacy_policy.policyname, legacy_table
      );
    end loop;
    execute format(
      'alter table public.%I enable row level security',
      legacy_table
    );
    foreach api_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = api_role) then
        execute format(
          'revoke all on public.%I from %I',
          legacy_table, api_role
        );
      end if;
    end loop;
  end loop;
end $$;

-- security_invoker: the base table policies (select all, manage as platform
-- owner) apply to the caller, exactly like they did for the old table.
create view public.lernfelder
with (security_invoker = true)
as
select
  lf.id,
  lf.title,
  lf.description,
  lf.code as label,
  lf.created_at,
  lf.updated_at
from public.training_catalog_learning_fields lf
where lf.training_catalog_id = '00000000-0000-4000-8000-000000000001';

alter view public.lernfelder alter column id set default gen_random_uuid();
alter view public.lernfelder alter column created_at set default now();

comment on view public.lernfelder is
  'Compatibility view over the FIAE rows of training_catalog_learning_fields (label = code). Writable through INSTEAD OF triggers. New code should use training_catalog_learning_fields.';

create or replace function public.lernfelder_view_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- order_index = max + 1 must not race with a parallel insert
    perform pg_advisory_xact_lock(
      hashtext('training_catalog_learning_fields:00000000-0000-4000-8000-000000000001')
    );
    insert into public.training_catalog_learning_fields (
      id,
      training_catalog_id,
      code,
      title,
      description,
      training_year,
      order_index,
      created_at,
      updated_at
    )
    values (
      coalesce(new.id, gen_random_uuid()),
      '00000000-0000-4000-8000-000000000001',
      new.label,
      new.title,
      new.description,
      public.lernfeld_label_training_year(new.label),
      coalesce((
        select max(lf.order_index)
        from public.training_catalog_learning_fields lf
        where lf.training_catalog_id = '00000000-0000-4000-8000-000000000001'
      ), 0) + 1,
      coalesce(new.created_at, now()),
      new.updated_at
    )
    returning id, title, description, code, created_at, updated_at
    into new.id, new.title, new.description, new.label,
         new.created_at, new.updated_at;
    return new;
  elsif tg_op = 'UPDATE' then
    update public.training_catalog_learning_fields lf
    set code = new.label,
        title = new.title,
        description = new.description,
        -- a changed label (LF-3 to LF-8) moves the learning field to the year
        -- of its new number
        training_year = case
          when new.label is distinct from old.label
            then public.lernfeld_label_training_year(new.label)
          else lf.training_year
        end,
        updated_at = new.updated_at
    where lf.id = old.id
      and lf.training_catalog_id = '00000000-0000-4000-8000-000000000001'
    returning lf.id, lf.title, lf.description, lf.code,
              lf.created_at, lf.updated_at
    into new.id, new.title, new.description, new.label,
         new.created_at, new.updated_at;
    if not found then
      return null;
    end if;
    return new;
  else
    delete from public.training_catalog_learning_fields lf
    where lf.id = old.id
      and lf.training_catalog_id = '00000000-0000-4000-8000-000000000001';
    if not found then
      return null;
    end if;
    return old;
  end if;
end;
$$;

create trigger lernfelder_view_write
  instead of insert or update or delete
  on public.lernfelder
  for each row
  execute function public.lernfelder_view_write();

-- Plain single table projection: automatically updatable. The catalog column
-- of an inserted row is derived from its learning field by the base trigger.
create view public.lernfeld_mappings
with (security_invoker = true)
as
select
  m.id,
  m.learning_field_id as lernfeld_id,
  m.enabler_id,
  m.use_case_id,
  m.created_at
from public.training_catalog_content_mappings m
where m.training_catalog_id = '00000000-0000-4000-8000-000000000001';

comment on view public.lernfeld_mappings is
  'Compatibility view over the FIAE rows of training_catalog_content_mappings. New code should use training_catalog_content_mappings.';

-- No anonymous access to the compatibility views (they are security_invoker
-- views over tables whose policies are limited to authenticated users).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.lernfelder from anon;
    revoke all on public.lernfeld_mappings from anon;
  end if;
end $$;

-- 4. Post checks ---------------------------------------------------------------

do $$
begin
  if (select count(*) from public.lernfelder)
     <> (select count(*) from public.lernfelder_legacy) then
    raise exception
      'Post check failed: compatibility view lernfelder does not match the legacy row count.';
  end if;
end $$;
