WAMOCON GmbH, Mergenthalerallee 79-81, 65760 Eschborn

# Probelauf der Rollout-Migrationen auf einem lokalen Klon

Stand: 29.10.2026, Paket PH6 (Jira WMCNL-2815, Phase 6). Dieses Dokument gehört zum Runbook `docs/kfbm-production-rollout.md` (Abschnitt 1.5, Generalprobe). Es beschreibt, was das Skript `scripts/db/rehearse-rollout-local.mjs` automatisch prüft, was es nicht prüfen kann und welches Ergebnis der Lauf vom 29.10.2026 hatte. Es gibt keine Verbindung zu Production, zur gehosteten Preview, zum Speicher oder zu einem Supabase-Projekt. Das Skript liest keine Zugangsdaten und keine Umgebungsvariable.

## Was schon vorhanden war

| Baustein | Was er prüft | Grenze |
| -------- | ------------ | ------ |
| `scripts/db/migration-check.mjs` (`npm run db:migrations:check`) | Dateinamen, Reihenfolge, keine Änderung angewendeter Dateien, zerstörende Anweisungen, Umschreibbarkeit für die Preview | liest nur Dateien, führt kein SQL aus |
| `scripts/db/rollout-gate.mjs` | stoppt einen Plan mit Dateien ab `20261024000100`, solange `KFBM_ROLLOUT_APPROVED` nicht exakt `true` ist | wird nur mit Plantext getestet (`tests/scripts/db/rollout-gate.test.mjs`) |
| `scripts/db/baseline-guard.mjs` | stoppt, wenn der Plan eine Basisdatei erneut anwenden würde | wie oben |
| `scripts/db/preview-migrate.mjs`, `preview-rebuild-db.test.mjs` | Neuaufbau von `public_preview` auf einem echten Postgres, nur mit `PREVIEW_REBUILD_TEST_URL` | prüft die Preview, nicht die Reihe auf `public` |
| `docs/production-schema-migration*.md`, `-verification.sql` | Runbook und Prüf-SQL der Katalogreihe | Handarbeit |
| `docs/kfbm-production-rollout-checks.sql` | V01 bis V14b vor und N01 bis N12 nach dem Rollout | Handarbeit in Production |

Neu ist der durchgehende, wiederholbare Lauf: ein Befehl baut ein Ausgangsschema, wendet die gesperrten Dateien an und führt die V- und N-Prüfungen aus.

## Das Skript

```
node scripts/db/rehearse-rollout-local.mjs              Plan anzeigen, nichts wird gestartet
node scripts/db/rehearse-rollout-local.mjs --run        Probelauf (Docker, Image lokal vorhanden)
```

Weitere Schalter: `--structure <Datei>` (eigener Strukturabzug statt der Schema-Historie, siehe unten), `--no-seed`, `--keep` (Container behalten), `--json <Datei>`, `--image <Name>`, `--pull`, `--baseline-only` (nur bis zu den V-Prüfungen).

Ablauf von `--run`:

1. Ein Wegwerf-Container aus `public.ecr.aws/supabase/postgres:17.11.0.006` (dasselbe Image wie die früheren Proben). Kein veröffentlichter Port und kein Netzwerk (`--network none`), Zugriff nur über `docker exec`, nur gegen einen Docker auf diesem Rechner (`DOCKER_HOST` und `DOCKER_CONTEXT` werden entfernt, ein entfernter Kontext wird abgelehnt), zufälliges Kennwort je Lauf, das nie ausgegeben wird. Der Container trägt das Label `wmc-rehearsal=1` und wird am Ende entfernt, auch bei einem Fehler und bei Strg+C (`--keep` ausgenommen).
2. Vorbereitung (`scripts/db/rehearsal/00-prep.sql`): API-Rollen, Schemas `auth` und `storage` als Attrappen, `vector`, Ledger-Tabelle.
3. Ausgangsschema: entweder aus `--structure` oder aus den 55 Dateien unter `src/db/migrations/drizzle` in Dateireihenfolge (Fehler werden gezählt und toleriert, die bekannten Lücken schließt `scripts/db/rehearsal/05-baseline-gaps.sql`).
4. Manuelle Basis: `202606260001` und die sechs Sicherheitsdateien vor `20261024000100`, mit Ledger-Zeile je Datei.
5. Erfundene Beispieldaten (`scripts/db/rehearsal/10-seed.sql`): 2 Organisationen (eine Plattform-Organisation), 7 Konten, 3 Kurse, 4 Enabler, 2 Use Cases, 2 Lernfelder mit Zuordnung, 2 Quizze, Dokumente mit Musterlösung, 6 Chunks im HAI-Index. Alle Namen und Adressen sind erfunden (`example.invalid`).
6. V-Prüfungen (aus `docs/kfbm-production-rollout-checks.sql` gelesen, nicht kopiert).
7. Tor: Plantext mit den gesperrten Dateien an `rollout-gate.mjs` und `baseline-guard.mjs`, das Tor geschlossen (Erwartung: Abbruch) und offen (Erwartung: Freigabe). `KFBM_ROLLOUT_APPROVED=true` steht nur in der Umgebung dieses Kindprozesses, nie in der des Skripts und nie in einer Datei.
8. Die 28 gesperrten Dateien ab `20261024000100`, je eine Transaktion, Zeit je Datei, Ledger-Zeile danach. Die Super-Admin-Datei `20261025000000` muss zuerst anhalten (Tor zu) und läuft erst nach dem Freigabe-Kommentar am Typ `user_role`.
9. N-Prüfungen, Zeilenzahlen aller Bestandstabellen vor und nach der Reihe (nichts darf verloren gehen), Nachweis der Datenschritte an den Beispielzeilen (genau ein Super-Admin, drei Einschreibungen, zwei kopierte Lernfelder).
10. Container entfernen.

Erwartungen mit hartem Ergebnis: V03b (Azubis dürfen die eigene Rolle nicht ändern), N01 (Ledger gleich Repository), N02 (alle Objekte der Reihe vorhanden). Alle anderen Prüfungen müssen fehlerfrei laufen, ihre Ausgabe ist Information (mit `--json` ablegen).

Tests für das Skript (ohne Docker): `tests/scripts/db/rehearse-rollout-local.test.mjs` (Plan, Argumente, Einteilung der Dateien, Zerlegung der Prüfdatei, Erwartungen, Sicherheitseigenschaften des Quelltexts).

## Ergebnis des Laufs vom 29.10.2026

Lokal, Windows, Docker Desktop, Image `public.ecr.aws/supabase/postgres:17.11.0.006`, Pipeline-Stand `origin/preview` (35 Dateien in `supabase/migrations`).

| Aufruf | Ergebnis | Laufzeit gesamt |
| ------ | -------- | --------------- |
| `--run` (Ausgangsschema aus der Schema-Historie) | 83 von 83 Schritten OK | 46 Sekunden |
| `--run --structure <Strukturabzug vom 23.10.2026>` | 81 von 81 Schritten OK | 31 Sekunden |

Beide Läufe: Tor zu stoppt den Plan, Tor offen gibt ihn frei, der Basis-Guard findet keinen Treffer, `20261025000000` hält ohne Token an, alle 28 Dateien laufen durch, N01 liefert keine Zeile, N02 keine fehlende Objektzeile, kein Datenverlust (die Tabellen `lernfelder` und `lernfeld_mappings` werden zu Sichten, ihre Zeilen bleiben als `*_legacy` erhalten), Super-Admin, Einschreibungen und Lernfeld-Kopie wie erwartet, Container entfernt.

Laufzeit der 28 Dateien zusammen: etwa 5 Sekunden, die längste Datei (`20261029000300`) 0,25 Sekunden. **Das ist keine Aussage über Production.** Die Beispieltabellen haben wenige Zeilen. Die Dauer an echten Daten (besonders `20261027000100` auf `hai_embeddings`, Stopp-Regel 45 Sekunden) misst nur die Generalprobe auf einer Wiederherstellung (Runbook, Abschnitt 1.5).

## Die Lücke: das Ausgangsschema ist aus dem Repository nicht herstellbar

Production hat eine Struktur, die kein Satz von Dateien im Repository vollständig erzeugt. Der Abzug der echten Struktur (`public-structure.sql` aus dem Snapshot des Preview-Resets) gehört nicht ins Repository. Gemessen wurde der Unterschied zwischen dem Abzug vom 23.10.2026 und der Nachbildung aus der Historie.

Fehler beim Abspielen der Historie (15, toleriert, alle benannt):

- `0001`, `0025`, `0030`: Spalte ist schon vorhanden (die Historie ist keine sauber abspielbare Kette, sie enthält Dateien, die dasselbe tun).
- `0010`: Relation `geschaeftsprozesse` fehlt, `0013_cleanup_test_data` und `0014_production_cleanup`: Relation `reflections` fehlt.
- `0013_unknown_spyke`: `year` und `training_stage` lassen sich nicht in `integer[]` umwandeln.
- `0015` bis `0017`: "No trainer found" (Datenschritte, die ein Konto voraussetzen).
- `0019`: ein `ivfflat`-Index erlaubt höchstens 2000 Dimensionen (die Spalte hat 3072).
- `0024_fix_storage_policies`: fehlende Eigentümerrechte an `storage.objects`.

Unterschiede der Struktur nach den Fehlern:

- Nur in Production: Tabelle `reflections` und vier Sicherungstabellen `_backup_*`. Nur in der Historie: `geschäftsprozesse`.
- Spalten nur in Production: `lernfelder` (fünf Zusatzspalten, vom Skript nachgetragen), `enablers` (vier Szenario- und Hinweisspalten, vom Skript nachgetragen), `annual_performance_summaries.sozialkompetenz_avg`, `work_certificates.sozialkompetenz_grade`.
- Typen, die abweichen: Zeitstempel der HAI-Tabellen (`timestamptz` in Production, `timestamp` in der Historie), `profiles.full_name` und `avatar_url` (`text` statt `varchar`), `use_cases.year` und `training_stage` (Feld statt Zahl), `weekly_evaluations.status` (Text statt Aufzählung), Datumsfelder von `work_certificates`.
- Der Auslöser auf `auth.users` (`handle_new_user`) kommt aus der Historie, in Production gibt es ihn nicht (Annahme A4). Das Skript entfernt ihn vor den Beispieldaten.

Was das für die Aussagekraft heißt:

- Die Historie reicht, um die **Reihe selbst** zu erproben: Alle 28 Dateien, das Tor, der Freigabe-Kommentar, die Datenschritte und die N-Prüfungen laufen durch. Das ist ein Regressionstest der Reihe.
- Sie reicht **nicht**, um zu belegen, dass die Reihe auf der **echten** Struktur läuft. Dafür gibt es `--structure`: Niko oder eine von ihm benannte Person legt den Strukturabzug lokal ab (nie ins Repository) und ruft das Skript mit dem Pfad auf. Der Lauf vom 29.10.2026 mit dem Abzug vom 23.10.2026 war ebenfalls fehlerfrei. Der Abzug wurde dabei nur gelesen, nicht ins Repository kopiert, sein Inhalt steht in keinem Bericht.
- Daten aus Production fehlen in beiden Fällen. Die Datenanteile (Backfill der Einschreibungen, Lernfeld-Kopie, HAI-Backfill) sind nur an erfundenen Zeilen geprüft. Das schließt weiter nur die Generalprobe auf einer Wiederherstellung (Runbook 1.5).
- Nicht Teil des Probelaufs: die Supabase-CLI mit `db push` (die Dateien werden mit `psql` angewendet, das Ledger schreibt das Skript selbst), Storage-Richtlinien (`supabase/manual/*`), die Inhaltsübernahme in Production (Abschnitte 4.x des Runbooks) und alles, was Production selbst betrifft.

## Aufräumen

Das Skript entfernt seinen Container selbst. Ein Rest (nach einem harten Abbruch) lässt sich so finden und entfernen:

```
docker ps -a --filter label=wmc-rehearsal=1
docker rm -f -v <Name>
```
