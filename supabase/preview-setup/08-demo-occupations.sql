-- =============================================================================
-- Preview setup, step 8 (optional, after 05): demo trainee and demo trainer PER OCCUPATION
-- =============================================================================
-- WHO/WHEN: the project owner, BY HAND, in the Supabase SQL editor, signed in
--           as role postgres. Not run by any workflow, NEVER run by an agent.
--           Run it
--             - after 05-demo-bootstrap.sql (it needs the "Demo-Ausbildungsbetrieb"),
--             - after each of the four demo accounts signed in to the Preview
--               app ONCE (the profile is created by that first sign-in),
--             - again after every "Preview Reset".
-- WHY:      The acceptance of the occupations (FIAE and KfBM) needs one trainee and
--           one trainer per occupation, so that "a trainee only sees the content of
--           the own occupation" and "a trainer works in the tab of the occupation"
--           can be tried with real accounts. No real person is involved.
-- EFFECT:   inside ONE transaction, in the schema public_preview only
--             1. checks that the demo company (slug demo-ausbildungsbetrieb) and
--                the two catalogs FIAE and KFBM exist,
--             2. enables FIAE and KFBM for the demo company (organization_catalogs),
--             3. sets role, organization, activation and (where still empty) a name
--                and the start of training of four EXISTING profiles:
--                  demo.fiae.trainer / demo.fiae.azubi     (occupation FIAE)
--                  demo.kfbm.trainer / demo.kfbm.azubi     (occupation KfBM)
--             4. assigns each demo trainee to the demo trainer of the same occupation
--                (only where no trainer is assigned yet),
--             5. enrolls each demo trainee in the catalog of the own occupation
--                (trainee_enrollments, one row per trainee, start date and duration
--                from the variables below).
--           After the commit a result table shows what happened per entry.
-- NOT DONE: it does NOT activate the catalog KFBM (training_catalogs.is_active): the
--           super admin does that in the web interface when the content is checked.
--           It does NOT assign courses (course_members): that is the release and
--           assignment in the web interface (docs/kfbm-freigabe-zuweisung.md). It
--           creates no profile (an account without a profile is skipped with a
--           NOTICE), reads or changes no Auth data, touches nothing outside
--           public_preview and contains no password or key.
--
-- THE E-MAIL ADDRESSES end in example.invalid on purpose: that top level domain is
-- reserved and never delivers mail, so no real person can receive or be confused with
-- an account. Create the four accounts by hand in the Supabase dashboard
-- (Authentication, Users, add user, "auto confirm", a throwaway password you note
-- down yourself), because the Auth is SHARED between Preview and Production (one
-- project, one Auth user table): the accounts exist for Production too, there without
-- a profile and without rights until somebody signs in there. Use a throwaway
-- password and delete the four accounts when the acceptance is over.
--
-- IDEMPOTENT: a second run changes nothing that is already right. A profile that
-- belongs to ANOTHER organization is not moved (NOTICE), an existing name, trainer
-- assignment or enrollment is never overwritten. Nothing is ever deleted.
--
-- REHEARSAL: v_dry_run = true (the default) performs everything and then stops with
-- an error that shows the counts, so nothing is changed. Set it to false to really write.
--
-- UNDO: not needed (additive). To start from zero use the workflow "Preview Reset"
-- (it deletes ALL Preview data, Production stays untouched).
-- =============================================================================

begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- Result of this run, shown by the last statement (a NOTICE is not shown by
-- every client). Lives in the session only.
drop table if exists pg_temp.demo_occupations_report;
create temp table demo_occupations_report (
  sort_order integer not null,
  item text not null,
  email text,
  status text not null,
  role text,
  occupation text
);

do $seed$
declare
  -- 1. THE ONLY PART TO EDIT: true = rehearsal (nothing changes), false = really write
  v_dry_run boolean := true;

  -- 2. The four demo accounts (as registered in Supabase Auth, case does not matter).
  --    The addresses are fixed on purpose and end in example.invalid.
  v_emails text[] := array[
    'demo.fiae.trainer@example.invalid',
    'demo.fiae.azubi@example.invalid',
    'demo.kfbm.trainer@example.invalid',
    'demo.kfbm.azubi@example.invalid'
  ];
  v_roles text[] := array['TRAINER', 'TRAINEE', 'TRAINER', 'TRAINEE'];
  v_codes text[] := array['FIAE', 'FIAE', 'KFBM', 'KFBM'];
  v_first_names text[] := array['Demo', 'Demo', 'Demo', 'Demo'];
  v_last_names text[] := array['Ausbilder FIAE', 'Azubi FIAE', 'Ausbilder KfBM', 'Azubi KfBM'];

  -- 3. Fixed values (change only for a good reason)
  c_demo_slug constant text := 'demo-ausbildungsbetrieb';
  c_start_date constant date := date '2026-09-01';
  c_duration_years constant integer := 3;

  -- 4. Working variables
  v_org_id uuid;
  v_catalog_ids uuid[] := array[null, null]::uuid[];
  v_catalog_codes text[] := array['FIAE', 'KFBM'];
  v_catalog_id uuid;
  v_catalog_active boolean;
  v_profile_ids uuid[] := array[null, null, null, null]::uuid[];
  v_p record;
  v_i integer;
  v_j integer;
  v_rows integer;
  v_status text;
  v_role_after text;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_skipped integer := 0;
  v_enrolled integer := 0;
  v_assigned integer := 0;
  v_table text;
begin
  -- A. Preconditions. Nothing is written before all of them hold.
  if not exists (select 1 from pg_namespace n where n.nspname = 'public_preview') then
    raise exception 'Das Schema public_preview existiert nicht. Dieses Skript läuft nur gegen die Preview. Es wurde nichts geändert.';
  end if;

  foreach v_table in array array['organizations', 'profiles', 'organization_catalogs', 'training_catalogs', 'trainee_enrollments'] loop
    if to_regclass('public_preview.' || v_table) is null then
      raise exception 'Die Tabelle public_preview.% fehlt. Die Preview ist noch nicht bis zur Katalog-Reihe migriert. Zuerst den Workflow "Preview Deploy" laufen lassen. Es wurde nichts geändert.', v_table;
    end if;
  end loop;

  select o.id into v_org_id
    from public_preview.organizations o
   where o.slug = c_demo_slug and not o.is_platform_owner;
  if v_org_id is null then
    raise exception 'Der Demo-Ausbildungsbetrieb (Slug %) fehlt in der Preview. Zuerst 05-demo-bootstrap.sql ausführen. Es wurde nichts geändert.', c_demo_slug;
  end if;

  for v_i in 1..2 loop
    select c.id into v_catalog_id
      from public_preview.training_catalogs c
     where c.code = v_catalog_codes[v_i];
    if v_catalog_id is null then
      raise exception 'Der Katalog % fehlt in public_preview.training_catalogs. Die Katalog-Migration ist unvollständig angewendet. Es wurde nichts geändert.', v_catalog_codes[v_i];
    end if;
    v_catalog_ids[v_i] := v_catalog_id;
  end loop;

  for v_i in 1..4 loop
    if v_emails[v_i] !~ '^[^@\s<>]+@example\.invalid$' then
      raise exception 'Die Adresse % endet nicht auf @example.invalid. In diesem Skript sind nur Demo-Adressen erlaubt. Es wurde nichts geändert.', v_emails[v_i];
    end if;
  end loop;

  -- B. Both catalogs enabled for the demo company. The FIAE row exists already (trigger
  --    organizations_enable_default_catalog), KFBM is added or switched on. The catalog
  --    itself is not activated here.
  for v_i in 1..2 loop
    insert into public_preview.organization_catalogs (organization_id, training_catalog_id, is_enabled)
    values (v_org_id, v_catalog_ids[v_i], true)
    on conflict (organization_id, training_catalog_id)
    do update set is_enabled = true, updated_at = now()
    where not public_preview.organization_catalogs.is_enabled;
    get diagnostics v_rows = row_count;

    select c.is_active into v_catalog_active
      from public_preview.training_catalogs c
     where c.id = v_catalog_ids[v_i];

    insert into demo_occupations_report (sort_order, item, status, occupation)
    values (
      v_i,
      'Katalog für den Demo-Betrieb',
      case when v_rows > 0 then 'freigeschaltet' else 'war schon freigeschaltet' end
        || case when v_catalog_active then ', Katalog ist aktiv' else ', Katalog ist NOCH NICHT aktiv (Superadmin schaltet ihn in der Oberfläche frei)' end,
      v_catalog_codes[v_i]
    );
  end loop;

  -- C. The four profiles. A profile is never created here: it appears with the first
  --    sign-in to the Preview app (/api/auth/sync-profile).
  for v_i in 1..4 loop
    select p.id, p.organization_id into v_p
      from public_preview.profiles p
     where lower(p.email) = lower(v_emails[v_i])
     order by p.created_at, p.id
     limit 1;

    if not found then
      raise notice 'ÜBERSPRUNGEN (%): Für % gibt es in der Preview noch kein Profil. Erst einmal in der Preview anmelden (das Konto muss in Supabase Auth existieren), dann dieses Skript erneut ausführen.', v_codes[v_i], v_emails[v_i];
      v_status := 'ÜBERSPRUNGEN: noch kein Profil. Erst einmal anmelden, dann Skript erneut ausführen';
      v_skipped := v_skipped + 1;
      v_role_after := null;
    elsif v_p.organization_id is not null and v_p.organization_id <> v_org_id then
      raise notice 'ÜBERSPRUNGEN (%): % gehört schon zu einer anderen Organisation und wird nicht verschoben.', v_codes[v_i], v_emails[v_i];
      v_status := 'ÜBERSPRUNGEN: gehört zu einer anderen Organisation, nicht verschoben';
      v_skipped := v_skipped + 1;
      select p.role::text into v_role_after from public_preview.profiles p where p.id = v_p.id;
    else
      v_profile_ids[v_i] := v_p.id;
      update public_preview.profiles p
         set role = v_roles[v_i]::public_preview.user_role,
             organization_id = v_org_id,
             is_active = true,
             trainer_activated = true,
             first_name = coalesce(p.first_name, v_first_names[v_i]),
             last_name = coalesce(p.last_name, v_last_names[v_i]),
             full_name = coalesce(p.full_name, v_first_names[v_i] || ' ' || v_last_names[v_i]),
             start_of_training_date = case
               when v_roles[v_i] = 'TRAINEE' then coalesce(p.start_of_training_date, c_start_date::timestamp)
               else p.start_of_training_date
             end,
             updated_at = now()
       where p.id = v_p.id
         and (p.role::text, p.organization_id, p.is_active, p.trainer_activated,
              p.first_name is null, p.last_name is null, p.full_name is null,
              v_roles[v_i] = 'TRAINEE' and p.start_of_training_date is null)
             is distinct from
             (v_roles[v_i], v_org_id, true, true, false, false, false, false);
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        v_status := 'aktualisiert';
        v_updated := v_updated + 1;
      else
        v_status := 'unverändert';
        v_unchanged := v_unchanged + 1;
      end if;
      select p.role::text into v_role_after from public_preview.profiles p where p.id = v_p.id;
    end if;

    insert into demo_occupations_report (sort_order, item, email, status, role, occupation)
    values (10 + v_i, case when v_roles[v_i] = 'TRAINER' then 'Demo-Ausbilder' else 'Demo-Azubi' end,
            v_emails[v_i], v_status, v_role_after, v_codes[v_i]);
  end loop;

  -- D. Each demo trainee: assigned to the trainer of the same occupation (only where
  --    nobody is assigned yet) and enrolled in the catalog of the own occupation.
  for v_i in 1..4 loop
    continue when v_roles[v_i] <> 'TRAINEE' or v_profile_ids[v_i] is null;

    -- the trainer of the same occupation is the entry with the same code and role TRAINER
    for v_j in 1..4 loop
      if v_roles[v_j] = 'TRAINER' and v_codes[v_j] = v_codes[v_i] and v_profile_ids[v_j] is not null then
        update public_preview.profiles p
           set assigned_trainer_id = v_profile_ids[v_j], updated_at = now()
         where p.id = v_profile_ids[v_i] and p.assigned_trainer_id is null;
        get diagnostics v_rows = row_count;
        v_assigned := v_assigned + v_rows;
      end if;
    end loop;

    select c.id into v_catalog_id
      from public_preview.training_catalogs c
     where c.code = v_codes[v_i];
    insert into public_preview.trainee_enrollments (trainee_id, training_catalog_id, start_date, duration_years)
    values (v_profile_ids[v_i], v_catalog_id, c_start_date, c_duration_years)
    on conflict (trainee_id, training_catalog_id) do nothing;
    get diagnostics v_rows = row_count;
    v_enrolled := v_enrolled + v_rows;
    insert into demo_occupations_report (sort_order, item, email, status, occupation)
    values (20 + v_i, 'Einschreibung', v_emails[v_i],
            case when v_rows > 0 then 'angelegt' else 'war schon vorhanden' end, v_codes[v_i]);
  end loop;

  raise notice 'Fertig: % Profil(e) aktualisiert, % unverändert, % übersprungen, % Trainerzuordnung(en), % Einschreibung(en) neu.',
    v_updated, v_unchanged, v_skipped, v_assigned, v_enrolled;
  if v_skipped > 0 then
    raise notice 'ACHTUNG: % von 4 Konten übersprungen, Gründe in den Meldungen davor und in der Ergebnistabelle.', v_skipped;
  end if;

  if v_dry_run then
    raise exception 'PROBELAUF, nichts wurde geändert: % Profil(e) würden aktualisiert, % sind unverändert, % würden übersprungen, % Trainerzuordnung(en), % Einschreibung(en) neu. Zum Schreiben v_dry_run oben auf false setzen und alles erneut ausführen.',
      v_updated, v_unchanged, v_skipped, v_assigned, v_enrolled;
  end if;
end
$seed$;

commit;

select item as "Eintrag", email as "E-Mail", status as "Ergebnis", role as "Rolle", occupation as "Beruf"
  from pg_temp.demo_occupations_report
 order by sort_order;
