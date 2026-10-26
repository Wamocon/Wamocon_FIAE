-- =============================================================================
-- Preview setup, step 7 (optional, after 05 and 06): copy the user profiles of
-- Production into the Preview
-- =============================================================================
-- WHO/WHEN: the project owner, BY HAND, in the Supabase SQL editor, signed in
--           as role postgres. Not run by any workflow. Run it
--             - after the demo bootstrap (05), because it needs the platform
--               organization of the Preview,
--             - again after every "Preview Reset" (a reset leaves public_preview
--               without profiles).
-- WHY:      The Auth accounts are shared between Production and Preview (one
--           Supabase project). A profile only appears in the Preview when its
--           person signs in there once. This copies the existing profiles, so the
--           people of the platform organization can work in the Preview at once
--           with the role and the trainer assignment they have in Production.
-- EFFECT:   inside ONE transaction, WRITES ONLY public_preview.profiles and only
--           READS public.profiles and public.organizations (Production is never
--           changed). Copied are the profiles of the PLATFORM organization of
--           Production, with their id (= the Auth id), name, e-mail address, role,
--           activation, training dates and trainer assignment. They are put into
--           the platform organization of the Preview. NOT copied: profiles of
--           customer organizations and profiles without an organization (they are
--           counted in the report), and no Auth data (no password, no token), no
--           enrollments, submissions, progress, reports or other data of a person.
--           A profile that exists in the Preview already is not changed.
-- MODES:    v_dry_run = true (the default) performs everything and then rolls it
--           back with an error that shows the counts, nothing is changed. Set it
--           to false to really copy.
-- IDEMPOTENT: a second run inserts nothing new (matched by id, then by the unique
--           e-mail address).
-- UNDO:     not needed (additive). To start from zero use the workflow "Preview
--           Reset" (it deletes ALL Preview data, Production stays untouched).
-- =============================================================================

begin isolation level repeatable read;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Result of a real run, shown by the last statement (a NOTICE is not shown by
-- every client). Lives in the session only.
drop table if exists pg_temp.user_copy_report;
create temp table user_copy_report (
  sort_order integer not null,
  item text not null,
  amount bigint not null
);

do $copy$
declare
  -- THE ONLY PART TO EDIT: true = rehearsal (nothing changes), false = really copy
  v_dry_run boolean := true;

  v_platform_id uuid;
  v_src bigint;
  v_eligible bigint;
  v_left_out bigint;
  v_before bigint;
  v_ins bigint;
  v_after bigint;
  v_no_trainer bigint;
  v_report jsonb;
begin
  -- A. Preconditions. Nothing is written before all of them hold.
  if not exists (select 1 from pg_namespace n where n.nspname = 'public_preview') then
    raise exception 'Das Schema public_preview existiert nicht. Dieses Skript läuft nur gegen die Preview. Es wurde nichts geändert.';
  end if;
  if to_regclass('public.profiles') is null or to_regclass('public.organizations') is null
     or to_regclass('public_preview.profiles') is null or to_regclass('public_preview.organizations') is null then
    raise exception 'Die Tabelle profiles oder organizations fehlt in public oder in public_preview. Es wurde nichts geändert.';
  end if;

  select o.id into v_platform_id
    from public_preview.organizations o
   where o.is_platform_owner
   order by o.created_at, o.id
   limit 1;
  if v_platform_id is null then
    raise exception 'Die Preview hat noch keine Plattform-Organisation. Zuerst das Demo-Bootstrap (05) ausführen und dann dieses Skript erneut starten. Es wurde nichts geändert.';
  end if;

  -- B. What is there, and what is left out
  select count(*) into v_src from public.profiles;
  select count(*) into v_eligible
    from public.profiles s
   where s.organization_id in (select o.id from public.organizations o where o.is_platform_owner);
  v_left_out := v_src - v_eligible;
  select count(*) into v_before from public_preview.profiles;

  -- C. The profiles of the platform organization. The trainer assignment is kept
  --    only if the trainer is copied as well (otherwise it would point nowhere).
  insert into public_preview.profiles (
    id, full_name, email, avatar_url, role, is_active, start_of_training_date,
    assigned_trainer_id, created_at, updated_at, first_name, last_name, birth_date,
    organization_id, trainer_activated, ausbildung_duration_years
  )
  select s.id, s.full_name, s.email, s.avatar_url,
         s.role::text::public_preview.user_role, s.is_active, s.start_of_training_date,
         case when exists (
                select 1 from public.profiles t
                 where t.id = s.assigned_trainer_id
                   and t.organization_id in (select o.id from public.organizations o where o.is_platform_owner)
              ) then s.assigned_trainer_id end,
         s.created_at, s.updated_at, s.first_name, s.last_name, s.birth_date,
         v_platform_id, s.trainer_activated, s.ausbildung_duration_years
    from public.profiles s
   where s.organization_id in (select o.id from public.organizations o where o.is_platform_owner)
  on conflict do nothing;
  get diagnostics v_ins = row_count;

  select count(*) into v_after from public_preview.profiles;
  select count(*) into v_no_trainer
    from public.profiles s
   where s.assigned_trainer_id is not null
     and s.organization_id in (select o.id from public.organizations o where o.is_platform_owner)
     and not exists (
       select 1 from public.profiles t
        where t.id = s.assigned_trainer_id
          and t.organization_id in (select o.id from public.organizations o where o.is_platform_owner)
     );

  v_report := jsonb_build_object(
    'Profile in Production', v_src,
    'davon Plattform-Organisation (werden kopiert)', v_eligible,
    'nicht kopiert (Kundenorganisation oder ohne Organisation)', v_left_out,
    'Profile in der Preview vorher', v_before,
    'eingefügt', v_ins,
    'Profile in der Preview nachher', v_after,
    'Ausbilder-Zuordnung entfernt (Ausbilder nicht kopiert)', v_no_trainer
  );

  -- D. Result
  if v_dry_run then
    raise exception E'PROBELAUF, es wurde nichts geändert (alles zurückgerollt). Das wäre das Ergebnis:\n%\nZum echten Kopieren oben v_dry_run auf false setzen.', jsonb_pretty(v_report);
  end if;

  insert into user_copy_report (sort_order, item, amount)
  select row_number() over (), e.key, (e.value)::text::bigint
    from jsonb_each(v_report) e;
  raise notice 'Fertig: die Profile der Plattform-Organisation wurden nach public_preview kopiert (Ergebnistabelle unten).';
end
$copy$;

commit;

select item as "Eintrag", amount as "Anzahl"
  from pg_temp.user_copy_report
 order by sort_order;
