-- =============================================================================
-- Ein Preview-Testkonto als echtes Konto in Production übernehmen
-- =============================================================================
-- Wann: Die Benutzerverwaltung in Production meldet beim Anlegen "Für diese E-Mail-Adresse gibt es bereits ein
-- Anmeldekonto, aber noch kein Profil in dieser Umgebung". Preview und Production teilen sich die Anmeldung
-- (auth.users). Ein in der Preview angelegtes Konto trägt app_metadata.preview_only = true und hat nur dort ein
-- Profil. Production weist solche Konten ab.
--
-- Ausführen: Supabase Dashboard, SQL Editor, Projekt FIAE-Production. VORHER die drei Werte unter "anpassen" ändern.
-- EIN DO-Block (eine Anweisung): atomar. Er bricht ab, ohne etwas zu ändern, wenn
--   - es kein Anmeldekonto zu der Adresse gibt,
--   - das Konto KEIN Preview-Testkonto ist (es also schon ein echtes Konto sein könnte),
--   - es in Production schon ein Profil gibt.
--
-- Was er tut: entfernt preview_only, legt das Production-Profil an (Namen aus dem Preview-Profil) und bei einem
-- Auszubildenden die Einschreibung in den gewählten Beruf.
--
-- ACHTUNG Passwort: Das Passwort des Kontos gilt danach weiter in Preview UND Production. Testkonten teilen sich oft
-- ein Passwort. Die Person sollte es bei der ersten Anmeldung ändern ("Passwort vergessen" auf der Anmeldeseite).
-- =============================================================================
do $uebernahme$
declare
  -- anpassen --------------------------------------------------------------
  v_email   text := 'name@beispiel.de';
  v_role    text := 'TRAINEE';   -- TRAINEE, TRAINER oder ADMIN
  v_catalog text := 'KFBM';      -- nur bei TRAINEE: Code des Berufs (KFBM oder FIAE), sonst egal
  -- -----------------------------------------------------------------------
  v_user uuid; v_flag text; v_org uuid; v_cat uuid; v_cat_years int;
begin
  select u.id, u.raw_app_meta_data ->> 'preview_only' into v_user, v_flag
  from auth.users u where lower(u.email) = lower(v_email);
  if v_user is null then
    raise exception 'Abbruch: kein Anmeldekonto für %, nichts geändert', v_email;
  end if;
  if v_flag is distinct from 'true' then
    raise exception 'Abbruch: % ist kein Preview-Testkonto (preview_only fehlt), nichts geändert', v_email;
  end if;
  if exists (select 1 from public.profiles p where p.id = v_user) then
    raise exception 'Abbruch: % hat in Production schon ein Profil, nichts geändert', v_email;
  end if;

  select o.id into v_org from public.organizations o where o.is_platform_owner limit 1;
  if v_org is null then raise exception 'Abbruch: keine Plattform-Organisation gefunden'; end if;

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'preview_only'
   where id = v_user;

  insert into public.profiles (id, email, full_name, first_name, last_name, role, is_active, organization_id)
  select u.id, u.email, coalesce(pp.full_name, split_part(u.email, '@', 1)), pp.first_name, pp.last_name,
         upper(v_role)::public.user_role, true, v_org
  from auth.users u
  left join public_preview.profiles pp on lower(pp.email) = lower(u.email)
  where u.id = v_user;

  if upper(v_role) = 'TRAINEE' then
    select t.id, t.duration_years into v_cat, v_cat_years from public.training_catalogs t where upper(t.code) = upper(v_catalog);
    if v_cat is null then raise exception 'Abbruch: Beruf % nicht gefunden, alles zurückgerollt', v_catalog; end if;
    insert into public.trainee_enrollments (trainee_id, training_catalog_id, duration_years)
    values (v_user, v_cat, v_cat_years);
  end if;

  raise notice 'Übernommen: % als % in Production. Passwort ändern lassen (gilt auch in der Preview).', v_email, upper(v_role);
end
$uebernahme$;
