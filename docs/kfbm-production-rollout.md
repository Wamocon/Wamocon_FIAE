WAMOCON GmbH, Mergenthalerallee 79-81, 65760 Eschborn

# KfBM-Rollout in Production: verbindliches Runbook

Stand: 28.10.2026. Status: Entwurf zur Freigabe durch Niko. Gilt für das Repository Wamocon_FIAE (Next.js, Drizzle, Supabase, Vercel).

**Dieses Dokument ist ein Plan.** Es führt nichts aus und ist kein Auftrag zur Ausführung. Production bleibt unberührt, bis Niko für eine Stufe ausdrücklich das Go gibt. Agenten schreiben nur Dokumentation, Code und Prüf-SQL, sie greifen weder schreibend noch lesend auf Production zu. Alle Messungen und alle Schritte mit Wirkung auf Production macht Niko selbst oder eine von ihm benannte Person.

Begleitdatei: `docs/kfbm-production-rollout-checks.sql` (nur lesende Abfragen, V01 bis V13 vor dem Rollout, N01 bis N11 danach). Abgeglichene Quellen: `docs/production-schema-migration.md`, `docs/production-schema-migration-verification.sql`, `docs/release-prozess.md`, alle 34 Dateien in `supabase/migrations`, `scripts/db/rollout-gate.mjs`, `scripts/db/baseline-guard.mjs`, `supabase/legacy-migrations.txt`, `supabase/known-drift.txt`, `supabase/manual/*`, `docs/rollback/20261024-kfbm-catalog-down.sql`, `docs/kfbm-import-runbook.md`, `docs/kfbm-upload-runbook.md`, `docs/security-hardening-2026-10.md`, die Workflows unter `.github/workflows` und `supabase/content-tables.json`.

**Kennzeichnung der Aussagen.**

- **[A]** Annahme. Jede Aussage über den Ist-Zustand von Production, von Vercel oder von Supabase ist eine Annahme, solange Niko sie nicht gemessen hat. Auch frühere Messungen (23. und 24.10.2026) gelten als Annahme, weil sie vor dem Rollout neu zu messen sind. Zu jeder Annahme nennt Abschnitt 1.2 die Messung.
- **[L]** lokal geprüft. Nachgestellt auf einer Wegwerf-Kopie (Postgres 17 im Container, Struktur von Production vom 23.10.2026 aus dem Snapshot, die in der Pipeline gepinnte Supabase-CLI 2.118.0). Es war keine Verbindung zu Production oder zur gehosteten Preview im Spiel. Eine lokale Prüfung ersetzt keine Messung an Production.
- **Schätzung** bei Dauer und Aufwand: ungemessen, die Generalprobe (Abschnitt 1.5) misst die Dauer.

## 0. Auf einen Blick

### 0.1 Was nach Production geht

| Block        | Inhalt                                                                                 | Wirkung auf Production                                                              |
| ------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Sicherheit   | sechs Dateien vom 23.10., Tabellenrechte (`20261029000300`), Storage-Vorlage v2        | schließt anonyme und überbreite Zugriffe über die REST-Schnittstelle, Daten bleiben |
| Berufsmodell | 15 Dateien der Katalogreihe, Rolle `SUPER_ADMIN`, Strukturdateien bis `20261028000300` | FIAE wird ein Beruf unter mehreren, alle bestehenden Zeilen bleiben FIAE            |
| HAI          | Beruf, Sichtbarkeit und Mandant im Index, PIN-Zähler                                   | Azubis bekommen keine Lösungen und keine Inhalte eines anderen Berufs               |
| Upload       | sieben Prozesstabellen                                                                 | angelegt, leer, geschlossen, Funktion in Production aus                             |
| App          | alle Änderungen auf `master` seit dem letzten Production-Stand                         | neue Oberflächen, neue Prüfungen, neue Routen                                       |
| Inhalt       | KfBM-Kurse, Enabler, Quizze, Use Cases, Lernfelder, Dokumentzeilen aus der Preview     | zunächst inaktiv und unsichtbar für Kunden                                          |
| HAI-Index    | Einbettungen der KfBM-Inhalte                                                          | nur mit gesondertem Go (Kosten, Schreibzugriff)                                     |

### 0.2 Zehn Befunde aus dem Abgleich der Quellen

Diese Befunde ändern den Plan gegenüber den bisherigen Runbooks. Sie sind der Hauptgrund für die Arbeitspakete in Abschnitt 1.3.

| Nr  | Befund                                                                                                                                                                                                                                                                                                                                                                         | Beleg                                                                                                                                                                 | Folge im Plan                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| B1  | `supabase db push` bricht ab, solange das Ledger Versionen ohne lokale Datei enthält. Production hat 60 solche Zeilen (Stand 24.10., [A]). Der Release-Lauf scheitert dann schon im Schritt "Dry run".                                                                                                                                                                         | [L] Fehler `DbPushMissingLocalError`. Nach `migration repair --status reverted` der 60 Versionen und `--status applied 202606260001` listet der Plan genau 33 Dateien | Ledger-Bereinigung als Vorbedingung (Abschnitt 1.7), Entscheidung D5                              |
| B2  | Die Reihenfolge der bisherigen Runbooks (Katalog, dann App-Release, dann Backfill) lässt sich mit der Pipeline nicht herstellen. Der Job `migrate` hält an der Backfill-Datei an, solange die Freigabe fehlt. Der Job `deploy` läuft erst danach. Die manuelle "Production Deploy" verlangt "up to date". Eine vorab als angewendet markierte Backfill-Datei lehnt die CLI ab. | [L] Push ohne Freigabe stoppt nach 21 Dateien an der Backfill-Datei. [L] Vorab markiert: `DbPushMissingRemoteError`                                                   | Freigabe vorab, kurze Lücke zwischen Migration und App (Abschnitt 2.2), Entscheidung D2           |
| B3  | Der Inhaltsabgleich im Release bricht ab. Die Allowlist nennt `lernfelder` mit dem Schlüssel `code`, die Sicht `lernfelder` hat seit `20261024000500` die Spalte `label` statt `code`. Der Job `content-sync` scheitert nach erfolgreicher Migration, die App wird nicht ausgeliefert.                                                                                         | [L] Spalten der Sicht gemessen. Code: `scripts/db/content-sync.mjs`, Prüfung "key column(s) ... missing"                                                              | Arbeitspaket WP1 vor dem Rollout                                                                  |
| B4  | Der manuelle Workflow "Content Sync" hat keine Eingabe für einen einzelnen Beruf (`--catalog`).                                                                                                                                                                                                                                                                                | `.github/workflows/content-sync.yml`                                                                                                                                  | Arbeitspaket WP2                                                                                  |
| B5  | Der Rückweg der App über "Production Deploy" mit einem älteren Release funktioniert nach dem Rollout nicht. Das ältere Release kennt die neuen Migrationsdateien nicht, die CLI lehnt das Ledger ab.                                                                                                                                                                           | gefolgert aus B1 [L], in der Generalprobe zu bestätigen                                                                                                               | App-Rückweg über Vercel (Abschnitt 2.6)                                                           |
| B6  | Eine bewusst nicht angewendete Migration blockiert alle späteren "Production Deploy" und "Content Sync" (beide verlangen "up to date").                                                                                                                                                                                                                                        | `deploy-production.yml`, `content-sync.yml`                                                                                                                           | Upload-Tabellen werden angewendet (Etappe E7), nicht ausgelassen                                  |
| B7  | Die sechs Sicherheitsdateien vom 23.10. sind laut Projektnotiz von Hand in Production angewendet worden, das Ledger kennt sie nicht [A]. Der Release wendet sie erneut an (wiederholbar).                                                                                                                                                                                      | Projektnotiz 24.10.2026, Kopfkommentare der Dateien ("Safe to run twice")                                                                                             | Vorcheck klärt es (V02b, V03, V04), kein Eingriff nötig                                           |
| B8  | Die Pipeline verbindet über die temporäre CLI-Rolle `cli_login_postgres`. Wem neue Objekte dann gehören und auf welche Rolle sich `alter default privileges` bezieht, ist nicht gemessen.                                                                                                                                                                                      | `scripts/db/supabase-retry.mjs`, `20261029000300` (nutzt `current_user`)                                                                                              | Nachcheck N10 nach jeder Stufe, Stopp bei einem zweiten Eigentümer (Stopp-Regel in Abschnitt 2.6) |
| B9  | Production muss `DB_CONNECTION_STRING` lesbar halten. Als "Sensitive" angelegt, bricht `scripts/db/deploy-env.mjs` den Deploy ab. Die Empfehlung in `docs/security-hardening-2026-10.md` ("sensitive") gilt für Production deshalb nicht.                                                                                                                                      | `scripts/db/deploy-env.mjs` (Production bleibt streng)                                                                                                                | Vercel-Prüfung H3                                                                                 |
| B10 | Die Repository-Variable `CONTENT_SYNC_OWNER_EMAIL` ist nicht gesetzt (vorhanden sind nur `KFBM_ROLLOUT_APPROVED` und `SUPABASE_PROJECT_REF_PROD`). Ohne sie überspringt der Abgleich Zeilen, deren Ersteller sich nicht zuordnen lässt.                                                                                                                                        | `gh variable list` am 28.10.2026                                                                                                                                      | H3                                                                                                |

Weitere Hinweise: Das Repository hat 34 Migrationsdateien, nicht 35 (eine Basisdatei `202606260001` und 33 offene). 27 davon liegen ab `20261024000100` hinter dem Rollout-Tor, die sechs vom 23.10. nicht [L]. Das Tor bleibt nach dem Rollout als Dauersperre für jede künftige Migration bestehen (Entscheidung D14).

### 0.3 Die fünf Entscheidungen, die Niko zuerst braucht (bis Freitag, 30.10.2026)

1. **Demo-Umgebung (D1).** Empfehlung: Production. Preview-Deployments liegen hinter der Vercel-Anmeldung [A], IHK-Gäste kommen dort nicht hinein. Rückfallebene: Preview mit Umgehungslink.
2. **Weg für den Backfill (D2).** Empfehlung: Freigabe vorab setzen und die kurze Lücke zwischen Migration und App-Deploy annehmen (Minuten, nur Admins der Plattform-Organisation betroffen, Zahl messen mit V06b).
3. **Importweg für den Inhalt (D3).** Empfehlung: Option A1, der vorhandene Inhaltsabgleich Preview nach Production, nach den Korrekturen WP1 und WP2. Kein neuer Schreibweg gegen Production.
4. **Fenster und Zweitfreigabe (D4).** Empfehlung: Samstag, 07.11.2026, 06:00 bis 12:00 Uhr, Ersatzfenster Samstag, 14.11.2026. Eine zweite Person als Reviewer des Environments `Production`.
5. **Neuindexierung der HAI und Sperre des Chat-Fallbacks (D8, D9).** Empfehlung: Einbettungen nur für den Katalog KfBM, mit Kostenzahl aus dem Trockenlauf, vor der Demo. Die Sperre des Fremdanbieter-Fallbacks vor der Freischaltung.

### 0.4 Zeitplan in einer Tabelle

| Datum                   | Meilenstein                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Do 29.10. bis Fr 30.10. | Entscheidungen, Vorchecks, Arbeitspakete WP1 und WP2 starten                                |
| Mo 02.11. bis Mi 04.11. | Backup, Restore-Test, Generalprobe, Ledger-Bereinigung, Storage-Vorlage, Buckets, Variablen |
| Do 05.11.               | Go 1 (Freigabe des Rollouts)                                                                |
| Sa 07.11.               | Rollout im Release-Lauf, Smoke-Tests                                                        |
| Di 10.11. bis Do 12.11. | Inhaltsabgleich (falls nicht im Release), HAI-Index KfBM, Aktivierung                       |
| Fr 13.11.               | Go 2 (Freischaltung)                                                                        |
| Sa 14.11.               | Ersatzfenster, spätester Termin für Schema-Änderungen                                       |
| Mo 16.11. bis Do 19.11. | Abnahme, Regression, Rollen und Mandanten                                                   |
| Fr 20.11.               | Go 3 (Go/No-Go Demo)                                                                        |
| Sa 21.11. bis Mi 25.11. | Code-Freeze, nur Rückfälle und Datenkorrekturen                                             |
| Do 26.11.               | IHK-Demo                                                                                    |

## 1. Vorbedingungen

### 1.1 Grundregeln

1. Schreibende Schritte in Production macht nur Niko (oder die von ihm benannte Person) und nur nach dem Go der jeweiligen Stufe. Kein Agent verbindet sich mit Production, auch nicht lesend.
2. Reihenfolge einhalten. Bei jedem unerwarteten Wert stoppen, nichts überspringen, nichts improvisieren. Eine Datei, die abbricht, ist ursächlich zu klären.
3. Vor jedem Schritt der Vorcheck, danach der Nachcheck. Jede Ausgabe wird mit Datum und Uhrzeit im Messprotokoll (Anhang C) abgelegt.
4. Jede Migrationsdatei läuft in einer eigenen Transaktion mit `lock_timeout` 5 Sekunden und `statement_timeout` 60 Sekunden. Bricht sie wegen einer Sperre ab, wurde nichts geändert. Dann außerhalb der Stoßzeit wiederholen ("Re-run failed jobs").
5. Verboten bleiben: `drizzle-kit push`, `supabase db reset`, Seed-Skripte gegen Production, das Anwenden des Ordners `src/db/migrations/drizzle`, das Ändern, Umbenennen oder Löschen schon veröffentlichter Migrationsdateien und das Anwenden einer Datei ohne Backup.
6. Die Variable `KFBM_ROLLOUT_APPROVED` steht auf `false`, bis Go 1 erteilt ist. Sie wird nach dem Rollout wieder auf `false` gesetzt.
7. Zeiten: Stoßzeit ist Mo bis Fr, 07:00 bis 18:00 Uhr [A, mit Vercel Analytics zu bestätigen]. Handschritte vorab laufen werktags ab 18:30 Uhr oder samstags. Der Rollout läuft samstags.

### 1.2 Annahmen und ihre Messung

Alle Zeilen sind Annahmen [A], bis Niko den Wert in Anhang C einträgt.

| Nr  | Annahme                                                                                                                                                                                        | Quelle der Annahme         | Messung (Datei `docs/kfbm-production-rollout-checks.sql`)     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------- |
| A1  | Das Ledger hat 60 Zeilen, die letzte Version ist `20260227143256`, `202606260001` fehlt                                                                                                        | Notiz 24.10.               | V02, V02b                                                     |
| A2  | Die sechs Sicherheitsdateien vom 23.10. sind von Hand angewendet, das Ledger kennt sie nicht                                                                                                   | Projektnotiz 24.10.        | V02b, V03, V03b, V04, V08                                     |
| A3  | Die App verbindet als Rolle `postgres` mit BYPASSRLS                                                                                                                                           | Messung 23.10.             | V09                                                           |
| A4  | Auf `auth.users` gibt es keinen Trigger                                                                                                                                                        | Messung 23.10.             | V04                                                           |
| A5  | `PUBLIC` darf `CREATE` im Schema `public`                                                                                                                                                      | Messung 23.10.             | V10                                                           |
| A6  | Production hat 6 Profile (1 Admin, 2 Trainer, 3 Azubis), 26 Kurse, 189 Enabler, 88 Use Cases                                                                                                   | Messung 23.10.             | V06, V06b, V07                                                |
| A7  | Die Tabelle `hai_embeddings` ist klein genug für den Backfill in 60 Sekunden                                                                                                                   | keine Messung              | V07b                                                          |
| A8  | Die Buckets `content` und `avatar` sind öffentlich, `content-upload` ist privat angelegt, `content-solutions` ist unbekannt                                                                    | Notiz 27.10.               | V08, N11                                                      |
| A9  | Das aktuelle Production-Deployment stammt aus dem letzten automatischen Vercel-Build von `master` vor dem Abschalten der Auto-Deployments (Ende 23./24.10.) und nicht aus dem Release `v1.0.0` | Notiz, `vercel.json`       | Vercel-Dashboard: Commit-SHA und Zeit notieren (Rückweg-Ziel) |
| A10 | Die Vercel-Variablen von Production sind vollständig (Abschnitt H3)                                                                                                                            | keine Messung              | Vercel-Dashboard, nur Namen                                   |
| A11 | Das Environment `Production` hat Reviewer und das Secret `SUPABASE_ACCESS_TOKEN`                                                                                                               | `docs/release-prozess.md`  | GitHub, Settings, Environments                                |
| A12 | Die Preview enthält noch keinen abgenommenen KfBM-Inhalt (die Preview-Läufe der Importe standen am 27.10. aus)                                                                                 | Notiz 27.10.               | Abfrage N05 mit Schema `public_preview`                       |
| A13 | Das Supabase-Projekt hat tägliche Backups, der Zeitpunkt der Wiederherstellung (PITR) ist tarifabhängig                                                                                        | unbekannt                  | Supabase-Dashboard, Database, Backups                         |
| A14 | Nutzung von Production ist gering und werktags tagsüber                                                                                                                                        | unbekannt                  | Vercel Analytics                                              |
| A15 | Die alte App läuft gegen das neue Schema unverändert weiter (Migrationen sind rückwärtskompatibel geschrieben)                                                                                 | Kopfkommentare der Dateien | Generalprobe (optional mit alter App)                         |

### 1.3 Arbeitspakete vor dem Rollout

Diese Pakete schreibt die Entwicklung (Agenten), jeweils als eigener Pull Request, Merge nur bei grüner CI und ohne Wirkung auf Production. Sie sind Teil der Bedingungen für Go 1.

| Nr  | Paket                                                                                                                                                                                | Warum                                                            | Abnahme                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| WP1 | In `supabase/content-tables.json` die Einträge `lernfelder` und `lernfeld_mappings` aus der Allowlist nehmen (die Lernfelder stehen in `training_catalog_learning_fields`), mit Test | B3, blockiert den Release-Lauf                                   | `npm run test:scripts` grün, Trockenlauf auf einer Wegwerf-Kopie mit Preview und Production als zwei Schemas ohne Fehler |
| WP2 | Im Workflow "Content Sync" eine Eingabe `catalog` (leer oder Code) einführen, die `--catalog` übergibt. Das Verhalten ohne Eingabe bleibt unverändert                                | B4, gezielter KfBM-Lauf                                          | Syntaxprüfung des Workflows, Test der Argumentbildung                                                                    |
| WP3 | Nach dem Rollout `GATED_FROM` in `scripts/db/rollout-gate.mjs` auf die erste Version nach `20261030000200` anheben (Entscheidung D14)                                                | sonst blockiert das Tor jede künftige Migration                  | Test der Gate-Funktion                                                                                                   |
| WP4 | Dieses Runbook als maßgeblich in `docs/production-schema-migration.md` und `docs/release-prozess.md` verlinken und die Widersprüche aus Anhang E bereinigen                          | die älteren Dokumente nennen eine nicht herstellbare Reihenfolge | Review durch Niko                                                                                                        |
| WP5 | Optional: Skript für den Pfad-Umzug `preview/kfbm/...` nach `kfbm/...` mit Probelauf und Rückbau (Abschnitt 4.5)                                                                     | Aufräumen nach der Demo                                          | nicht vor der Demo nötig                                                                                                 |
| WP6 | Optional: Sperre des Chat-Fallbacks auf Fremdanbieter (Entscheidung D8)                                                                                                              | Datenweitergabe an Fremdanbieter bei Ausfall von Sokrates        | Test, Konfigurationsschalter                                                                                             |

### 1.4 Backup und Wiederherstellungsweg

Ziel: Vor dem ersten Schreibzugriff gibt es eine Sicherung, deren Wiederherstellung einmal erprobt wurde.

| Weg                                                              | Inhalt                                                                                                                                                       | Wiederherstellung                                                                 | Grenzen                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase-Backup (Dashboard, Database, Backups)                   | ganze Datenbank, je nach Tarif täglich oder auf eine Sekunde genau [A]                                                                                       | Wiederherstellung im Dashboard ersetzt die gesamte Datenbank des Projekts         | Daten seit dem Backup gehen verloren, Storage-Dateien sind nicht Teil des Datenbank-Backups                                                                                                                      |
| Logische Sicherung mit `pg_dump` (Pflicht, unabhängig vom Tarif) | Schemas `public` und `supabase_migrations` und die Tabelle `auth.users` (Fremdschlüssel der Profile), Format `custom`                                        | `pg_restore` in einen Wegwerf-Container (Generalprobe) oder gezielt in Production | Verbindung über Direktverbindung oder Session-Pooler (Port 5432), nicht den Transaction-Pooler. Die Datei enthält personenbezogene Daten und Passwort-Hashes: verschlüsselt ablegen und nach dem Rollout löschen |
| Inventare als Textdateien                                        | `select * from supabase_migrations.schema_migrations`, `pg_policies` (V08), `storage.buckets` (V08), Standardrechte (Prüfung 6 in `verify-rls-lockdown.sql`) | Vorlage für Rückwege von Hand                                                     | nur Metadaten                                                                                                                                                                                                    |

Beispielbefehle (zur Prüfung in der Generalprobe, Verbindung nur aus der Umgebung des Prozesses, nie in eine Datei):

```bash
pg_dump "<Verbindung Session-Pooler>" --format=custom --no-owner --schema=public --schema=supabase_migrations --file=production-JJJJMMTT-HHMM.dump
pg_dump "<Verbindung Session-Pooler>" --format=custom --no-owner --table=auth.users --file=production-auth-users-JJJJMMTT-HHMM.dump
```

Zwei getrennte Aufrufe: Mit `--table` sichert `pg_dump` nur Tabellen, die Schalter `--schema` wirken dann nicht mehr. Die Erweiterung `vector` (Schema `public`) gehört keinem der beiden Abzüge, im Zielcontainer wird sie vor dem Zurückspielen angelegt (`create extension if not exists vector with schema public;`).

Der Zeitpunkt der Sicherung und der Ablageort stehen im Messprotokoll. Vor dem Rollout-Fenster wird die Sicherung wiederholt (Drehbuch, 05:45 Uhr), weil sich bis dahin Daten ändern können.

### 1.5 Generalprobe auf einer Wiederherstellung

Zweck: Die Migrationsreihe an den echten Daten und die Pipeline-Schritte der CLI erproben, ohne Production zu berühren. Die Generalprobe prüft zugleich, ob die Sicherung wiederherstellbar ist. Das schließt die größte Lücke der bisherigen Prüfung: Die Datenanteile der Reihe (Kopie der Lernfelder, Backfill der Einschreibungen, Backfill des HAI-Index) wurden bisher nur an leeren Strukturen geprüft.

Wer: Betrieb mit Niko. Dauer: etwa ein halber Tag (Schätzung). Wann: Mo 02.11. bis Mi 04.11.

1. Wegwerf-Container mit demselben Postgres-Hauptstand wie Production (V01), zum Beispiel `public.ecr.aws/supabase/postgres:17.x`, auf einem freien Port, auf einem verschlüsselten Datenträger.
2. Erweiterung `vector` im Schema `public` anlegen, dann beide Sicherungen zurückspielen (`pg_restore`). Fehler wegen fehlender Rollen sind erwartbar (zum Beispiel die Rolle `app_user`), Fremdschlüssel auf `auth.users` nur, wenn die Tabelle nicht mitgesichert wurde.
3. Ledger wie in Production bereinigen (Abschnitt 1.7), mit der gepinnten CLI 2.118.0 gegen den Container: `--db-url "postgresql://postgres:<Passwort>@127.0.0.1:<Port>/postgres?sslmode=disable"` (ohne `sslmode=disable` lehnt die CLI den lokalen Server ab).
4. `supabase db push --dry-run --db-url ...`. Erwartung: 33 Dateien von `20261023100000` bis `20261030000200`, `202606260001` nicht dabei. Die Ausgabe in `dry-run.txt` ablegen, dann `KFBM_ROLLOUT_APPROVED=false node scripts/db/rollout-gate.mjs --plan dry-run.txt` (Erwartung: Abbruch mit 27 Dateien), mit `true` (Erwartung: Freigabe), und `node scripts/db/baseline-guard.mjs --plan dry-run.txt` (Erwartung: kein Treffer).
5. Echten Push ohne Backfill-Freigabe starten. Erwartung: 21 Dateien werden angewendet, der Lauf hält an `20261025000000` an [L]. Dann `comment on type public.user_role is 'super_admin_backfill=approved';` setzen und den Push wiederholen. Erwartung: die übrigen 12 Dateien laufen durch, danach "Remote database is up to date." [L].
6. Je Datei die Dauer notieren (Zeit der Anwendung im Protokoll). Besonders `20261027000100` (Sperre und Backfill auf `hai_embeddings`). Mehr als 45 Sekunden in der Kopie ist ein No-Go für diese Datei (Stopp-Regel in Abschnitt 2.6).
7. Nachchecks: N01 (leer), N02 (alle wahr), Prüfungen C4 bis C9, C10, C11b, C12b, C15b, C17 aus `docs/production-schema-migration-verification.sql`, `verify-rls-lockdown.sql` (Erwartung in der Kopfzeile der Datei). Zeilenzahlen aus V07 vorher und nachher vergleichen: alle Bestandstabellen unverändert.
8. Optional: die neue App gegen die Kopie starten (`DB_CONNECTION_STRING` nur aus der Shell) und Smoke S1 bis S6 durchgehen. Optional auf einer zweiten Kopie den Rückweg der Katalogreihe (`docs/rollback/20261024-kfbm-catalog-down.sql`) erproben.
9. Container und Sicherungskopie löschen (Datenschutz), Ergebnis ins Messprotokoll.

Erfolgskriterien: Schritte 4, 5 und 7 wie erwartet, keine Datei über 45 Sekunden, keine Abweichung in den Zeilenzahlen. Das Ergebnis ist Bedingung für Go 1.

### 1.6 Lesende Vorchecks (Niko führt sie selbst aus)

Der SQL-Editor von Supabase zeigt nur das Ergebnis der letzten Anweisung. Deshalb jede Abfrage einzeln markieren und ausführen. Die vollständigen Abfragen mit Erwartungswerten stehen in `docs/kfbm-production-rollout-checks.sql`. Hier die sechs wichtigsten.

**Ledger-Stand (V02).** Erwartet vor der Bereinigung: 60 Zeilen, letzte Version `20260227143256`, `has_202606260001 = false`, `rows_from_20261023 = 0`.

```sql
select count(*) as ledger_rows,
       max(version) as last_version,
       bool_or(version = '202606260001') as has_202606260001,
       count(*) filter (where version >= '20261023') as rows_from_20261023
from supabase_migrations.schema_migrations;
```

**Spaltenrechte auf `profiles` (V03b und V03).** Erwartet: `false`. Ist es `true`, ist `20261023200000` nicht wirksam. Die Spaltenliste V03 zeigt für `authenticated` genau fünf Spalten (`avatar_url`, `birth_date`, `full_name`, `start_of_training_date`, `updated_at`) und keine für `anon`.

```sql
select has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
  as authenticated_can_update_role_must_be_false;

select a.attname as column_name,
       has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE') as authenticated_update,
       has_column_privilege('anon', a.attrelid, a.attnum, 'UPDATE') as anon_update
from pg_attribute a
where a.attrelid = 'public.profiles'::regclass
  and a.attnum > 0 and not a.attisdropped
  and (has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
       or has_column_privilege('anon', a.attrelid, a.attnum, 'UPDATE'))
order by a.attname;
```

**Trigger auf `profiles` und `auth.users` (V04).** Erwartet: auf `public.profiles` der Trigger `profiles_protect_columns`, auf `auth.users` keiner. Ein Trigger auf `auth.users`, der Profile anlegt, müsste Konten mit `raw_app_meta_data` `preview_only = true` überspringen.

```sql
select 'public.profiles' as on_table, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal
union all
select 'auth.users', t.tgname, t.tgenabled, pg_get_triggerdef(t.oid)
from pg_trigger t
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
order by 1, 2;
```

**Formen der gespeicherten Datei-Links (V05).** Zeigt nur Zahlen je Form. Gebraucht für die Entscheidung zum Bucket `content` (D7) und für den Pfad-Umzug. Erwartet: überwiegend "public url, bucket content", keine "signed url".

```sql
with urls as (
  select 'content_documents.storage_url' as source, storage_url as url from public.content_documents
  union all select 'enablers.ppt_url', ppt_url from public.enablers
  union all select 'enablers.video_url', video_url from public.enablers
  union all select 'enablers.scenario_pdf_url', scenario_pdf_url from public.enablers
)
select source,
       case
         when url is null then 'NULL'
         when url = '' then 'empty'
         when url like 'private://%' then 'private reference'
         when url like '%/storage/v1/object/public/content/preview/%' then 'public url, bucket content, prefix preview/'
         when url like '%/storage/v1/object/public/content/%' then 'public url, bucket content'
         when url like '%/storage/v1/object/public/avatar/%' then 'public url, bucket avatar'
         when url like '%/storage/v1/object/sign/%' then 'signed url'
         when url like 'http%' then 'other http url'
         else 'other form'
       end as link_form,
       count(*) as links
from urls
group by 1, 2
order by 1, 3 desc;
```

**Profile ohne Organisation (V06) und Admins der Plattform-Organisation (V06b).** Die zweite Zahl ist die Zahl der Personen, die in der Lücke zwischen Migration und App-Deploy die Admin-Oberfläche der alten App verlieren.

```sql
select role, count(*) as profiles_without_organization,
       count(*) filter (where is_active) as active_ones
from public.profiles
where organization_id is null
group by role
order by role;

select o.name as organization, p.role, count(*) as profiles
from public.profiles p
join public.organizations o on o.id = p.organization_id
where o.is_platform_owner
group by o.name, p.role
order by o.name, p.role;
```

**Zeilenzahlen (V07 und V07b).** Referenz für den Vergleich nach dem Rollout. Regel: mehr als 50.000 Zeilen oder mehr als 1 GB in `hai_embeddings` heißt, dass die Generalprobe zwingend ist und das Fenster länger wird.

```sql
select 'courses' as table_name, count(*) as row_count from public.courses
union all select 'enablers', count(*) from public.enablers
union all select 'use_cases', count(*) from public.use_cases
union all select 'training_components', count(*) from public.training_components
union all select 'quizzes', count(*) from public.quizzes
union all select 'questions', count(*) from public.questions
union all select 'options', count(*) from public.options
union all select 'content_documents', count(*) from public.content_documents
union all select 'lernfelder', count(*) from public.lernfelder
union all select 'profiles', count(*) from public.profiles
union all select 'organizations', count(*) from public.organizations
union all select 'hai_embeddings', count(*) from public.hai_embeddings
union all select 'auth.users', count(*) from auth.users
order by 1;

select pg_size_pretty(pg_total_relation_size('public.hai_embeddings')) as total_size,
       (select count(*) from public.hai_embeddings) as chunks;
```

Die übrigen Vorchecks in der Datei: V01 (Identität: Projekt FIEA-Production, Rolle `postgres`, Postgres mindestens 15), V08 (Policy-Inventar und Buckets, Vorlage für Rückwege), V09 (Rollen und Verbindungen), V10 (`CREATE` auf `public`), V11 (Zustand vor der Katalogreihe, fünf Zusatzspalten von `lernfelder` leer), V12 (doppelte Buchstaben je Komponente), V13 (HAI-Chunks je Quelle und Organisation der Dokumente).

### 1.7 Ledger-Bereinigung (Voraussetzung jedes Releases)

Befund B1 [L]: Mit den 60 Ledger-Zeilen ohne Datei lehnt `supabase db push` jeden Lauf ab. Das ist die CLI-Regel "Remote migration versions not found in local migrations directory". Zwei Wege:

| Weg                         | Was                                                                                                                                                                                                                  | Aufwand                         | Risiko                                                                                                                     | Empfehlung                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| (b) Ledger-Zeilen entfernen | `supabase migration repair --status reverted <60 Versionen>` (der Vorschlag der CLI). Entfernt nur Zeilen der Verlaufstabelle, ändert kein Schema. Rückweg: `--status applied <Versionen>` legt die Zeilen wieder an | klein, ein Aufruf               | gering, schreibt in Production (nur die Verlaufstabelle). Die Historie der 60 Zeilen steckt dann nur noch in der Sicherung | **empfohlen**                                 |
| (a) Platzhalterdateien      | 60 leere Migrationsdateien mit diesen Versionen ins Repository, dazu Ausnahmen in `scripts/db/migration-check.mjs`                                                                                                   | mittel, Codeänderung und Review | Preview und Prüfskripte müssen die Dateien kennen                                                                          | nur falls Niko das Ledger nicht antasten will |

Ablauf für (b), Niko, außerhalb der Stoßzeit, nach der Sicherung:

1. Alle Zeilen sichern: `select * from supabase_migrations.schema_migrations order by version;` als CSV exportieren und ablegen.
2. Die Liste der 60 Versionen bilden und gegen `supabase/known-drift.txt` prüfen: `select string_agg(version, ' ' order by version) from supabase_migrations.schema_migrations where version < '202606';`
3. `supabase link --project-ref <Referenz aus der Repository-Variable SUPABASE_PROJECT_REF_PROD>`, dann `supabase migration list --linked` (nur lesend, vorher ansehen).
4. `supabase migration repair --status reverted <60 Versionen> --linked`
5. `supabase migration repair --status applied 202606260001 --linked` (die Basisdatei `202606260001_schema_only_ausbildung_duration.sql` ist von Hand angewendet, `profiles.ausbildung_duration_years` existiert [A]).
6. `supabase db push --linked --dry-run`. Erwartung: genau 33 Dateien (`20261023100000` bis `20261030000200`), kein Fehler, `202606260001` nicht dabei [L].
7. Nachcheck: V02 liefert eine Zeile (`202606260001`).

Rückweg: `supabase migration repair --status reverted 202606260001` und `--status applied <60 Versionen>`. Das Schema bleibt in beiden Richtungen unberührt.

### 1.8 Einstellungen in GitHub, Vercel und Supabase prüfen

Siehe die Etappenkarte H3 (Variablen und Einstellungen). Dazu gehören das Environment `Production` mit mindestens einem Reviewer, das Tag-Ruleset für `v*`, `SUPABASE_ACCESS_TOKEN` im Environment, die Vercel-Variablen und die Notiz des aktuellen Production-Deployments.

## 2. Etappen in fester Reihenfolge

### 2.1 Überblick

Drei Gruppen. **H** sind Handschritte vorab (in der Reihenfolge der Tabelle, außerhalb der Stoßzeit). **E** sind die Etappen des Release-Laufs. Ihre Reihenfolge erzwingt die Versionsnummer der Migrationsdateien, die Pipeline wendet alle 33 offenen Dateien in einem Lauf an. **S** und die Abschnitte 4 und 5 folgen danach.

| Nr  | Etappe                                                | Mittel                                             | Hängt ab von                        | Wer                 | Wann                    |
| --- | ----------------------------------------------------- | -------------------------------------------------- | ----------------------------------- | ------------------- | ----------------------- |
| V   | Messung, Backup, Generalprobe, Ledger                 | Abschnitt 1                                        | nichts                              | Niko, Betrieb       | Mo 02.11. bis Mi 04.11. |
| H1  | Storage-Vorlage v2 (Bucket-Richtlinien)               | `supabase/manual/20261029_storage_policies_v2.sql` | V, `verify-rls-lockdown.sql` vorher | Niko                | Mi 04.11. abends        |
| H2  | Buckets prüfen und anlegen                            | Supabase Dashboard                                 | H1                                  | Niko                | Mi 04.11.               |
| H3  | Variablen und Einstellungen                           | GitHub, Vercel                                     | V                                   | Niko                | Di 03.11. bis Do 05.11. |
| E1  | Sechs Sicherheitsdateien vom 23.10.                   | Release-Lauf                                       | V (Ledger)                          | Niko, Zweitfreigabe | Sa 07.11.               |
| E2  | Katalogreihe `20261024000100` bis `20261024001500`    | Release-Lauf                                       | E1 (Spaltenrechte vor `001500`)     | wie E1              | Sa 07.11.               |
| E3  | Super-Admin-Backfill `20261025000000`                 | Release-Lauf, Freigabe vorab                       | E2, Freigabe-Kommentar              | wie E1              | Sa 07.11.               |
| E4  | `20261025000100` bis `20261028000300`                 | Release-Lauf                                       | E3                                  | wie E1              | Sa 07.11.               |
| E5  | `20261029000100` und `20261029000200`                 | Release-Lauf                                       | E4                                  | wie E1              | Sa 07.11.               |
| E6  | Tabellenrechte `20261029000300` und Nachweis          | Release-Lauf, `verify-rls-lockdown.sql`            | E5, H1                              | wie E1              | Sa 07.11.               |
| E7  | Upload-Tabellen `20261030000100` und `20261030000200` | Release-Lauf                                       | E6                                  | wie E1              | Sa 07.11.               |
| E8  | Inhaltsabgleich (Job `content-sync`)                  | Release-Lauf, vorher manueller Trockenlauf         | E7, WP1, WP2, H3                    | wie E1              | Sa 07.11.               |
| E9  | App-Release (Job `deploy`)                            | Release-Lauf                                       | E8, H3                              | wie E1              | Sa 07.11.               |
| S   | Smoke-Tests und Beobachtung                           | Abschnitt 6                                        | E9                                  | Niko, Fachseite     | Sa 07.11. und So 08.11. |

Der App-Release steht in der Pipeline zwingend am Ende (E9), obwohl die bisherigen Runbooks ihn hinter die Katalogreihe und vor den Backfill setzen. Abschnitt 2.2 erklärt warum.

### 2.2 Ausführungsmodell: warum Freigabe vorab und eine kurze Lücke

Fakten [L]: `supabase db push` wendet alle offenen Dateien in Versionsreihenfolge an. Ohne Freigabe-Kommentar bricht der Lauf an `20261025000000` ab, 21 Dateien sind dann angewendet und im Ledger. Die Jobs der Pipeline hängen per `needs` aneinander (`guard`, `migrate`, `content-sync`, `deploy`), ein Abbruch in `migrate` stoppt den Deploy. "Production Deploy" von Hand verlangt "up to date". Eine als angewendet vorab markierte Backfill-Datei lehnt die CLI mit `DbPushMissingRemoteError` ab.

Daraus folgt: Wer die Pipeline benutzt, kann die App nicht zwischen Katalogreihe und Backfill ausliefern. Optionen:

| Option             | Beschreibung                                                                                                                                          | Bewertung                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1 (empfohlen)** | Freigabe-Kommentar unmittelbar vor dem Release setzen. Der Backfill läuft im Job `migrate`, der App-Deploy folgt im selben Lauf einige Minuten später | Lücke von etwa 15 bis 30 Minuten (Schätzung), in der die alte App läuft, während die Admins der Plattform-Organisation schon `SUPER_ADMIN` sind. Die alte App prüft den Text `ADMIN`: diese Personen verlieren die Admin-Oberfläche, bis der Deploy fertig ist. Betroffen sind nur sie (Zahl: V06b). Rückweg ist ein `UPDATE`. Samstagmorgen, Betroffene vorab informieren |
| P2                 | Pipeline ändern (Backfill als eigener Job oder Release nach dem Deploy)                                                                               | kein Aufwand jetzt vertretbar, WP außerhalb dieses Rollouts                                                                                                                                                                                                                                                                                                                |
| P3                 | App von Hand mit der Vercel-CLI außerhalb der Workflows ausliefern                                                                                    | umgeht Schutz, Environment-Freigabe, Prüfung `require-master`: nicht empfohlen                                                                                                                                                                                                                                                                                             |

Eine Lücke in die andere Richtung gibt es nicht: Die alte App läuft gegen das neue Schema weiter (Annahme A15), die neue App braucht alle Spalten (`courses.training_component_id`, `quizzes.code`, `options.order_index`), deshalb liegt der Deploy hinter der letzten Migration.

### 2.3 Abhängigkeiten im Einzelnen

| Datei oder Schritt                 | braucht vorher                                                     | warum                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `20261024001500`, `20261025000000` | `20261023200000`                                                   | sonst könnte jeder angemeldete Nutzer seine Rolle setzen. Beide Dateien prüfen es selbst |
| `20261025000000`                   | Freigabe-Kommentar und `001500`                                    | technisches Tor, die Datei bricht sonst mit klarer Meldung ab                            |
| `20261026000100`                   | `20261024001100`                                                   | eindeutiger Index auf `trainee_enrollments`                                              |
| `20261027000100`                   | Katalogreihe                                                       | Spalten und Trigger an `hai_embeddings` brauchen `training_catalogs`                     |
| `20261028000200`                   | Katalogreihe, Spalte `quizzes.training_catalog_id`                 | Katalogprüfung der Quiz-Verknüpfungen                                                    |
| `20261029000100`                   | `20261027000100`                                                   | ersetzt Funktion und Trigger                                                             |
| `20261029000300`                   | `20261023300000`, `20261023300100` (Trigger auf `profiles`)        | prüft sie am Ende selbst                                                                 |
| `20261030000200`                   | `20261030000100`                                                   | erweitert eine Prüfung der Tabelle                                                       |
| App-Release                        | alle Dateien bis `20261030000200`, `SUPABASE_SECRET_KEY` in Vercel | Spalten und PIN-Zähler (ohne `auth_attempts` antwortet die PIN-Prüfung mit 503)          |
| Inhaltsabgleich                    | `20261028000300`, WP1, `CONTENT_SYNC_OWNER_EMAIL`                  | Spalten der Allowlist, Ersteller                                                         |
| HAI-Index KfBM                     | Inhaltsabgleich, App-Release                                       | Quellen und Persona                                                                      |
| Aktivierung                        | Inhaltsabgleich, Abnahme, HAI-Index                                | sichtbar für Azubis                                                                      |

### 2.4 Fenster und Zeiten

| Fenster            | Zeit                                  | Was                                              |
| ------------------ | ------------------------------------- | ------------------------------------------------ |
| Messungen          | jederzeit, lesend                     | V01 bis V13                                      |
| Handschritte vorab | Mo bis Fr ab 18:30 Uhr oder samstags  | Ledger, Storage-Vorlage, Buckets, Variablen      |
| Rollout            | Sa 07.11.2026, 06:00 bis 12:00 Uhr    | Release-Lauf E1 bis E9, Smoke-Tests              |
| Ersatzfenster      | Sa 14.11.2026, 06:00 bis 12:00 Uhr    | nur wenn der Rollout am 07.11. nicht stattfindet |
| Inhalt und HAI     | Di 10.11. bis Do 12.11., ab 18:30 Uhr | falls nicht im Release                           |

Jede Migrationsdatei nimmt höchstens 5 Sekunden auf Sperren Rücksicht (`lock_timeout`). Das Fenster liegt außerhalb der Stoßzeit, damit lange Abfragen anderer Sitzungen (zu sehen mit `select pid, state, query_start, left(query, 80) from pg_stat_activity where state <> 'idle' order by query_start;`) die Dateien nicht abbrechen. Besonders `20261027000100` hält `ACCESS EXCLUSIVE` auf `hai_embeddings` bis zum Ende der Datei.

### 2.5 Drehbuch für den Rollout-Tag (Sa 07.11.2026)

| Zeit  | Schritt                                                                                                                                                                                                     | Wer                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 05:30 | Bereitschaft: Niko, Zweitfreigabe, Betrieb. V01, V02, V07 wiederholen. Commit-SHA des Production-Deployments in Vercel notieren                                                                             | Niko                |
| 05:45 | Sicherung wiederholen und Zeit notieren. Go-Liste (Abschnitt 7.1) abhaken                                                                                                                                   | Betrieb, Niko       |
| 06:00 | Fenster beginnt. Repository-Variable `KFBM_ROLLOUT_APPROVED` auf `true`                                                                                                                                     | Niko                |
| 06:05 | Freigabe-Kommentar setzen (E3). Release auf GitHub veröffentlichen (Tag `v1.1.0` oder die nächste Nummer auf `master`)                                                                                      | Niko                |
| 06:10 | Job `guard` läuft (ohne Freigabe). Job `migrate`: Zweitfreigabe gibt frei. Log lesen: Plan mit 33 Dateien, Rollout-Tor "approved", Baseline-Guard ohne Treffer. Dann Anwendung (Schätzung 3 bis 15 Minuten) | Niko, Zweitfreigabe |
| 06:30 | Nachchecks E1 bis E7: N01, N02, N03, N09, N10, `verify-rls-lockdown.sql` nachher. Stopp-Regeln beachten                                                                                                     | Niko                |
| 06:50 | Manueller Workflow "Content Sync" als Trockenlauf (`apply` aus). Zahlen lesen: FIAE null neue Zeilen, KfBM wie in der Preview                                                                               | Niko                |
| 07:10 | Job `content-sync` des Releases freigeben                                                                                                                                                                   | Niko, Zweitfreigabe |
| 07:30 | Job `deploy` freigeben, Build und Deployment (Schätzung 10 bis 15 Minuten)                                                                                                                                  | Niko, Zweitfreigabe |
| 07:50 | Smoke-Tests S1 bis S10 (etwa 40 Minuten), Logs der Funktionen ansehen                                                                                                                                       | Niko, Betrieb       |
| 08:30 | Entscheidung weiter oder Rückweg (Abschnitt 2.6). Bei "weiter": `KFBM_ROLLOUT_APPROVED` zurück auf `false`, Freigabe-Kommentar zurücksetzen: `comment on type public.user_role is null;`                    | Niko                |
| 09:00 | Beobachtung der Fehlerrate bis 12:00 Uhr, Meldung an die Beteiligten                                                                                                                                        | Betrieb, Niko       |

### 2.6 Rückweg-Stufen

Der Rückweg wird in dieser Reihenfolge gewählt, vom kleinsten Eingriff zum größten. Meist ist Vorwärtskorrigieren besser als Zurückrollen.

| Stufe | Eingriff                                                                                                                            | Wann                                                                                  | Wirkung                                                                                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1    | App zurück auf das gemerkte Deployment (Vercel Dashboard, Deployments, "Instant Rollback" oder "Promote" des notierten Deployments) | App fehlerhaft, Schema in Ordnung                                                     | nur die App, die alte App läuft gegen das neue Schema (A15). **Nicht** über "Production Deploy" mit einem älteren Release, das scheitert nach dem Rollout (B5) |
| R2    | Aktivierung zurück (Beruf KfBM für die Organisation sperren oder den Katalog inaktiv setzen)                                        | Inhaltsfehler nach der Freischaltung                                                  | KfBM verschwindet für Azubis, Daten bleiben                                                                                                                    |
| R3    | Einzelne Datei zurückbauen (Anhang B)                                                                                               | gezielter Fehler einer Stufe                                                          | nur die Struktur der Datei, jeweils in einer Transaktion, erst als Probe mit `rollback`                                                                        |
| R4    | Gesamtrückbau in umgekehrter Reihenfolge (Anhang B), danach `migration repair --status reverted <Versionen>`                        | nur solange kein KfBM-Datensatz besteht (das Skript der Katalogreihe bricht sonst ab) | Stand vor dem Rollout, `SUPER_ADMIN` bleibt als Enum-Wert                                                                                                      |
| R5    | Wiederherstellung aus der Sicherung                                                                                                 | letzter Ausweg bei Datenschaden                                                       | Datenverlust seit der Sicherung, ganze Datenbank, Storage unberührt                                                                                            |

Stopp-Regel: Bei einem zweiten Eigentümer in N10, einer Datei mit mehr als 45 Sekunden in der Generalprobe oder einer fehlgeschlagenen Datei wird nicht weitergemacht, bis die Ursache geklärt ist.

## 3. Etappenkarten

Jede Karte: Zweck, Dateien, Hängt ab von, Risiko, Vorcheck, Nachcheck, Rückweg, Dauer, Wer, Fenster. Dauern sind Schätzungen, die die Generalprobe überprüft.

### H1 Storage-Vorlage v2

| Feld         | Inhalt                                                                                                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zweck        | Die Buckets `content` und `avatar` lassen angemeldete Nutzer nur noch den eigenen Ordner lesen, schreiben und löschen. `anon` bekommt keine Richtlinie                                                                                                                                                  |
| Dateien      | `supabase/manual/20261029_storage_policies_v2.sql` (Handlauf im SQL-Editor als Rolle `postgres`, ersetzt `20261023_storage_policies.sql`, wiederholbar)                                                                                                                                                 |
| Hängt ab von | V (Messung, Policy-Liste gesichert). Unabhängig von den Datenbankdateien                                                                                                                                                                                                                                |
| Risiko       | mittel. Der Bucket ist zwischen Production und Preview geteilt, die Vorlage lässt die `*_preview`-Richtlinien der Preview stehen. Annahme: alle Uploads liegen im Ordner `<auth-uid>/`. Gefunden: `PdfUploader` und `Profile.tsx`                                                                       |
| Vorcheck     | `verify-rls-lockdown.sql` (Prüfungen 9 und 10) und V08, Ausgabe sichern                                                                                                                                                                                                                                 |
| Nachcheck    | Prüfungen 9 und 10 erneut. Erwartet: eigene Ordnerrichtlinien (`*_own_folder`, `*_preview`), keine Richtlinie für `public` oder `anon` auf `content` und `avatar`. `content` und `avatar` bleiben öffentlich. Die Vorlage bricht selbst ab, wenn `anon` oder ein Nutzer ohne Dateien noch Objekte sieht |
| Rückweg      | Block "UNDO" am Ende der Vorlage (Policy-Liste aus V08 neu anlegen), ohne Wirkung auf Daten                                                                                                                                                                                                             |
| Dauer        | 5 Minuten                                                                                                                                                                                                                                                                                               |
| Wer          | Niko                                                                                                                                                                                                                                                                                                    |
| Fenster      | Mi 04.11. ab 18:30 Uhr, danach Smoke S1, S4, S5 (Avatar, PDF-Upload)                                                                                                                                                                                                                                    |

### H2 Buckets

| Feld         | Inhalt                                                                                                                                                                                                                                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zweck        | `content-solutions` (privat) gibt es, bevor Inhalt mit Referenzen `private://content-solutions/...` ankommt. `content-upload` bleibt privat. `content` und `avatar` bleiben, wie sie sind                                                                                                                                                                      |
| Mittel       | Supabase Dashboard, Storage                                                                                                                                                                                                                                                                                                                                    |
| Hängt ab von | H1                                                                                                                                                                                                                                                                                                                                                             |
| Risiko       | gering. Ein falsch öffentlicher Lösungs-Bucket wäre der echte Schaden                                                                                                                                                                                                                                                                                          |
| Vorcheck     | V08 (Spalte `public`, Limits, Typen)                                                                                                                                                                                                                                                                                                                           |
| Soll-Zustand | `content-solutions`: nicht öffentlich, Größenlimit 25 MB, erlaubter Typ `application/pdf`. `content-upload`: nicht öffentlich, 25 MB, PDF und docx (für Production unbenutzt, die JSON- und Excel-Umstellung nach `docs/kfbm-upload-runbook.md` 12.9 entfällt, solange der Upload in Production aus ist). `content` und `avatar`: öffentlich (Entscheidung D7) |
| Nachcheck    | `verify-rls-lockdown.sql`, Prüfung 10 (zeigt `content-solutions` mit `public = false`), Prüfung 9 (keine Richtlinie, die `content-solutions` nennt). N11                                                                                                                                                                                                       |
| Rückweg      | leeren Bucket löschen. Eine Änderung der Flags ist sofort umkehrbar                                                                                                                                                                                                                                                                                            |
| Dauer        | 10 Minuten                                                                                                                                                                                                                                                                                                                                                     |
| Wer          | Niko                                                                                                                                                                                                                                                                                                                                                           |
| Fenster      | Mi 04.11.                                                                                                                                                                                                                                                                                                                                                      |

### H3 Variablen und Einstellungen

| Feld                                                          | Inhalt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zweck                                                         | Pipeline und App finden alles, was sie brauchen, und nichts, was nicht in Production gehört                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Mittel                                                        | GitHub Settings, Vercel Dashboard (nur Namen ansehen, Werte nie ausgeben oder notieren)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Hängt ab von                                                  | V                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Risiko                                                        | mittel. Eine fehlende oder falsche Variable bricht Deploy oder Funktionen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| GitHub                                                        | Repository-Variablen: `SUPABASE_PROJECT_REF_PROD` (gesetzt), `KFBM_ROLLOUT_APPROVED` (steht auf `false`, Go 1 setzt sie am Rollout-Tag), **`CONTENT_SYNC_OWNER_EMAIL` neu setzen** (E-Mail-Adresse des Plattform-Administrators in Production, B10). Environment `Production`: mindestens ein Reviewer (Zweitfreigabe), Secrets `SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Tag-Ruleset für `v*` nur für Maintainer, Environment nur für `master` und `v*`                                                                                                        |
| Vercel (Projekt `wamocon-fiae-svfz`), muss vorhanden sein [A] | `DB_CONNECTION_STRING` (Rolle `postgres`, **lesbar, nicht Sensitive**, B9), `HAI_DB_CONNECTION_STRING`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` oder `SUPABASE_SERVICE_ROLE_KEY` (mindestens 16 Zeichen, Pflicht für den PIN-Nachweis und die signierten Links der Lösungen), `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` oder `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `HAI_ADMIN_PIN`, `GEMINI_API_KEY` (Einbettungen), die Variablen des Chats (`OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_MODEL`), `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `NEXT_PUBLIC_APP_URL` |
| Vercel, darf in Production nicht gesetzt sein                 | `NEXT_PUBLIC_DB_SCHEMA`, `SUPABASE_DB_SCHEMA` (der Deploy setzt sie fest), `CONTENT_UPLOAD_KI_ENABLED` (die KI-Stufe bleibt aus), `KFBM_ROLLOUT_APPROVED` (gehört nur ins Repository). Fremdanbieter-Schlüssel (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`) nur nach Entscheidung D8                                                                                                                                                                                                                                                                                                                  |
| Vorcheck                                                      | Namensliste aus dem Vercel-Dashboard abhaken, Commit-SHA des aktuellen Production-Deployments notieren (Rückweg R1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Nachcheck                                                     | Deploy-Job meldet keinen Fehler der Umgebungsprüfung (`scripts/db/deploy-env.mjs`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Rückweg                                                       | alte Werte vor der Änderung im Passwortmanager festhalten                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Dauer                                                         | 1 Stunde                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Wer                                                           | Niko                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Fenster                                                       | Di 03.11. bis Do 05.11.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### E1 Sechs Sicherheitsdateien vom 23. Oktober

| Feld         | Inhalt                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zweck        | Sechs ungenutzte Tabellen sperren, HAI-Policies schließen, anonymes Lesen der Inhaltstabellen beenden, Rechte und Trigger auf `profiles`                                                                                        |
| Dateien      | `20261023100000`, `20261023100100`, `20261023100200`, `20261023200000`, `20261023300000`, `20261023300100`                                                                                                                      |
| Hängt ab von | V. `20261023200000` muss vor `20261024001500` liegen, die Versionsnummern sichern das                                                                                                                                           |
| Risiko       | gering. Laut Projektnotiz [A] schon von Hand angewendet, die Dateien sind wiederholbar. Rest: Fremdwerkzeuge mit dem `anon`-Schlüssel auf Inhaltstabellen (`20261023100200`) verlieren den Zugriff, die App nutzt den Weg nicht |
| Vorcheck     | V02b, V03, V03b, V04, V08                                                                                                                                                                                                       |
| Nachcheck    | V03 (fünf Spalten), V04 (`profiles_protect_columns`), Smoke S7 (Gegenprobe mit dem öffentlichen Schlüssel)                                                                                                                      |
| Rückweg      | Kopfkommentar je Datei, gebündelt in Anhang B                                                                                                                                                                                   |
| Dauer        | unter 1 Minute                                                                                                                                                                                                                  |
| Wer          | Niko mit Zweitfreigabe                                                                                                                                                                                                          |
| Fenster      | Release-Lauf, Sa 07.11.                                                                                                                                                                                                         |

### E2 Katalogreihe

| Feld         | Inhalt                                                                                                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zweck        | Berufsmodell: `training_catalogs` (FIAE, KFBM), Katalogspalten, Lernfeld-Modell (`lernfelder` wird Sicht), Codes, Einschreibungen, Wahlkomponenten, Enum-Wert `SUPER_ADMIN`                                                                                                       |
| Dateien      | `20261024000100` bis `20261024001500` (15 Dateien, Wirkung je Datei in Anhang A)                                                                                                                                                                                                  |
| Hängt ab von | E1                                                                                                                                                                                                                                                                                |
| Risiko       | mittel. Strukturumbau mit Datenkopie (Lernfelder, Backfill der Einschreibungen, Zuordnung aus Kurs). Die Dateien brechen bei unerwarteten Daten sauber ab (zum Beispiel Zusatzspalten von `lernfelder` mit Werten) und ändern dann nichts                                         |
| Vorcheck     | V01 (Postgres mindestens 15), V03b (muss `false` sein), V07, V11 (fünf Zusatzspalten leer), C3 (Labels der Lernfelder)                                                                                                                                                            |
| Nachcheck    | N02, C4 bis C9 und C17 aus `docs/production-schema-migration-verification.sql` (alles FIAE, `lernfelder` gleich viele Zeilen wie `lernfelder_legacy`, alle Constraints validiert, keine Policy für `public` oder `anon` auf den neuen Tabellen). Zeilenzahlen aus V07 unverändert |
| Rückweg      | `docs/rollback/20261024-kfbm-catalog-down.sql`, nur solange alles FIAE ist, danach `migration repair --status reverted <Versionen>`. Der Enum-Wert bleibt (Anhang B)                                                                                                              |
| Dauer        | 2 bis 5 Minuten (Schätzung)                                                                                                                                                                                                                                                       |
| Wer          | Niko mit Zweitfreigabe                                                                                                                                                                                                                                                            |
| Fenster      | Release-Lauf, Sa 07.11.                                                                                                                                                                                                                                                           |

### E3 Super-Admin-Backfill

| Feld         | Inhalt                                                                                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zweck        | Admins der Plattform-Organisation werden `SUPER_ADMIN`. Admins der Kundenorganisationen bleiben `ADMIN`                                                                                                               |
| Dateien      | `20261025000000_super_admin_backfill.sql` (technisches Tor: bricht ab ohne `20261023200000` und ohne den Freigabe-Kommentar)                                                                                          |
| Hängt ab von | E2 (Enum-Wert), Freigabe-Kommentar                                                                                                                                                                                    |
| Risiko       | mittel wegen der Lücke aus Abschnitt 2.2: bis zum App-Deploy verlieren die betroffenen Admins die Oberfläche der alten App                                                                                            |
| Vorcheck     | V06b (Zahl der betroffenen Personen), V03b                                                                                                                                                                            |
| Freigabe     | unmittelbar vor dem Release: `comment on type public.user_role is 'super_admin_backfill=approved';`                                                                                                                   |
| Nachcheck    | N03 (kein `ADMIN` mehr in der Plattform-Organisation), danach Anmeldung als Admin nach dem Deploy (S3)                                                                                                                |
| Rückweg      | `update public.profiles set role = 'ADMIN' where role = 'SUPER_ADMIN';` (gültig, solange `SUPER_ADMIN` nur durch den Backfill entstand). Danach das Tor wieder schließen: `comment on type public.user_role is null;` |
| Dauer        | unter 1 Minute                                                                                                                                                                                                        |
| Wer          | Niko                                                                                                                                                                                                                  |
| Fenster      | Release-Lauf, Sa 07.11.                                                                                                                                                                                               |

### E4 Strukturdateien vom 25. bis 28. Oktober

| Feld         | Inhalt                                                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zweck        | `PUBLIC` verliert `CREATE` auf `public`, genau eine Einschreibung je Azubi, HAI-Index mit Beruf, Sichtbarkeit und Organisation, Kurs mit Komponente verbinden, Quiz-Code und Katalogprüfung, eindeutiger Buchstabe je Komponente, `options.order_index`                         |
| Dateien      | `20261025000100`, `20261026000100`, `20261027000100`, `20261028000100`, `20261028000200`, `20261028000300`                                                                                                                                                                      |
| Hängt ab von | E3                                                                                                                                                                                                                                                                              |
| Risiko       | mittel bis hoch bei `20261027000100`: `ACCESS EXCLUSIVE` auf `hai_embeddings` bis zum Ende, Backfill aller Zeilen in einer Anweisung unter 60 Sekunden, Indexbau ohne `concurrently`. Die anderen Dateien sind klein, ihre Vorprüfungen brechen mit Anzahl ab und ändern nichts |
| Vorcheck     | V07b (Größe), V10, V12, V13, C11 (mehr als eine Einschreibung je Azubi, Tabelle existiert erst nach E2: im Lauf selbst geprüft), C15 und C16                                                                                                                                    |
| Nachcheck    | N02, C11b, C12b (jeder Chunk hat einen Katalog, Lösungsseiten und alle Quiz-Chunks `trainer`), C15b, C17. Im Lauf die Meldungen `raise notice` des HAI-Backfills lesen: Zeilen ohne ableitbaren Katalog gehen an FIAE                                                           |
| Rückweg      | je Datei im Kopfkommentar (Anhang B). Die HAI-Spalten nur zusammen mit der App zurückbauen                                                                                                                                                                                      |
| Dauer        | 2 bis 10 Minuten, abhängig von `hai_embeddings` (Schätzung)                                                                                                                                                                                                                     |
| Wer          | Niko mit Zweitfreigabe                                                                                                                                                                                                                                                          |
| Fenster      | Release-Lauf, Sa 07.11.                                                                                                                                                                                                                                                         |

### E5 HAI-Quizsichtbarkeit und PIN-Zähler

| Feld         | Inhalt                                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zweck        | Fragen-Chunks der Quizze dürfen für Azubis sichtbar sein, Antworten nie. Zähler für fehlgeschlagene PIN-Eingaben über mehrere Instanzen                                                               |
| Dateien      | `20261029000100`, `20261029000200`                                                                                                                                                                    |
| Hängt ab von | E4                                                                                                                                                                                                    |
| Risiko       | gering. Keine Daten gelesen oder geändert, bestehende Quiz-Chunks bleiben `trainer` bis zur Neuindexierung. Ohne `auth_attempts` antwortet die PIN-Prüfung mit 503                                    |
| Vorcheck     | N02 vor dem Lauf zeigt, dass `hai_embeddings.visibility` existiert (E4)                                                                                                                               |
| Nachcheck    | N02, `select count(*) from public.auth_attempts` gleich 0                                                                                                                                             |
| Rückweg      | `20261029000100`: Funktion und Trigger der Vorgängerversion wiederherstellen (Kopfkommentar). `20261029000200`: `drop table if exists public.auth_attempts;` (die PIN-Prüfung antwortet dann mit 503) |
| Dauer        | unter 1 Minute                                                                                                                                                                                        |
| Wer          | Niko mit Zweitfreigabe                                                                                                                                                                                |
| Fenster      | Release-Lauf, Sa 07.11.                                                                                                                                                                               |

### E6 Tabellenrechte (RLS-Lockdown) und Nachweis

| Feld         | Inhalt                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zweck        | `anon` und `authenticated` verlieren alle Tabellen-, Sicht- und Sequenzrechte in `public`, alle Policies werden durch vier ersetzt (`profiles` lesen und eigene Spalten ändern, `notifications` lesen, `organizations` lesen). Neue Tabellen starten ohne Rechte für die API-Rollen                                                                                                                             |
| Dateien      | `20261029000300_security_revoke_api_table_access.sql`. Handlauf der Storage-Vorlage ist H1 (vorab)                                                                                                                                                                                                                                                                                                              |
| Hängt ab von | E5, H1, `profiles_protect_columns` (E1). Die Datei prüft den Trigger am Ende selbst                                                                                                                                                                                                                                                                                                                             |
| Risiko       | mittel. Der Browser nutzt `supabase-js` nur für Anmeldung, eigene Profilzeile, eigene Benachrichtigungen (Realtime), eigene Organisation und Storage. Alles andere läuft serverseitig als `postgres`. Das Dokument `docs/security-hardening-2026-10.md` und der Test `tests/unit/security/browser-db-access.test.ts` belegen das Minimum. Rest: ein Fremdwerkzeug mit dem `anon`-Schlüssel verliert den Zugriff |
| Vorcheck     | `verify-rls-lockdown.sql` vollständig, Ausgabe sichern (Prüfung 11 schlägt vorher erwartet fehl)                                                                                                                                                                                                                                                                                                                |
| Nachcheck    | `verify-rls-lockdown.sql` erneut. Die Erwartung steht in der Kopfzeile der Datei: Prüfungen 1, 4, 5 und 7 leer, Prüfung 2 nur vier Zeilen für `authenticated`, Prüfung 3 genau vier Policies, Prüfung 8 fünf Spalten, Prüfung 6 ohne `anon` und `authenticated` in den Standardrechten der Rolle `postgres`. N10 (Eigentümer). Smoke S1, S3, S5 (Glocke, Realtime), S7                                          |
| Rückweg      | `supabase/manual/rollback-rls-lockdown.sql` (stellt aus `public.rls_lockdown_backup` wieder her, bricht ohne Sicherung ab, wiederholbar). Öffnet den REST-Weg wieder: nur so lange, wie die Ursache behoben wird                                                                                                                                                                                                |
| Dauer        | 1 bis 3 Minuten (Schätzung)                                                                                                                                                                                                                                                                                                                                                                                     |
| Wer          | Niko mit Zweitfreigabe                                                                                                                                                                                                                                                                                                                                                                                          |
| Fenster      | Release-Lauf, Sa 07.11.                                                                                                                                                                                                                                                                                                                                                                                         |

### E7 Upload-Tabellen

| Feld         | Inhalt                                                                                                                                                                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zweck        | Die sieben Prozesstabellen des Inhalts-Uploads anlegen. Die Funktion bleibt in Production aus (alle Routen antworten dort mit 404, Sperre G1 in `src/lib/content-upload/staging/config.ts`)                                                                                                                                                         |
| Dateien      | `20261030000100_content_upload_tables.sql`, `20261030000200_content_upload_json_xlsx.sql`                                                                                                                                                                                                                                                           |
| Entscheidung | **Anwenden, nicht auslassen** (D6). Die Tabellen sind leer, für die API-Rollen geschlossen und ohne Wirkung. Eine Auslassung verlangt eine Ledger-Markierung ohne Struktur und blockiert später jedes "Production Deploy" und jeden "Content Sync" (B6). Wer den Upload in Production nie will, kann die Tabellen später mit den Vorlagen entfernen |
| Hängt ab von | E6                                                                                                                                                                                                                                                                                                                                                  |
| Risiko       | gering. Freigabebedingungen für den Betrieb des Uploads in Production stehen in `docs/kfbm-upload-runbook.md`, Abschnitt 8 (PDF-Leser ohne Sandbox, Claims, unbenutzte Upload-URL, Docx-Metadaten, Sichtbarkeit der Originale, Laufzeit). Sie sind **keine** Bedingung für diese Etappe, wohl aber für das Einschalten der Funktion                 |
| Vorcheck     | N02 zeigt vorher `false` für die sieben Tabellen                                                                                                                                                                                                                                                                                                    |
| Nachcheck    | N09 (Zeilensicherheit an, keine Rechte für `anon` und `authenticated`, keine Policies). Smoke S10 (die Seite `/trainer/content-upload` antwortet in Production mit 404)                                                                                                                                                                             |
| Rückweg      | `supabase/manual/rollback-content-upload-json-xlsx.sql`, dann `supabase/manual/rollback-content-upload-tables.sql` (je erst mit `rollback;` als Probe, brechen ab, wenn die Tabellen Zeilen haben). Die Verlaufszeilen bleiben, ein erneutes Anlegen verlangt das Entfernen der Version im Ledger                                                   |
| Dauer        | unter 1 Minute                                                                                                                                                                                                                                                                                                                                      |
| Wer          | Niko mit Zweitfreigabe                                                                                                                                                                                                                                                                                                                              |
| Fenster      | Release-Lauf, Sa 07.11.                                                                                                                                                                                                                                                                                                                             |

### E8 Inhaltsabgleich (Job `content-sync`)

| Feld         | Inhalt                                                                                                                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zweck        | Der Release kopiert den Ausbildungsinhalt der Preview nach Production, nur einfügend, nie löschend (Abschnitt 4)                                                                                                                               |
| Mittel       | Job `content-sync` des Releases (`--direction preview-to-production --update never`)                                                                                                                                                           |
| Hängt ab von | E7, WP1, `CONTENT_SYNC_OWNER_EMAIL` (H3), Abnahmestand der Preview (A12)                                                                                                                                                                       |
| Risiko       | mittel: Der Lauf im Release schreibt ohne weitere Zahlenkontrolle. Deshalb vorher der manuelle Trockenlauf. Zeilen, die in Production seit der Kopie vom 26.10. gelöscht wurden, würden wieder eingefügt (der Abgleich kennt keine Löschungen) |
| Vorcheck     | Manueller Workflow "Content Sync" mit `apply` aus: Bericht im Job-Summary. FIAE muss null neue Zeilen zeigen. KfBM-Zahlen mit N05 auf der Preview (Schema `public_preview`) vergleichen                                                        |
| Nachcheck    | N05 auf Production (gleiche Zahlen wie Preview), N06 (Lösungsschutz der Dokumente, keine Zeile in der zweiten Abfrage), N07 (alles inaktiv), der zweite Trockenlauf des Jobs meldet null Änderungen                                            |
| Rückweg      | Löschen der Zeilen des Katalogs KFBM nach `docs/kfbm-import-runbook.md` (Abschnitte "Apply in die Preview: wer, wann, womit, Rückbau", Lernfelder, Use Cases), nur vor der Aktivierung                                                         |
| Dauer        | 5 bis 15 Minuten (Schätzung)                                                                                                                                                                                                                   |
| Wer          | Niko mit Zweitfreigabe                                                                                                                                                                                                                         |
| Fenster      | Release-Lauf, Sa 07.11.                                                                                                                                                                                                                        |

### E9 App-Release (Job `deploy`)

| Feld         | Inhalt                                                                                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zweck        | Die App aller Änderungen seit dem letzten Production-Stand geht live: Berufsauswahl, Phasenpläne, Lösungsschutz, Rollen, PIN mit Ratenbegrenzung, signierte Links der Lösungen, Sitzungsprüfung, Abweisung der Preview-Konten |
| Mittel       | Job `deploy` des Releases (Vercel-Build des Release-Commits, Ziel Production, Schema `public` fest)                                                                                                                           |
| Hängt ab von | E8, H3                                                                                                                                                                                                                        |
| Risiko       | mittel bis hoch wegen der Größe der Änderung. Die Sicherheitsänderungen im Code wirken erst mit diesem Release                                                                                                                |
| Vorcheck     | Commit-SHA des bisherigen Deployments notiert (R1), Umgebungsprüfung im Job grün                                                                                                                                              |
| Nachcheck    | Smoke S1 bis S10 (Abschnitt 6.1), Fehler und Laufzeiten in den Vercel-Logs                                                                                                                                                    |
| Rückweg      | R1 (Vercel, notiertes Deployment). Nicht über "Production Deploy" mit älterem Release (B5)                                                                                                                                    |
| Dauer        | 10 bis 15 Minuten (Schätzung)                                                                                                                                                                                                 |
| Wer          | Niko mit Zweitfreigabe                                                                                                                                                                                                        |
| Fenster      | Release-Lauf, Sa 07.11.                                                                                                                                                                                                       |

## 4. Der Inhaltsimport in Production

### 4.1 Ausgangslage

- Die Importskripte (`import:kfbm:apply`, `import:kfbm:learning-fields`, `import:kfbm:use-cases`, `import:kfbm:documents`) haben absichtlich kein Ziel `production` und keinen Schalter dafür. Der Code lehnt Production und fremde Hosts vor der ersten Verbindung ab (`src/lib/content-import/apply/target.ts`).
- Die Quelle liegt im OneDrive des Eigentümers (Word, PDF, JSON, Excel). Sie wird nie ins Repository kopiert.
- Der Inhalt entsteht in der Preview, wird dort von Niko abgenommen und kommt von dort nach Production. Stand 27.10. standen die Preview-Läufe aus (A12).
- Der Inhalt kommt **inaktiv** an: Kurse, Enabler, Quizze und Use Cases haben `is_active = false`, Kurse sind nicht veröffentlicht, der Katalog KFBM ist inaktiv.
- Lösungsteile der Use Cases liegen als PDF im privaten Bucket `content-solutions` (Referenz `private://content-solutions/<Pfad>`), Szenario-Lösungen als Zeilen `TRAINER_SOLUTION` mit `TRAINER_ONLY`.

### 4.2 Optionen

| Option                                         | Beschreibung                                                                                                                                                                                                                                                                                                        | Aufwand (Schätzung)                                                                           | Risiko                                                                                                                                                                     | Rückweg                                               | Eignung für den Termin               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| **A1** vorhandener Inhaltsabgleich (empfohlen) | Der Workflow "Content Sync" und der Job `content-sync` des Releases kopieren die Allowlist-Tabellen von `public_preview` nach `public`, nur einfügend, mit Trockenlauf, Transaktion, Sperre, Konvergenzprüfung und Freigabe im Environment `Production`. Voraussetzung: WP1 (Allowlist) und WP2 (Eingabe `catalog`) | 0,5 bis 1 Tag Entwicklung, 1 Stunde Lauf                                                      | gering: additiv, nie löschend, nur Spalten der Allowlist, keine Nutzerdaten                                                                                                | Löschen per SQL nach Katalog, nur vor der Aktivierung | gut, passt ins Fenster               |
| A2 neues Einmalskript                          | Ein Skript kopiert die Preview-Daten einmalig nach Production, ausdrücklich freigegeben                                                                                                                                                                                                                             | 2 bis 3 Tage                                                                                  | mittel: neuer Schreibweg, nicht erprobt, dieselbe Aufgabe wie A1                                                                                                           | wie A1                                                | nicht nötig, A1 leistet dasselbe     |
| B Importskripte mit Ziel `production`          | Vier Skripte bekommen ein Ziel `production` hinter Schutz: zwei Freigaben, Bestätigung des Hosts, Probelauf Pflicht, Gate-Variable                                                                                                                                                                                  | 4 bis 6 Tage (Ziel, Prüfung, vier Skripte, Tests, Speicher für PDF, Review)                   | mittel bis hoch: zweiter, ungeprüfter Lauf gegen Production mit den Quellfragen, die noch offen sind. Schreibzugriff auf den Speicher aus der lokalen Entwicklungsumgebung | Löschen per SQL nach Katalog                          | zu knapp, nur nach der Demo sinnvoll |
| C Upload über die Oberfläche in Production     | Der Inhalts-Upload wird in Production eingeschaltet (Sperre G1 ändern)                                                                                                                                                                                                                                              | 8 bis 15 Tage (Freigabebedingungen 1 und 3, Messung der Laufzeit, Bucket-Umstellung, Abnahme) | hoch: neue Angriffsfläche vor der Demo (PDF-Leser ohne Sandbox, Datei-Uploads, Warteschlange)                                                                              | Funktion wieder abschalten                            | nicht vor der Demo                   |

### 4.3 Empfehlung

**A1.** Gründe:

1. Die Preview ist die Abnahmeumgebung. Was Niko dort geprüft hat, kommt als dieselbe Zeile mit demselben Code an. B würde die Quelle ein zweites Mal gegen Production lesen, mit allen offenen Quellfragen.
2. Es entsteht kein neuer Schreibweg gegen Production. Der Abgleich ist additiv, löscht nie, schreibt nur die Spalten der Allowlist und läuft in einer Transaktion mit Konvergenzprüfung. Er ist ohnehin Teil des Release-Laufs.
3. A1 braucht den kleinsten Aufwand (WP1, WP2) und passt in den Zeitplan. B und C verbrauchen die Zeit, die für Abnahme und Regression fehlt.
4. Der Rückweg ist einfach, solange nichts aktiviert ist.

Nachteile, die Niko kennt: Die Dokumentzeilen zeigen auf Pfade unter `preview/kfbm/` (Abschnitt 4.5). Die Preview muss bis zur Kopie stabil bleiben (kein "Preview Reset"). Der Abgleich nimmt Zeilen, die er nicht kennt, nie mit. Spätere Korrekturen kommen mit `update_mode = newer` und gesondertem Go.

Diese Empfehlung wird hier nicht umgesetzt. WP1 und WP2 sind der erste Schritt dazu.

### 4.4 Ablauf mit A1

1. **Preview-Stand festhalten.** Abnahme der Preview durch Niko, Zahlen mit N05 (Schema `public_preview`) notieren: Komponenten, Kurse, Enabler, Use Cases, Quizze, Fragen, Optionen, Lernfelder, Zuordnungen.
2. **Trockenlauf.** Workflow "Content Sync", Eingabe `apply` aus, `direction` `preview-to-production`, `update_mode` `never` und (nach WP2) `catalog` `KFBM`. Der Bericht im Job-Summary zeigt je Tabelle: Quelle, Ziel vorher, einzufügen, Ziel nachher. Prüfen: keine Abbrüche wegen nicht eindeutiger Schlüssel, KfBM-Zahlen gleich N05 der Preview, **FIAE null neue Zeilen**.
3. **Anwenden.** Entweder im Release-Lauf (E8, alle Kataloge) oder später mit `apply` an und `catalog` `KFBM`. Der Lauf endet mit einem zweiten Trockenlauf, der null Änderungen melden muss.
4. **Nachchecks.** N05 (Zahlen wie Preview), N06 (zweite Abfrage leer), N07 (alles inaktiv, Katalog inaktiv, N04).
5. **Dokumentzeilen und Dateien.** Siehe 4.5.
6. **Lernfelder und Zuordnungen** kommen mit der Allowlist (`training_catalog_learning_fields`, `training_catalog_content_mappings`, `use_cases.lernfelder`). Stichprobe: Lernfeldseite eines KfBM-Azubis nach der Aktivierung.

Entscheidung D3b: Der Abgleich läuft im Release (E8) oder später. Empfehlung: im Release, wenn die Preview bis Do 05.11. abgenommen ist. Sonst läuft der Release trotzdem (Sicherheit hat Vorrang), und der Inhalt folgt als manueller Lauf mit `catalog` `KFBM` in den Tagen 10.11. bis 12.11.

### 4.5 PDF-Dateien: Speicher-Pfade und Buckets

| Art              | Zeile in `content_documents`       | Bucket                       | Pfad heute (Preview)                               | Bemerkung                                                                                                                                                          |
| ---------------- | ---------------------------------- | ---------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enabler-Lehrtext | `THEORY`, `ALL`                    | `content` (öffentlich)       | `preview/kfbm/<Enablercode>/enabler/<Datei>`       | öffentliche URL in `storage_url`                                                                                                                                   |
| Szenario         | `EXERCISE`, `ALL`                  | `content` (öffentlich)       | `preview/kfbm/<Enablercode>/szenario/<Datei>`      |                                                                                                                                                                    |
| Use-Case-Aufgabe | `TRAINEE_QUESTION`, `ALL`          | `content` (öffentlich)       | `preview/kfbm/<Enablercode>/aufgabe/<Datei>`       |                                                                                                                                                                    |
| Musterlösung     | `TRAINER_SOLUTION`, `TRAINER_ONLY` | `content-solutions` (privat) | `preview/kfbm/<Enablercode>/musterloesung/<Datei>` | `storage_url` ist die Referenz `private://content-solutions/<Pfad>`, nur die Trainerliste macht daraus eine signierte URL (10 Minuten, mit dem geheimen Schlüssel) |

Wichtig: Production und Preview teilen dieselben Buckets. Die Dateien liegen also schon da. Der Abgleich kopiert nur die Metadaten (`storage_url`, `storage_path`, `file_size`, `mime_type`, `page_count`). Die öffentlichen URLs enthalten den Host des gemeinsamen Supabase-Projekts und funktionieren in Production unverändert.

Entscheidung D16: Pfade belassen oder umziehen.

| Weg                                                      | Beschreibung                                                                                                                                                                                  | Bewertung                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Belassen unter `preview/kfbm/` (Empfehlung für die Demo) | nichts kopieren                                                                                                                                                                               | Production-Zeilen zeigen auf das Präfix `preview/`. Ein späteres Aufräumen oder Überschreiben des Präfix (Skript mit `--overwrite-files`, Reset eines Preview-Speichers) trifft dann Production-Dokumente. Heute räumt kein Workflow dort auf [A] |
| Umziehen nach `kfbm/<Enablercode>/...`                   | Dateien im gemeinsamen Bucket kopieren (Dienstschlüssel), danach die Zeilen in einer Transaktion umschreiben (`storage_url` und `storage_path`, Referenz `private://` ebenso), erst Probelauf | braucht WP5. Rückweg: Zeilen zurückschreiben, alte Dateien bleiben bis zur Freigabe liegen. Nach der Demo einplanen, nicht davor                                                                                                                  |

Frage D7 (Bucket `content` öffentlich, H6) bleibt davon unberührt: Solange er öffentlich ist, kennt jeder mit der URL die Datei. Lösungen liegen nie dort. Die Umstellung auf einen privaten Bucket mit signierten Links ist Anwendungsarbeit (Vorlage `supabase/manual/20261029_storage_policies_v2.sql`, Abschnitt "LATER") und nicht Teil dieses Rollouts.

### 4.6 Freischaltung (Aktivierung)

Nach Abnahme, HAI-Index (Abschnitt 5) und Go 2. Alle Schritte in der Oberfläche durch den `SUPER_ADMIN`.

1. Beruf KfBM aktivieren (Katalog `is_active`).
2. Für die Demo-Organisation freigeben. In Production gibt es keine Preview-Testkonten (Production weist Konten mit `preview_only` ab). Demo-Konten werden in Production als echte Konten über die Nutzerverwaltung angelegt, mit eigenen Wegwerf-Adressen.
3. Azubi einschreiben, Wahlkomponenten wählen (zwei von neun), Ausbilder zuordnen.
4. Inhalte aktivieren (Kurse, Enabler, Quizze, Use Cases). Der Weg für etwa 225 Enabler ist offen (Entscheidung D13: Oberfläche je Element oder ein freigegebener SQL-Entwurf mit Probelauf und Rückweg, den ein Agent vorbereitet).
5. Vorher die Lösungsschutz-Tests aus 6.2 durchführen.

Rückweg: R2 (Beruf sperren), Inhalte wieder inaktiv setzen. Gelöscht wird nichts, sobald Azubis Daten dazu haben.

## 5. HAI: Neuindexierung nur mit gesondertem Go

### 5.1 Ausgangslage

- Der Chat läuft über Sokrates, die Einbettungen über Gemini (`gemini-embedding-001`, `vector(3072)`) [A, nach Code vom 26.10.]. Es gibt kein Go für einen Wechsel der Einbettungen und keines für eine Neuindexierung (Entscheidung 26.10.2026).
- Nach dem Inhaltsabgleich kennt die HAI keine KfBM-Inhalte. `hai_embeddings` wird vom Abgleich nie angefasst.
- Das Skript `scripts/reindex-gemini.ts` ist geschützt: Standard ist ein Trockenlauf (zählt Chunks, kein Modellaufruf, kein Schreiben), `--target` ist Pflicht, ein echter Lauf braucht `--apply`. Für Production zusätzlich `--confirm-production <Host der Verbindung>` und `KFBM_ROLLOUT_APPROVED=true` in der Umgebung des Prozesses (nicht aus `.env.local`). Auch der Trockenlauf gegen Production verlangt beides.

### 5.2 Reihenfolge

Nach dem Inhaltsabgleich (E8) und dem App-Release (E9), vor der Aktivierung. Nicht im Rollout-Fenster.

| Schritt | Was                                                                                                                                                                                                                                                                                 | Wer             | Wirkung                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------- |
| H-1     | Trockenlauf gegen Production: `npx tsx scripts/reindex-gemini.ts --target production --confirm-production <Host> --catalog KFBM` mit `KFBM_ROLLOUT_APPROVED=true` nur in dieser Shell. Liest, schreibt nichts, kein Modellaufruf. Ausgabe: Chunks je Quelle, Beruf und Sichtbarkeit | Niko            | lesend                                             |
| H-2     | Kostenentscheidung. Kosten gleich Zahl der Chunks mal durchschnittliche Tokens je Chunk (Chunks haben 500 Zeichen) mal Preis laut aktueller Preisliste von Google. Niko legt eine Obergrenze fest und erteilt das Go oder nicht (D9)                                                | Niko            | Entscheidung                                       |
| H-3     | Echter Lauf nur für KfBM: `... --catalog KFBM --apply`. Der Fortschritt steht in der Datenbank (Inhaltshash), ein Abbruch lässt sich fortsetzen                                                                                                                                     | Niko            | Schreibzugriff auf `hai_embeddings`, Gemini-Kosten |
| H-4     | Nachcheck: N08 (keine Zeile ohne Katalog, zweite Abfrage 0), C12b, C18 (Fragen für Azubis sichtbar, Antworten nur Trainer). Fünf Fragen als KfBM-Azubi stellen, eine Frage als FIAE-Azubi (darf keine KfBM-Quellen zeigen), eine Frage nach einer Lösung (darf keine nennen)        | Niko, Fachseite | lesend                                             |
| H-5     | Optional und getrennt, eigenes Go: Neuindexierung der FIAE-Quellen. Ohne sie bleiben die Reste C19 (alte Enabler-Chunks mit Hinweistext für Azubis) und C20 (E-Mail-Adressen in persönlichen Chunks). Beide bestehen schon heute, sie sind kein neues Risiko des Rollouts           | Niko            | wie H-3                                            |

Rückweg: `--catalog KFBM --purge --apply` löscht nur die Chunks des Katalogs, die das Skript selbst aufbaut. Die HAI antwortet dann ohne KfBM-Wissen.

Risiken: Kosten und Quotenfehler der Gemini-Schnittstelle (der Lauf ist fortsetzbar), Teilindex (die HAI antwortet dann mit Teilwissen), Schreiblast auf einer Tabelle mit Vektorspalte. Dauer: von der Zahl der Chunks abhängig, Schätzung Minuten bis eine Stunde, der Trockenlauf liefert die Zahl.

Die Sperre des Chat-Fallbacks (D8) betrifft den Chat, nicht die Einbettungen: Fällt Sokrates aus, geht der Chat heute auf jeden Anbieter mit gesetztem Schlüssel (Gemini, Claude, OpenRouter) über. Ohne Sperre gehen dann Auszüge der Inhalte an Fremdanbieter.

## 6. Abnahme- und Regressionsliste

Alle Prüfungen in Production laufen mit eigenen Testkonten (Admin, Trainer, Azubi, KfBM-Azubi), nie mit Konten echter Personen. Ergebnis je Zeile: bestanden, nicht bestanden, nicht geprüft, mit Datum und Namen.

### 6.1 Smoke-Tests direkt nach dem Release (S1 bis S10)

| Nr  | Prüfung                                                                                                                                                                                                                                     | Erwartung                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| S1  | Anmelden, Abmelden, Profil laden, Avatar hochladen                                                                                                                                                                                          | funktioniert                                                            |
| S2  | Startseite und öffentlicher Katalog ohne Anmeldung                                                                                                                                                                                          | laden                                                                   |
| S3  | Admin: Nutzerverwaltung, Menü des `SUPER_ADMIN` sichtbar                                                                                                                                                                                    | funktioniert                                                            |
| S4  | Trainer: Kursliste, Enabler öffnen, PDF im Inhaltseditor hochladen, Dokument ansehen und löschen                                                                                                                                            | funktioniert                                                            |
| S5  | Azubi: Dashboard, Kurs, Enabler-Quiz, Use-Case-Abgabe, Berichtsheft mit PDF-Upload, Benachrichtigungsglocke (Realtime)                                                                                                                      | funktioniert                                                            |
| S6  | HAI-Chat (FIAE): Frage stellen, Quellen werden angezeigt                                                                                                                                                                                    | funktioniert                                                            |
| S7  | Gegenprobe mit dem öffentlichen Schlüssel ohne Anmeldung: `/rest/v1/hai_embeddings`, `/rest/v1/options`, `/rest/v1/reflections`, `/rest/v1/courses`. Mit dem Testkonto der Azubi-Rolle: Änderung der eigenen Rolle über `/rest/v1/profiles` | keine Zeilen oder Fehler, die Rollenänderung scheitert (SQLSTATE 42501) |
| S8  | Vercel-Logs der ersten 30 Minuten                                                                                                                                                                                                           | keine Häufung von 5xx                                                   |
| S9  | PIN-Dialog der HAI-Verwaltung (nur öffnen, keine Fehleingabe zur Ratenprobe)                                                                                                                                                                | Nachweis wird ausgestellt, kein 503                                     |
| S10 | `/trainer/content-upload` und `/api/trainer/content-upload/runs` in Production                                                                                                                                                              | 404 (Funktion aus)                                                      |

### 6.2 FIAE-Regression

Kursliste, Kurs, Enabler, Use Cases, Lernfelder (Sicht), Quiz, Ausbildungsnachweis (Tätigkeitsnachweis mit Komponentenstunden), Berichtsheft, Arbeitszeugnis, Zeugnisnoten, Trainer-Ansichten, Dashboard. Zeilenzahlen aus V07 vor und nach dem Rollout gleich (außer neuen Tabellen). HAI-Antwort zu einem FIAE-Thema mit Quellen.

### 6.3 KfBM Ende zu Ende

| Nr  | Prüfung                                                                                                                 | Erwartung                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| K1  | `SUPER_ADMIN` aktiviert Beruf, gibt für die Demo-Organisation frei, schreibt Azubi ein, Wahlkomponenten (zwei von neun) | funktioniert, Grenze der Wahl greift                                            |
| K2  | KfBM-Azubi: Phasenplan, Komponentenliste mit Stunden (Wochen mal 40), Kurs, Enabler mit Lehrtext (PDF), Szenario        | sichtbar, Dateien öffnen                                                        |
| K3  | Quiz je Stufe und Global-Quiz                                                                                           | Fragen sichtbar, **keine** richtige Antwort und keine Begründung vor der Abgabe |
| K4  | Use Case: Aufgabe sichtbar, **keine** Musterlösung                                                                      | Azubi sieht keine Zeile `TRAINER_SOLUTION` und keine Referenz `private://`      |
| K5  | Lernfelder LF1 bis LF13 mit Zuordnung der Enabler und Use Cases                                                         | Seite zeigt die Zuordnung (Zähler der Use Cases mit Verzögerung bis 15 Minuten) |
| K6  | Trainer: Musterlösung öffnet über die signierte URL (zehn Minuten gültig)                                               | funktioniert, nach Ablauf 403                                                   |
| K7  | HAI als KfBM-Azubi: Persona KfBM, Antworten mit Quellen aus KfBM                                                        | funktioniert nach H-3                                                           |
| K8  | Tätigkeitsnachweis mit KfBM-Komponenten                                                                                 | funktioniert                                                                    |
| K9  | Hinweistext (`hint_text`)                                                                                               | nur Trainer                                                                     |

### 6.4 Rollen

| Rolle                              | Prüfung                                                      | Erwartung                            |
| ---------------------------------- | ------------------------------------------------------------ | ------------------------------------ |
| `SUPER_ADMIN`                      | Lehrplan ändern, Berufe aktivieren, Organisationen verwalten | erlaubt                              |
| `ADMIN` der Plattform-Organisation | Lehrplan ändern                                              | erlaubt (Lehrplan-Schreibrecht)      |
| `ADMIN` einer Kundenorganisation   | Lehrplan ändern, Berufe aktivieren                           | 403                                  |
| `TEMP_ADMIN`                       | Umfang der eigenen Organisation                              | unverändert                          |
| `TRAINER`                          | eigene Azubis, Musterlösungen                                | erlaubt, fremde Organisation nicht   |
| `TRAINEE`                          | eigener Beruf, eigene Daten                                  | erlaubt, nie Lösungen vor der Abgabe |

### 6.5 Mandanten

| Prüfung                              | Erwartung                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Organisation ohne Freigabe von KfBM  | sieht KfBM nirgends (Katalogliste, Kurse, HAI)                                                         |
| Azubi einer Organisation             | sieht nichts einer anderen Organisation                                                                |
| FIAE-Azubi in der HAI                | bekommt keine KfBM-Chunks                                                                              |
| Dokumente der Plattform-Organisation | für Kundenorganisationen in der HAI sichtbar wie vorher (V13, Abfrage der Dokumente nach Organisation) |

### 6.6 Sicherheitsregression

REST-Zugriff ohne Anmeldung auf alle Tabellen (nichts lesbar), Storage-Listing als `anon` leer, Bucket `content-solutions` und `content-upload` privat, kein Zugriff auf `private://`-Referenzen für Azubis, Upload-Routen 404, PIN-Prüfung mit Zähler, N09 und N11 wie erwartet.

## 7. Go/No-Go und Zeitplan rückwärts

### 7.1 Go 1: Freigabe des Rollouts (Do 05.11.2026)

Alle Punkte müssen erfüllt sein. Ein offener Punkt ist ein No-Go, das Ersatzfenster am 14.11. bleibt.

1. Entscheidungen D1 bis D5 sind getroffen und im Dokument eingetragen.
2. Das Messprotokoll (Anhang C) ist vollständig. Es gibt keine unerklärte Abweichung zu den Annahmen A1 bis A15.
3. Sicherung vorhanden, Zeitpunkt und Ablageort notiert, Wiederherstellung erprobt (Generalprobe).
4. Generalprobe bestanden (Kriterien aus 1.5), keine Datei über 45 Sekunden.
5. WP1 und WP2 gemergt, CI grün. Release-Kandidat ist ein fester Commit auf `master`, danach keine neuen Migrationen.
6. Ledger bereinigt, `supabase db push --linked --dry-run` zeigt genau 33 Dateien.
7. H1 (Storage), H2 (Buckets) und H3 (Variablen, Environment, `CONTENT_SYNC_OWNER_EMAIL`) erledigt und mit `verify-rls-lockdown.sql` belegt.
8. Zweitfreigabe und Betrieb für den 07.11., 05:30 bis 12:00 Uhr bestätigt.
9. Preview-Abnahme dokumentiert oder die Entscheidung D3b (Inhalt später) getroffen.
10. Wartungshinweis (T minus 7) ist verschickt.

**No-Go-Gründe:** `hai_embeddings` über der Schwelle ohne bestandene Generalprobe, zweiter Eigentümer in N10 in der Generalprobe (soweit prüfbar), Sicherung nicht wiederherstellbar, offener schwerer Fehler in der Preview.

### 7.2 Go 2: Freischaltung (Fr 13.11.2026)

1. Release-Lauf vollständig, alle Nachchecks N01 bis N11 wie erwartet, Smoke S1 bis S10 bestanden.
2. 24 Stunden Beobachtung ohne Fehlerhäufung, FIAE-Regression (6.2) bestanden.
3. KfBM-Zahlen in Production gleich Preview (N05), Lösungsschutz der Dokumente (N06) ohne Befund.
4. Go für den HAI-Index (H-2) erteilt und H-3, H-4 durchgeführt.
5. Entscheidung D8 (Fallback) getroffen und, falls ja, umgesetzt.
6. Demo-Konten angelegt und getestet.

### 7.3 Go 3: Demo (Fr 20.11.2026)

1. KfBM Ende zu Ende (6.3), Rollen (6.4), Mandanten (6.5) und Sicherheitsregression (6.6) bestanden, keine offenen Fehler der Stufen 1 und 2.
2. Fachliche Abnahme der Inhalte durch die Fachseite mit den Entscheidungen zu den Quellfragen (D12).
3. Frische Sicherung nach der letzten Datenänderung.
4. Rückfallebene geprüft: Preview mit Umgehungslink für die Gäste oder Demo mit FIAE, falls KfBM in Production zurückgenommen wird.
5. Generalprobe der Demo mit der Fachseite am Mi 25.11. eingeplant, Code-Freeze ab Sa 21.11.

**No-Go-Folge:** Demo aus der Preview (Umgehungslink, Inhalt eingefroren, kein Reset) oder Demo mit eingeschränktem Umfang. Entscheidung Niko am 20.11.

### 7.4 Zeitplan rückwärts vom 26.11.2026

| Datum                   | Meilenstein                                                           | Puffer                       |
| ----------------------- | --------------------------------------------------------------------- | ---------------------------- |
| Do 26.11.               | IHK-Demo, 08:00 Uhr Smoke-Check, 08:30 Uhr Anmeldung der Demo-Konten  |                              |
| Mi 25.11.               | Generalprobe der Demo mit der Fachseite                               | 1 Tag                        |
| Mo 23.11. bis Di 24.11. | Puffer, nur Datenkorrekturen                                          | 2 Tage                       |
| Sa 21.11.               | Code-Freeze                                                           |                              |
| Fr 20.11.               | Go 3                                                                  |                              |
| Mi 18.11. bis Do 19.11. | Abnahme der Fachseite, Rest der Regression                            |                              |
| Mo 16.11. bis Di 17.11. | KfBM Ende zu Ende, Rollen, Mandanten in Production                    |                              |
| Sa 14.11.               | Ersatzfenster für den Rollout, spätester Termin für Schema-Änderungen |                              |
| Fr 13.11.               | Go 2                                                                  |                              |
| Di 10.11. bis Do 12.11. | Inhaltsabgleich (falls nicht im Release), HAI-Index KfBM, Aktivierung |                              |
| Sa 07.11.               | Rollout                                                               | 7 Tage bis zum Ersatzfenster |
| Do 05.11.               | Go 1                                                                  |                              |
| Mo 02.11. bis Mi 04.11. | Backup, Generalprobe, Ledger, H1 bis H3                               |                              |
| Do 29.10. bis Fr 30.10. | Entscheidungen D1 bis D5, Vorchecks, WP1 und WP2                      |                              |

Verzögert sich der Rollout über den 14.11. hinaus, wird die Demo aus der Preview gezeigt (7.3).

## 8. Offene Entscheidungen für Niko

| Nr  | Frage                                                                                                                                                                                                                                                                                            | Optionen                                                                                                                                                                      | Empfehlung                                                                                                                     | Frist       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| D1  | Demo auf Production oder Preview?                                                                                                                                                                                                                                                                | Production, Preview mit Umgehungslink                                                                                                                                         | Production, Preview als Rückfallebene. Die Preview liegt hinter der Vercel-Anmeldung [A]                                       | 30.10.      |
| D2  | Weg für den Backfill (Abschnitt 2.2)                                                                                                                                                                                                                                                             | P1 Freigabe vorab und kurze Lücke, P2 Pipeline ändern, P3 Handauslieferung                                                                                                    | P1                                                                                                                             | 30.10.      |
| D3  | Importweg (Abschnitt 4)                                                                                                                                                                                                                                                                          | A1, A2, B, C                                                                                                                                                                  | A1                                                                                                                             | 30.10.      |
| D3b | Inhaltsabgleich im Release oder später                                                                                                                                                                                                                                                           | im Release, später mit `catalog` `KFBM`                                                                                                                                       | im Release, wenn die Preview bis 05.11. abgenommen ist                                                                         | 04.11.      |
| D4  | Fenster und Zweitfreigabe                                                                                                                                                                                                                                                                        | Sa 07.11. mit Ersatz Sa 14.11., andere Zeit. Name der zweiten Person                                                                                                          | Sa 07.11., 06:00 bis 12:00 Uhr                                                                                                 | 30.10.      |
| D5  | Ledger-Bereinigung (Abschnitt 1.7)                                                                                                                                                                                                                                                               | (b) 60 Zeilen entfernen, (a) Platzhalterdateien                                                                                                                               | (b)                                                                                                                            | 30.10.      |
| D6  | Upload-Tabellen in Production anlegen?                                                                                                                                                                                                                                                           | anwenden (Funktion bleibt aus), auslassen mit Ledger-Markierung                                                                                                               | anwenden (B6)                                                                                                                  | 02.11.      |
| D7  | Bucket `content` öffentlich lassen (H6)?                                                                                                                                                                                                                                                         | öffentlich bis nach der Demo, privat mit signierten Links (Anwendungsarbeit)                                                                                                  | öffentlich bis nach der Demo, Entscheidung festhalten. Lösungen liegen im privaten Bucket                                      | 06.11.      |
| D8  | Chat-Fallback auf Fremdanbieter sperren?                                                                                                                                                                                                                                                         | sperren (Code, WP6), Schlüssel der Fremdanbieter nicht setzen, nichts tun                                                                                                     | sperren vor der Freischaltung. Mit Konfiguration allein nicht erreichbar, weil Gemini auch für die Einbettungen gebraucht wird | 06.11.      |
| D9  | Neuindexierung KfBM (Abschnitt 5)                                                                                                                                                                                                                                                                | Go nach Kostenzahl, kein Go                                                                                                                                                   | Go, nur Katalog KfBM, mit Obergrenze                                                                                           | 10.11.      |
| D10 | Neuindexierung FIAE für die Reste C19 und C20                                                                                                                                                                                                                                                    | Go, später                                                                                                                                                                    | später, getrennt von der Demo                                                                                                  | nach 26.11. |
| D11 | Sichtbarkeit der Originale des Uploads vor der Aktivierung                                                                                                                                                                                                                                       | sofort, erst nach Aktivierung                                                                                                                                                 | erst nach Aktivierung (nur relevant, wenn der Upload je in Production läuft)                                                   | bei Bedarf  |
| D12 | Quellfragen: Szenario 23c im Ordner 23b (Szenario 23b fehlt), Szenarien 10m, 16c, 23c mit Aufgabe, Global-Quiz 01, 03, 04 doppelt, Use Case 5b, Quizfehler (10b, 16e, 11c, 1a High, 6g, Global 13), K14-a, 18 Quizze mit 8 Fragen, Enabler 6d bis 6g unlesbar, Lernfeldtitel und Stunden, Wochen | je Punkt: festlegen, nachliefern, auslassen                                                                                                                                   | in der Fachabnahme klären, vor dem Abgleich oder danach per `update_mode = newer`                                              | 06.11.      |
| D13 | Wie werden die Inhalte aktiviert?                                                                                                                                                                                                                                                                | Oberfläche je Element, freigegebener SQL-Entwurf mit Probelauf                                                                                                                | SQL-Entwurf mit Rückweg, von einem Agenten vorbereitet, von Niko ausgeführt                                                    | 10.11.      |
| D14 | Rollout-Tor nach dem Rollout                                                                                                                                                                                                                                                                     | Variable auf `false` lassen (jede künftige Migration braucht ein Go), `GATED_FROM` anheben (WP3)                                                                              | WP3, dann normale Releases ohne Zusatzfreigabe                                                                                 | nach 08.11. |
| D15 | Sicherheitsreste vor der Öffnung für Kunden                                                                                                                                                                                                                                                      | Schlüsselrotation (Legacy-JWT-Schlüssel, geleakter `service_role`-Schlüssel in der Git-Historie), Auth-Einstellungen (`mailer_autoconfirm`, Site URL `http://localhost:3000`) | nicht Teil des Rollouts, aber vor der Öffnung für Kunden, nach der Demo                                                        | nach 26.11. |
| D16 | Pfade der KfBM-Dateien (4.5)                                                                                                                                                                                                                                                                     | belassen unter `preview/kfbm/`, umziehen (WP5)                                                                                                                                | belassen bis nach der Demo                                                                                                     | 06.11.      |
| D17 | Tarif und Wiederherstellung (A13)                                                                                                                                                                                                                                                                | Dashboard prüfen                                                                                                                                                              | Niko prüft, Ergebnis ins Messprotokoll                                                                                         | 30.10.      |

## 9. Zuständigkeiten und Kommunikationsplan

### 9.1 Rollen

Die Namen trägt Niko ein. Eine Person kann mehrere Rollen haben, nicht aber Ausführung und Zweitfreigabe derselben Stufe.

| Rolle                      | Name           | Aufgabe                                                                                              |
| -------------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| Eigentümer und Entscheider | Niko           | alle Entscheidungen, alle Messungen, alle schreibenden Schritte in Production, Go 1 bis 3            |
| Zweitfreigabe              | _einzutragen_  | Reviewer des GitHub-Environments `Production` (drei Freigaben im Release), Gegenlesen der Nachchecks |
| Betrieb                    | _einzutragen_  | Sicherung, Wiederherstellung, Generalprobe, Beobachtung von Vercel und Supabase                      |
| Entwicklung (Agenten)      | Claude-Agenten | WP1 bis WP6, Dokumentation, Prüf-SQL, Tests. Nie Production, auch nicht lesend                       |
| Fachseite                  | _einzutragen_  | inhaltliche Abnahme KfBM, Quellfragen, Demo-Probe                                                    |

### 9.2 Zuständigkeit je Aktivität

| Aktivität                              | Niko                    | Zweitfreigabe          | Betrieb    | Entwicklung         | Fachseite   |
| -------------------------------------- | ----------------------- | ---------------------- | ---------- | ------------------- | ----------- |
| Messungen V01 bis V13                  | ausführen               | lesen                  |            |                     |             |
| Sicherung und Restore-Test             | verantwortlich          |                        | ausführen  |                     |             |
| Generalprobe                           | verantwortlich          |                        | ausführen  | Skripte, Auswertung |             |
| Ledger-Bereinigung                     | ausführen               |                        |            |                     |             |
| WP1 bis WP6                            | abnehmen                |                        |            | ausführen           |             |
| H1 bis H3                              | ausführen               |                        |            |                     |             |
| Release-Lauf E1 bis E9                 | ausführen und freigeben | zweite Freigabe je Job | beobachten | Rückfragen          |             |
| Smoke-Tests                            | ausführen               |                        | ausführen  |                     |             |
| Inhaltsabgleich und Prüfung der Zahlen | freigeben               | zweite Freigabe        |            |                     | prüfen      |
| HAI-Index                              | Go und Ausführung       |                        |            |                     | Stichproben |
| Aktivierung                            | ausführen               |                        |            |                     | abnehmen    |
| Abnahme und Regression                 | verantwortlich          |                        |            |                     | ausführen   |
| Go 1 bis 3                             | entscheidet             | gegenlesen             | berichtet  | berichtet           | berichtet   |

### 9.3 Kommunikationsplan

| Wann                           | Von     | An                                | Kanal                          | Inhalt                                             |
| ------------------------------ | ------- | --------------------------------- | ------------------------------ | -------------------------------------------------- |
| Fr 30.10.                      | Niko    | Zweitfreigabe, Betrieb, Fachseite | E-Mail                         | Termine, Rollen, Entscheidungen D1 bis D5          |
| Sa 31.10. (sieben Tage vorher) | Niko    | alle Nutzer von Production        | E-Mail oder Hinweis in der App | Wartungshinweis für Sa 07.11., 06:00 bis 12:00 Uhr |
| Do 05.11.                      | Niko    | Beteiligte                        | E-Mail                         | Ergebnis Go 1, Bestätigung des Fensters            |
| Fr 06.11.                      | Niko    | Nutzer                            | E-Mail                         | Erinnerung (T minus 1)                             |
| Sa 07.11., 06:00               | Niko    | Beteiligte                        | Chat                           | Start des Fensters                                 |
| Sa 07.11., bei Abweichung      | Niko    | Beteiligte                        | Chat                           | Stopp oder Rückweg, mit Stufe aus 2.6              |
| Sa 07.11., Ende                | Niko    | alle                              | E-Mail                         | Abschluss, Stand, bekannte Einschränkungen         |
| So 08.11. und Mo 09.11.        | Betrieb | Niko                              | Chat                           | Beobachtung der Fehlerrate                         |
| Fr 13.11., Fr 20.11.           | Niko    | Beteiligte                        | E-Mail                         | Ergebnis Go 2 und Go 3                             |
| Mi 25.11.                      | Niko    | Fachseite                         | Termin                         | Generalprobe der Demo                              |
| Do 26.11.                      | Niko    | Beteiligte                        | Chat                           | Smoke-Check vor der Demo                           |

Muster für den Wartungshinweis: "Am Samstag, 07.11.2026, zwischen 06:00 und 12:00 Uhr aktualisieren wir die Lernplattform. In dieser Zeit kann es kurze Unterbrechungen geben. Bitte arbeiten Sie in dieser Zeit nicht in der Plattform. Alle Ihre Daten bleiben erhalten."

Eskalation: Fehler in Production zuerst an Niko, dann Entscheidung über die Rückweg-Stufe (2.6). Fehler, die Lösungen oder Daten anderer Organisationen sichtbar machen, sind sofort ein Rückweg R2 (Beruf sperren) und ein Stopp der Demo-Vorbereitung.

## Anhang A: Dateien und Wirkung je Datei

Das Repository hat 34 Dateien. `202606260001` ist die Basis (von Hand angewendet, nach der Ledger-Bereinigung als angewendet geführt). Die übrigen 33 sind offen. "Tor" heißt: hinter `KFBM_ROLLOUT_APPROVED` (ab `20261024000100`, 27 Dateien).

| Datei            | Etappe | Tor  | Wirkung                                                                                                                                                                           |
| ---------------- | ------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `202606260001`   | Basis  | nein | Spalte `profiles.ausbildung_duration_years`, schon angewendet                                                                                                                     |
| `20261023100000` | E1     | nein | sechs ungenutzte Tabellen: RLS an, Rechte von `anon` und `authenticated` entzogen, keine Daten geändert                                                                           |
| `20261023100100` | E1     | nein | `hai_embeddings` und `hai_reindex_jobs`: offene Policies für `public` entfernt                                                                                                    |
| `20261023100200` | E1     | nein | anonyme Lese-Policies von 19 Inhaltstabellen entfernt (auch `options` mit den richtigen Antworten)                                                                                |
| `20261023200000` | E1     | nein | `profiles`: UPDATE nur noch auf fünf Spalten für `authenticated`, Policy mit `WITH CHECK`                                                                                         |
| `20261023300000` | E1     | nein | Trigger `profiles_protect_columns` (Version 1)                                                                                                                                    |
| `20261023300100` | E1     | nein | Trigger und Funktion Version 2 (auch INSERT und DELETE gesperrt, `assigned_trainer_id` nicht mehr schreibbar)                                                                     |
| `20261024000100` | E2     | ja   | `training_catalogs` (FIAE, KFBM), `training_catalog_id` an Kursen und Komponenten, Lernfeld- und Mapping-Tabellen. Stoppt beim zweiten Lauf                                       |
| `20261024000200` | E2     | ja   | Spalte `code` an Kursen, Enablern, Use Cases (nullable, eindeutig je Katalog beziehungsweise Kurs)                                                                                |
| `20261024000300` | E2     | ja   | `training_catalog_id` an Enablern, Use Cases, Mappings, Backfill per UPDATE, Fremdschlüssel `NOT VALID`                                                                           |
| `20261024000400` | E2     | ja   | validiert die Fremdschlüssel                                                                                                                                                      |
| `20261024000500` | E2     | ja   | Lernfeld-Modell: Daten in die Katalogtabellen, Altbestand als `*_legacy`, `lernfelder` und `lernfeld_mappings` werden Sichten. Bricht ab, wenn die fünf Zusatzspalten Werte haben |
| `20261024000600` | E2     | ja   | `quizzes.training_catalog_id` (Standard FIAE) und `training_component_id`                                                                                                         |
| `20261024000700` | E2     | ja   | `training_components.phase`, Backfill aus dem Ausbildungsjahr                                                                                                                     |
| `20261024000800` | E2     | ja   | `use_cases.enabler_id` (nullable, eindeutig), Diagnose-Sicht                                                                                                                      |
| `20261024000900` | E2     | ja   | `occupation_code`, `regulation_version`, `settings`, `elective_pick_count`                                                                                                        |
| `20261024001000` | E2     | ja   | `organization_catalogs`, FIAE für bestehende Organisationen                                                                                                                       |
| `20261024001100` | E2     | ja   | `trainee_enrollments`                                                                                                                                                             |
| `20261024001200` | E2     | ja   | Backfill der Einschreibungen (FIAE)                                                                                                                                               |
| `20261024001300` | E2     | ja   | `training_components.kind`                                                                                                                                                        |
| `20261024001400` | E2     | ja   | `trainee_elective_choices`                                                                                                                                                        |
| `20261024001500` | E2     | ja   | Enum-Wert `SUPER_ADMIN` (eigene Datei, prüft die Spaltenrechte selbst)                                                                                                            |
| `20261025000000` | E3     | ja   | Backfill ADMIN der Plattform-Organisation zu SUPER_ADMIN, technisches Tor (Kommentar-Freigabe)                                                                                    |
| `20261025000100` | E4     | ja   | `revoke create on schema public from public`                                                                                                                                      |
| `20261026000100` | E4     | ja   | eindeutiger Index `trainee_enrollments_trainee_unique`. Bricht ab bei mehr als einer Einschreibung je Azubi                                                                       |
| `20261027000100` | E4     | ja   | HAI-Index: `training_catalog_id`, `visibility`, `organization_id`, Ableitungsfunktionen, Trigger, Backfill ohne Modellaufruf. `ACCESS EXCLUSIVE` bis zum Ende                     |
| `20261028000100` | E4     | ja   | `courses.training_component_id`, zusammengesetzter Fremdschlüssel, eindeutiger Index                                                                                              |
| `20261028000200` | E4     | ja   | `quizzes.code`, Katalogprüfung der Quiz-Verknüpfungen (zwei Trigger). Bricht ab bei Verstößen                                                                                     |
| `20261028000300` | E4     | ja   | eindeutig `(component_id, letter)` in `training_use_cases`, `options.order_index`. Bricht ab bei Dubletten                                                                        |
| `20261029000100` | E5     | ja   | Funktion und Trigger der HAI-Sichtbarkeit (Fragen-Chunks für Azubis, Antworten nur Trainer). Keine Daten                                                                          |
| `20261029000200` | E5     | ja   | Tabelle `auth_attempts` (PIN-Zähler), geschlossen für die API-Rollen                                                                                                              |
| `20261029000300` | E6     | ja   | Lockdown der API-Rollen (Rechte, Policies, Standardrechte, Funktionsrechte), Sicherung in `rls_lockdown_backup`                                                                   |
| `20261030000100` | E7     | ja   | sieben Tabellen `content_upload_*`, leer, geschlossen                                                                                                                             |
| `20261030000200` | E7     | ja   | erweitert die Prüfung `content_upload_files_ext_check` um `json` und `xlsx`                                                                                                       |

## Anhang B: Rückwege je Datei

Alle Rückwege sind Handarbeit im SQL-Editor als Rolle `postgres`, in einer Transaktion, erst als Probe mit `rollback`, dann mit `commit`. Der Gesamtrückbau läuft in umgekehrter Reihenfolge und nur, solange kein KfBM-Datensatz besteht.

| Reihenfolge | Datei                                 | Rückweg                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1           | `20261030000200`                      | `supabase/manual/rollback-content-upload-json-xlsx.sql` (bricht ab, wenn eine Zeile `json` oder `xlsx` hat)                                                                                                                                                                                                                                                                                                     |
| 2           | `20261030000100`                      | `supabase/manual/rollback-content-upload-tables.sql` (bricht ab, wenn eine Tabelle Zeilen hat, außer mit dem ausdrücklichen Schalter)                                                                                                                                                                                                                                                                           |
| 3           | `20261029000300`                      | `supabase/manual/rollback-rls-lockdown.sql` (stellt aus `public.rls_lockdown_backup` wieder her)                                                                                                                                                                                                                                                                                                                |
| 4           | `20261029000200`                      | `drop table if exists public.auth_attempts;`                                                                                                                                                                                                                                                                                                                                                                    |
| 5           | `20261029000100`                      | Funktion `hai_embedding_visibility` und Trigger `hai_embeddings_set_scope` der Fassung von `20261027000100` neu anlegen (Kopfkommentar der Datei)                                                                                                                                                                                                                                                               |
| 6           | `20261028000300`                      | `alter table public.training_use_cases drop constraint training_use_cases_component_letter_unique; alter table public.options drop column order_index;`                                                                                                                                                                                                                                                         |
| 7           | `20261028000200`                      | `drop trigger enabler_quiz_links_catalog_check on public.enabler_quiz_links; drop trigger quizzes_catalog_link_check on public.quizzes; drop function public.check_quiz_link_catalog(); drop function public.check_quiz_catalog_for_links(); drop index public.quizzes_catalog_code_unique; alter table public.quizzes drop constraint quizzes_code_format_check; alter table public.quizzes drop column code;` |
| 8           | `20261028000100`                      | `drop index public.courses_training_component_unique; alter table public.courses drop constraint courses_component_catalog_fk; alter table public.courses drop column training_component_id;`                                                                                                                                                                                                                   |
| 9           | `20261027000100`                      | Kopfkommentar der Datei (Trigger, Funktionen, Indizes und die drei Spalten von `hai_embeddings` entfernen). Nur zusammen mit dem App-Rückbau, die App setzt die Spalten voraus                                                                                                                                                                                                                                  |
| 10          | `20261026000100`                      | `drop index public.trainee_enrollments_trainee_unique;`                                                                                                                                                                                                                                                                                                                                                         |
| 11          | `20261025000100`                      | `grant create on schema public to public;`                                                                                                                                                                                                                                                                                                                                                                      |
| 12          | `20261025000000`                      | `update public.profiles set role = 'ADMIN' where role = 'SUPER_ADMIN';` und `comment on type public.user_role is null;`                                                                                                                                                                                                                                                                                         |
| 13          | `20261024000100` bis `20261024001500` | `docs/rollback/20261024-kfbm-catalog-down.sql` (bricht ab, sobald ein Datensatz außerhalb von FIAE existiert). Der Enum-Wert `SUPER_ADMIN` bleibt bestehen                                                                                                                                                                                                                                                      |
| 14          | `20261023100000` bis `20261023300100` | Kopfkommentare der Dateien. Ein Rückbau öffnet gewollt geschlossene Zugriffswege und ist nur sinnvoll, wenn ein externer Aufrufer sie braucht                                                                                                                                                                                                                                                                   |
| 15          | Ledger                                | `supabase migration repair --status reverted <Versionen der zurückgebauten Dateien>`                                                                                                                                                                                                                                                                                                                            |

Reihenfolge 7 und 8 und 13: Die Dateien `20261028000100` bis `20261028000300` deckt das Skript der Katalogreihe ebenfalls ab (laut Kopf, "wenn sie liefen"). Dann entfallen die Zeilen 6 bis 8. Vor dem Skript der Katalogreihe muss `20261027000100` (Zeile 9) zurückgebaut sein, weil `hai_embeddings` einen Fremdschlüssel auf `training_catalogs` hat. In der Generalprobe zu bestätigen.

## Anhang C: Messprotokoll (Vorlage)

Niko trägt ein. Spalte "Erwartet" nennt den Wert, ab dem weitergemacht werden darf.

| Messung                      | Datei und Abfrage         | Erwartet                                                           | Gemessen | Datum und Uhrzeit | in Ordnung |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------ | -------- | ----------------- | ---------- |
| Identität                    | V01                       | Projekt FIEA-Production, Rolle `postgres`, Postgres mindestens 15  |          |                   |            |
| Ledger                       | V02, V02b                 | 60 Zeilen, letzte `20260227143256`, `202606260001` fehlt           |          |                   |            |
| Rolle der Spalte `role`      | V03b                      | `false`                                                            |          |                   |            |
| Spaltenrechte                | V03                       | fünf Spalten für `authenticated`, keine für `anon`                 |          |                   |            |
| Trigger                      | V04                       | `profiles_protect_columns` auf `profiles`, keiner auf `auth.users` |          |                   |            |
| Link-Formen                  | V05, V05b                 | Zahlen notieren                                                    |          |                   |            |
| Profile ohne Organisation    | V06                       | Zahlen notieren                                                    |          |                   |            |
| Admins der Plattform         | V06b                      | Zahl notieren (Lücke aus 2.2)                                      |          |                   |            |
| Zeilenzahlen                 | V07                       | 26 Kurse, 189 Enabler, 88 Use Cases (Stand 23.10.)                 |          |                   |            |
| Größe `hai_embeddings`       | V07b                      | unter 50.000 Zeilen und unter 1 GB                                 |          |                   |            |
| Policies und Buckets         | V08                       | sichern                                                            |          |                   |            |
| Rollen                       | V09                       | App als `postgres`                                                 |          |                   |            |
| `CREATE` auf `public`        | V10                       | `true` vor E4, `false` danach                                      |          |                   |            |
| Zustand vor der Reihe        | V11                       | `training_catalogs` null, Zusatzspalten leer                       |          |                   |            |
| Doppelte Buchstaben          | V12                       | 0 Zeilen                                                           |          |                   |            |
| HAI-Chunks                   | V13                       | Zahlen notieren                                                    |          |                   |            |
| Vercel-Deployment            | Dashboard                 | Commit-SHA und Zeit                                                |          |                   |            |
| Tarif und Wiederherstellung  | Dashboard                 | Backup-Zeitpunkt, PITR ja oder nein                                |          |                   |            |
| Ledger nach dem Release      | N01                       | 0 Zeilen                                                           |          |                   |            |
| Objekte der Reihe            | N02                       | keine Zeile mit `present = false`                                  |          |                   |            |
| Rollen der Plattform         | N03                       | kein `ADMIN` mehr                                                  |          |                   |            |
| Katalogstand                 | N04                       | FIAE aktiv, KFBM inaktiv                                           |          |                   |            |
| Inhalt je Katalog            | N05                       | KfBM gleich Preview                                                |          |                   |            |
| Lösungsschutz                | N06                       | zweite Abfrage leer                                                |          |                   |            |
| Aktivierungsstand            | N07                       | KfBM alles inaktiv bis zur Freischaltung                           |          |                   |            |
| HAI nach dem Index           | N08                       | kein Katalog `NULL`, zweite Abfrage 0                              |          |                   |            |
| Upload-Tabellen              | N09                       | RLS an, keine Rechte, keine Policies                               |          |                   |            |
| Eigentümer                   | N10                       | nur `postgres`                                                     |          |                   |            |
| Buckets und Storage-Policies | N11                       | `content-solutions` und `content-upload` nicht öffentlich          |          |                   |            |
| Nachweis der Rechte          | `verify-rls-lockdown.sql` | Erwartung in der Kopfzeile der Datei                               |          |                   |            |

## Anhang D: Befehle (Referenz)

Verbindungen nie in Dateien oder Chats schreiben. Die CLI ist in der Pipeline auf Version 2.118.0 gepinnt. Für Läufe gegen einen lokalen Container braucht die CLI `?sslmode=disable` in der Adresse.

```bash
supabase link --project-ref <Referenz aus SUPABASE_PROJECT_REF_PROD>
supabase migration list --linked
supabase migration repair --status reverted <60 Versionen> --linked
supabase migration repair --status applied 202606260001 --linked
supabase db push --linked --dry-run
node scripts/db/rollout-gate.mjs --plan dry-run.txt
node scripts/db/baseline-guard.mjs --plan dry-run.txt
node scripts/db/migration-check.mjs --base refs/tags/v1.0.0
```

Erwartete Fehlerbilder der CLI (lokal nachgestellt):

| Meldung                                                                                             | Bedeutung                                                                  | Maßnahme                                                                            |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `DbPushMissingLocalError` ("Remote migration versions not found in local migrations directory")     | das Ledger hat Versionen ohne Datei (B1)                                   | Ledger-Bereinigung (1.7)                                                            |
| `DbPushMissingRemoteError` ("Found local migration files to be inserted before the last migration") | eine spätere Version ist angewendet oder markiert, eine frühere fehlt (B2) | nicht mit `--include-all` überfahren, Ursache klären                                |
| `DbPushApplyError` mit "Gate closed: ..." an `20261025000000`                                       | Freigabe-Kommentar fehlt, `20261023200000` fehlt                           | Freigabe setzen (E3), Lauf wiederholen. Die davor liegenden Dateien sind angewendet |

Belege, auf denen die Aussagen mit [L] beruhen (lokale Wegwerf-Kopie, nicht Production): Push ohne Freigabe stoppt nach 21 Dateien an `20261025000000`, nach der Freigabe laufen die übrigen 12 durch, anschließend meldet `db push --dry-run` "Remote database is up to date." `node scripts/db/migration-check.mjs --base refs/tags/v1.0.0` meldet 34 Dateien in Ordnung. Das Rollout-Tor zählt im Plan 27 gesperrte Dateien. Die Abfragen V01 bis V13 laufen auf der Struktur vom 23.10., N01 bis N11 auf dem Endstand (N01 leer, N02 ohne `false`).

## Anhang E: Abweichungen zwischen den Quellen

Beim Abgleich der Dokumente mit den Dateien und Skripten sind diese Widersprüche aufgefallen. Sie sind in diesem Runbook aufgelöst, WP4 bereinigt die älteren Dokumente.

| Quelle                                                                                    | Aussage dort                                                                        | Befund                                                                                                                        | Folge                                                           |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `docs/production-schema-migration.md`, Abschnitte "Dateien und Wirkung" und "Reihenfolge" | Die Reihe endet bei `20261029000100`                                                | Es fehlen `20261029000200`, `20261029000300`, `20261030000100` und `20261030000200`. Die Dateien vom 23.10. stehen dort nicht | Anhang A dieses Runbooks ist vollständig (34 Dateien)           |
| `docs/production-schema-migration.md`, Reihenfolge Punkte 5 und 6                         | App-Release vor dem Backfill                                                        | Mit der Pipeline nicht herstellbar (B2)                                                                                       | Freigabe vorab, kurze Lücke (Abschnitt 2.2)                     |
| `docs/release-prozess.md`, Abschnitt 6, Schritt 3                                         | `db push --dry-run` muss nach der Reparatur "Remote database is up to date." melden | Heute offen: 33 Dateien. Die 60 Ledger-Zeilen ohne Datei lassen `db push` abbrechen (B1)                                      | Ledger-Bereinigung (1.7), erwartet wird der Plan mit 33 Dateien |
| `docs/release-prozess.md`, Abschnitt 10                                                   | Rückweg über "Production Deploy" mit einem älteren Release                          | Nach dem Rollout verweigert die Prüfung "up to date" (B5)                                                                     | Rückweg über Vercel (R1)                                        |
| `docs/release-prozess.md`, Abschnitt 8                                                    | "Bekannter Befund": `lernfelder` in der Allowlist                                   | bleibt offen und blockiert den Release-Lauf (B3)                                                                              | WP1                                                             |
| `supabase/known-drift.txt`                                                                | 60 Ledger-Zeilen "cannot be fixed any more, baseline"                               | Mit der CLI lassen sie sich entfernen, und der Release-Lauf verlangt es (B1)                                                  | Datei wird nach der Bereinigung gegenstandslos, WP4             |
| `docs/security-hardening-2026-10.md`                                                      | "Nichts davon wurde angewendet" (Stand 23.10. morgens)                              | Die Projektnotiz vom 24.10. nennt die Dateien als von Hand angewendet [A]                                                     | V02b, V03, V04 klären es                                        |
| `docs/security-hardening-2026-10.md`, "Weitere offene Punkte"                             | `DB_CONNECTION_STRING` als "sensitive" speichern                                    | `scripts/db/deploy-env.mjs` verlangt für Production einen lesbaren Wert (B9)                                                  | Production-Variable nicht als Sensitive anlegen                 |
| `docs/kfbm-upload-runbook.md`, Abschnitt 7                                                | Die Tabellen des Uploads fehlen in Production bis zum Rollout                       | Nach dem Rollout existieren sie, leer und geschlossen, die Funktion bleibt durch G1 aus                                       | Etappe E7, Smoke S10                                            |
| Auftrag RO1                                                                               | 35 Migrationsdateien                                                                | Das Repository hat 34 (eine Basis, 33 offene)                                                                                 | Anhang A                                                        |
