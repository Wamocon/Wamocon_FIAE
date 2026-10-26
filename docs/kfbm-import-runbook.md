# KfBM-Inhaltsimport: Runbook für Plan, Prüfung, Probelauf und Apply

Stand: 26.10.2026. Dieses Paket ist Phase 4.4 des KfBM-Umbaus. Es schreibt die geparsten Inhalte (Phase 4.0 und 4.3, siehe `docs/kfbm-import-quellformat.md`) in die Datenbank, standardmäßig als Probelauf.

**Production ist ausdrücklich nicht vorgesehen.** Das Skript hat kein Ziel `production` und keinen Schalter dafür. Ein Apply in Production gibt es erst nach dem Go des Eigentümers und dem Rollout (Variable `KFBM_ROLLOUT_APPROVED`, `docs/release-prozess.md`), und dann nur nach einer bewussten Änderung des Skripts. Dieses Paket enthält keine Migration und hat keine Wirkung auf Production.

## Was das Skript tut und was nicht

Es liest die Quelldokumente (nur lesend) und schreibt in acht Tabellen: `training_components`, `courses`, `enablers`, `quizzes`, `questions`, `options`, `enabler_quiz_links` und `content_documents`. Es löscht nie etwas (kein `DELETE`, kein `TRUNCATE`, keine Struktur) und überschreibt keine bestehende Zeile, außer mit `--update-existing` und nur in benannten Spalten (`src/lib/content-import/apply/tables.ts`).

Es lädt keine Dateien in den Storage hoch, ruft keine Modelle auf, löst keine Indexierung aus und nutzt kein Netzwerk außer der Zieldatenbank. Use Cases und die Zuordnung der Lernfelder aus der Excel (Phase 4.5) gehören nicht dazu.

## Ablauf in vier Schritten

Alle Befehle laufen im Repository. Die Verbindung kommt ausschließlich aus der Umgebungsvariablen `DB_CONNECTION_STRING`, nie aus einer `.env`-Datei. Das Skript gibt weder die Verbindung noch Inhalte der Dateien aus.

### 1. Plan (ohne Datenbank)

```
npm run import:kfbm:apply -- plan "<Pfad zu Komponente>" --out kfbm-plan.json --hydrate
```

Liest die Word-Dateien nacheinander (OneDrive-Platzhalter lädt `--hydrate` herunter, Frist je Datei mit `--timeout <Sekunden>`) und schreibt den vollständigen Plan als JSON und daneben eine Zusammenfassung als Markdown (`kfbm-plan.md`). Mit `--components K4,K24.2` lässt sich der Lauf auf einzelne Komponenten begrenzen.

- Die Zusammenfassung nennt Zahlen, Namen und Gründe, keine Inhalte. Sie ist die Vorlage für die Abnahme des Plans.
- **Die JSON-Datei enthält die Inhalte der Quelldateien, auch die Lösungen.** Sie gehört nicht ins Repository (Dateinamen `kfbm-plan*.json` und `kfbm-plan*.md` stehen in der `.gitignore`), nicht in Tickets und nicht in Chats. Sie ist wie die Quelle zu behandeln.
- Alles Unklare wird übersprungen und mit Datei und Grund in der Zusammenfassung geführt, nie geraten.

### 2. Prüfung (nur lesend)

```
$env:DB_CONNECTION_STRING = "<Verbindung des Ziels>"
npm run import:kfbm:apply -- check --plan kfbm-plan.json --target local --created-by <Profil-UUID>
```

Vergleicht den Plan mit der Zieldatenbank in einer schreibgeschützten Transaktion: was ist neu, was existiert schon (gleicher Schlüssel), was würde sich ändern, was ist ein Konflikt. Ein Konflikt (zum Beispiel ein Quiz mit anderer Fragenzahl in der Datenbank) beendet den Lauf mit Exit-Code 3. Mit `--report-out <Datei.md>` entsteht ein Bericht ohne Inhalte.

### 3. Probelauf (Standard von `run`)

```
npm run import:kfbm:apply -- run --plan kfbm-plan.json --target local --created-by <Profil-UUID>
```

Führt alles aus (alle Einfügungen laufen gegen die echten Constraints und Trigger), gibt die Zählung je Tabelle aus und rollt dann zurück. Danach liegt nichts in der Datenbank. Das ist der Normalfall vor jedem echten Lauf.

### 4. Apply

```
npm run import:kfbm:apply -- run --plan kfbm-plan.json --target local --created-by <Profil-UUID> --apply
```

Ein echter Lauf braucht `--apply` und ein Ziel, dessen Host, Schema und Rolle zur Angabe passen. Alles geschieht in einer Transaktion (Isolation `repeatable read`, `lock_timeout` 5 s, `statement_timeout` 60 s, Advisory Lock gegen zwei gleichzeitige Läufe). Bei einem Fehler wird nichts übernommen. Ein zweiter Lauf schreibt nichts (idempotent), eine fehlende Zeile wird ergänzt.

| Option                    | Wirkung                                                                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--update-existing`       | aktualisiert bestehende Zeilen in den benannten Spalten (Titel, Beschreibungen, Fragen- und Optionstexte, Reihenfolge, Art und Phase der Komponente). Nie `is_active`, Autor, Speicherspalten. Ein fehlender Wert im Plan löscht keinen bestehenden Text. |
| `--scenario-solutions`    | schreibt zusätzlich die Lösungsteile der Szenarien (nur Ziel `local`, siehe unten)                                                                                                                                                                        |
| `--confirm-host <Host>`   | Pflicht für einen echten Lauf in der Preview, muss der Host der Verbindung sein                                                                                                                                                                           |
| `--report-out <Datei.md>` | Bericht ohne Inhalte                                                                                                                                                                                                                                      |

## Ziele und Schutz

| Ziel         | Erlaubt, wenn                                                                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local`      | Host ist eine Loopback-Adresse, `current_schema` und die Auflösung von `training_catalogs` sind `public`, die Datenbank hat keine Preview-Schemas oder Preview-Rollen                           |
| `preview`    | Host ist nicht Loopback, `current_schema` und die Auflösung sind `public_preview`, die Rolle ist `app_preview` oder `app_preview_migrator`, ein echter Lauf nennt den Host mit `--confirm-host` |
| `production` | nie                                                                                                                                                                                             |

Zusätzlich gilt: Die Verbindung wird aus einzelnen Feldern gebaut. Parameter wie `?host=`, `?options=` oder `?user=` in der Verbindung werden abgelehnt, nur `?sslmode=` ist erlaubt. Ein Katalog `KFBM` muss in der Zieldatenbank existieren und aktiv sein, sonst bricht der Lauf ab. Der Autor (`--created-by`) muss ein Profil mit Trainer- oder Admin-Rolle sein.

TLS: Für gehostete Ziele verschlüsselt das Skript, prüft aber das Zertifikat nur mit `?sslmode=verify-full` (und dem passenden CA-Zertifikat in `NODE_EXTRA_CA_CERTS`). Ohne diese Angabe wie im Reindex-Skript ohne Prüfung, das Skript weist darauf hin.

## Apply in die Preview: wer, wann, womit, Rückbau

- **Wer:** der Eigentümer (Niko), niemand sonst. Der Agent, der dieses Paket gebaut hat, schreibt nicht in die Preview.
- **Wann:** nach der Abnahme der Zusammenfassung des Plans und nach einem Probelauf gegen die Preview (`check` und `run` ohne `--apply`), der keine Konflikte meldet. Die Voraussetzungen unten müssen erfüllt sein.
- **Womit:** `DB_CONNECTION_STRING` der Preview mit der Rolle `app_preview_migrator`, `--target preview --apply --confirm-host <Host>`, `--created-by` ist das Profil des Superadmins der Preview (dort braucht jedes Konto vor der ersten Anmeldung Rolle und Organisation).
- **Voraussetzungen in der Preview:** die Migrationen bis `20261029000100` sind angewendet, der Katalog `KFBM` ist aktiv (der Seed legt ihn inaktiv an, der Superadmin schaltet ihn ein), `check` meldet keine Konflikte.
- **Aktivierung:** Alle importierten Kurse, Enabler und Quizze sind inaktiv (`is_active = false`, Kurse auch nicht veröffentlicht). Das steuert `content.activate` in `scripts/import/kfbm-decisions.json`. Aktiviert wird erst nach der inhaltlichen Abnahme und nach Klärung der Punkte unter "Vor der Aktivierung".
- **Rückbau:** Das Skript löscht nie. Der Rückbau in der Preview ist ein bewusster Schritt des Eigentümers: entweder der Reset der Preview-Struktur (`supabase/preview-setup`, Preview Reset) oder die folgenden Anweisungen in einer Transaktion, erst als Probe mit `rollback`, dann mit `commit`. Sie treffen nur Zeilen des Katalogs KFBM.

```sql
begin;
with kfbm as (select id from training_catalogs where code = 'KFBM')
delete from content_documents where enabler_id in
  (select e.id from enablers e where e.training_catalog_id in (select id from kfbm));
delete from enabler_quiz_links where quiz_id in
  (select q.id from quizzes q where q.training_catalog_id in (select id from training_catalogs where code = 'KFBM'));
delete from quizzes where training_catalog_id in (select id from training_catalogs where code = 'KFBM');
delete from enablers where training_catalog_id in (select id from training_catalogs where code = 'KFBM');
delete from courses where training_catalog_id in (select id from training_catalogs where code = 'KFBM');
delete from training_components where training_catalog_id in (select id from training_catalogs where code = 'KFBM');
-- Fragen und Optionen fallen mit den Quizzen weg (on delete cascade)
rollback; -- zur Kontrolle der Zahlen, dann mit commit wiederholen
```

## Wo die Daten landen

| Quelle              | Ziel                                                                                                                                                                                                                         | Schlüssel für die Idempotenz |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Komponente (Ordner) | `training_components` (Code `K6.1`, Art `pflicht`, `wahl` oder `integrativ`, Phase 1, 2 oder leer) und je Komponente ein Kurs in `courses` (gleicher Code, `training_component_id`)                                          | Katalog und Code             |
| Enabler-Text (Word) | `enablers` (Code `K6.2-d`, Titel aus der Überschrift, Text in `description_text`)                                                                                                                                            | Kurs und Code                |
| Quiz je Stufe       | `quizzes` (Typ `LESSON`, Code `K6.2-d-low`), `questions` (Nummer als `order_index`), `options` (vier je Frage, `order_index` 1 bis 4), `enabler_quiz_links` (LOW, MEDIUM, HIGH)                                              | Katalog und Code             |
| Global-Quiz         | `quizzes` (Typ `GLOBAL`, Code `K6.2-global`, `training_component_id`) mit 20 Fragen. Die Stufe der Frage (1 bis 5 leicht, 6 bis 15 mittel, 16 bis 20 schwer) ergibt sich aus der Nummer, die Tabelle hat dafür keine Spalte. | Katalog und Code             |
| Szenario            | `content_documents` am Enabler, bis zu drei Zeilen (siehe unten)                                                                                                                                                             | Enabler, Typ und Titel       |

Die Komponenten tragen vorläufig Wochen und Sollstunden 0 (die Spalten sind `NOT NULL`, der Plan nennt keine Werte). `order_index` einer Komponente ist `Nummer * 10 + Teilung` (K1 gleich 10, K6.2 gleich 62). Der Kurs bekommt `year` gleich Phase (die Plattform führt "Ausbildungsjahr" als Phase) und `chapter` gleich `order_index`.

## Lösungsschutz

- Frage und Optionen stehen in `questions.question_text` und `options.option_text`. Die richtige Antwort steht nur in `options.is_correct`, die Kurzbegründung nur in `options.explanation` der richtigen Option, `questions.expected_answer` bleibt leer. So hält es die App heute (die Routen der Azubis lesen `is_correct` nicht, die Begründung kommt mit dem Ergebnis).
- Szenario: Die Ausgangssituation steht als Dokumentzeile `TRAINEE_QUESTION` mit Sichtbarkeit `ALL` (Text in `description`). Das Lösungsszenario und der Abschnitt zum Fachwissen sind je eine Zeile `TRAINER_SOLUTION` mit Sichtbarkeit `TRAINER_ONLY`. Das ist die Art, wie die Plattform Use-Case-Dokumente trennt (`src/app/api/trainer/use-cases/[useCaseId]/documents/route.ts`), und die HAI-Indexierung ordnet solche Zeilen dem Trainerbereich zu (`src/lib/hai/indexScope.ts`). Die Datenbank hat keine eigene Tabelle für Szenarien.
- Die Dokumentzeilen haben noch keine Datei: `storage_url` ist leer (die Spalte ist `NOT NULL`), `mime_type` ist `text/plain`. Die Reindex-Skripte überspringen eine leere `storage_url`.
- Das Skript prüft den Plan und jede Zeile vor dem Schreiben: eine Lösungsmarke ("Richtige Antwort:", "Kurzbegründung:", "Lösungsszenario", "Fachwissen zur Lösung") oder ein langer Lösungstext in einem sichtbaren Feld lässt den Lauf abbrechen, beim Planen wird die Datei übersprungen.

**Lösungsteile der Szenarien nur lokal.** Die Richtlinie `cd_select` der Tabelle `content_documents` (`src/db/migrations/drizzle/0016_rls_policies.sql`) erlaubt allen Rollen das Lesen von Zeilen ohne Organisation, ohne Rücksicht auf die Sichtbarkeit. Wer den öffentlichen Schlüssel hat, könnte die Lösungstexte über die REST-Schnittstelle lesen. Deshalb schreibt das Skript die Zeilen `TRAINER_SOLUTION` nur mit `--scenario-solutions`, und dieser Schalter ist für die Preview gesperrt, bis die Richtlinie (Lesen nur für `authenticated` und ohne `TRAINER_ONLY` und `TRAINER_SOLUTION` für Nicht-Trainer, kein `select` für `anon`) in einer eigenen Migration eingeschränkt ist. Bis dahin enthält die Preview nur die Ausgangssituation der Szenarien.

## Vor der Aktivierung der Inhalte

1. Die Route `GET /api/trainee/enablers/[enablerId]/quizzes/[difficulty]` liefert `options.explanation` an Azubis schon vor der Antwort (die Seite nutzt das, um die Begründung nach der Antwort zu zeigen). Weil die Begründung nur an der richtigen Option steht, verrät das die richtige Antwort. Das ist bestehender Code und gilt auch für FIAE. Vor der Aktivierung eines Quiz die Route ändern (Begründung erst mit dem Ergebnis aus `submit`).
2. Die Seite der Azubis für einen Enabler ruft die Dokumentenroute des Trainers auf und listet jede Dokumentzeile als Link. Die Route liefert alle Spalten ohne Filter nach Sichtbarkeit. Sie bleibt für Azubis gesperrt, solange niemand sie öffnet. Wer sie öffnet, muss `TRAINER_ONLY` und `TRAINER_SOLUTION` ausfiltern und Zeilen mit leerer `storage_url` nicht als Link zeigen.
3. Die Wochen und Sollstunden der Komponenten und die Zuordnung der Lernfelder fehlen noch.

## Upload der Originaldateien (eigenes Paket, nicht Teil dieses Laufs)

Nötig sind: ein Plan, welche Dateien (Enabler-Text, Szenario, Quiz je Stufe, Global-Quiz, jeweils als Word und PDF) wohin gehören; der Upload in den Bucket mit einem Präfix je Umgebung (`preview/`), weil Storage zwischen Preview und Production geteilt ist; danach je Datei `storage_url`, `storage_path`, `file_size`, `mime_type` und `page_count` der vorhandenen Dokumentzeilen setzen (für die Enabler-Texte neue Zeilen vom Typ `THEORY`); Entscheidung zum privaten Bucket und zu signierten Links (HAI-Paket H6); die Quelldateien liegen im OneDrive und sind teils nur Platzhalter.

## Übersprungene Dateien und Voreinstellungen

Die Voreinstellungen stehen in `scripts/import/kfbm-decisions.json` und sind Vorschläge des Plans, nicht bestätigt:

- Dubletten: die neueste Fassung (höchste Version, dann jüngstes Änderungsdatum). Liegen Version und Zeitpunkt weniger als 24 Stunden auseinander, werden beide Kopien übersprungen.
- Komponentencodes wie das Inventurskript sie ableitet (K6.1, K6.2, K24.1, K24.2, K25.1, K25.2). K10 bis K17 und K19 sind Wahl, K18 ist ausgeschlossen, K20 bis K23 sind integrativ, K24 und K25 sind Pflicht mit Phase (Teil 1 gleich Phase 1, Teil 2 gleich Phase 2).
- Ein Enabler braucht seinen Text. Fehlt oder scheitert der Text, werden Quizze und Szenario dieses Enablers mit dem Grund `ENABLER_MISSING` übersprungen.
- Dateien mit Formatfehlern (Parser-Befund `error`), mit Widerspruch zwischen Überschrift und Pfad, und Szenarien mit der Überschrift "Aufgabe" statt "Lösungsszenario" werden übersprungen.

Gründe im Plan: `PARSE_ERROR`, `CODE_MISMATCH`, `DIFFICULTY_MISMATCH`, `KIND_MISMATCH`, `QUESTION_COUNT`, `DUPLICATE_AMBIGUOUS`, `ENABLER_MISSING`, `PATH_ISSUE`, `READ_ERROR`, `PLACEHOLDER`, `NO_HEADING`, `NO_DECISION`, `NO_GROUP`, `KIND_GROUP_MISMATCH`, `SOLUTION_MARKER`.

## Tests

- `tests/unit/content-import/apply`: Planbildung aus erfundenen Eingaben, Idempotenz, Rollback des Probelaufs, Konflikte, Lösungsschutz, Zielprüfung, SQL-Schicht mit aufzeichnender Verbindung.
- `tests/scripts/import/kfbm-apply.test.mjs` (`npm run test:scripts`): die Befehle, Ablehnung von Production und fremden Hosts vor der ersten Verbindung, keine Geheimnisse in der Ausgabe.
- Der Rauchtest gegen eine echte Datenbank steht im Bericht des Pull Requests.
