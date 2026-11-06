# Lehren aus dem Produktivgang v2.0.0 (05. und 06.11.2026)

Zweck: Die Fehler des ersten Produktivgangs mit Migrationen, ihre Ursache und die Regel, damit sie bei der nächsten Erweiterung nicht noch einmal passieren. Die Checkliste in Abschnitt 2 gehört vor jedes Release, das Migrationen enthält.

Bezug: `docs/release-prozess.md` (Ablauf), `docs/kfbm-production-rollout.md` (Runbook mit den Freigaben), `docs/production-schema-migration.md`.

## 1. Was schiefgegangen ist

| Nr. | Fehler | Ursache | Wirkung | Behebung | Regel für die Zukunft |
| --- | ------ | ------- | ------- | -------- | --------------------- |
| 1 | Release-Lauf hielt in `migrate` an | Die Migration `20261025000000_super_admin_backfill.sql` hat ein Freigabetor (Kommentar `super_admin_backfill=approved`). Die manuelle Freigabe vor dem Release (Runbook E3) stand nicht in der Checkliste. | 21 von 43 Migrationen waren angewendet, alte App auf halb migrierter Struktur, ein Admin ohne Oberfläche | Kommentar gesetzt, "Re-run failed jobs" | Vor jedem Release alle Tore suchen (Abschnitt 2, Schritt 3) und die Freigaben vorher setzen |
| 2 | Rollout-Gate und Baseline-Guard prüften einen leeren Plan | Die Supabase CLI schreibt die Liste der offenen Migrationen und "up to date" auf **stderr**. `\| tee dry-run.txt` fing nur stdout. | Die Schutzfunktionen waren im Release wirkungslos, die Prüfung "Verify nothing is open" wäre nach der Migration rot geworden | `2>&1 \| tee` an vier Stellen, Regressionstest in `security-boundary.test.mjs` | Jede Erfassung von CLI-Ausgabe für eine Prüfung muss stderr einschließen. Eine Prüfung, die nie rot wurde, wurde nie getestet |
| 3 | Inhaltsabgleich scheiterte mit "statement timeout" nach 2 Minuten | Der Generator verglich Schlüsselspalten mit `is not distinct from`. Das nutzt keinen Index und keinen Hash-Join, es ist eine Schleife über Quelle mal Ziel (zuerst bei `questions`). Die Pipeline läuft über die Management-API mit eigener Rolle und hartem 2-Minuten-Limit. | Content-Sync rot, Deploy übersprungen, Inhalte fehlten | Generator: `=` bei NOT NULL-Schlüsselspalten des Ziels, Index und `analyze` auf den Mapping-Tabellen (Abschnitt 3) | Neue oder große Tabellen in der Allowlist vorher mit Produktionsmengen messen (Abschnitt 2, Schritt 6) |
| 4 | Versuch, das Limit im Skript anzuheben, wirkte nicht | `SET LOCAL statement_timeout` innerhalb desselben Statements wirkt nicht, PostgreSQL setzt den Timer beim Start des Statements. Geprüft: 130 Sekunden `pg_sleep` nach `SET LOCAL` brach nach 2 Minuten ab. | Zeitverlust, Änderung wieder verworfen | Ursache beheben statt Limit anheben | Ein Limit lässt sich nur auf Rollen- oder Verbindungsebene ändern. Eine Rollen-Einstellung (`ALTER ROLE postgres`) gilt nicht für die Rolle der Pipeline |
| 5 | `CONTENT_SYNC_OWNER_EMAIL` war im Release leer | Die Repository-Variable wurde nie gesetzt. Das Skript warnt nur, es bricht nicht ab. | Zeilen ohne passenden Ersteller werden übersprungen, mit ihnen Kurse, Quizze und Dokumente | Variable setzen (Abschnitt 3) | Variablen vor dem Release mit `gh variable list` prüfen (Abschnitt 2, Schritt 2) |
| 6 | Release-Notes nannten 39 statt 43 Migrationen und FIAE-Inhalte, die die Pipeline nicht bringt | Notes und Pipeline wurden nicht gegeneinander geprüft | falsche Erwartung beim Lesen der Notes | Zahl korrigiert, FIAE separat nachgezogen | Zahlen der Notes aus dem Probelauf übernehmen. Was die Pipeline nicht liefert, nicht als geliefert schreiben |
| 7 | Lokale Prüfungen scheiterten | Lokale Supabase CLI 2.70.5 statt der in der CI gepinnten 2.118.0. Direkter Datenbank-Host nur über IPv6, aus Docker nicht erreichbar. | Stunden für Backup und Trockenlauf | CLI 2.118.0 aus dem GitHub-Release geladen, Session Pooler (IPv4) benutzt | Lokal dieselbe CLI-Version wie die CI. Für Docker und `pg_dump` den Session Pooler nehmen |
| 8 | Testkonten ohne `preview_only` | Das Kennzeichen liegt in `auth.users.raw_app_meta_data`, und `auth.users` ist zwischen Preview und Production geteilt. Zwei Gmail-Testkonten hatten es nicht. | Ein Testkonto hätte sich in Production anmelden können | Kennzeichen gesetzt | Vor jedem Release die Testkonten in `auth.users` prüfen (Abschnitt 2, Schritt 4) |
| 9 | Unbenutzte GitHub-Environments | Sechs Environments mit Namenszusatz, die kein Workflow nutzt | Verwirrung, ein Secret am falschen Ort | gelöscht, es gibt nur `Preview` und `Production` | Nur diese zwei Environments. Secrets nur dort |

## 2. Checkliste vor jedem Release mit Migrationen

1. **Probelauf mit Tag.** Tag auf `master` anlegen (bei Korrekturen ein Wegwerf-Tag wie `v2.0.0-rc1`), Workflow "Release Rehearsal" mit dem Tag starten. Die Zusammenfassung nennt Plan und Commit. Erst bei Grün das Release für denselben Commit veröffentlichen. Der Probelauf gilt nur für die Migration, nicht für den Inhaltsabgleich.
2. **Variablen und Secrets.** `gh variable list` und `gh secret list --env Production`: `SUPABASE_PROJECT_REF_PROD`, `KFBM_ROLLOUT_APPROVED`, `CONTENT_SYNC_OWNER_EMAIL` (ein Profil, das in Production existiert), `VERCEL_PROJECT_ID`.
3. **Tore finden und Freigaben setzen.** `grep -l -i -E "gate closed|=approved" supabase/migrations/*.sql` für die offenen Dateien. Jedes Tor hat im Runbook eine Freigabe (Spalte "Freigabe"). Setzen unmittelbar vor dem Release, den Zeitpunkt mit dem Release abstimmen.
4. **Testkonten.** In `auth.users` sind alle Konten, die nicht nach Production gehören, mit `preview_only = true` gekennzeichnet. Echte Produktionskonten dürfen es nicht tragen.
5. **Backup.** Logischer Dump (`public`, `supabase_migrations`, `auth.users`) über den Session Pooler, verschlüsselt, Passphrase im Passwort-Manager, Klartext nach der Prüfung löschen. Zusätzlich die tägliche Sicherung von Supabase prüfen.
6. **Größen und Voraussetzungen messen.** Zeilenzahl und Größe der Tabellen, die gesperrt oder umgeschrieben werden (zum Beispiel `hai_embeddings`: bis 50.000 Zeilen und 1 GB), und die Vorbedingungen der Migrationen als lesende Abfragen gegen Production (Duplikate, fehlende Tabellen, Katalogabweichungen).
7. **Release-Notes gegen die Pipeline lesen.** Zahl der Migrationen aus dem Probelauf. Nur Inhalte nennen, die der Release-Lauf wirklich synchronisiert.
8. **Nach der Migration.** Trockenlauf des Inhaltsabgleichs (er braucht die neue Struktur). Erst bei sauberem Trockenlauf anwenden.

## 3. Folgearbeiten

- Der Generator des Abgleichs (`scripts/db/content-sync.mjs`) nutzt für NOT NULL-Schlüssel `=` und legt auf den Mapping-Tabellen Index und Statistik an. Tests in `tests/scripts/db/content-sync.test.mjs`.
- Das Skript sollte im Release **abbrechen**, wenn `CONTENT_SYNC_OWNER_EMAIL` fehlt und Zeilen übersprungen würden, statt nur zu warnen.
- Das Rollout-Gate könnte die manuellen Tore selbst melden ("Tor in Datei X, Freigabe fehlt"), statt erst mitten im Lauf anzuhalten.
- Der Inhaltsabgleich für FIAE (ohne `--catalog`) ist separat zu entscheiden, siehe `docs/release-prozess.md`, Abschnitt 8.
