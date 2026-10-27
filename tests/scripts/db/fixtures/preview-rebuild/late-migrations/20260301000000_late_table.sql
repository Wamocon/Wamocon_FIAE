-- A migration that arrives after the first rebuild (applied with "apply", not "rebuild").
create table public.late_table (
  id integer primary key,
  note text
);

create or replace function public.late_note(n integer) returns text
  language sql stable as $$ select note from public.late_table where id = n $$;
