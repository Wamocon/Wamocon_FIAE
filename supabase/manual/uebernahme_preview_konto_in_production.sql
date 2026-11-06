-- =============================================================================
-- Ein Preview-Testkonto als echtes Konto in Production übernehmen
-- =============================================================================
-- Wann: Die Benutzerverwaltung in Production meldet beim Anlegen "Diese E-Mail-Adresse ist bereits vergeben" (ein
-- Plattform-Administrator sieht zusätzlich "Testkonto aus der Preview"). Preview und Production teilen sich die
-- Anmeldung (auth.users). Ein in der Preview angelegtes Konto trägt app_metadata.preview_only = true und hat nur dort
-- ein Profil. Production weist solche Konten ab.
--
-- Ausführen: Supabase Dashboard, SQL Editor, Projekt FIAE-Production. VORHER die drei Werte unter "anpassen" ändern.
-- EIN DO-Block (eine Anweisung): atomar. Er bricht ab, ohne etwas zu ändern, wenn
--   - die Rolle nicht TRAINEE, TRAINER oder TEMP_ADMIN ist (wie bei POST /api/admin/users; ADMIN und SUPER_ADMIN
--     werden nicht angelegt, sondern befördert),
--   - es kein Anmeldekonto zu der Adresse gibt,
--   - das Konto KEIN Preview-Testkonto ist (es also schon ein echtes Konto sein könnte),
--   - es in Production schon ein Profil gibt.
--
-- Was er tut: entfernt preview_only, legt das Production-Profil an (Namen aus dem Preview-Profil, freigeschaltet wie
-- bei der Anlage durch einen Administrator) und bei einem Auszubildenden die Einschreibung in den gewählten Beruf.
--
-- Passwort: Das Passwort des Preview-Kontos ist den Testern bekannt und gilt in beiden Umgebungen. Das Skript setzt
-- deshalb ein zufälliges Passwort und beendet alle Sitzungen. Die Person meldet sich über "Passwort vergessen" auf
-- der Anmeldeseite an und wählt ein eigenes Passwort. Nicht erledigt (wie bei POST /api/admin/users): Prüfung der
-- Plätze der Organisation (maxTraineeSeats, maxTrainerSeats) und die Zugangsdaten-E-Mail. Plätze vorher prüfen.
-- =============================================================================
do $uebernahme$
declare
  -- anpassen --------------------------------------------------------------
  v_email   text := 'name@beispiel.de';
  v_role    text := 'TRAINEE';   -- TRAINEE, TRAINER oder TEMP_ADMIN
  v_catalog text := 'KFBM';      -- nur bei TRAINEE: Code des Berufs (KFBM oder FIAE)
  -- -----------------------------------------------------------------------
  v_user uuid; v_flag jsonb; v_org uuid; v_cat uuid; v_cat_years int;
begin
  if upper(v_role) not in ('TRAINEE', 'TRAINER', 'TEMP_ADMIN') then
    raise exception 'Abbruch: Rolle % nicht erlaubt (TRAINEE, TRAINER oder TEMP_ADMIN), nichts geändert', v_role;
  end if;

  select u.id, u.raw_app_meta_data -> 'preview_only' into v_user, v_flag
  from auth.users u where lower(u.email) = lower(v_email) order by u.created_at limit 1;
  if v_user is null then
    raise exception 'Abbruch: kein Anmeldekonto für %, nichts geändert', v_email;
  end if;
  if v_flag is distinct from 'true'::jsonb then
    raise exception 'Abbruch: % ist kein Preview-Testkonto (preview_only fehlt), nichts geändert', v_email;
  end if;
  if exists (select 1 from public.profiles p where p.id = v_user) then
    raise exception 'Abbruch: % hat in Production schon ein Profil, nichts geändert', v_email;
  end if;

  select o.id into v_org from public.organizations o where o.is_platform_owner limit 1;
  if v_org is null then raise exception 'Abbruch: keine Plattform-Organisation gefunden'; end if;

  if upper(v_role) = 'TRAINEE' then
    select t.id, t.duration_years into v_cat, v_cat_years from public.training_catalogs t where upper(t.code) = upper(v_catalog);
    if v_cat is null then raise exception 'Abbruch: Beruf % nicht gefunden, nichts geändert', v_catalog; end if;
  end if;

  -- Kennzeichen entfernen, zufälliges Passwort, alle Sitzungen beenden
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'preview_only',
         encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))
   where id = v_user;
  delete from auth.sessions where user_id = v_user;
  delete from auth.refresh_tokens where user_id = v_user::text;

  insert into public.profiles (id, email, full_name, first_name, last_name, role, is_active, trainer_activated, organization_id)
  select u.id, lower(u.email), coalesce(pp.full_name, split_part(u.email, '@', 1)), pp.first_name, pp.last_name,
         upper(v_role)::public.user_role, true, true, v_org
  from auth.users u
  left join public_preview.profiles pp on pp.id = u.id
  where u.id = v_user;

  if upper(v_role) = 'TRAINEE' then
    insert into public.trainee_enrollments (trainee_id, training_catalog_id, duration_years)
    values (v_user, v_cat, v_cat_years);
  end if;

  raise notice 'Übernommen: % als % in Production. Die Person setzt ihr Passwort über "Passwort vergessen" neu.', v_email, upper(v_role);
end
$uebernahme$;
