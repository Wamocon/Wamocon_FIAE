-- Rollout rehearsal: columns of the production structure (snapshot of 2026-10-23) that the
-- schema history in src/db/migrations/drizzle does not create, and that the rollout series
-- or its checks read.
--
-- Runs only in the throwaway container, after the history replay and before the manual
-- baseline files. Idempotent. The full list of remaining differences is in
-- docs/kfbm-rollout-probelauf.md (section "Bekannte Lücke").

-- learning fields: the migration 20261024000500 copies them and stops at the first value
-- of the five extra columns, V11 reads them
alter table public.lernfelder
  add column if not exists code text,
  add column if not exists training_year integer,
  add column if not exists hours_budget integer,
  add column if not exists is_common boolean default true,
  add column if not exists order_index integer;

-- enablers: scenario and hint columns that the import and the sync read and write
alter table public.enablers
  add column if not exists scenario_text text,
  add column if not exists hint_text text,
  add column if not exists scenario_image_url text,
  add column if not exists scenarios jsonb;

-- production has no trigger on auth.users (measured 2026-10-23, assumption A4 of the
-- runbook), the history creates one (handle_new_user) that would fire on the sample users
do $$
declare
  t record;
begin
  for t in
    select tgname from pg_trigger
    where tgrelid = 'auth.users'::regclass and not tgisinternal
  loop
    execute format('drop trigger %I on auth.users', t.tgname);
  end loop;
end
$$;
