-- Not yet in public: the learning field tables of the structure dump become views
-- over catalog tables (like the catalog migration 20261024*). Preview therefore
-- holds views whose names used to be tables, plus a view on a view.
-- migration:destructive-ok

begin;

create table public.catalog_learning_fields (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  code text
);

create table public.catalog_learning_field_mappings (
  id uuid primary key default gen_random_uuid(),
  learning_field_id uuid not null references public.catalog_learning_fields (id) on delete cascade,
  target text not null
);

drop view public.v_lernfeld_overview;
drop table public.lernfeld_mappings;
drop table public.lernfelder;

create view public.lernfelder as
  select id, title, code from public.catalog_learning_fields;

create view public.lernfeld_mappings as
  select id, learning_field_id as lernfeld_id, target
  from public.catalog_learning_field_mappings;

create view public.v_lernfeld_overview as
  select l.id, l.title,
    (select count(*) from public.lernfeld_mappings m where m.lernfeld_id = l.id) as mappings
  from public.lernfelder l;

-- a partitioned table with a partition, a standalone enum and a function
create table public.metrics (
  day date not null,
  value integer not null
) partition by range (day);

create table public.metrics_2026 partition of public.metrics
  for values from ('2026-01-01') to ('2027-01-01');

create type public.mood as enum ('good', 'bad');

create function public.mood_label(m public.mood) returns text
  language sql immutable as $$ select m::text $$;

-- a range type (its constructor functions belong to the type), an aggregate, functions
-- that disappear together with the table of their argument type, and enough plain
-- functions to need more than one fetch of the routine loop
create type public.day_span as range (subtype = date);

create aggregate public.sum_values(integer) (sfunc = int4pl, stype = integer, initcond = '0');

-- a function on the row type of a table goes away together with the table
create function public.metrics_total(r public.metrics) returns integer
  language sql as $fn$ select r.value $fn$;

-- the same name and signature also exists in public (the structure dump of the real
-- project always has it): a drop that is not qualified must never reach that one
create function public.shadow_fn(r public.metrics) returns integer
  language sql as $fn$ select r.value $fn$;

do $$
begin
  for i in 1..12 loop
    execute format('create function public.plain_fn_%s() returns integer language sql as ''select %s''', i, i);
  end loop;
end
$$;

grant select on public.lernfelder to authenticated;
grant select on public.v_lernfeld_overview to authenticated;

commit;
