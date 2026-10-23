-- Security hardening 1 of 3: lock down tables that nothing reads through the API.
--
-- Measured read-only on production on 2026-10-23: these six tables have no row
-- level security and the role anon holds every privilege on them (select,
-- insert, update, delete, truncate). No code in this repository uses them
-- (src and scripts were searched), the app reaches the database through Drizzle
-- as the role postgres, which bypasses row level security.
--
--   reflections                 4 rows (dropped by drizzle 0012, still present)
--   ihk_grade_legend            6 rows
--   _backup_quizzes             391 rows
--   _backup_questions           4215 rows
--   _backup_options             16875 rows
--   _backup_enabler_quiz_links  502 rows
--
-- Effect: row level security is enabled and the privileges of anon and
-- authenticated are revoked. No policy is created, so only service_role and
-- postgres can still reach the tables. No data is changed or deleted.
-- Tables that do not exist (fresh databases) are skipped.
--
-- Undo (only if something breaks):
--   alter table public.<table> disable row level security;
--   grant all on table public.<table> to anon, authenticated;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  t text;
begin
  foreach t in array array[
    'reflections',
    'ihk_grade_legend',
    '_backup_quizzes',
    '_backup_questions',
    '_backup_options',
    '_backup_enabler_quiz_links'
  ] loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
