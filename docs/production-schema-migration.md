# Production Schema Migration Runbook

Use this runbook for the Supabase production schema migration. The migration is
schema-only and must not seed, delete, truncate, or rewrite production data,
except for setting `profiles.ausbildung_duration_years` to `3` where the new
column needs a safe default.

## Files

- Migration SQL:
  `supabase/migrations/202606260001_schema_only_ausbildung_duration.sql`
- Read-only verification SQL:
  `docs/production-schema-migration-verification.sql`

## Required Flow

1. Connect Supabase MCP to production.
2. Confirm the project ID/name in the MCP output before any write.
3. Run the read-only checks in
   `docs/production-schema-migration-verification.sql`.
4. Save the pre-migration row counts.
5. Apply only
   `supabase/migrations/202606260001_schema_only_ausbildung_duration.sql`
   through the Supabase MCP migration tool.
6. Run the same read-only verification SQL again.
7. Compare row counts. They must match, except that the verification should now
   show `profiles.ausbildung_duration_years` exists with default `3`, `NOT NULL`,
   and the `2` or `3` check constraint.
8. Deploy the app only after verification passes.

## Explicitly Forbidden

- `drizzle-kit push`
- `supabase db reset`
- Seed scripts
- Applying the full `src/db/migrations/drizzle` folder
- Seed/data-fix files such as
  `0036_fix_automation_use_case_planned_hours.sql`
- Any unrelated `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE`

## Expected App Behavior After Deploy

- Existing trainees default to a `3` year study plan.
- Trainers can change a trainee between `2` and `3` years in the app.
- Trainer and trainee Ausbildungnachweise views load from the same production
  schema without crashing on missing duration data.

---

## Runbook: Ausbildungskatalog-Migrationsreihe (KfBM-Umbau)

Dieser Abschnitt gilt für die Dateien `supabase/migrations/20261020000100` bis
`20261020001500` und `20261024000000` (PR 83). Die Migration von `202606260001` oben ist bereits in
Produktion angewendet und bleibt unverändert. Die Reihe ist bisher auf keiner
Datenbank angewendet worden. Sie wurde nur auf einer lokalen Wegwerf-Datenbank
(PostgreSQL 15 mit Stubs für `auth` und `storage`) geprüft, nicht auf einer
Kopie der Produktion.

## Gemessener Ausgangszustand (Produktion, nur lesend geprüft)

- 26 Kurse, 189 Enabler, 88 Use Cases; nur 4 Kurse haben gleich viele Enabler
  und Use Cases. Deshalb gibt es keine automatische Zuordnung von
  `use_cases.enabler_id`: Alle bestehenden FIAE-Use-Cases behalten `NULL`.
- Die Tabelle `training_catalogs` existiert nicht, die Spalte
  `profiles.ausbildung_duration_years` existiert.
- Es gibt keinen Trigger auf `auth.users`.
- Ledger `supabase_migrations.schema_migrations` existiert (letzte Version
  `20260227143256`), ein Drizzle-Ledger existiert nicht.
- Die App verbindet sich als Rolle `postgres` (BYPASSRLS). Bestehende
  Policies erlauben anonymes Lesen mehrerer Inhaltstabellen (bekanntes Thema,
  wird getrennt behoben). Die neuen Tabellen wiederholen das nicht.

## Dateien und Wirkung

| Datei | Wirkung |
| --- | --- |
| 000100 | Tabelle `training_catalogs` (FIAE, KFBM), `training_catalog_id` an `courses` und `training_components` per konstantem Default (kein Zeilen-Rewrite), Lernfeld- und Mapping-Tabellen. Stoppt bei zweitem Lauf. |
| 000200 | Spalte `code` an Kursen, Enablern, Use Cases (nullable, eindeutig je Katalog bzw. Kurs) |
| 000300, 000400 | `training_catalog_id` an Enablern, Use Cases, Mappings (Backfill per UPDATE), zusammengesetzte Fremdschlüssel (erst `NOT VALID`, dann validiert) |
| 000500 | Lernfeld-Modell: Daten aus `lernfelder` und `lernfeld_mappings` in die Katalogtabellen, Altbestand als `*_legacy` behalten, `lernfelder` und `lernfeld_mappings` werden Views |
| 000600 | `quizzes.training_catalog_id` (Default FIAE) und `training_component_id` |
| 000700 | `training_components.phase` (Backfill aus `training_year`) |
| 000800 | `use_cases.enabler_id` (nullable, eindeutig), Diagnose-View `v_use_case_enabler_backfill_report` |
| 000900 | `occupation_code`, `regulation_version`, `settings`, `elective_pick_count` |
| 001000 bis 001400 | `organization_catalogs`, `trainee_enrollments` (mit FIAE-Backfill), `training_components.kind`, `trainee_elective_choices` |
| 001500 | Enum-Wert `SUPER_ADMIN` (eigene Datei) |
| 20261024000000 | Backfill ADMIN der Plattform-Organisation zu SUPER_ADMIN, **technisch gesperrt** bis PR 89 angewendet ist und der App-Release bestätigt wurde (siehe Reihenfolge, Punkt 5) |

Daten werden verändert in: 000300 (UPDATE enablers, use_cases, mappings),
000500 (Kopie der Lernfelder), 000700 (UPDATE training_components), 001000
(INSERT Organisationen), 001200 (INSERT Einschreibungen), 001300 (UPDATE
training_components), 20261024000000 (UPDATE profiles). Die Aussage "keine
Produktivdaten geändert" gilt nur, solange die Reihe nicht angewendet ist.

## Reihenfolge

1. **Backup** der Produktionsdatenbank (Supabase-Backup bzw. `pg_dump`) und
   Notieren des Zeitpunkts. Wiederherstellung testen oder zumindest den Weg
   dokumentieren.
2. **Vorchecks** (nur lesend, siehe `docs/production-schema-migration-verification.sql`,
   Abschnitt "Katalogreihe, Vorchecks"): Zeilenzahlen, Postgres-Version (mindestens 15),
   `training_catalogs` fehlt, Ledger-Stand, Rolle `anon` und `authenticated`
   vorhanden.
3. **Reihenfolge-Regel für PR 89:** Die Migration
   `20261023200000_security_profiles_column_privileges.sql` MUSS vor
   `20261020001500` angewendet sein, weil sonst jeder angemeldete Nutzer seine
   eigene Rolle setzen könnte (die Reihe trägt ältere Versionsnummern). Vorcheck:
   `select has_column_privilege('authenticated','public.profiles','role','UPDATE');`
   muss `false` liefern. Die Datei 001500 und die Datei 20261024000000 prüfen das
   selbst und brechen sonst ab.
4. **Migration anwenden** (Dateien 000100 bis 001500) über die Release-Pipeline
   bzw. `supabase db push`. Jede Datei läuft in einer Transaktion mit
   `lock_timeout 5s` und `statement_timeout 60s`. Bricht eine Datei ab, wird
   nichts davon angewendet; ursächlich klären, nicht überspringen. Vor dem Push
   mit `supabase migration list` prüfen, dass die zwölfstellige Version
   `202606260001` im Ledger korrekt geführt wird und die neuen vierzehnstelligen
   Versionen danach einsortiert werden. Gegebenenfalls `supabase migration repair`.
5. **App deployen.** Die bestehenden Abfragen laufen unverändert weiter
   (`lernfelder` und `lernfeld_mappings` sind kompatible Views). Alle
   Rollenprüfungen der App behandeln `SUPER_ADMIN` mindestens wie `ADMIN`.
6. **Erst nach diesem App-Release:** Freigabe setzen
   (`comment on type public.user_role is 'super_admin_backfill=approved';`) und
   die Datei `20261024000000_super_admin_backfill.sql` anwenden. Ohne Freigabe
   oder ohne PR 89 bricht die Datei mit einer klaren Meldung ab, die Pipeline
   hält an dieser Stelle an (das Gate ist technisch, nicht nur ein Kommentar).
   Rückweg: `update public.profiles set role = 'ADMIN' where role = 'SUPER_ADMIN';`
7. **Nachchecks** (Abschnitt "Katalogreihe, Nachchecks" in der Verifikations-SQL):
   Zeilenzahlen der Bestandstabellen unverändert, alle Kurse und Komponenten im
   Katalog FIAE, `lernfelder` (View) liefert so viele Zeilen wie
   `lernfelder_legacy`, alle Constraints validiert, Policies der neuen Tabellen
   nur für `authenticated`.
8. **FIAE-Regression** in der App (Kursliste, Enabler, Use Cases, Lernfelder,
   Ausbildungsnachweis, Arbeitszeugnis).

## Verhaltensänderungen, auf die zu achten ist

- `lernfelder`: wiederholte Labels werden vom Schlüssel `(training_catalog_id, code)`
  abgelehnt; bei der Migration bekommen Duplikate den Zusatz "#2". Das
  Ausbildungsjahr wird aus der Nummer im Label abgeleitet (1 bis 5 Jahr 1,
  6 bis 10 Jahr 2, ab 11 Jahr 3), Herkunft: `scripts/seed-lernfelder.ts`.
- Das Löschen eines Enablers oder Use Cases entfernt jetzt dessen Lernfeld-Zuordnung
  (`ON DELETE CASCADE`), vorher wurde der Verweis auf NULL gesetzt.
- `enablers.training_catalog_id` und `use_cases.training_catalog_id` werden per
  Trigger aus dem Kurs abgeleitet. Ein Kurs mit Inhalt kann seinen Katalog nicht
  wechseln.
- Lesezugriff auf die Katalog- und Lernfeldtabellen nur noch für angemeldete
  Benutzer (Rolle `authenticated`); anonymes Lesen über die Supabase-API
  entfällt für die View `lernfelder`. Die App ist nicht betroffen
  (BYPASSRLS-Verbindung, kein Lesen dieser Tabellen mit dem anon-Schlüssel).
- Neue Tabellen `organization_catalogs`, `trainee_enrollments`,
  `trainee_elective_choices`: RLS an, nur `authenticated`, Lesen mit
  Organisationsbezug (`get_user_org_id()`), Schreiben Plattform-Owner bzw.
  Organisation. Keine Policy mit `USING (true)`, kein anonymer Zugriff.
- `trainee_enrollments` ist eine Momentaufnahme der Profile. Maßgeblich bleiben
  bis zur Umstellung der App `profiles.start_of_training_date` und
  `profiles.ausbildung_duration_years`.

## Rollback

`docs/rollback/20261020-kfbm-catalog-down.sql`. Nur sinnvoll, bis der erste
KfBM-Datensatz existiert; das Skript bricht sonst ab. Danach `supabase migration
repair --status reverted <Version>` für die Dateien der Reihe. Der Enum-Wert
`SUPER_ADMIN` bleibt bestehen (Postgres kann ihn nicht entfernen).

## Weiterhin verboten

`drizzle-kit push`, `supabase db reset`, Seed-Skripte gegen Produktion, das
Anwenden des Drizzle-Ordners, sowie das Anwenden einer Datei der Reihe ohne
Backup und Vorchecks.
