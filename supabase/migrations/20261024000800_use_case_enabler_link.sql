-- Package 2.4 (part 3): 1:1 link between a use case and its enabler (E7).
--
-- use_cases.enabler_id is nullable and unique. The composite foreign key
-- (enabler_id, course_id) -> enablers (id, course_id) guarantees that a use
-- case can only be linked to an enabler of its own course. Deleting an enabler
-- clears the link (ON DELETE SET NULL on enabler_id only, PostgreSQL 15), the
-- use case itself is kept.
--
-- No automatic backfill for the existing FIAE content. A read-only measurement
-- of production on 2026-10-23 found 26 courses with 189 enablers and 88 use
-- cases, and only 4 courses with as many use cases as enablers. Pairing by
-- position would link wrong rows, and an empty link is safer than a wrong one.
-- Existing FIAE use cases therefore keep enabler_id NULL. Review the state
-- per course with
--   select * from public.v_use_case_enabler_backfill_report where needs_review;
-- NOT NULL on enabler_id must not be enforced for the FIAE catalog. The KfBM
-- import sets enabler_id explicitly for every use case.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception
      'PostgreSQL 15 or newer is required (ON DELETE SET NULL with a column list).';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'enablers_id_course_unique'
      and conrelid = 'public.enablers'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.enablers
      add constraint enablers_id_course_unique
      unique (id, course_id);
  end if;
end $$;

alter table public.use_cases
  add column if not exists enabler_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'use_cases_enabler_id_unique'
      and conrelid = 'public.use_cases'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.use_cases
      add constraint use_cases_enabler_id_unique
      unique (enabler_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'use_cases_enabler_course_fk'
      and conrelid = 'public.use_cases'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.use_cases
      add constraint use_cases_enabler_course_fk
      foreign key (enabler_id, course_id)
      references public.enablers (id, course_id)
      on delete set null (enabler_id);
  end if;
end $$;

-- Diagnosis per course: counts, pairing state and deviations. Courses without
-- any link show up as partially_paired and need a human decision.
create or replace view public.v_use_case_enabler_backfill_report
with (security_invoker = true)
as
with enabler_stats as (
  select
    e.course_id,
    count(*) as enabler_count,
    count(*) - count(distinct e.order_index) as duplicate_enabler_order_indexes,
    count(*) filter (
      where not exists (
        select 1 from public.use_cases u where u.enabler_id = e.id
      )
    ) as unlinked_enablers
  from public.enablers e
  group by e.course_id
),
use_case_stats as (
  select
    u.course_id,
    count(*) as use_case_count,
    count(*) - count(distinct u.order_index) as duplicate_use_case_order_indexes,
    count(*) filter (where u.enabler_id is not null) as paired_count,
    count(*) filter (where u.enabler_id is null) as unlinked_use_cases,
    count(*) filter (
      where u.enabler_id is not null
        and exists (
          select 1
          from public.enablers pe
          where pe.id = u.enabler_id
            and lower(btrim(pe.title)) <> lower(btrim(u.title))
        )
    ) as paired_title_mismatch_count
  from public.use_cases u
  group by u.course_id
),
per_course as (
  select
    c.id as course_id,
    c.training_catalog_id,
    c.code as course_code,
    c.title as course_title,
    coalesce(es.enabler_count, 0) as enabler_count,
    coalesce(us.use_case_count, 0) as use_case_count,
    coalesce(us.paired_count, 0) as paired_count,
    coalesce(es.unlinked_enablers, 0) as unlinked_enablers,
    coalesce(us.unlinked_use_cases, 0) as unlinked_use_cases,
    coalesce(es.duplicate_enabler_order_indexes, 0)
      as duplicate_enabler_order_indexes,
    coalesce(us.duplicate_use_case_order_indexes, 0)
      as duplicate_use_case_order_indexes,
    coalesce(us.paired_title_mismatch_count, 0) as paired_title_mismatch_count
  from public.courses c
  left join enabler_stats es on es.course_id = c.id
  left join use_case_stats us on us.course_id = c.id
)
select
  p.*,
  case
    when p.enabler_count = 0 and p.use_case_count = 0 then 'empty'
    when p.enabler_count <> p.use_case_count then 'count_mismatch'
    when p.duplicate_enabler_order_indexes > 0
      or p.duplicate_use_case_order_indexes > 0 then 'order_ambiguous'
    when p.paired_count <> p.use_case_count then 'partially_paired'
    else 'ok'
  end as status,
  (
    not (p.enabler_count = 0 and p.use_case_count = 0)
    and (
      p.enabler_count <> p.use_case_count
      or p.duplicate_enabler_order_indexes > 0
      or p.duplicate_use_case_order_indexes > 0
      or p.paired_count <> p.use_case_count
    )
  ) as needs_review,
  -- Soft signal only: paired titles differ, a human should spot-check them.
  (p.paired_title_mismatch_count > 0) as title_review_recommended
from per_course p;

-- The view exposes counts per course; it is for operators, not for anonymous
-- API callers (revoked only if the Supabase API role exists).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.v_use_case_enabler_backfill_report from anon;
  end if;
end $$;

comment on column public.use_cases.enabler_id is
  'Optional 1:1 link to the enabler of the same course (composite foreign key with course_id). NULL for all existing FIAE use cases (no positional backfill, production counts do not match); set explicitly by the KfBM import.';
comment on view public.v_use_case_enabler_backfill_report is
  'Per course: number of enablers and use cases, how many use cases are linked (paired_count, column name kept) and deviations. needs_review = true marks courses whose counts or links do not match; title_review_recommended is a soft hint for linked rows with different titles.';
