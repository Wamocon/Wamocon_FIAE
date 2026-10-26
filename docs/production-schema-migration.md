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

Dieser Abschnitt gilt für die Dateien `supabase/migrations/20261024000100` bis
`20261024001500`, `20261025000000`, die Sicherheitsdatei `20261025000100`,
die Folgedateien `20261026000100` und `20261027000100` und die drei Dateien
`20261028000100` bis `20261028000300` zur Vorbereitung des KfBM-Inhaltsimports
(PR 83 und später). Die Migration von
`202606260001` oben ist bereits in Produktion
angewendet und bleibt unverändert. Die Reihe ist in Produktion noch nicht
angewendet. Geprüft ist sie auf einer lokalen Wegwerf-Datenbank (PostgreSQL 15
mit Stubs für `auth` und `storage`) und, Stand 23.10.2026, in der
Preview-Umgebung gegen den Strukturklon der Produktion (echte Struktur, 60
Tabellen, 95 Policies): Alle Dateien laufen dort durch. Die Preview-Tabellen sind
leer, die Datenanteile (Kopie der Lernfelder, Einschreibungs-Backfill) sind dort
also nur strukturell geprüft, nicht mit den echten Zeilen.

## Gemessener Ausgangszustand (Produktion, nur lesend geprüft)

- 26 Kurse, 189 Enabler, 88 Use Cases; nur 4 Kurse haben gleich viele Enabler
  und Use Cases. Deshalb gibt es keine automatische Zuordnung von
  `use_cases.enabler_id`: Alle bestehenden FIAE-Use-Cases behalten `NULL`.
- `lernfelder` trägt neben den Spalten von Drizzle 0026 fünf leere Zusatzspalten
  (`code`, `training_year`, `hours_budget`, `is_common`, `order_index`): 12 Zeilen
  LF-1 bis LF-12, alle Zusatzspalten NULL, `is_common` überall `true`,
  `lernfeld_mappings` leer. Die Datei 000500 akzeptiert die Spalten, solange sie
  leer sind, und bricht bei einem Wert ab.
- Alle 246 Objekte in `public` gehören `postgres`. Auf dem Schema `public` hält
  `PUBLIC` das Recht `CREATE` (ACL `=UC`), das die Datei `20261025000100` entzieht.
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
| 20261025000000 | Backfill ADMIN der Plattform-Organisation zu SUPER_ADMIN, **technisch gesperrt** bis PR 89 angewendet ist und der App-Release bestätigt wurde (siehe Reihenfolge, Punkt 5) |
| 20261025000100 | Sicherheitsdatei: `revoke create on schema public from public`. Eine einzige Anweisung, ändert keine Daten. Sie liegt hinter dem Backfill und wird deshalb erst nach dessen Freigabe angewendet (Punkt 6). Rückweg: `grant create on schema public to public;` |
| 20261026000100 | Genau eine Einschreibung je Azubi: eindeutiger Index `trainee_enrollments_trainee_unique` auf `trainee_enrollments (trainee_id)`. Die Vorprüfung bricht mit einer Meldung samt Anzahl ab, wenn ein Azubi mehr als eine Einschreibung hat, und löscht nichts. Ändert keine Daten, `create unique index` ohne `concurrently` (die Datei läuft in einer Transaktion), die Tabelle ist klein. Sie liegt hinter dem Backfill und wird deshalb ebenfalls erst nach dessen Freigabe angewendet. Rückweg: `drop index public.trainee_enrollments_trainee_unique;` |
| 20261027000100 | HAI-Index, Beruf und Lösungsschutz (Paket H1): Spalten `training_catalog_id`, `visibility` (`all` oder `trainer`) und `organization_id` an `hai_embeddings`, Index `idx_hai_embeddings_scope`, drei Ableitungsfunktionen, ein BEFORE-Trigger auf `hai_embeddings`, der die Spalten für Zeilen der bestehenden Schreibpfade füllt, und ein AFTER-Trigger auf `content_documents`, der Chunks mitnimmt, wenn ein Dokument später Lösung oder `TRAINER_ONLY` wird oder die Organisation wechselt. Backfill in reinem SQL, ohne Modellaufruf, kein erneutes Einbetten: Der Katalog kommt je Quelle aus Enabler, Kurs, Use Case, Quiz, Dokument, Lernfeld oder Komponente, persönliche Zeilen über die Einschreibung. Zeilen ohne ableitbaren Katalog gehen an FIAE, die Zahl je `source_type` steht als `raise notice` im Lauf, die Datei bricht deshalb nicht ab. `visibility = 'trainer'` für Lösungsseiten (`TRAINER_SOLUTION`), Dokumente mit `TRAINER_ONLY` und jeden Quiz-Chunk (Fragen und Antworten liegen im selben Text, ein Folge-Chunk kann das Ende einer Antwort ohne Marker tragen). Abbruch nur in den Vorprüfungen (Tabelle, Katalogreihe, FIAE-Katalog fehlen). Ein UPDATE berührt jede Zeile, die einen Wert braucht, einmal, `create index` ohne `concurrently`. Die Sperre des `alter table` (ACCESS EXCLUSIVE auf `hai_embeddings`) gilt bis zum Ende der Datei, also auch während des Backfills: im Wartungsfenster anwenden. Die Datei liegt hinter dem Katalog und wird deshalb erst nach der Freigabe angewendet. Der App-Code von H1 setzt die Spalten voraus: App-Release erst nach dieser Datei. Rückweg: Kopfkommentar der Datei. |
| 20261028000100 | Kurs und Komponente verbinden: `courses.training_component_id` (nullable), zusammengesetzter Fremdschlüssel `courses_component_catalog_fk` auf `training_components (id, training_catalog_id)` (`on delete restrict`), eindeutiger Index `courses_training_component_unique` (höchstens ein Kurs je Komponente). Backfill nur dort, wo Kurs und Komponente im selben Katalog denselben Code tragen und die Komponente noch frei ist. Die FIAE-Kurse haben keinen Code und bleiben `NULL`, das ist kein Fehler (die Datei meldet die Zahlen mit `raise notice`). Rückweg: Index, Constraint und Spalte entfernen (Kopfkommentar der Datei). |
| 20261028000200 | `quizzes.code` (nullable, gleiches Format wie die anderen Codes, eindeutig je Katalog wo gesetzt) und Katalogprüfung für Quiz-Verknüpfungen: Trigger `enabler_quiz_links_catalog_check` verlangt, dass Quiz und Enabler (über den Kurs) im selben Katalog liegen, ein zweiter Trigger schützt den Katalog eines schon verknüpften Quiz. Die Vorprüfung bricht mit der Zahl der Verstöße ab und ändert nichts. Rückweg im Kopfkommentar der Datei. |
| 20261028000300 | Eindeutig `(component_id, letter)` auf `training_use_cases` (Vorprüfung bricht mit der Zahl der Dubletten ab, löscht nichts) und `options.order_index` (nullable, ohne Standardwert, kein Umschreiben der Tabelle). Rückweg im Kopfkommentar der Datei. |

Daten werden verändert in: 000300 (UPDATE enablers, use_cases, mappings),
000500 (Kopie der Lernfelder), 000700 (UPDATE training_components), 001000
(INSERT Organisationen), 001200 (INSERT Einschreibungen), 001300 (UPDATE
training_components), 20261025000000 (UPDATE profiles), 20261027000100 (UPDATE
hai_embeddings), 20261028000100 (UPDATE courses, nur bei gleichem Code von Kurs und
Komponente, für FIAE heute keine Zeile). Die Aussage "keine Produktivdaten geändert"
gilt nur, solange die Reihe nicht angewendet ist.

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
   `20261024001500` angewendet sein, weil sonst jeder angemeldete Nutzer seine
   eigene Rolle setzen könnte (die Reihe trägt ältere Versionsnummern). Vorcheck:
   `select has_column_privilege('authenticated','public.profiles','role','UPDATE');`
   muss `false` liefern. Die Datei 001500 und die Datei 20261025000000 prüfen das
   selbst und brechen sonst ab.
4. **Migration anwenden** (Dateien 000100 bis 001500) über die Release-Pipeline
   bzw. `supabase db push`. Jede Datei läuft in einer Transaktion mit
   `lock_timeout 5s` und `statement_timeout 60s`. Bricht eine Datei ab, wird
   nichts davon angewendet; ursächlich klären, nicht überspringen. Vor dem Push
   mit `supabase migration list` prüfen, dass die zwölfstellige Version
   `202606260001` im Ledger korrekt geführt wird und die neuen vierzehnstelligen
   Versionen danach einsortiert werden. Gegebenenfalls `supabase migration repair`.
   **Freigabe:** Die Release-Pipeline wendet die Reihe nur an, wenn der Eigentümer
   die Repository-Variable `KFBM_ROLLOUT_APPROVED` auf `true` gesetzt hat (Schritt
   "Rollout gate" im Release-Workflow). Vorher bricht ein Release, dessen Plan eine
   Datei ab Version `20261024000100` enthält, vor dem Anwenden ab, es ändert sich
   nichts. Die Variable steht bis zum Rollout auf `false`.
5. **App deployen.** Die bestehenden Abfragen laufen unverändert weiter
   (`lernfelder` und `lernfeld_mappings` sind kompatible Views). Alle
   Rollenprüfungen der App behandeln `SUPER_ADMIN` mindestens wie `ADMIN`.
6. **Erst nach diesem App-Release:** Freigabe setzen
   (`comment on type public.user_role is 'super_admin_backfill=approved';`) und
   die Datei `20261025000000_super_admin_backfill.sql` anwenden. Ohne Freigabe
   oder ohne PR 89 bricht die Datei mit einer klaren Meldung ab, die Pipeline
   hält an dieser Stelle an (das Gate ist technisch, nicht nur ein Kommentar).
   Rückweg: `update public.profiles set role = 'ADMIN' where role = 'SUPER_ADMIN';`
   Danach läuft die Sicherheitsdatei `20261025000100` (Widerruf von `CREATE` auf
   `public` für `PUBLIC`), weil sie hinter dem Backfill einsortiert ist. Vorcheck
   und Nachcheck: `04-verify.sql`, Abfrage 4 (`create_priv` auf `public`) muss von
   `true` auf `false` wechseln. Als Nächstes läuft `20261026000100` (eindeutiger
   Index auf `trainee_enrollments (trainee_id)`). Vorcheck (nur lesend): Abfrage
   C11 der Verifikations-SQL muss null Zeilen liefern, sonst bricht die Datei
   mit einer Meldung ab und ändert nichts. Nachcheck: Abfrage C11b. Danach läuft
   `20261027000100` (HAI-Index, Beruf und Lösungsschutz). Vorcheck (nur lesend):
   Abfrage C12 der Verifikations-SQL zeigt die Zeilen je `source_type`. Im Lauf die
   Meldungen `raise notice` lesen: Zeilen ohne ableitbaren Katalog gehen an FIAE.
   Nachcheck: Abfrage C12b (keine Zeile ohne Katalog, Lösungsseiten und alle
   Quiz-Chunks haben `trainer`). Vor der Freigabe die Organisationsverteilung der
   Dokumente prüfen (Abfrage C12a): Tragen die Plattform-PDFs die Organisation der
   Plattform statt NULL, sehen Kundenorganisationen sie in der HAI nicht mehr. Ein Reindex ist nicht nötig.
   Danach laufen `20261028000100` bis `20261028000300` (Vorbereitung des
   KfBM-Inhaltsimports). Vorchecks (nur lesend): Abfrage C15 (Quiz-Verknüpfungen
   über Katalogen hinweg) und C16 (doppelte Buchstaben je Komponente) müssen null
   Zeilen liefern, sonst brechen die Dateien `20261028000200` und
   `20261028000300` mit einer Meldung samt Anzahl ab und ändern nichts. Nachcheck:
   Abfrage C15b. Der Backfill von `20261028000100` meldet die Zahlen im Protokoll
   (für FIAE ist null verknüpft die erwartete Zahl: `courses.code` erlaubt kein
   `§`, die Codes der FIAE-Komponenten beginnen damit). Der App-Release mit den
   neuen Spalten (`courses.training_component_id`, `quizzes.code`,
   `options.order_index`) folgt erst nach `20261028000300`, weil Abfragen über
   `courses`, `quizzes` und `options` alle Spalten nennen. Die Dateien nehmen
   kurz eine Sperre auf diese Tabellen (`lock_timeout` 5 Sekunden), am besten
   außerhalb der Stoßzeiten anwenden.
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
- Lesezugriff auf `training_catalogs`, `training_catalog_learning_fields` und
  `training_catalog_content_mappings` nur für angemeldete Benutzer (Rolle
  `authenticated`) und nur für aktive Kataloge, die für die eigene Organisation in
  `organization_catalogs` freigegeben sind (Funktion
  `can_read_training_catalog`); der Plattformbesitzer sieht alles. Ein inaktiver
  Katalog (KfBM vor dem Release) bleibt für Kundenorganisationen unsichtbar.
  Schreiben dürfen nur Plattformbesitzer; TRUNCATE, REFERENCES und TRIGGER sind
  für anon und authenticated entzogen (TRUNCATE ignoriert RLS). Die App ist nicht
  betroffen (BYPASSRLS-Verbindung, kein Lesen mit dem anon-Schlüssel).
- Die Altbestände `lernfelder_legacy` und `lernfeld_mappings_legacy` sind für
  anon und authenticated gesperrt (alle Policies entfernt, alle Rechte entzogen),
  ebenso der anonyme Zugriff auf die Views `lernfelder` und `lernfeld_mappings`.
  Vorher waren die Altbestände anonym lesbar (`lf_select_all`, `lfm_select_all`).
- Neue Tabellen `organization_catalogs`, `trainee_enrollments`,
  `trainee_elective_choices`: RLS an, nur Lesen für `authenticated` mit
  Organisationsbezug (`get_user_org_id()`). INSERT, UPDATE, DELETE, TRUNCATE,
  REFERENCES und TRIGGER sind für anon und authenticated entzogen, geschrieben
  wird nur serverseitig (Rolle postgres bzw. service_role). Keine Policy mit
  `USING (true)`, kein anonymer Zugriff.
- Ableitungs-Trigger (Katalog aus Kurs, Lernfeld, Einschreibung) laufen als
  SECURITY DEFINER mit festem search_path; EXECUTE auf die neuen Funktionen ist
  für PUBLIC und anon entzogen.
- Wahlkomponenten: Das Limit gilt auch bei späteren Änderungen. Das Senken von
  `elective_pick_count` unter bestehende Wahlen und der Wechsel der Art
  (`kind`) einer gewählten Wahlkomponente werden abgelehnt.
- Lernfeld-Routen: Ein doppeltes Label ergibt `409` mit klarer Meldung statt
  `500`; eine Label-Änderung berechnet das Ausbildungsjahr neu; die
  Reihenfolge-Nummer wird unter einem Advisory-Lock vergeben.
- Preview: Die Dateien der Reihe wurden mit `scripts/db/preview-rewrite.mjs`
  (PR 86) umgeschrieben und auf einem Schema `public_preview` einer
  Wegwerf-Datenbank ausgeführt; Katalog-Prüfungen nutzen
  `to_regclass('public.<Tabelle>')`, `pg_attribute`, `pg_policy` und
  `connamespace` statt des Schemawerts als Zeichenkette. Gate und
  Rollenprüfungen sind mit `-- preview:skip` gerahmt.
- `trainee_enrollments` ist eine Momentaufnahme der Profile. Maßgeblich bleiben
  bis zur Umstellung der App `profiles.start_of_training_date` und
  `profiles.ausbildung_duration_years`.
- Quiz und Enabler müssen im selben Katalog liegen. Ab `20261028000200` weist die
  Datenbank eine Verknüpfung (`enabler_quiz_links`) mit einem Quiz eines anderen
  Katalogs ab (`check_violation`, die Meldung nennt beide Kataloge). Die
  Trainer-Routen setzen den Katalog des Quiz schon aus dem Enabler, sie sind
  nicht betroffen. Wer sonst Quizze für einen Enabler eines anderen Berufs
  anlegt, muss `quizzes.training_catalog_id` selbst setzen (der Standard ist FIAE).
- Ein Kurs, der mit einer Komponente verbunden ist (`courses.training_component_id`),
  hält diese fest: Die Komponente lässt sich nicht löschen (`on delete restrict`).
  Das Seed-Skript für die FIAE-Komponenten löscht Komponenten und scheitert dann
  laut, sobald ein FIAE-Kurs verbunden ist.
- Ein Azubi hat genau eine Einschreibung. Der Berufswechsel ersetzt sie (die
  Administration löscht die anderen Einschreibungen in derselben Transaktion,
  `setTraineeEnrollment`). Ab `20261026000100` sichert ein eindeutiger Index auf
  `trainee_id` das in der Datenbank ab: Eine zweite Einschreibung desselben
  Azubis scheitert mit `unique_violation`.

- HAI-Index (ab `20261027000100`): Die Suche der HAI filtert im SQL, vor dem
  `LIMIT`, nach Beruf (`training_catalog_id` aus dem Katalogbereich des Nutzers),
  Sichtbarkeit und Organisation. Azubis bekommen keine Lösungen (Use-Case-Lösungsseiten,
  Quiz-Antworten, erwartete Antworten), weder im Kontext noch in Zitaten, und keine
  Inhalte eines anderen Berufs. Zeilen ohne Katalog sind für niemanden sichtbar. Der
  PageIndex liest keine Lösungs-PDFs für Azubis und setzt in Zitaten nur dann die
  öffentliche `storage_url`, wenn das Dokument für Azubis sichtbar ist. Die
  Schreibpfade setzen die neuen Spalten noch nicht selbst, ein Trigger leitet sie aus
  der Quelle ab (Folgepaket H2 setzt sie ausdrücklich).

## Rollback

`docs/rollback/20261024-kfbm-catalog-down.sql`. Nur sinnvoll, bis der erste
KfBM-Datensatz existiert; das Skript bricht sonst ab. Danach `supabase migration
repair --status reverted <Version>` für die Dateien der Reihe. Der Enum-Wert
`SUPER_ADMIN` bleibt bestehen (Postgres kann ihn nicht entfernen).

## Weiterhin verboten

`drizzle-kit push`, `supabase db reset`, Seed-Skripte gegen Produktion, das
Anwenden des Drizzle-Ordners, sowie das Anwenden einer Datei der Reihe ohne
Backup und Vorchecks.
