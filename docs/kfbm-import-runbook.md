# KfBM-Inhaltsimport: Runbook für Plan, Prüfung, Probelauf und Apply

Stand: 27.10.2026. Dieses Paket ist Phase 4.4 des KfBM-Umbaus, die Lernfelder (Phase 4.5) und die Use Cases (Phase 4.6) stehen in eigenen Abschnitten weiter unten. Es schreibt die geparsten Inhalte (Phase 4.0 und 4.3, siehe `docs/kfbm-import-quellformat.md`) in die Datenbank, standardmäßig als Probelauf.

**Production ist ausdrücklich nicht vorgesehen.** Das Skript hat kein Ziel `production` und keinen Schalter dafür. Ein Apply in Production gibt es erst nach dem Go des Eigentümers und dem Rollout (Variable `KFBM_ROLLOUT_APPROVED`, `docs/release-prozess.md`), und dann nur nach einer bewussten Änderung des Skripts. Dieses Paket enthält keine Migration und hat keine Wirkung auf Production.

## Was das Skript tut und was nicht

Es liest die Quelldokumente (nur lesend) und schreibt in acht Tabellen: `training_components`, `courses`, `enablers`, `quizzes`, `questions`, `options`, `enabler_quiz_links` und `content_documents`. Es löscht nie etwas (kein `DELETE`, kein `TRUNCATE`, keine Struktur) und überschreibt keine bestehende Zeile, außer mit `--update-existing` und nur in benannten Spalten (`src/lib/content-import/apply/tables.ts`).

Es lädt keine Dateien in den Storage hoch, ruft keine Modelle auf, löst keine Indexierung aus und nutzt kein Netzwerk außer der Zieldatenbank. Use Cases gehören nicht dazu, sie schreibt ein eigenes Skript (Abschnitt "Use Cases"). Die Lernfelder und ihre Zuordnung aus der Excel schreibt ebenfalls ein eigenes Skript (Abschnitt "Lernfelder und Zuordnungen").

**Reihenfolge der drei Läufe:** erst der Inhaltsimport (Kurse, Enabler, Quizze, Szenarien), dann die Lernfelder, dann die Use Cases. Die Lernfelder und die Use Cases hängen an den Enablern des Inhaltsimports und brauchen sich nicht gegenseitig, ihre Reihenfolge ist egal. Jeder Lauf ist ein Probelauf, solange `--apply` fehlt.

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
3. Die Wochen und Sollstunden der Komponenten fehlen noch. Die Lernfelder und ihre Zuordnung schreibt das Skript der Phase 4.5, Titel und Stunden der Lernfelder sind dort vorläufig oder offen.

## Upload der Originaldateien (eigenes Paket, nicht Teil dieses Laufs)

Nötig sind: ein Plan, welche Dateien (Enabler-Text, Szenario, Quiz je Stufe, Global-Quiz, jeweils als Word und PDF) wohin gehören; der Upload in den Bucket mit einem Präfix je Umgebung (`preview/`), weil Storage zwischen Preview und Production geteilt ist; danach je Datei `storage_url`, `storage_path`, `file_size`, `mime_type` und `page_count` der vorhandenen Dokumentzeilen setzen (für die Enabler-Texte neue Zeilen vom Typ `THEORY`); Entscheidung zum privaten Bucket und zu signierten Links (HAI-Paket H6); die Quelldateien liegen im OneDrive und sind teils nur Platzhalter.

## Übersprungene Dateien und Voreinstellungen

Die Voreinstellungen stehen in `scripts/import/kfbm-decisions.json` und sind Vorschläge des Plans, nicht bestätigt:

- Dubletten: die neueste Fassung (höchste Version, dann jüngstes Änderungsdatum). Liegen Version und Zeitpunkt weniger als 24 Stunden auseinander, werden beide Kopien übersprungen.
- Komponentencodes wie das Inventurskript sie ableitet (K6.1, K6.2, K24.1, K24.2, K25.1, K25.2). K10 bis K17 und K19 sind Wahl, K18 ist ausgeschlossen, K20 bis K23 sind integrativ, K24 und K25 sind Pflicht mit Phase (Teil 1 gleich Phase 1, Teil 2 gleich Phase 2).
- Ein Enabler braucht seinen Text. Fehlt oder scheitert der Text, werden Quizze und Szenario dieses Enablers mit dem Grund `ENABLER_MISSING` übersprungen.
- Dateien mit Formatfehlern (Parser-Befund `error`), mit Widerspruch zwischen Überschrift und Pfad, und Szenarien mit der Überschrift "Aufgabe" statt "Lösungsszenario" werden übersprungen.

Gründe im Plan: `PARSE_ERROR`, `CODE_MISMATCH`, `DIFFICULTY_MISMATCH`, `KIND_MISMATCH`, `QUESTION_COUNT`, `DUPLICATE_AMBIGUOUS`, `ENABLER_MISSING`, `PATH_ISSUE`, `READ_ERROR`, `PLACEHOLDER`, `NO_HEADING`, `NO_DECISION`, `NO_GROUP`, `KIND_GROUP_MISMATCH`, `SOLUTION_MARKER`.

## Lernfelder und Zuordnungen (Phase 4.5)

Ein eigenes Skript, `scripts/import/kfbm-learning-fields.mjs` (`npm run import:kfbm:learning-fields`), schreibt die 13 Lernfelder des KfBM und ordnet die Enabler des Inhaltsimports den Lernfeldern zu. Es ist ein eigenes Skript, weil die Eingabe eine Excel-Tabelle und eine Codeliste ist und nicht die Word-Dokumente, und weil der Plan eine andere Form hat. Die Sicherheitsstruktur ist dieselbe (Ziele nur `local` und `preview`, Probelauf als Standard, echter Lauf nur mit `--apply`, Transaktion mit Isolation `repeatable read`, derselbe Advisory Lock, kein `DELETE`, keine Struktur, Verbindung nur aus `DB_CONNECTION_STRING`, keine Geheimnisse im Log). Die Prüfung von Host, Schema und Rolle ist derselbe Code (`src/lib/content-import/apply/target.ts`). Dieses Paket enthält keine Migration und hat keine Wirkung auf Production.

### Reihenfolge

1. Inhaltsimport (Abschnitte oben): schreibt Komponenten, Kurse, Enabler, Quizze und Szenarien.
2. Plan der Lernfelder (ohne Datenbank).
3. Prüfung, Probelauf, echter Lauf der Lernfelder.

Ohne Enabler im Katalog stoppt das Skript (`NO_ENABLERS`). Fehlen einzelne Enabler, werden deren Zuordnungen als übersprungen gemeldet (`ENABLER_NOT_IN_DATABASE`), und der Lauf lässt sich wiederholen, sobald der Inhaltsimport sie geschrieben hat. Ein zweiter Lauf ergänzt nur, was fehlt.

### Schritte

```
npm run import:kfbm:learning-fields -- plan "<Pfad>\Übertragung von Mapping aus Dokument in Excel.xlsx" --import-source "<Pfad zu Komponente>" --titles "<Pfad>\Enabler_Quellen.csv" --out kfbm-plan-lf.json
$env:DB_CONNECTION_STRING = "<Verbindung des Ziels>"
npm run import:kfbm:learning-fields -- check --plan kfbm-plan-lf.json --target local
npm run import:kfbm:learning-fields -- run --plan kfbm-plan-lf.json --target local
npm run import:kfbm:learning-fields -- run --plan kfbm-plan-lf.json --target local --apply
```

- `plan` liest die Tabelle (nur lesend, 60 Sekunden Frist) und die Codes des Inhaltsimports. Die Codes kommen aus den Dateinamen des Quellordners (`--import-source`, es wird kein Dokument geöffnet, dieselbe Auswahl wie im Plan des Inhaltsimports) oder aus dessen Plan (`--import-plan kfbm-plan.json`). Neben dem JSON entsteht eine Zusammenfassung als Markdown (`kfbm-plan-lf.md`). Beide Dateien enthalten nur Codes, Zahlen und Zeilennummern, keinen Zelltext. Der Dateiname `kfbm-plan-lf.json` steht über `kfbm-plan*.json` in der `.gitignore`.
- `check` vergleicht den Plan in einer schreibgeschützten Transaktion mit der Zieldatenbank. `run` ist ein Probelauf und rollt zurück, mit `--apply` wird übernommen. Optionen wie beim Inhaltsimport: `--confirm-host <Host>` ist Pflicht für einen echten Lauf in der Preview, `--report-out <Datei.md>` schreibt den Bericht. `--update-existing` aktualisiert nur den Titel bestehender Lernfelder, und nur durch einen Titel aus der Titeldatei des Eigentümers (`.json`) oder wenn noch der Platzhalter "Lernfeld N" steht. Vorläufige Titel aus der Quellenliste ersetzen nie einen gesetzten Titel und ein Platzhalter nie einen vorhandenen. Sonst wird nichts überschrieben. Exit-Codes: 0 fertig, 1 Fehler oder abgelehnt, 2 falsche Aufrufe, 3 Konflikte.

### Was gelesen und geschrieben wird

| Quelle                                                  | Ziel                                                                                                                                                 | Schlüssel für die Idempotenz |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 13 Lernfelder (Code `LF1` bis `LF13`)                   | `training_catalog_learning_fields` (Schuljahr 1 für LF1 bis LF4, 2 für LF5 bis LF8, 3 für LF9 bis LF13, `order_index` 1 bis 13, `hours_budget` leer) | Katalog und Code             |
| Zeile der Tabelle (Position mit Buchstabe) und Lernfeld | `training_catalog_content_mappings` (`learning_field_id`, `enabler_id`, der Katalog wird per Trigger abgeleitet)                                     | Lernfeld und Enabler         |

- Die Tabelle: Kopfzeile mit "Schuljahr 1" bis "Schuljahr 3" (in der Fassung vom 07.08.2026 Zeile 4), Spalte A nennt die Komponente nur in der ersten Zeile ihres Blocks, Spalte B die Position ("a) ..."), die Spalten C bis E die Lernfelder je Schuljahr. Die Nummer der Importkomponente folgt aus dem Paragrafen der Verordnung: Abschnitt A (§ 4 Absatz 2) Nr. 1 bis 9 sind K1 bis K9, Abschnitt B (Absatz 3) Nr. 1 bis 10 sind K10 bis K19, Abschnitt C (Absatz 4) Nr. 1 bis 6 sind K20 bis K25. Der Titel der Komponente wird nicht ausgewertet. Bei geteilten Komponenten (K6, K24, K25) entscheidet der Buchstabe, zu welchem Teil der Enabler gehört (K6.1-a, K6.2-d). Es gilt die Fassung "Übertragung von Mapping aus Dokument in Excel.xlsx" (Stand 07.08.2026), die ältere Datei mit dem Zusatz "-WMC-NB-MB-03" wird nicht gelesen.
- Angaben wie "LF 2", "LF2,3", "LF 2,3,4", "Lernfeld 3", "LF 5, LF 7", "LF 5 und 7" werden gelesen (Groß und Kleinschreibung, Leerzeichen, Steuerzeichen und Silbentrennung spielen keine Rolle). "alle Lernfelder" bedeutet alle Lernfelder des Schuljahrs der Spalte. "nur betrieblich" und "nur betr./beh." bedeuten, dass die Position nur im Betrieb vermittelt wird: kein Lernfeld, kein Fehler (Hinweis im Plan).
- Nichts wird geraten. Als übersprungen mit Grund und Zeilennummer (und Spalte) führt der Plan: Komponente ohne Gegenstück im Import (`COMPONENT_NOT_IN_IMPORT`), ausgeschlossene Komponente (`COMPONENT_EXCLUDED`, K18), Buchstabe ohne Enabler im Import (`ENABLER_NOT_IN_IMPORT`), mehrfach vorkommender Buchstabe (`DUPLICATE_LETTER`, beide Zeilen), Zeile ohne Buchstaben (`NO_LETTER`), widersprüchlicher Block (`NUMBER_MISMATCH`, `SECTION_MISMATCH`, `REFERENCE_MISMATCH`, `NUMBER_OUT_OF_RANGE`, `BLOCK_UNKNOWN`), Lernfeld außerhalb 1 bis 13 (`LF_OUT_OF_RANGE`), Lernfeld, das nicht zum Schuljahr der Spalte gehört (`YEAR_MISMATCH`), nicht lesbare Zelle (`UNPARSEABLE_REFERENCE`), Lernfeldangabe ohne Zeilentext (`ORPHAN_REFERENCE`).
- Zuordnungen gibt es nur zu Enablern. Das Modell erlaubt auch Use Cases (genau eines von beiden), die Zuordnung zu Komponenten gibt es im Modell nicht. Die Use Cases schreibt das Skript des nächsten Abschnitts, die Excel nennt für sie keine eigene Zuordnung (jeder Use Case gehört zu genau einem Enabler).
- Titel und Stunden: Die Tabelle nennt keine. Als einzige Quelle für Titel dient die Kapitelliste in `Enabler_Quellen.csv` (Kurztitel aus den Buchkapiteln), mit `--titles <Datei>` übernommen und im Plan als vorläufig markiert. Ohne `--titles` lauten die Titel "Lernfeld 1" bis "Lernfeld 13" (vorläufig, die Spalte ist `NOT NULL`). Der Eigentümer kann offizielle Titel als JSON nachreichen (`{"LF1": "..."}`, Datei mit der Endung `.json`) und mit `--update-existing` einspielen. Stunden (`hours_budget`) bleiben leer, bis eine Quelle vorliegt.
- Konflikte (ein Lernfeld besteht mit anderem Schuljahr, eine Stelle der Reihenfolge ist von einem anderen Code belegt) stoppen einen echten Lauf vor dem ersten Schreiben (Exit 3). Bestehende Zuordnungen, die der Plan nicht nennt, bleiben unverändert (der Bericht zählt sie).

### Apply in die Preview, Rückbau

- **Wer, wann:** der Eigentümer, nach dem Inhaltsimport in die Preview und nach einem Probelauf gegen die Preview ohne Konflikte. Der Agent, der dieses Paket gebaut hat, schreibt nicht in die Preview.
- **Womit:** `DB_CONNECTION_STRING` der Preview mit der Rolle `app_preview_migrator`, `--target preview --apply --confirm-host <Host>`. Voraussetzungen: Migrationen bis `20261029000100`, Katalog `KFBM` aktiv, Enabler des Inhaltsimports vorhanden. Der Plan wird auf dem eigenen Rechner aus Excel und Quellordner erzeugt (die Preview braucht keine Quelldateien).
- **Rückbau:** Das Skript löscht nie. In einer Transaktion, erst als Probe mit `rollback`, dann mit `commit`. Das trifft nur den Katalog KFBM und auch von Hand angelegte Lernfelder und Zuordnungen dieses Katalogs. Nicht während eines Imports ausführen (das SQL nimmt den Advisory Lock nicht). Wurde schon indexiert, danach in `hai_embeddings` die Zeilen mit `source_id` der gelöschten Lernfelder prüfen (dort gibt es keinen Fremdschlüssel):

```sql
begin;
delete from training_catalog_content_mappings
  where training_catalog_id = (select id from training_catalogs where code = 'KFBM');
delete from training_catalog_learning_fields
  where training_catalog_id = (select id from training_catalogs where code = 'KFBM');
rollback; -- zur Kontrolle der Zahlen, dann mit commit wiederholen
```

## Use Cases (Phase 4.6)

Ein eigenes Skript, `scripts/import/kfbm-use-cases.mjs` (`npm run import:kfbm:use-cases`), schreibt je Enabler einen Use Case des KfBM. Es ist ein eigenes Skript, weil die Eingabe ein eigenes Dokumentformat hat (Aufgabe mit Musterlösung, siehe `docs/kfbm-import-quellformat.md`), die Ziele `use_cases` und `content_documents` sind und der Plan eine andere Form hat. Die Sicherheitsstruktur ist dieselbe wie beim Inhaltsimport (Ziele nur `local` und `preview`, Probelauf als Standard, echter Lauf nur mit `--apply` und in der Preview mit `--confirm-host`, Transaktion mit Isolation `repeatable read`, derselbe Advisory Lock, kein `DELETE`, keine Struktur, Verbindung nur aus `DB_CONNECTION_STRING`, keine Geheimnisse im Log). Die Prüfung von Host, Schema und Rolle und die Argumente sind derselbe Code (`src/lib/content-import/apply/target.ts`). Dieses Paket enthält keine Migration und hat keine Wirkung auf Production.

### Reihenfolge

1. Inhaltsimport (Abschnitte oben): schreibt Komponenten, Kurse und Enabler. Ohne Enabler im Katalog stoppt das Skript der Use Cases (`NO_ENABLERS`).
2. Plan der Use Cases (ohne Datenbank).
3. Prüfung, Probelauf, echter Lauf der Use Cases.

Fehlen einzelne Kurse oder Enabler (der Inhaltsimport hat deren Datei übersprungen), meldet das Skript den Use Case als nicht übernommen (`COURSE_NOT_IN_DATABASE`, `ENABLER_NOT_IN_DATABASE`). Der Lauf lässt sich wiederholen, sobald der Inhaltsimport die Enabler nachgetragen hat. Ein zweiter Lauf ergänzt nur, was fehlt.

### Schritte

```
npm run import:kfbm:use-cases -- plan "<Pfad zu Komponente>" --out kfbm-plan-uc.json --hydrate
$env:DB_CONNECTION_STRING = "<Verbindung des Ziels>"
npm run import:kfbm:use-cases -- check --plan kfbm-plan-uc.json --target local --created-by <Profil-UUID>
npm run import:kfbm:use-cases -- run --plan kfbm-plan-uc.json --target local --created-by <Profil-UUID>
npm run import:kfbm:use-cases -- run --plan kfbm-plan-uc.json --target local --created-by <Profil-UUID> --apply
```

- `plan` liest die Use-Case-Dateien nacheinander (nur lesend, nie mehrere zugleich, OneDrive-Platzhalter lädt `--hydrate` herunter, Frist je Datei mit `--timeout <Sekunden>`, Abbruch nach drei Fristüberschreitungen) und schreibt den Plan als JSON und daneben eine Zusammenfassung als Markdown (`kfbm-plan-uc.md`). `--components K4,K24.2` begrenzt den Lauf. **Die JSON-Datei enthält die Texte, auch die Musterlösungen.** Sie gehört nicht ins Repository (der Dateiname `kfbm-plan-uc.json` steht über `kfbm-plan*.json` in der `.gitignore`), nicht in Tickets und nicht in Chats. Die Zusammenfassung nennt Zahlen, Namen und Gründe, keine Inhalte.
- `check` vergleicht den Plan in einer schreibgeschützten Transaktion mit der Zieldatenbank. `run` ist ein Probelauf und rollt zurück, mit `--apply` wird übernommen. `check` und `run` nehmen statt `--plan` auch den Quellordner (dann entsteht der Plan zuerst). Optionen: `--created-by <Profil-UUID>` (Pflicht, Profil mit Trainer- oder Admin-Rolle, wird als Hochladender der Dokumentzeilen eingetragen), `--update-existing`, `--confirm-host <Host>` (Pflicht für einen echten Lauf in der Preview), `--report-out <Datei.md>` (Bericht ohne Inhalte) und `--use-case-solutions` (siehe Lösungsschutz). Exit-Codes: 0 fertig, 1 Fehler oder abgelehnt, 2 falsche Aufrufe, 3 Konflikte.
- `--update-existing` aktualisiert bestehende Zeilen nur in `title`, `description_text` und `order_index` eines Use Cases und in `description` einer Dokumentzeile. Nie `is_active`, Kurs, Verknüpfung zum Enabler, Code oder Autor. Ein fehlender Wert im Plan löscht keinen bestehenden Text.

### Was gelesen und geschrieben wird

| Quelle                                  | Ziel                                                                                                                                                                                  | Schlüssel für die Idempotenz |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Use-Case-Datei (Word, `UC_<Buchstabe>`) | `use_cases`: Code `K6.2-d` (Komponentencode und Buchstabe), Kurs der Komponente, `enabler_id` des Enablers mit demselben Code, Titel aus der Überschrift, Position aus dem Buchstaben | Kurs und Code                |
| Aufgabe (Abschnitte der Datei)          | `use_cases.description_text`: Ausgangssituation mit den Eckdaten, Zielsetzung, Weg zum Ziel. Tabellen werden zeilenweise gelesen (Zellen mit " \| " getrennt)                         | wie oben                     |
| Behandelte Themen                       | `content_documents` am Use Case, Typ `THEORY`, Sichtbarkeit `ALL`                                                                                                                     | Use Case, Typ und Titel      |
| Musterlösung (und Bewertungskriterien)  | `content_documents` am Use Case, Typ `TRAINER_SOLUTION`, Sichtbarkeit `TRAINER_ONLY`, nur mit `--use-case-solutions`                                                                  | Use Case, Typ und Titel      |

Der Schlüssel des Plans ist Katalog, Komponentencode, Enabler-Code und Buchstabe (Komponentencode und Buchstabe ergeben den Code `K6.2-d`, den auch der Enabler trägt). Ein Enabler hat genau einen Use Case (`use_cases.enabler_id` ist eindeutig, die Verknüpfung ist mit dem Kurs über einen zusammengesetzten Fremdschlüssel gesichert). Alle neuen Use Cases sind inaktiv (`is_active = false`, gesteuert wie beim Inhaltsimport von `content.activate` in `scripts/import/kfbm-decisions.json`). Die Dokumentzeilen haben noch keine Datei: `storage_url` ist leer, `mime_type` ist `text/plain`.

Nicht Teil dieses Pakets: die Tabelle `training_use_cases` (die Themen des Ausbildungsrahmenplans für den Ausbildungsnachweis, je Komponente und Buchstabe mit Sollstunden). Sie braucht Sollstunden, für die es noch keine Quelle gibt. Die Eindeutigkeit von Komponente und Buchstabe dort stellt die Migration `20261028000300` sicher.

### Übersprungene Dateien und Konflikte (nichts wird geraten)

| Code                                    | Bedeutung                                                                                                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DUPLICATE_SOLUTION_VARIANT`            | Zwei Kopien eines Use Cases, eine davon im Ordner "Ohne Musterlösung" (Use Case 5b). Beide werden übersprungen, auch wenn eine deutlich neuer ist. Der Eigentümer nennt die gültige Fassung. |
| `DUPLICATE_AMBIGUOUS`                   | Zwei Kopien gleicher Version mit Änderungszeiten unter 24 Stunden Abstand. Beide werden übersprungen.                                                                                        |
| (ältere Kopie)                          | Zwei Kopien mit mehr als 24 Stunden Abstand: die neueste Fassung (höchste Version, dann jüngste Änderung) gilt, die ältere steht unter "Ältere Kopien" im Plan.                              |
| `PARSE_ERROR`                           | Formatfehler der Datei (zum Beispiel fehlender Abschnitt Musterlösung). Der Plan nennt nur die Codes.                                                                                        |
| `CODE_MISMATCH`                         | Die Überschrift nennt einen anderen Use Case als der Pfad.                                                                                                                                   |
| `SOLUTION_MARKER`                       | Ein sichtbarer Abschnitt nennt eine Lösung (Marke wie "Musterlösung" oder "Fachwissen zur Lösung") oder enthält den ganzen Lösungstext eines Use Cases.                                      |
| `TITLE_DUPLICATE`                       | Zwei Use Cases einer Komponente mit gleichem Titel (der Schlüssel des Inhaltsabgleichs ist Kurs und Titel).                                                                                  |
| `PATH_ISSUE`, `NO_DECISION`             | Pfad passt nicht zum Schema, Komponente ohne Entscheidung in `kfbm-decisions.json` (K18 ist ausgeschlossen und wird nur gezählt).                                                            |
| `READ_ERROR`, `PLACEHOLDER`, `NOT_READ` | Die Datei war nicht lesbar (Frist, beschädigt) oder ein nicht geladener OneDrive-Platzhalter ohne `--hydrate`.                                                                               |

Hinweise des Parsers (kein Grund zum Überspringen) stehen unter "Hinweise der Parser", etwa `DATA_HEADING_MISSING` (keine fette Zeile "Eckdaten") oder `SOLUTION_TEXT_OF_<Code>_IN_VISIBLE_TEXT` (ein Absatz aus der Musterlösung eines Use Cases steht im sichtbaren Text eines anderen, der Eigentümer sieht nach, ob das Absicht ist).

Konflikte mit der Datenbank (der Use Case besteht, ist aber mit einem anderen Enabler oder gar nicht verknüpft, ein Enabler hat schon einen anderen Use Case, eine Dokumentzeile besteht mit anderer Sichtbarkeit) stoppen einen echten Lauf vor dem ersten Schreiben (Exit 3). Bestehende Zeilen werden nie überschrieben und nie gelöscht.

### Lösungsschutz

- Die Aufgabe steht in `use_cases.description_text`. Sie enthält nur Ausgangssituation, Zielsetzung und Weg zum Ziel, nie die Musterlösung. Die Behandelten Themen stehen als Dokumentzeile `THEORY` mit Sichtbarkeit `ALL`.
- Die Musterlösung (und, falls eine spätere Fassung der Quelle sie hat, die Bewertungskriterien) steht nur in Dokumentzeilen `TRAINER_SOLUTION` mit Sichtbarkeit `TRAINER_ONLY` und **nur mit `--use-case-solutions`**. Ohne den Schalter gelangt kein Lösungstext in die Datenbank, der Bericht nennt die Zahl der zurückgehaltenen Zeilen.
- **`--use-case-solutions` ist für die Preview gesperrt**, wie `--scenario-solutions`: Die Richtlinie `cd_select` der Tabelle `content_documents` erlaubt allen Rollen das Lesen von Zeilen ohne Organisation, ohne Rücksicht auf die Sichtbarkeit. Bis die Richtlinie in einer eigenen Migration eingeschränkt ist, enthält die Preview nur die Aufgaben und die Behandelten Themen. Der Schalter gilt nur für `check` und `run` mit Ziel `local`.
- Das Skript prüft den Plan und jede Zeile vor dem Schreiben (`src/lib/content-import/use-cases/guard.ts`): eine Lösungsmarke oder der ganze Lösungstext eines Use Cases in einem sichtbaren Feld lässt den Lauf abbrechen, beim Planen wird die Datei übersprungen. Jede Dokumentzeile muss entweder `THEORY` und `ALL` oder `TRAINER_SOLUTION` und `TRAINER_ONLY` sein.
- `toTraineeUseCase` (`src/lib/content-import/use-cases/parser.ts`) liefert die Sicht für Azubis und gibt bei einem Fehler oder einer Lösungsmarke im sichtbaren Text `null` zurück.

### Vor der Aktivierung der Use Cases

1. Die Routen, die Use-Case-Dokumente an Azubis liefern, müssen `TRAINER_ONLY` und `TRAINER_SOLUTION` ausfiltern (siehe "Vor der Aktivierung der Inhalte", Punkt 2). Das gilt für die Preview erst, wenn dort Lösungen liegen, also nach der Einschränkung der Richtlinie.
2. Die Originaldateien der Use Cases (Word) fehlen noch (siehe "Upload der Originaldateien"). Bis dahin ist `storage_url` der Dokumentzeilen leer. Die Seite der Azubis zeigt die Zeile `THEORY` (Behandelte Themen) dann als Eintrag ohne Link. Die HAI-Indexierung der Use-Case-Dokumente (`src/lib/hai/ingestUseCase.ts`, `pageIndexService.ts`) überspringt eine leere `storage_url` nicht: Mit `--use-case-solutions` (nur lokal) zählen die Lösungszeilen dort als fehlgeschlagene Aufnahme. Vor einem Indexlauf entweder die Dateien hochladen oder die Abfragen um `storage_url <> ''` ergänzen (eigener Schnitt).
3. Die Dokumentzeile hat als `file_name` den Dateinamen der Quelle (sichtbar in der Dokumentliste der Azubis). Der Upload entscheidet, ob dieser Name bleibt.
4. Mit `content.activate = true` setzt das Skript `is_active`, aber nicht `activated_at` (die Trainerroute setzt es beim Aktivieren). Der Standard ist `false`, aktiviert wird über die Oberfläche.

### Grenzen

- Ein Absatz der Musterlösung eines Use Cases, der im sichtbaren Text eines anderen steht, ist nur ein Hinweis im Plan (`SOLUTION_TEXT_OF_..._IN_VISIBLE_TEXT`), kein Grund zum Überspringen. Marken (zum Beispiel `Musterlösung`, eine Zeile nur mit `Bewertungskriterien`) und der ganze Lösungstext in einem sichtbaren Feld brechen ab. Eine Überschrift `Musterlösung` oder `Bewertungskriterien`, die nicht fett ist oder in einer Tabelle steht, ist ein Formatfehler (`SOLUTION_HEADING_NOT_BOLD`), die Datei wird übersprungen. Abweichende Überschriften wie "Lösungsvorschlag" erkennt die Prüfung nicht (die Quellen haben keine).
- Die Transaktion nimmt den Advisory Lock als erste Anweisung, die zugleich den Snapshot festlegt (gemeinsamer Code der drei Importskripte). Ein Lauf, der in diesem Augenblick mit einem anderen Import zusammentrifft, kann auf einem veralteten Stand arbeiten. Für `use_cases` fangen das die Eindeutigkeiten ab (der Lauf wird zurückgerollt), `content_documents` hat keinen Schlüssel auf Use Case, Typ und Titel. Importe also nie gleichzeitig starten.
- `--target local` erkennt eine Datenbank an Loopback-Adresse und fehlenden Preview-Markern. Eine Verbindung über einen Tunnel auf `localhost` zu einer anderen Datenbank (zum Beispiel Production) erkennt das nicht. `DB_CONNECTION_STRING` vor jedem Lauf prüfen.

### Apply in die Preview: wer, wann, womit, Rückbau

- **Wer, wann:** der Eigentümer, nach dem Inhaltsimport in die Preview und nach einem Probelauf gegen die Preview ohne Konflikte. Der Agent, der dieses Paket gebaut hat, schreibt nicht in die Preview.
- **Womit:** `DB_CONNECTION_STRING` der Preview mit der Rolle `app_preview_migrator`, `--target preview --apply --confirm-host <Host>` (ohne `--use-case-solutions`), `--created-by` ist das Profil des Superadmins der Preview. Voraussetzungen: Migrationen bis `20261029000100`, Katalog `KFBM` aktiv, Kurse und Enabler des Inhaltsimports vorhanden. Der Plan wird auf dem eigenen Rechner aus dem Quellordner erzeugt (die Preview braucht keine Quelldateien).
- **Rückbau:** Das Skript löscht nie. In einer Transaktion, erst als Probe mit `rollback`, dann mit `commit`. Das trifft nur den Katalog KFBM. Vorher prüfen, ob Azubis schon Abgaben haben: Die Tabellen `use_case_submissions` und `trainee_use_case_overrides` hängen mit `on delete cascade` an den Use Cases, ein Löschen nähme die Abgaben mit. Nicht während eines Imports ausführen (das SQL nimmt den Advisory Lock nicht). Wurde schon indexiert, danach in `hai_embeddings` die Zeilen der gelöschten Dokumentzeilen prüfen (dort gibt es keinen Fremdschlüssel).

```sql
select (select count(*) from use_case_submissions s join use_cases u on u.id = s.use_case_id
         where u.training_catalog_id = (select id from training_catalogs where code = 'KFBM')) as abgaben,
       (select count(*) from trainee_use_case_overrides o join use_cases u on u.id = o.use_case_id
         where u.training_catalog_id = (select id from training_catalogs where code = 'KFBM')) as freigaben;
begin;
delete from content_documents where use_case_id in
  (select u.id from use_cases u where u.training_catalog_id = (select id from training_catalogs where code = 'KFBM'));
delete from training_catalog_content_mappings where use_case_id in
  (select u.id from use_cases u where u.training_catalog_id = (select id from training_catalogs where code = 'KFBM'));
delete from use_cases where training_catalog_id = (select id from training_catalogs where code = 'KFBM');
rollback; -- zur Kontrolle der Zahlen, dann mit commit wiederholen
```

## Tests

- `tests/unit/content-import/use-cases` (Parser mit erfundenen Beispielen im Stil der Quelle, Plan, Lösungsschutz, Engine mit Speicherdatenbank, Transaktion mit aufzeichnender Verbindung, Aufrufe) und `tests/scripts/import/kfbm-use-cases.test.mjs` (`npm run test:scripts`: Befehle, Ablehnung von Production und fremden Hosts vor der ersten Verbindung, keine Geheimnisse in der Ausgabe, kein `.env`, kein Netzwerk).
- `tests/unit/content-import/apply`: Planbildung aus erfundenen Eingaben, Idempotenz, Rollback des Probelaufs, Konflikte, Lösungsschutz, Zielprüfung, SQL-Schicht mit aufzeichnender Verbindung.
- `tests/scripts/import/kfbm-apply.test.mjs` (`npm run test:scripts`): die Befehle, Ablehnung von Production und fremden Hosts vor der ersten Verbindung, keine Geheimnisse in der Ausgabe.
- `tests/unit/content-import/learning-fields` (Tabelle lesen, Lernfeldangaben, Plan, Engine mit Speicherdatenbank, Transaktion mit aufzeichnender Verbindung, Aufrufe) und `tests/scripts/import/kfbm-learning-fields.test.mjs` (`npm run test:scripts`: Befehle, Ablehnung von Production und fremden Hosts vor der ersten Verbindung, keine Geheimnisse in der Ausgabe, kein `.env`, kein Netzwerk).
- Der Rauchtest gegen eine echte Datenbank steht im Bericht des Pull Requests.
