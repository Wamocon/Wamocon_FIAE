-- =============================================================================
-- Preview setup, step 5 (optional, after 01 to 04): demo bootstrap
-- =============================================================================
-- WHO/WHEN: the project owner, BY HAND, in the Supabase SQL editor, signed in
--           as role postgres. Not run by any workflow. Run it
--             - after the structure of the Preview was migrated up to the
--               catalog series (20261024001500 and newer, trigger
--               organizations_enable_default_catalog),
--             - after each of the three test accounts signed in to the Preview
--               app ONCE (the profile is created by that first sign-in),
--             - again after every "Preview Reset" (a reset leaves public_preview
--               empty: no organization, no profile, no role).
-- WHY:      public_preview has no rows after a reset. A new profile starts as
--           TRAINEE without an organization, and accounts are created in the
--           Preview only by an administrator in the user administration (they
--           carry app_metadata.preview_only). Without this step nobody sees KfBM.
-- EFFECT:   inside ONE transaction, in the schema public_preview only
--             1. creates the platform organization (is_platform_owner = true),
--             2. creates the "Demo-Ausbildungsbetrieb" (plan PRO, generous
--                seats, active),
--             3. sets role, organization, is_active and trainer_activated of
--                three EXISTING profiles: super admin (platform organization),
--                trainer and trainee (demo company).
--           The three e-mail addresses are the variables at the top of the DO
--           block. The script refuses to start while a placeholder is left.
--           After the commit a result table shows what happened per entry.
-- NOT DONE: it does NOT enable KfBM for the demo company and writes no catalog
--           rows. The super admin does that in the web interface (organization
--           catalogs, enroll the trainee), that belongs to the acceptance. The
--           FIAE row of each new organization is created by the trigger
--           organizations_enable_default_catalog, the script only checks it.
--           It creates no profile (an account without a profile is skipped with
--           a NOTICE), reads or changes no Auth data, touches nothing outside
--           public_preview and contains no password or key.
--
-- THE AUTHENTICATION IS SHARED between Preview and Production (one Supabase
-- project, one Auth user table). A test account therefore has to be a REAL Auth
-- account: create it in the Supabase dashboard (Authentication, Users, add
-- user, confirm the e-mail address). It exists for Production too. There a
-- profile only appears if somebody signs in to Production with it. It is a
-- TRAINEE without an organization (no rights, no data, harmless).
-- RECOMMENDATION: own test accounts with a throwaway password, NOT the real
-- accounts of people.
--
-- IDEMPOTENT: a second run changes nothing that is already right. A missing
-- organization is created, an existing one is only re-activated or given more
-- seats if it fell below the values here. A profile is only updated where a
-- value differs. Neither the name nor the plan of an existing organization is
-- overwritten. A profile that already belongs to ANOTHER organization is not
-- moved (NOTICE). Nothing is ever deleted.
--
-- UNDO: not needed (additive). To start from zero use the workflow "Preview
-- Reset" (it deletes ALL Preview data, Production stays untouched).
-- =============================================================================

begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- Result of this run, shown by the last statement (a NOTICE is not shown by
-- every client). Lives in the session only.
drop table if exists pg_temp.demo_bootstrap_report;
create temp table demo_bootstrap_report (
  sort_order integer not null,
  item text not null,
  email text,
  status text not null,
  role text,
  organization text
);

do $bootstrap$
declare
  -- 1. THE ONLY PART TO EDIT: the e-mail addresses of the three test accounts
  --    (as registered in Supabase Auth, case does not matter). Replace the
  --    whole text between the quotes, including the angle brackets.
  v_superadmin_email text := '<E-MAIL-DES-SUPERADMIN-EINTRAGEN>';
  v_trainer_email text := '<E-MAIL-DES-AUSBILDERS-EINTRAGEN>';
  v_trainee_email text := '<E-MAIL-DES-AZUBIS-EINTRAGEN>';

  -- 2. Fixed values of the demo set up (change only for a good reason)
  c_platform_name constant text := 'WAMOCON Plattform (Preview)';
  c_platform_slug constant text := 'wamocon-plattform-preview';
  c_demo_name constant text := 'Demo-Ausbildungsbetrieb';
  c_demo_slug constant text := 'demo-ausbildungsbetrieb';
  c_plan constant text := 'PRO';
  c_trainee_seats constant integer := 25;
  c_trainer_seats constant integer := 10;
  c_fiae_code constant text := 'FIAE';

  -- 3. Working variables
  v_names text[] := array['v_superadmin_email', 'v_trainer_email', 'v_trainee_email'];
  v_inputs text[];
  v_emails text[];
  v_labels text[] := array['Superadmin', 'Ausbilder', 'Azubi'];
  v_roles text[] := array['SUPER_ADMIN', 'TRAINER', 'TRAINEE'];
  v_org_labels text[] := array['Plattform-Organisation', 'Demo-Ausbildungsbetrieb'];
  v_org_names text[] := array[c_platform_name, c_demo_name];
  v_org_slugs text[] := array[c_platform_slug, c_demo_slug];
  v_org_trainee_seats integer[] := array[10, c_trainee_seats];
  v_org_trainer_seats integer[] := array[10, c_trainer_seats];
  v_org_ids uuid[] := array[null, null]::uuid[];
  v_table text;
  v_fiae_id uuid;
  v_org_id uuid;
  v_target_org uuid;
  v_status text;
  v_codes text;
  v_p record;
  v_role_after text;
  v_org_after text;
  v_i integer;
  v_rows integer;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_skipped integer := 0;
begin
  -- A. Preconditions. Nothing is written before all of them hold.
  if not exists (select 1 from pg_namespace n where n.nspname = 'public_preview') then
    raise exception 'Das Schema public_preview existiert nicht. Dieses Skript läuft nur gegen die Preview. Zuerst 01-preview-role.sql ausführen und den Workflow "Preview Reset" (Modus execute) starten. Es wurde nichts geändert.';
  end if;

  foreach v_table in array array['organizations', 'profiles', 'organization_catalogs', 'training_catalogs'] loop
    if to_regclass('public_preview.' || v_table) is null then
      raise exception 'Die Tabelle public_preview.% fehlt. Die Preview ist noch nicht bis zur Katalog-Reihe migriert (Migrationen bis 20261024001500). Zuerst den Workflow "Preview Deploy" für master laufen lassen, dann dieses Skript erneut ausführen. Es wurde nichts geändert.', v_table;
    end if;
  end loop;

  if not exists (
    select 1 from pg_enum e
     where e.enumtypid = to_regtype('public_preview.user_role')
       and e.enumlabel = 'SUPER_ADMIN'
  ) then
    raise exception 'Der Rollenwert SUPER_ADMIN fehlt im Typ public_preview.user_role (Migration 20261024001500 ist in der Preview nicht angewendet). Zuerst migrieren, dann dieses Skript erneut ausführen. Es wurde nichts geändert.';
  end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = to_regclass('public_preview.organizations')
       and t.tgname = 'organizations_enable_default_catalog'
       and not t.tgisinternal
  ) then
    raise exception 'Der Trigger organizations_enable_default_catalog fehlt auf public_preview.organizations (Migration 20261024001000 ist in der Preview nicht angewendet). Ohne ihn bekäme eine neue Organisation keine FIAE-Zeile. Es wurde nichts geändert.';
  end if;

  select c.id into v_fiae_id
    from public_preview.training_catalogs c
   where c.code = c_fiae_code;
  if v_fiae_id is null then
    raise exception 'Der Katalog % fehlt in public_preview.training_catalogs. Die Katalog-Migration ist unvollständig angewendet. Es wurde nichts geändert.', c_fiae_code;
  end if;

  -- B. The three e-mail addresses: replaced, valid, different. Lower case, like
  --    /api/auth/sync-profile stores them.
  v_inputs := array[v_superadmin_email, v_trainer_email, v_trainee_email];
  v_emails := array[
    lower(btrim(v_superadmin_email)),
    lower(btrim(v_trainer_email)),
    lower(btrim(v_trainee_email))
  ];
  for v_i in 1..3 loop
    if v_emails[v_i] is null or v_emails[v_i] !~ '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' then
      raise exception 'Platzhalter nicht ersetzt: % enthält keine gültige E-Mail-Adresse (Wert: "%"). Die drei Adressen oben im Skript eintragen und alles erneut ausführen. Es wurde nichts geändert.', v_names[v_i], v_inputs[v_i];
    end if;
  end loop;
  if v_emails[1] = v_emails[2] or v_emails[1] = v_emails[3] or v_emails[2] = v_emails[3] then
    raise exception 'Die drei E-Mail-Adressen müssen verschieden sein, sonst bekäme ein Profil zwei Rollen. Es wurde nichts geändert.';
  end if;

  -- C. The two organizations (1 = platform organization, 2 = demo company).
  --    Looked up first, created only when missing. The FIAE row of a new
  --    organization comes from the trigger organizations_enable_default_catalog,
  --    it is verified and never written here.
  for v_i in 1..2 loop
    if v_i = 1 then
      select o.id into v_org_id
        from public_preview.organizations o
       where o.is_platform_owner
       order by o.created_at, o.id
       limit 1;
    else
      select o.id into v_org_id
        from public_preview.organizations o
       where o.slug = v_org_slugs[v_i] and not o.is_platform_owner;
    end if;

    if v_org_id is null then
      if exists (select 1 from public_preview.organizations o where o.slug = v_org_slugs[v_i]) then
        raise exception 'Der Slug "%" ist in der Preview schon an eine andere Organisation vergeben (Art Plattform oder Betrieb passt nicht). Diese Organisation in der Oberfläche umbenennen oder den Slug oben im Skript ändern. Es wurde nichts geändert.', v_org_slugs[v_i];
      end if;
      insert into public_preview.organizations (
        name, slug, subscription_plan, max_trainee_seats, max_trainer_seats,
        is_active, is_platform_owner, notes
      ) values (
        v_org_names[v_i], v_org_slugs[v_i], c_plan::public_preview.subscription_plan,
        v_org_trainee_seats[v_i], v_org_trainer_seats[v_i],
        true, v_i = 1, 'Angelegt von 05-demo-bootstrap.sql'
      )
      returning id into v_org_id;
      if not exists (
        select 1 from public_preview.organization_catalogs oc
         where oc.organization_id = v_org_id
           and oc.training_catalog_id = v_fiae_id
           and oc.is_enabled
      ) then
        raise exception 'Der Trigger organizations_enable_default_catalog hat für die neue Organisation "%" keine FIAE-Zeile in organization_catalogs angelegt. Abbruch, es wurde nichts geändert.', v_org_names[v_i];
      end if;
      v_status := 'angelegt, FIAE-Zeile vom Trigger geprüft';
    else
      update public_preview.organizations o
         set is_active = true,
             max_trainee_seats = greatest(o.max_trainee_seats, v_org_trainee_seats[v_i]),
             max_trainer_seats = greatest(o.max_trainer_seats, v_org_trainer_seats[v_i]),
             updated_at = now()
       where o.id = v_org_id
         and (not o.is_active
              or o.max_trainee_seats < v_org_trainee_seats[v_i]
              or o.max_trainer_seats < v_org_trainer_seats[v_i]);
      get diagnostics v_rows = row_count;
      v_status := case when v_rows > 0 then 'vorhanden, aktiviert beziehungsweise Plätze angehoben' else 'vorhanden, unverändert' end;
    end if;

    v_org_ids[v_i] := v_org_id;
    insert into demo_bootstrap_report (sort_order, item, status, organization)
    values (v_i, v_org_labels[v_i], v_status, v_org_names[v_i] || ' (' || v_org_slugs[v_i] || ')');
  end loop;

  -- D. The three test accounts. A profile is never created here: it appears with
  --    the first sign-in to the Preview app (/api/auth/sync-profile).
  for v_i in 1..3 loop
    -- the super admin belongs to the platform organization, the others to the demo company
    v_target_org := case when v_i = 1 then v_org_ids[1] else v_org_ids[2] end;

    select p.id, p.organization_id into v_p
      from public_preview.profiles p
     where lower(p.email) = v_emails[v_i]
     order by p.created_at, p.id
     limit 1;

    if not found then
      raise notice 'ÜBERSPRUNGEN (%): Für % gibt es in der Preview noch kein Profil. Erst einmal in der Preview anmelden (das Konto muss in Supabase Auth existieren), dann dieses Skript erneut ausführen.', v_labels[v_i], v_emails[v_i];
      v_status := 'ÜBERSPRUNGEN: noch kein Profil. Erst einmal anmelden, dann Skript erneut ausführen';
      v_skipped := v_skipped + 1;
      v_role_after := null;
      v_org_after := null;
    elsif v_p.organization_id is not null and v_p.organization_id <> v_target_org then
      raise notice 'ÜBERSPRUNGEN (%): % gehört schon zu einer anderen Organisation und wird nicht verschoben. Dort in der Oberfläche korrigieren oder das Profil prüfen.', v_labels[v_i], v_emails[v_i];
      v_status := 'ÜBERSPRUNGEN: gehört zu einer anderen Organisation, nicht verschoben';
      v_skipped := v_skipped + 1;
      select p.role::text, o.name into v_role_after, v_org_after
        from public_preview.profiles p
        left join public_preview.organizations o on o.id = p.organization_id
       where p.id = v_p.id;
    else
      update public_preview.profiles p
         set role = v_roles[v_i]::public_preview.user_role,
             organization_id = v_target_org,
             is_active = true,
             trainer_activated = true,
             updated_at = now()
       where p.id = v_p.id
         and (p.role::text, p.organization_id, p.is_active, p.trainer_activated)
             is distinct from
             (v_roles[v_i], v_target_org, true, true);
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        v_status := 'aktualisiert';
        v_updated := v_updated + 1;
      else
        v_status := 'unverändert';
        v_unchanged := v_unchanged + 1;
      end if;
      select p.role::text, o.name into v_role_after, v_org_after
        from public_preview.profiles p
        left join public_preview.organizations o on o.id = p.organization_id
       where p.id = v_p.id;
    end if;

    insert into demo_bootstrap_report (sort_order, item, email, status, role, organization)
    values (2 + v_i, v_labels[v_i], v_emails[v_i], v_status, v_role_after, v_org_after);
  end loop;

  -- E. Information only: which catalogs the demo company has enabled right now.
  --    KfBM is not part of this script, the super admin switches it on in the
  --    web interface.
  select string_agg(c.code, ', ' order by c.code) into v_codes
    from public_preview.organization_catalogs oc
    join public_preview.training_catalogs c on c.id = oc.training_catalog_id
   where oc.organization_id = v_org_ids[2] and oc.is_enabled;
  insert into demo_bootstrap_report (sort_order, item, status)
  values (6, 'Kataloge des Demo-Betriebs (aktiv)', coalesce(v_codes, 'keiner') || '. Weitere Berufe schaltet der Superadmin in der Oberfläche frei');

  raise notice 'Fertig: % Konto/Konten aktualisiert, % unverändert, % übersprungen.', v_updated, v_unchanged, v_skipped;
  if v_skipped > 0 then
    raise notice 'ACHTUNG: % von 3 Konten übersprungen, Gründe in den Meldungen davor und in der Ergebnistabelle. Fehlt ein Profil: erst einmal anmelden (Konto in Supabase Auth, Anmeldung in der Preview), dann dieses Skript erneut ausführen.', v_skipped;
  end if;
end
$bootstrap$;

commit;

select item as "Eintrag", email as "E-Mail", status as "Ergebnis", role as "Rolle", organization as "Organisation"
  from pg_temp.demo_bootstrap_report
 order by sort_order;
