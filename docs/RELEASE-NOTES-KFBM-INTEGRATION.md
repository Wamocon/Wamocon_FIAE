# KfBM-Integration: Release Notes für den Merge Request (PR 83)

## Zusammenfassung

Diese Änderung legt die Datenmodell-Grundlage für die Integration von Kaufleuten
für Büromanagement (KfBM) als zweite Fachrichtung im LFA-Lernzentrum. Der
bestehende FIAE-Betrieb bleibt der Referenzpfad. Es werden keine KfBM-Inhalte
importiert und kein Anwendungscode umgestellt.

**Wichtig zum Datenbestand:** Die Migrationsreihe `supabase/migrations/20261024*`
enthält UPDATE- und INSERT-Anweisungen auf bestehende Produktivdaten (Kurse,
Enabler, Use Cases, Komponenten, Lernfelder, Organisationen, Profile). Die
Aussage "keine Produktivdaten geändert" gilt nur, solange die Reihe nirgends
angewendet ist. Das ist aktuell der Fall: Die Reihe wurde auf keiner Datenbank
angewendet, nur auf einer lokalen Wegwerf-Datenbank geprüft (siehe unten).

## Enthalten

- Ausbildungskataloge FIAE und KFBM; Kurse, Komponenten, Enabler, Use Cases,
  Quizze und Lernfeld-Zuordnungen tragen eine `training_catalog_id`. Zusammengesetzte
  Fremdschlüssel verhindern, dass eine KfBM-Zuordnung auf FIAE-Inhalt zeigt.
- Stabiler Textcode (`code`) an Kursen, Enablern und Use Cases, eindeutig je
  Katalog bzw. Kurs, mit Formatprüfung.
- Ein Lernfeld-Modell: `training_catalog_learning_fields` und
  `training_catalog_content_mappings`. `lernfelder` und `lernfeld_mappings` bleiben
  als kompatible Views bestehen, der Altbestand liegt als `*_legacy`.
- Quizze sind an Katalog und Komponente gebunden (ein Global-Quiz je Komponente).
- `training_components.phase` und `kind` (Pflicht, Wahl, integrativ).
- `use_cases.enabler_id` (nullable, eindeutig, Fremdschlüssel auf Enabler des
  gleichen Kurses) und die Diagnose-View `v_use_case_enabler_backfill_report`.
  **Keine automatische Zuordnung:** Produktion hat 26 Kurse, 189 Enabler und 88
  Use Cases, nur 4 Kurse haben gleich viele. Alle bestehenden FIAE-Use-Cases
  behalten `NULL`. Der KfBM-Import setzt die Verknüpfung explizit.
- `training_catalogs`: `occupation_code`, `regulation_version`, `settings` (jsonb),
  `elective_pick_count`. TypeScript-Helfer `src/lib/catalog/settings.ts` mit
  Standardwerten und Validierung (noch von keinem Aufrufer genutzt).
- `organization_catalogs`, `trainee_enrollments` (Momentaufnahme der Profile),
  `trainee_elective_choices` (höchstens `elective_pick_count` Wahlkomponenten,
  geprüft per Constraint-Trigger).
- Rolle `SUPER_ADMIN` als Enum-Wert (eigene Datei) und ein Backfill, der erst nach
  dem App-Release angewendet werden darf.
- Zugriffsschutz: Alle Policies der Katalogtabellen und neuen Tabellen gelten nur
  für `authenticated`. Kein anonymes Lesen, keine Policy mit `USING (true)` für
  public oder anon. Katalog, Lernfelder und Zuordnungen sind nur für aktive,
  für die eigene Organisation freigegebene Kataloge lesbar. Die Tabellen
  `organization_catalogs`, `trainee_enrollments` und `trainee_elective_choices`
  sind für die API-Rollen nur lesbar (kein INSERT, UPDATE, DELETE, TRUNCATE), die
  Altbestände der Lernfelder sind gesperrt. TRUNCATE ist auf den Katalogtabellen
  für authenticated entzogen.
- Seed (`seed-training-data.ts`, `seed-lernfelder.ts`) sowie Export und Import der
  Inhalte tragen die Katalogspalten. Der Seed löscht nur FIAE-Daten und verschluckt
  keine Fehler mehr.
- Rollback-Skript `docs/rollback/20261024-kfbm-catalog-down.sql`, Runbook in
  `docs/production-schema-migration.md`, Vor- und Nachchecks in
  `docs/production-schema-migration-verification.sql`.
- Projekt-Onepager, Zeitplan und HAI-Vorgehen.

## Katalogfilter in App und API (Paket 3.1)

- Zentraler Helfer `src/lib/catalog/scope.ts`: Der Katalogbereich eines Nutzers
  kommt aus Sitzung und Datenbank (Azubi: Einschreibung, sonst FIAE; Trainer,
  Admin: in `organization_catalogs` aktivierte Kataloge; SUPER_ADMIN: alle). Die
  aktive Auswahl über Header `x-catalog` oder Query `catalog` wird dagegen
  geprüft, ein fremder oder unbekannter Wert ergibt 403. Bei einem Fehler gibt es
  keinen Zugriff (503 bzw. 403), nie alle Kataloge.
- Gefiltert sind die Routen auf Kurse, Enabler, Use Cases, Quizze (auch Global),
  Lernfelder, die Trainer- und Azubi-Listen sowie der lesende HAI-Datenkontext.
  Schreibzugriffe prüfen, dass das Elternobjekt im erlaubten Katalog liegt, neue
  Datensätze erhalten den aktiven Katalog. Fremde Datensätze antworten mit 404.
- Öffentliche Listen `/api/training-components` und `/api/training-use-cases`:
  Parameter `catalog` (Code, Standard FIAE), nur aktive Kataloge, Katalog im
  URL-Cache-Schlüssel, `X-Catalog` und `Vary` in den Antwortköpfen.
- Cache-Schlüssel der authentifizierten Listen enthalten den Katalogbereich.
- Die Lernfeld-Routen lesen und schreiben jetzt `training_catalog_learning_fields`
  (Antwortform unverändert, `label` ist der Code). Ohne Sitzung gilt der aktive
  öffentliche Katalog; die Oberfläche sendet das Token jetzt mit.
- Noch nicht gefiltert (Azubi-eigene Daten oder späteres Paket): Aktivitätsnachweise,
  Arbeitszeugnis-Routen, Trainer-Azubi-Übersichten, Feedback, Breadcrumb,
  HAI-Chat, HAI-Index und HAI-Sync.

## Noch nicht Bestandteil dieser Änderung

- Migration anwenden oder Schema in Produktion ausrollen.
- Katalogauswahl und Katalogfilter in UI, APIs, Nutzerzuordnung und Berechtigungen.
- Umstellung der Arbeitszeugnis-Aufrufer auf die Katalog-Settings.
- Umstellung der App auf die Rolle `SUPER_ADMIN`.
- Migration der Text-Arrays `courses.lernfelder` und `use_cases.lernfelder`.
- Import der KfBM-Lernfelder, Komponenten, Mappings und Content-Dateien.
- HAI-Indexierung aller KfBM-Inhalte oder Sprachaufnahme und -ausgabe.
- Produktivfreigabe von KfBM.

## FIAE-Kompatibilität und Datenbanksicherheit

- Bestehende Zeilen werden FIAE zugeordnet: bei Kursen, Komponenten und Quizzen
  über einen konstanten Spalten-Default (kein Rewrite), bei Enablern, Use Cases
  und Mappings über einen UPDATE-Backfill aus dem Elternobjekt.
- Neue Zeilen erhalten FIAE als Default, bis App und API bewusst einen Katalog wählen.
- Jede Datei hat Lock- und Statement-Timeouts, kein explizites BEGIN/COMMIT und
  Vorprüfungen. Die Dateien sind gegen einen Zweitlauf abgesichert: Wo ein Zweitlauf
  nicht sinnvoll ist (000100, 000500), bricht die Vorprüfung mit klarer Meldung ab,
  alle anderen sind idempotent.
- Verhaltensänderungen: Wiederholte Lernfeld-Labels werden abgelehnt (bei der
  Migration mit dem Suffix "#2" versehen); das Löschen eines Enablers oder Use Cases
  entfernt dessen Lernfeld-Zuordnung; Lesezugriff auf Katalog- und Lernfeldtabellen
  nur für angemeldete Benutzer mit freigegebenem, aktivem Katalog; ein doppeltes
  Label in der Lernfeld-Route ergibt 409.
- Reihenfolge: PR 89 (`20261023200000`, Spaltenrechte auf profiles) muss vor
  `20261024001500` angewendet sein; die Dateien prüfen das. Das SUPER_ADMIN-Gate
  der Datei `20261025000000` ist technisch erzwungen (PR 89 plus Freigabe
  per `comment on type public.user_role`), die Datei bricht sonst ab.
- Rollenprüfungen der App (Server und Browser) laufen über
  `src/lib/auth/roles.ts`, SUPER_ADMIN hat überall mindestens die Rechte von ADMIN.
- Hinweis: "Keine Produktivdaten geändert" gilt nur ohne Anwendung der Reihe.
- Migrationsreihenfolge und Rollout: siehe Runbook. Die Datei 20261025000000
  (SUPER_ADMIN-Backfill) erst nach dem passenden App-Release.

## Prüfungen

- `npm run type-check`: erfolgreich.
- ESLint und Prettier auf den geänderten TypeScript-Dateien: erfolgreich.
- Jest: `tests/unit/lib/catalog-settings.test.ts` (23 Tests) und
  `tests/unit/migrations/catalog-series.test.ts` (statische Prüfungen der Reihe:
  14-stellige Versionen, Timeouts, kein BEGIN/COMMIT, `public.`-Schema,
  Identifier höchstens 63 Zeichen, Policies nur für `authenticated`) erfolgreich.
- **Wegwerf-Datenbank:** Die gesamte Reihe wurde auf einer lokalen PostgreSQL-15-Instanz
  (Docker, Stubs für `auth` und `storage`, synthetische Testdaten, Basis aus den
  Drizzle-Dateien) angewendet, ein zweites Mal ausgeführt (Idempotenz), mit
  Constraint-, RLS-, Backfill-, Seed-, Export/Import- und Rollback-Tests geprüft.
  Es wurde keine Supabase- oder Produktionsdatenbank verwendet.
- Die bestehende Jest-Suite hat 15 fehlschlagende Suiten (30 Tests), identisch zum
  Stand vor dieser Änderung (Mock-Probleme, `incrementalCache`); sie sind
  unabhängig von diesem PR.

## Bekannte Einschränkungen

- Nicht getestet: Lauf gegen eine Kopie der Produktion, Supabase-CLI-Pipeline,
  Preview-Umschreiben `public` nach `public_preview`.
- Lokaler Plattformstart benötigt Supabase-Umgebungsvariablen; die Startseite
  konnte ohne lokale Konfiguration nicht vollständig gerendert werden.
- Katalogkontext wird noch nicht über alle UI- und API-Abfragen durchgezogen.
- Bestehende Policies anderer Inhaltstabellen erlauben anonymes Lesen (bekanntes
  Thema, wird getrennt behoben).

## Folgearbeiten

1. Migration auf einer Kopie der Produktion trocken ausführen und Vor- und
   Nachchecks gegenlesen.
2. Ausbildungskatalog in Benutzer- und Organisationskontext und in den API- und
   UI-Flows durchgängig machen; Arbeitszeugnis auf die Katalog-Settings umstellen.
3. App für `SUPER_ADMIN` freigeben, danach Freigabe setzen und Datei 20261025000000 anwenden (sie schlägt fehl, solange das Gate geschlossen ist).
4. Text-Arrays `courses.lernfelder` und `use_cases.lernfelder` migrieren;
   `lernfelder_legacy` und `lernfeld_mappings_legacy` später entfernen.
5. KfBM-Curriculum und Mapping aus freigegebenen Quellen importieren, Content über
   einen manifest- und kennungsbasierten Importpfad übernehmen.
6. HAI-Wissensindex und anschließend Sprachfunktionen mit Quellen-, Rollen-,
   Datenschutz- und Regressionstests erweitern.
