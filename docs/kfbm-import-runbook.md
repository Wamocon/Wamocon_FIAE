# KfBM-Inhaltsimport: Runbook für Plan, Prüfung, Probelauf und Apply

Stand: 27.10.2026. Dieses Paket ist Phase 4.4 des KfBM-Umbaus, die Lernfelder (Phase 4.5) und die Use Cases (Phase 4.6) stehen in eigenen Abschnitten weiter unten. Es schreibt die geparsten Inhalte (Phase 4.0 und 4.3, siehe `docs/kfbm-import-quellformat.md`) in die Datenbank, standardmäßig als Probelauf.

**Production ist ausdrücklich nicht vorgesehen.** Das Skript hat kein Ziel `production` und keinen Schalter dafür. Ein Apply in Production gibt es erst nach dem Go des Eigentümers und dem Rollout (Variable `KFBM_ROLLOUT_APPROVED`, `docs/release-prozess.md`), und dann nur nach einer bewussten Änderung des Skripts. Dieses Paket enthält keine Migration und hat keine Wirkung auf Production.

## Was das Skript tut und was nicht

Es liest die Quelldokumente (nur lesend) und schreibt in acht Tabellen: `training_components`, `courses`, `enablers`, `quizzes`, `questions`, `options`, `enabler_quiz_links` und `content_documents`. Es löscht nie etwas (kein `DELETE`, kein `TRUNCATE`, keine Struktur) und überschreibt keine bestehende Zeile, außer mit `--update-existing` und nur in benannten Spalten (`src/lib/content-import/apply/tables.ts`).

Es lädt keine Dateien in den Storage hoch, ruft keine Modelle auf, löst keine Indexierung aus und nutzt kein Netzwerk außer der Zieldatenbank. Use Cases gehören nicht dazu, sie schreibt ein eigenes Skript (Abschnitt "Use Cases"). Die Lernfelder und ihre Zuordnung aus der Excel schreibt ebenfalls ein eigenes Skript (Abschnitt "Lernfelder und Zuordnungen").

**Reihenfolge der drei Läufe:** erst der Inhaltsimport (Kurse, Enabler, Quizze, Szenarien), dann die Lernfelder, dann die Use Cases. Die Lernfelder und die Use Cases hängen an den Enablern des Inhaltsimports. Der Lernfeldlauf liest die Use Cases aus der Datenbank und ordnet sie den Lernfeldern zu, deshalb wird er nach dem Use-Case-Import wiederholt (ein zweiter Lauf ergänzt nur, was fehlt). Jeder Lauf ist ein Probelauf, solange `--apply` fehlt.

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

Die Wochen der Komponenten kommen aus dem Ausbildungsrahmenplan (Abschnitt "Wochen und Sollstunden der Komponenten"), die Sollstunden bleiben vorläufig 0 (die Spalten sind `NOT NULL`, der Plan nennt keine Stunden). `order_index` einer Komponente ist `Nummer * 10 + Teilung` (K1 gleich 10, K6.2 gleich 62). Der Kurs bekommt `year` gleich Phase (die Plattform führt "Ausbildungsjahr" als Phase) und `chapter` gleich `order_index`.

## Wochen und Sollstunden der Komponenten

**Quelle der Wochen:** Bundesgesetzblatt Teil I Nr. 62 vom 28.02.2025, Verordnung über die Berufsausbildung zum Kaufmann und zur Kauffrau für Büromanagement (BüroMKfAusbV) vom 25.02.2025, Anlage (Ausbildungsrahmenplan), Spalte 4 "Zeitliche Richtwerte in Wochen im 1. bis 15. Monat und im 16. bis 36. Monat". Die Seitenangaben sind die Seiten "Seite N von 17" dieser Veröffentlichung. Gegenprobe mit zwei Dokumenten des BIBB ("Ausbildung gestalten", Kaufmann/Kauffrau für Büromanagement, Bonn 2025): Kapitel 2.2.1 mit der Übersicht (Wochen insgesamt Abschnitt A: 58 und 37, zwei Wahlqualifikationen: 44) und das Muster eines betrieblichen Ausbildungsplans, das jeden Wert mit seinem Zeitraum druckt. Die Daten stehen mit Seite je Wert in `src/lib/content-import/apply/component-weeks.ts`, die Prüfung der Summen in `tests/unit/content-import/apply/component-weeks.test.ts`.

| Komponente  | Position (Abschnitt) | Zeitraum         | Wochen | Seite     |
| ----------- | -------------------- | ---------------- | ------ | --------- |
| K1          | A1 (a bis f)         | 1. bis 15.       | 11     | 8         |
| K2          | A2 (a bis j)         | 1. bis 15.       | 11     | 8         |
| K3          | A3 (a bis d)         | 1. bis 15.       | 7      | 8         |
| K4          | A4 (a bis c)         | 1. bis 15.       | 5      | 8         |
| K5          | A5 (a bis e)         | 1. bis 15.       | 7      | 9         |
| K6.1        | A6 (a bis c)         | 1. bis 15.       | 6      | 9         |
| K6.2        | A6 (d bis g)         | 16. bis 36.      | 11     | 9         |
| K7          | A7 (a bis f)         | 1. bis 15.       | 11     | 9         |
| K8          | A8 (a bis e)         | 16. bis 36.      | 13     | 9         |
| K9          | A9 (a bis f)         | 16. bis 36.      | 13     | 9         |
| K10 bis K17 | B1 bis B8            | 16. bis 36.      | je 22  | 10 bis 14 |
| K19         | B10                  | 16. bis 36.      | 22     | 15        |
| K20 bis K23 | C1 bis C4            | ganze Ausbildung | keine  | 15 bis 16 |
| K24.1       | C5 (a bis d)         | 1. bis 15.       | 4      | 17        |
| K24.2       | C5 (e)               | 16. bis 36.      | 2      | 17        |
| K25.1       | C6 (a bis c)         | 1. bis 15.       | 2      | 17        |
| K25.2       | C6 (d bis k)         | 16. bis 36.      | 9      | 17        |

**Regeln (nichts wird gerechnet, jeder Wert steht so im Plan):**

- Die Nummer der Komponente ist die Position der Verordnung: K1 bis K9 sind Abschnitt A (§ 4 Abs. 2 Nr. 1 bis 9), K10 bis K19 sind die Wahlqualifikationen 1 bis 10 (§ 4 Abs. 3), K20 bis K25 sind Abschnitt C (§ 4 Abs. 4 Nr. 1 bis 6). K18 (Wahlqualifikation 9, Verwaltung) wird nicht importiert, hat im Plan aber ebenfalls 22 Wochen.
- Eine Position, deren Wochen der Plan auf beide Zeiträume verteilt, ist in der Plattform schon zwei Komponenten: A6 (K6.1 mit 6 und K6.2 mit 11), C5 (K24.1 mit 4 und K24.2 mit 2) und C6 (K25.1 mit 2 und K25.2 mit 9). Die Ordner Teil 1 und Teil 2 der Quelle und die Phase der Komponente stimmen mit dem Zeitraum überein (1 bis 15 Monate gleich Phase 1, 16 bis 36 Monate gleich Phase 2).
- Jede Wahlqualifikation hat 22 Wochen, alle im 16. bis 36. Monat. Ein Ausbildungsvertrag wählt zwei davon. Die Wochen aller Wahlkomponenten dürfen deshalb nie addiert werden (neun Komponenten ergeben 198 Wochen, eine Ausbildung hat 44).
- K20 bis K23 haben keine Wochen. Der Plan nennt dort "Zeitliche Zuordnung: während der gesamten Ausbildung". Die Spalte bleibt 0 und das ist der richtige Wert, kein Platzhalter. Der Import setzt diese Komponenten nie auf einen anderen Wert.
- Die Werte sind Bruttowochen. Berufsschule, Urlaub, Feiertage und Krankheit sind nicht abgezogen (BIBB, Kapitel 2.2.1: etwa drei Tage je Woche stehen im Betrieb zur Verfügung).
- Summenprobe (im Test festgeschrieben): Abschnitt A 58 Wochen im 1. bis 15. Monat und 37 im 16. bis 36. Monat, Abschnitt C (Position 5 und 6) 6 und 11 Wochen, zwei Wahlqualifikationen 44 Wochen. Das ergibt 64 und 92 Wochen, zusammen 156 Wochen, also drei Jahre zu je 52 Wochen.

**Wirkung im Import:** `plan` schreibt die Wochen aus dieser Tabelle in den Plan (Spalte "Wochen" der Zusammenfassung, im Plan `weeksSource`). Eine Entscheidung des Eigentümers in `kfbm-decisions.json` unter `components.totalWeeks` geht vor. Eine neue Komponente bekommt die Wochen beim Anlegen. Bei einer bestehenden Komponente setzt der echte Lauf `total_weeks` nur, wenn der Wert 0 ist (auch ohne `--update-existing`). Steht dort ein anderer Wert, meldet der Bericht die Abweichung und `--update-existing` überschreibt sie. Eine 0 im Plan (K20 bis K23, Platzhalter) überschreibt nie einen Wert. Keine andere Spalte wird angefasst, `total_hours` nie. Der Probelauf bleibt Standard. Ein zweiter Lauf schreibt nichts.

**Sollstunden:** Der Ausbildungsrahmenplan hat kein Stundenmaß je Komponente, und in keinem der gelesenen Dokumente (Rahmenplan, Verordnung, Erläuterungen, Muster und Beispiel des betrieblichen Ausbildungsplans, Struktur, BIBB-Handbuch, Broschüre) steht eine amtliche Stundenangabe für die betriebliche Ausbildung. Die Stundenzahlen dort betreffen die Berufsschule (Zeitrichtwerte der Lernfelder, zusammen 880 Stunden) und die dienstbegleitende Unterweisung im öffentlichen Dienst (420 Stunden) und gehören nicht in `total_hours`. Deshalb bleibt `total_hours` bei 0, der Plan führt das als offene Frage.

Vorschlag zur Entscheidung des Eigentümers (nicht gesetzt): Wochen mal 40 Stunden. Das ist die Regel der Plattform (Kommentar zu `total_hours` im Schema: "totalWeeks \* 40", ebenso die Daten für FIAE). Es sind Bruttostunden, nach der Modellrechnung des BIBB wären es netto etwa drei Fünftel davon.

| Komponente       | Wochen | Stunden (Vorschlag) |
| ---------------- | ------ | ------------------- |
| K1, K2, K7, K6.2 | 11     | 440                 |
| K3, K5           | 7      | 280                 |
| K4               | 5      | 200                 |
| K6.1             | 6      | 240                 |
| K8, K9           | 13     | 520                 |
| K10 bis K17, K19 | 22     | 880                 |
| K24.1            | 4      | 160                 |
| K24.2, K25.1     | 2      | 80                  |
| K25.2            | 9      | 360                 |
| K20 bis K23      | keine  | keine               |

Folgt der Eigentümer dem Vorschlag, trägt er die Stunden je Code in `kfbm-decisions.json` unter `components.totalHours` ein. Das Anlegen neuer Komponenten nimmt sie dann mit. Für bestehende Komponenten braucht es eine kleine Erweiterung des Imports (`total_hours` in `fillWhenEmpty` in `src/lib/content-import/apply/tables.ts`), die bewusst noch nicht gebaut ist.

**Wo die Plattform die Werte verwendet:** Die Spalten `total_weeks` und `total_hours` der Komponenten liefert `GET /api/training-components` unverändert aus. Angezeigt wird nur `total_hours`, in der Liste der Komponenten im Tätigkeitsnachweis der Azubis (`{Code} • {Stunden} Std gesamt`, `src/app/trainee/activity-reports/page.tsx`). Mit 0 steht dort "0 Std gesamt" (falsche Anzeige, kein Fehler); `total_weeks` wird nirgends angezeigt oder gerechnet. Der Reindex (`scripts/reindex-gemini.ts`) schreibt "Dauer: N Wochen / M Stunden" in den Text, den HAI zu einer Komponente findet. Mit den richtigen Wochen und 0 Stunden stünde dort "11 Wochen / 0 Stunden". Es gibt kein Go für eine Neuindexierung, der Text ändert sich erst mit ihr. Der Phasenplan (`src/lib/catalog/phase-plan.ts`) rechnet in Monaten aus den Katalogeinstellungen, die Schule und die Prüfungen lesen die Spalten nicht, und die Stundengrenze eines Tätigkeitsnachweises kommt aus den Sollstunden der Use Cases (`normalizePlannedHours`). Nirgends wird durch `total_weeks` oder `total_hours` geteilt, 0 verursacht also keinen Fehler.

## Lösungsschutz

- Frage und Optionen stehen in `questions.question_text` und `options.option_text`. Die richtige Antwort steht nur in `options.is_correct`, die Kurzbegründung nur in `options.explanation` der richtigen Option, `questions.expected_answer` bleibt leer. So hält es die App heute (die Routen der Azubis lesen `is_correct` nicht, die Begründung kommt mit dem Ergebnis).
- Szenario: Die Ausgangssituation steht als Dokumentzeile `TRAINEE_QUESTION` mit Sichtbarkeit `ALL` (Text in `description`). Hat die Datei einen Abschnitt `Aufgabe` neben dem Lösungsszenario, steht die Aufgabe in derselben Zeile hinter der Situation unter der Zwischenüberschrift `Aufgabe` (so wie bei den Use Cases, deren sichtbarer Text Situation, Ziel und Weg enthält). Titel, Schlüssel und Zahl der Zeilen bleiben gleich, ein Szenario ohne Aufgabe schreibt dieselbe Zeile wie zuvor. Das Lösungsszenario und der Abschnitt zum Fachwissen sind je eine Zeile `TRAINER_SOLUTION` mit Sichtbarkeit `TRAINER_ONLY`. Das ist die Art, wie die Plattform Use-Case-Dokumente trennt (`src/app/api/trainer/use-cases/[useCaseId]/documents/route.ts`), und die HAI-Indexierung ordnet solche Zeilen dem Trainerbereich zu (`src/lib/hai/indexScope.ts`). Die Datenbank hat keine eigene Tabelle für Szenarien.
- Die Dokumentzeilen haben noch keine Datei: `storage_url` ist leer (die Spalte ist `NOT NULL`), `mime_type` ist `text/plain`. Die Reindex-Skripte überspringen eine leere `storage_url`.
- Das Skript prüft den Plan und jede Zeile vor dem Schreiben: eine Lösungsmarke ("Richtige Antwort:", "Kurzbegründung:", "Lösungsszenario", "Fachwissen zur Lösung") oder ein langer Lösungstext in einem sichtbaren Feld lässt den Lauf abbrechen, beim Planen wird die Datei übersprungen.

**Lösungsteile der Szenarien nur lokal.** Die Richtlinie `cd_select` der Tabelle `content_documents` (`src/db/migrations/drizzle/0016_rls_policies.sql`) erlaubt allen Rollen das Lesen von Zeilen ohne Organisation, ohne Rücksicht auf die Sichtbarkeit. Wer den öffentlichen Schlüssel hat, könnte die Lösungstexte über die REST-Schnittstelle lesen. Deshalb schreibt das Skript die Zeilen `TRAINER_SOLUTION` nur mit `--scenario-solutions`, und dieser Schalter ist für die Preview gesperrt, bis die Richtlinie (Lesen nur für `authenticated` und ohne `TRAINER_ONLY` und `TRAINER_SOLUTION` für Nicht-Trainer, kein `select` für `anon`) in einer eigenen Migration eingeschränkt ist. Bis dahin enthält die Preview nur die Ausgangssituation der Szenarien.

### Geprüfte Fehlalarme der Marke "Lösung"

Steht in einem Lehrtext eine Zeile nur mit dem Wort "Lösung" (zum Beispiel als Beschriftung einer Tabellenzelle), schlägt die Lösungsmarke an und der Enabler fällt samt Szenario und Quizzen aus dem Plan (`SOLUTION_MARKER`, `ENABLER_MISSING`). Ist die Zeile geprüft und kein Lösungsteil, steht der Enabler in `scripts/import/kfbm-decisions.json` unter `content.reviewedSolutionWordFalsePositives` als `{ "enabler": "K24.2-e", "reason": "..." }`. Eingetragen sind K24.2-e (Fehlerprotokoll) und K25.2-d (Phasen eines Gesprächs).

- Die Freigabe gilt nur für den Text dieses einen Enablers und nur für das Muster der reinen Zeile "Lösung". Alle anderen Marken (zum Beispiel "Lösungsszenario", "Musterlösung", "Richtige Antwort"), der Titel des Enablers, die Szenarien, Quizze und Use Cases und jeder Treffer eines Szenario-Lösungstextes bleiben scharf. Das Muster selbst ist unverändert.
- Der Plan führt die Freigabe als `reviewedMarkers` und je Enabler als Hinweis `REVIEWED_MARKER`. Die Prüfung vor dem Schreiben (`validatePlan`, Zeilenprüfung, Aktualisierung) lässt die Zeile nur für Enabler dieser Liste durch. Ohne den Eintrag im Plan bricht jeder Lauf ab.
- Streng geprüft: ein unbekannter oder ungültiger Schlüssel (Platzhalter, Komponente statt Enabler), ein doppelter Eintrag, ein fehlender oder zu kurzer Grund und jedes weitere Feld sind Fehler der Voreinstellungen und stoppen den Lauf. Ein Eintrag, der nichts freigibt, bleibt ohne Wirkung.
- Neuer Eintrag nur nach Prüfung des Lehrtexts durch den Eigentümer. Wird der Text später geändert, gilt die Freigabe weiter, der Plan sollte dann erneut gelesen werden.

## Vor der Aktivierung der Inhalte

1. Die Route `GET /api/trainee/enablers/[enablerId]/quizzes/[difficulty]` liefert `options.explanation` an Azubis schon vor der Antwort (die Seite nutzt das, um die Begründung nach der Antwort zu zeigen). Weil die Begründung nur an der richtigen Option steht, verrät das die richtige Antwort. Das ist bestehender Code und gilt auch für FIAE. Vor der Aktivierung eines Quiz die Route ändern (Begründung erst mit dem Ergebnis aus `submit`).
2. Die Seite der Azubis für einen Enabler ruft die Dokumentenroute des Trainers auf und listet jede Dokumentzeile als Link. Die Route liefert alle Spalten ohne Filter nach Sichtbarkeit. Sie bleibt für Azubis gesperrt, solange niemand sie öffnet. Wer sie öffnet, muss `TRAINER_ONLY` und `TRAINER_SOLUTION` ausfiltern und Zeilen mit leerer `storage_url` nicht als Link zeigen.
3. Die Sollstunden der Komponenten fehlen noch (der Eigentümer entscheidet, die Wochen stehen im Plan). Die Lernfelder und ihre Zuordnung schreibt das Skript der Phase 4.5, Titel und Stunden der Lernfelder sind dort vorläufig oder offen.

## Upload der Originaldateien (eigenes Paket, nicht Teil dieses Laufs)

Nötig sind: ein Plan, welche Dateien (Enabler-Text, Szenario, Quiz je Stufe, Global-Quiz, jeweils als Word und PDF) wohin gehören; der Upload in den Bucket mit einem Präfix je Umgebung (`preview/`), weil Storage zwischen Preview und Production geteilt ist; danach je Datei `storage_url`, `storage_path`, `file_size`, `mime_type` und `page_count` der vorhandenen Dokumentzeilen setzen (für die Enabler-Texte neue Zeilen vom Typ `THEORY`); Entscheidung zum privaten Bucket und zu signierten Links (HAI-Paket H6); die Quelldateien liegen im OneDrive und sind teils nur Platzhalter.

## Übersprungene Dateien und Voreinstellungen

Die Voreinstellungen stehen in `scripts/import/kfbm-decisions.json` und sind Vorschläge des Plans, nicht bestätigt:

- Dubletten: die neueste Fassung (höchste Version, dann jüngstes Änderungsdatum). Liegen Version und Zeitpunkt weniger als 24 Stunden auseinander, werden beide Kopien übersprungen.
- Komponentencodes wie das Inventurskript sie ableitet (K6.1, K6.2, K24.1, K24.2, K25.1, K25.2). K10 bis K17 und K19 sind Wahl, K18 ist ausgeschlossen, K20 bis K23 sind integrativ, K24 und K25 sind Pflicht mit Phase (Teil 1 gleich Phase 1, Teil 2 gleich Phase 2).
- Ein Enabler braucht seinen Text. Fehlt oder scheitert der Text, werden Quizze und Szenario dieses Enablers mit dem Grund `ENABLER_MISSING` übersprungen.
- Dateien mit Formatfehlern (Parser-Befund `error`), mit Widerspruch zwischen Überschrift und Pfad und Szenarien, deren Aufgabe Text der Lösung wiederholt oder eine Lösungsmarke zeigt (`SOLUTION_MARKER`), werden übersprungen. Ein Szenario mit der Überschrift "Aufgabe" statt "Lösungsszenario" wird gelesen: Der Abschnitt gilt als Lösung (nur Trainer), der Plan führt den Hinweis `TASK_AS_SOLUTION`.

Gründe im Plan: `PARSE_ERROR`, `CODE_MISMATCH`, `DIFFICULTY_MISMATCH`, `KIND_MISMATCH`, `QUESTION_COUNT`, `DUPLICATE_AMBIGUOUS`, `ENABLER_MISSING`, `PATH_ISSUE`, `READ_ERROR`, `PLACEHOLDER`, `NO_HEADING`, `NO_DECISION`, `NO_GROUP`, `KIND_GROUP_MISMATCH`, `SOLUTION_MARKER`.

## Lernfelder und Zuordnungen (Phase 4.5)

Ein eigenes Skript, `scripts/import/kfbm-learning-fields.mjs` (`npm run import:kfbm:learning-fields`), schreibt die 13 Lernfelder des KfBM und ordnet die Enabler des Inhaltsimports den Lernfeldern zu. Es ist ein eigenes Skript, weil die Eingabe eine Excel-Tabelle und eine Codeliste ist und nicht die Word-Dokumente, und weil der Plan eine andere Form hat. Die Sicherheitsstruktur ist dieselbe (Ziele nur `local` und `preview`, Probelauf als Standard, echter Lauf nur mit `--apply`, Transaktion mit Isolation `repeatable read`, derselbe Advisory Lock, kein `DELETE`, keine Struktur, Verbindung nur aus `DB_CONNECTION_STRING`, keine Geheimnisse im Log). Die Prüfung von Host, Schema und Rolle ist derselbe Code (`src/lib/content-import/apply/target.ts`). Dieses Paket enthält keine Migration und hat keine Wirkung auf Production.

### Reihenfolge

1. Inhaltsimport (Abschnitte oben): schreibt Komponenten, Kurse, Enabler, Quizze und Szenarien.
2. Plan der Lernfelder (ohne Datenbank).
3. Prüfung, Probelauf, echter Lauf der Lernfelder.
4. Use-Case-Import (Abschnitt "Use Cases"), danach den Lauf der Lernfelder wiederholen: erst dann gibt es Use Cases, denen der Lauf die Lernfelder zuordnen kann. Der erste Lauf schreibt Lernfelder, Beschreibungen und die Zuordnung der Enabler, der zweite ergänzt die Zuordnung der Use Cases.

Ohne Enabler im Katalog stoppt das Skript (`NO_ENABLERS`). Fehlen einzelne Enabler, werden deren Zuordnungen als übersprungen gemeldet (`ENABLER_NOT_IN_DATABASE`), und der Lauf lässt sich wiederholen, sobald der Inhaltsimport sie geschrieben hat. Ein zweiter Lauf ergänzt nur, was fehlt.

### Schritte

```
npm run import:kfbm:learning-fields -- plan "<Pfad>\Übertragung von Mapping aus Dokument in Excel.xlsx" --import-source "<Pfad zu Komponente>" --out kfbm-plan-lf.json
$env:DB_CONNECTION_STRING = "<Verbindung des Ziels>"
npm run import:kfbm:learning-fields -- check --plan kfbm-plan-lf.json --target local
npm run import:kfbm:learning-fields -- run --plan kfbm-plan-lf.json --target local
npm run import:kfbm:learning-fields -- run --plan kfbm-plan-lf.json --target local --apply
```

- `plan` liest die Tabelle (nur lesend, 60 Sekunden Frist) und die Codes des Inhaltsimports. Die Codes kommen aus den Dateinamen des Quellordners (`--import-source`, es wird kein Dokument geöffnet, dieselbe Auswahl wie im Plan des Inhaltsimports) oder aus dessen Plan (`--import-plan kfbm-plan.json`). Neben dem JSON entsteht eine Zusammenfassung als Markdown (`kfbm-plan-lf.md`). Beide Dateien enthalten nur Codes, Zahlen und Zeilennummern, keinen Zelltext. Der Dateiname `kfbm-plan-lf.json` steht über `kfbm-plan*.json` in der `.gitignore`.
- `check` vergleicht den Plan in einer schreibgeschützten Transaktion mit der Zieldatenbank. `run` ist ein Probelauf und rollt zurück, mit `--apply` wird übernommen. Optionen wie beim Inhaltsimport: `--confirm-host <Host>` ist Pflicht für einen echten Lauf in der Preview, `--report-out <Datei.md>` schreibt den Bericht. Eine leere Beschreibung eines bestehenden Lernfelds füllt jeder Lauf mit der amtlichen Zielformulierung, eine Beschreibung mit Text ersetzt nur `--update-existing`. `--update-existing` aktualisiert bei bestehenden Lernfeldern nur den Titel, die Beschreibung und die Stunden (`hours_budget`). Der Titel wird nur durch den amtlichen Titel, einen Titel aus der Titeldatei des Eigentümers (`.json`) oder bei noch stehendem Platzhalter "Lernfeld N" ersetzt. Vorläufige Titel aus der Quellenliste ersetzen nie einen gesetzten Titel und ein Platzhalter nie einen vorhandenen. Die Stunden werden gesetzt, wenn sie fehlen oder vom Zeitrichtwert abweichen, und nie geleert. Schuljahr und Reihenfolge ändert der Lauf nie. Ohne `--update-existing` bleiben bestehende Zeilen unverändert, der Bericht nennt die Abweichungen. Sonst wird nichts überschrieben. Exit-Codes: 0 fertig, 1 Fehler oder abgelehnt, 2 falsche Aufrufe, 3 Konflikte.

### Was gelesen und geschrieben wird

| Quelle                                                  | Ziel                                                                                                                                                          | Schlüssel für die Idempotenz |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 13 Lernfelder (Code `LF1` bis `LF13`)                   | `training_catalog_learning_fields` (Schuljahr 1 für LF1 bis LF4, 2 für LF5 bis LF8, 3 für LF9 bis LF13, `order_index` 1 bis 13, `hours_budget` Zeitrichtwert) | Katalog und Code             |
| 13 Lernfelder, Beschreibung                             | `training_catalog_learning_fields.description` (wörtliche Zielformulierung des Rahmenlehrplans, ein Satz, 120 bis 240 Zeichen wie bei den FIAE-Lernfeldern)    | Katalog und Code             |
| Zeile der Tabelle (Position mit Buchstabe) und Lernfeld | `training_catalog_content_mappings` (`learning_field_id`, `enabler_id`, der Katalog wird per Trigger abgeleitet)                                              | Lernfeld und Enabler         |
| Zuordnung Enabler zu Lernfeld und `use_cases.enabler_id` | `training_catalog_content_mappings` (`learning_field_id`, `use_case_id`, `enabler_id` leer): eine eigene Zeile je Use Case                                    | Lernfeld und Use Case        |
| dieselbe Zuordnung                                      | `use_cases.lernfelder` (Textfeld, Code des Lernfelds, zum Beispiel `LF3`, es wird nur ergänzt)                                                                | Use Case und Code            |

- Die Tabelle: Kopfzeile mit "Schuljahr 1" bis "Schuljahr 3" (in der Fassung vom 07.08.2026 Zeile 4), Spalte A nennt die Komponente nur in der ersten Zeile ihres Blocks, Spalte B die Position ("a) ..."), die Spalten C bis E die Lernfelder je Schuljahr. Die Nummer der Importkomponente folgt aus dem Paragrafen der Verordnung: Abschnitt A (§ 4 Absatz 2) Nr. 1 bis 9 sind K1 bis K9, Abschnitt B (Absatz 3) Nr. 1 bis 10 sind K10 bis K19, Abschnitt C (Absatz 4) Nr. 1 bis 6 sind K20 bis K25. Der Titel der Komponente wird nicht ausgewertet. Bei geteilten Komponenten (K6, K24, K25) entscheidet der Buchstabe, zu welchem Teil der Enabler gehört (K6.1-a, K6.2-d). Es gilt die Fassung "Übertragung von Mapping aus Dokument in Excel.xlsx" (Stand 07.08.2026), die ältere Datei mit dem Zusatz "-WMC-NB-MB-03" wird nicht gelesen.
- Angaben wie "LF 2", "LF2,3", "LF 2,3,4", "Lernfeld 3", "LF 5, LF 7", "LF 5 und 7" werden gelesen (Groß und Kleinschreibung, Leerzeichen, Steuerzeichen und Silbentrennung spielen keine Rolle). "alle Lernfelder" bedeutet alle Lernfelder des Schuljahrs der Spalte. "nur betrieblich" und "nur betr./beh." bedeuten, dass die Position nur im Betrieb vermittelt wird: kein Lernfeld, kein Fehler (Hinweis im Plan).
- Nichts wird geraten. Als übersprungen mit Grund und Zeilennummer (und Spalte) führt der Plan: Komponente ohne Gegenstück im Import (`COMPONENT_NOT_IN_IMPORT`), ausgeschlossene Komponente (`COMPONENT_EXCLUDED`, K18), Buchstabe ohne Enabler im Import (`ENABLER_NOT_IN_IMPORT`), mehrfach vorkommender Buchstabe (`DUPLICATE_LETTER`, beide Zeilen), Zeile ohne Buchstaben (`NO_LETTER`), widersprüchlicher Block (`NUMBER_MISMATCH`, `SECTION_MISMATCH`, `REFERENCE_MISMATCH`, `NUMBER_OUT_OF_RANGE`, `BLOCK_UNKNOWN`), Lernfeld außerhalb 1 bis 13 (`LF_OUT_OF_RANGE`), Lernfeld, das nicht zum Schuljahr der Spalte gehört (`YEAR_MISMATCH`), nicht lesbare Zelle (`UNPARSEABLE_REFERENCE`), Lernfeldangabe ohne Zeilentext (`ORPHAN_REFERENCE`).
- Zuordnungen gibt es nur zu Enablern. Das Modell erlaubt auch Use Cases (genau eines von beiden), die Zuordnung zu Komponenten gibt es im Modell nicht. Die Use Cases schreibt das Skript des nächsten Abschnitts, die Excel nennt für sie keine eigene Zuordnung (jeder Use Case gehört zu genau einem Enabler).
- Titel und Stunden: Die Tabelle nennt keine. Maßgebliche Quelle ist der Rahmenlehrplan für Kaufleute für Büromanagement (Beschluss der KMK vom 27.09.2013 in der Fassung vom 20.03.2025, Teil V Lernfelder). Bezeichnung und Zeitrichtwert der 13 Lernfelder stehen als Daten im Modul `src/lib/content-import/learning-fields/official.ts` und gehen standardmäßig in jeden Plan ein: Titel mit Quelle `official` (nicht vorläufig) und `hours_budget` je Lernfeld. Die Summe ist 880 Stunden, 320 im Schuljahr 1, 280 im Schuljahr 2 und 280 im Schuljahr 3, die Tests prüfen das. Beim Lernfeld 11 steht im PDF "40. Stunden" (Tippfehler mit Punkt), eingetragen sind 40 Stunden, weil nur das zur Jahressumme von 280 Stunden passt. Rangfolge der Titel: Titeldatei des Eigentümers (`--titles <Datei>.json`, `{"LF1": "..."}`), dann der amtliche Titel, dann die Kapitelliste `Enabler_Quellen.csv` (`--titles <Datei>.csv`, Kurztitel, vorläufig) und zuletzt der Platzhalter "Lernfeld N". Weil der amtliche Titel vor der Kapitelliste steht, ist `--titles` mit einer `.csv` nur noch für Pläne ohne die amtlichen Daten von Bedeutung. Die Stunden kommen nur aus dem Modul. Ein bestehendes Lernfeld mit anderem Titel oder anderen Stunden wird ohne `--update-existing` nur gemeldet.
- Offener Punkt `HOURS_BUDGET` entfällt, sobald alle 13 Lernfelder Stunden haben. Die 13 Einzel-PDF der Lernfelder enthalten nur Kapitelverzeichnisse eines Lehrbuchs ohne Stunden, ihre Titel stimmen mit den amtlichen überein (außer beim Lernfeld 7: dort steht "bewältigen" statt "gestalten", maßgeblich ist der Rahmenlehrplan). Die Änderung braucht keine Migration (die Spalte `hours_budget` gibt es seit `20261024000100`) und hat keine Wirkung auf Production.
- Beschreibung: Die Beschreibung ist die wörtliche Zielformulierung des Lernfelds aus dem Rahmenlehrplan (erster Absatz unter Titel und Zeitrichtwert, ein Satz "Die Schülerinnen und Schüler besitzen die Kompetenz, ..."), im Modul `official.ts` mit Quelle. Nichts ist umformuliert, nur das Layout des PDF ist bereinigt (Zeilenumbrüche, Silbentrennung am Zeilenende, zum Beispiel "Be-" und "triebs" zu "Betriebs"). Diese Form hat dieselbe Länge wie die FIAE-Beschreibungen (ein bis zwei Sätze), die Lernfeldseiten sehen damit für beide Berufe gleich aus. Die Inhalte der Lernfelder stehen im Rahmenlehrplan nicht als eigene Liste, sondern als Beispiele in Klammern im Fließtext der Kompetenzbeschreibung, sie sind deshalb nicht übernommen. Die 13 Einzel-PDF der Lernfelder (`Dokumente\LF`) sind Inhaltsverzeichnisse eines Lehrbuchs ohne Zielformulierung, Zeitrichtwert und Kompetenzen und deshalb keine amtliche Quelle. Der Plan trägt die Beschreibung mit, ein Planfile ohne Beschreibung (älterer Plan) schreibt keine und löscht keine. Eine Beschreibung im Plan, die nicht der amtliche Text ist, lehnt die Prüfung des Plans ab.
- Zuordnung der Use Cases: Die Lernfeldseiten (`/api/trainee/lernfelder`, `/api/trainer/lernfelder` und die Detailrouten) lesen die Use Cases eines Lernfelds nicht aus der Zuordnungstabelle, sondern aus dem Textfeld `use_cases.lernfelder` (Code des Lernfelds, `arrayContains`). Für KfBM war es leer, deshalb zeigten die Seiten keinen Use Case, auch wenn Zeilen mit `use_case_id` gefehlt hätten. Der Lauf liest in `check`, Probelauf und echtem Lauf die Use Cases des Katalogs aus der Datenbank und schreibt für jede Zuordnung (Lernfeld, Enabler) zwei Dinge für den Use Case des Enablers (`use_cases.enabler_id`, je Enabler höchstens einer): die Zeile (Lernfeld, Use Case) in `training_catalog_content_mappings` (die Tabelle erlaubt je Zeile genau einen von `enabler_id` und `use_case_id`, deshalb eine eigene Zeile) und den Code des Lernfelds in `use_cases.lernfelder`. Das Textfeld wird nur ergänzt, nie geleert oder umgeordnet, vorhandene Codes bleiben. Das Ergänzen geschieht auch ohne `--update-existing` (wie das Anlegen der Zuordnungszeilen), ein Code, den jemand von Hand entfernt hat, kommt beim nächsten Lauf wieder. Die Liste der Lernfelder der Trainee-Route (`/api/trainee/lernfelder`) hält die Zahl der Use Cases bis zu 15 Minuten im Speicher des Servers, nach dem Lauf erscheinen die neuen Zahlen also mit Verzögerung oder nach einem Neustart. Es gibt keine Migration, der Lauf schreibt nur diese Daten.
- Meldungen zur Zuordnung der Use Cases im Bericht: "Enabler mit Lernfeld, aber ohne Use Case" (die Enabler, für die es keinen Use Case gibt, mit Code) und "Use Cases des Katalogs ohne Enabler" (Use Cases mit `enabler_id` leer, sie bekommen kein Lernfeld, mit Code). Beide sind Hinweise, kein Fehler. Die Zahlen der Preview stehen erst nach dem Lauf fest (erwartet bis zu 688 Zuordnungen zu Use Cases, eine je Zuordnung eines Enablers mit Use Case).
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

Die Zuordnung der Use Cases wird mit demselben Löschen der Zuordnungen mit entfernt (die Zeilen mit `use_case_id` tragen den Katalog). Nicht mit entfernt sind die Codes in `use_cases.lernfelder`. Sie lassen sich in derselben Transaktion zurücknehmen, wenn an den Use Cases des Katalogs keine Lernfeldcodes von Hand gesetzt wurden:

```sql
begin;
update use_cases
  set lernfelder = array(
    select code from unnest(lernfelder) as code where code !~ '^LF[0-9]+$'
  )
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

## Quiz-JSON als Quelle (Schema 1.0)

Stand: 27.10.2026. Die Quizze liegen neben den Word-Dateien auch als JSON vor (zwei Dateien, Schema 1.0): eine mit den Enabler-Quizzen in drei Stufen (Kopf mit `schema_version`, `quiz_count`, `difficulty_levels`) und eine mit den Global-Quizzen (je Komponente 20 Fragen). Das Skript nimmt sie als zusätzliche oder alleinige Quelle für die Quizze. Der Code liegt in `src/lib/content-import/quiz-json/` (reine Funktionen, kein Dateizugriff im Kern). Dieses Paket enthält keine Migration und hat keine Wirkung auf Production.

**Die JSON-Dateien werden nur gelesen.** Sie gehören nicht ins Repository und nicht in Tickets, sie enthalten wie die Word-Dateien die Lösungen. Die Tests arbeiten mit erfundenen Beispielen im selben Schema.

Als Datei der Enabler-Quizze gelten `alle_quizze 1.json` und die korrigierte Fassung `alle_quizze 1.korrigiert.json` (Quiz K14-a repariert, gleiches Schema). Beide lassen sich mit `--quizzes-json` einlesen, für einen Lauf gilt die korrigierte Fassung, sobald der Eigentümer sie freigibt. Die Global-Quizze stehen in `global_quizze 1.json`.

### Befehle

```
npm run import:kfbm:apply -- check-quizzes --quizzes-json "<alle_quizze.json>" --global-quizzes-json "<global_quizze.json>" --report-out quiz-json-bericht.md
npm run import:kfbm:apply -- plan --quizzes-json "<alle_quizze.json>" --global-quizzes-json "<global_quizze.json>" --out kfbm-plan.json
npm run import:kfbm:apply -- plan "<Pfad zu Komponente>" --quizzes-json "<alle_quizze.json>" --global-quizzes-json "<global_quizze.json>" --out kfbm-plan.json
```

- `check-quizzes` ist nur lesend und nennt Zahlen, Komponenten, Kennungen und Codes, nie einen Text der Dateien: Zählung je Komponente und Stufe, Fragen je Satz (ein Satz ist ein Quiz in einer Stufe) und alle Befunde mit der Kennung des Quizzes, der Stufe und der Fragenummer. Exit-Code 0 ohne Fehler (Hinweise sind erlaubt), 1 bei mindestens einem Fehler, 2 bei einer Datei, die nicht gelesen werden kann. Der Bericht (`--report-out`) muss auf `.md` enden, und eine Ausgabedatei darf nie eine der JSON-Eingaben sein.
- `plan`, `check` und `run` nehmen dieselben Optionen. Ohne Quellordner genügt eine JSON-Datei. Mit Quellordner kommen die Quizze aus beiden Quellen, `--components` begrenzt auch die JSON-Quizze. `--plan` und die JSON-Optionen schließen sich aus (ein Plan enthält seinen Inhalt schon).
- Die Dateien müssen auf `.json` enden und dürfen höchstens 32 MB groß sein. Die Meldungen nennen die Datei und eine Position, nie den Inhalt.
- Alles Übrige gilt wie bisher: Probelauf ist der Standard, Ziele nur `local` und `preview`, `--apply` und bei der Preview `--confirm-host`, Antworten und Erklärungen nur in ihren Spalten, keine Ausgabe von Inhalten.

### Wie dieselben Zeilen getroffen werden

Jeder Satz (Quiz und Stufe) und jedes Global-Quiz wird für den Planer zu einer Datei im Schema des Quellbaums, abgeleitet aus `id`, `curriculum_component` und `training_section`. Die Funktion `pathInfo`, die auch die Word-Dateien einordnet, bildet daraus Schlüssel, Enabler und Komponente. Die Pläne aus Word und aus JSON benennen deshalb dieselben Zeilen, ein Lauf aus der einen Quelle nach einem Lauf aus der anderen legt nichts doppelt an (getestet mit der Speicherdatenbank der Engine und mit einer Wegwerf-Datenbank).

| JSON                                        | Plan                                         |
| ------------------------------------------- | -------------------------------------------- |
| Quiz `10a`, Komponente `10`, Stufe `leicht`  | Quiz `K10-a-low`, Schlüssel `quiz:10a:low`   |
| Quiz `6a`, Komponente `06.1`, Stufe `mittel` | Quiz `K6.1-a-medium`, Enabler `K6.1-a`       |
| Quiz `24_1a`, Komponente `24.1`, Stufe `schwer` | Quiz `K24.1-a-high`                       |
| Global-Quiz `06.2`                          | Quiz `K6.2-global`, Schlüssel `global-quiz:06.2` |

Die Stufen `leicht`, `mittel`, `schwer` entsprechen `Low`, `Medium`, `High`. Die Kennung eines Quizzes ohne Teilnummer (`6a`) erhält die Teilnummer der Komponente (`06.1`), eine Kennung mit Teilnummer (`24_1a`) muss zur Komponente passen, sonst ist der Eintrag ein Fehler.

### Zusammenspiel mit dem Word-Baum und der Datenbank

- **Der Word-Baum gilt.** Hat ein Quiz der JSON denselben Schlüssel wie eine Word-Datei, bleibt die Word-Datei und das JSON-Quiz steht im Plan unter "Ältere Kopien". Nur mit `--prefer-json-quizzes` (braucht den Quellordner und eine JSON-Datei) ersetzt das JSON-Quiz die Word-Quiz-Dateien desselben Schlüssels, die dann unter "Ältere Kopien" stehen, und auch nur, wenn der JSON-Satz fehlerfrei ist. Eine Word-Datei, die der Planer nicht verwenden kann (Formatfehler, Platzhalter, nicht lesbar, Pfad passt nicht), hält ihren Schlüssel nicht besetzt: Das JSON-Quiz füllt die Lücke und die Word-Datei steht unter "Ältere Kopien" (die Konsole nennt die Zahl). Sonst bliebe das fehlerhafte Word-Quiz und das gültige JSON-Quiz ginge verloren.
- **Enabler:** Das Word-Dokument eines Enablers hat immer Vorrang. Fehlt es, legt der Plan den Enabler aus der Überschrift des JSON-Titels an (`10a) Titel`), ohne Lehrtext. Passt der Titel nicht zu Kennung und Komponente, entsteht kein Enabler und die Quizze stehen mit `ENABLER_MISSING` unter den übersprungenen, der Enabler muss dann aus dem Word-Baum kommen.
- **Komponenten:** Kennt der Word-Baum die Komponente, kommen Titel, Paragraf und Gruppe (und damit die Phase) immer von dort, die JSON ändert sie nie. Nur eine Komponente, die allein die JSON kennt, nimmt Titel, Paragraf und Gruppe aus `curriculum_component` und `training_section`. Art und Phase kommen aus `kfbm-decisions.json` wie bisher. Zwei Quizze derselben Komponente mit verschiedenem Titel oder Abschnitt sind ein Fehler (`COMPONENT_CONFLICT`).
- **Datenbank:** Bestehende Zeilen bleiben unverändert, auch wenn die JSON andere Texte nennt (der Bericht führt die Abweichungen). Nur `--update-existing` ändert die benannten Spalten (Fragen- und Optionstexte, Erklärung, Titel). Eine andere Fragenzahl als in der Datenbank ist wie bisher ein Konflikt (Exit-Code 3). Ein Enabler, der schon mit Lehrtext besteht, verliert ihn nie, ein fehlender Wert im Plan löscht nichts.

### Fehlende Fragen nachliefern (`--extend-quizzes`)

Sechs Quizze (2g, 7b, 7d, 8a, 9d, 9e, je drei Stufen) haben in der Quelle 8 statt 10 Fragen und werden zunächst so importiert (nur ein Hinweis `QUESTION_COUNT`). Werden die fehlenden Fragen später nachgeliefert, meldet die Engine bei einem Quiz mit anderer Fragenzahl weiter einen Konflikt (Exit-Code 3). Mit dem Schalter `--extend-quizzes` (`check` und `run`, Standard aus) ergänzt der Lauf stattdessen die fehlenden Fragen mit ihren Optionen, wenn:

- die Datenbank weniger Fragen hat als der Plan und
- jede vorhandene Frage im Plan mit demselben Text vorkommt (Leerraum wird nicht verglichen) und in derselben Reihenfolge, und die Optionen der vorhandenen Fragen die Gestalt des Plans haben (gleiche Zahl, Reihenfolge 1 bis n).

Sonst bleibt es ein Konflikt mit Begründung (andere Texte, andere Reihenfolge, andere Optionen, mehr Fragen in der Datenbank). Die Zuordnung läuft über den Fragentext und die Reihenfolge, die Nummer im Plan bestimmt die Stelle (`order_index`), auch in der Mitte.

- Vorhandene Fragen, Optionen, richtige Antworten und Erklärungen werden nicht geändert und nie gelöscht, die Fragen-ids bleiben. Antworten von Azubis hängen an der Fragen-id und bleiben gültig (an einer Wegwerf-Datenbank mit einer vorhandenen Abgabe geprüft).
- **Nur der Positionswert `order_index` vorhandener Fragen verschiebt sich**, wo eine neue Frage davor liegt (die Spalte ist eine ganze Zahl ohne Eindeutigkeit, anders ist eine Frage in der Mitte nicht an die richtige Stelle zu bringen). Das ist die einzige Änderung an vorhandenen Zeilen, der Bericht nennt sie. Der Eigentümer hat diese Verschiebung am 27.10.2026 ausdrücklich akzeptiert.
- Der Probelauf und die Prüfung zeigen die Zählung als "n Fragen ergänzt" je Quiz (mit der Zahl der verschobenen Positionen), danach schreibt `--apply` genau das. Ein zweiter Lauf ergänzt nichts mehr.
- Neue Fragen laufen durch denselben Lösungsschutz wie alle Zeilen. Neue Fragen sind noch nicht im HAI-Index, sie kommen erst mit einer späteren Neuindexierung hinein.

### Strenge Prüfung (nichts wird geraten)

Ein Fehler überspringt die Stufe (oder bei Fehlern im Kopf die ganze Datei) mit Kennung und Grund, ohne einen Text der Datei zu nennen. Ein Hinweis kommt in die Hinweise des Plans, die Stufe bleibt im Plan.

| Code                                              | Art     | Bedeutung                                                                                                          |
| ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `SCHEMA_VERSION`, `QUIZ_COUNT`, `LEVELS_HEADER`, `NOT_OBJECT`, `QUIZZES_MISSING` | Fehler, die ganze Datei wird nicht gelesen | Kopf passt nicht (andere Fassung, abgeschnittene Datei) |
| `UNKNOWN_FIELD`, `UNKNOWN_LEVEL`                  | Fehler  | Ein Feld oder eine Stufe, die das Schema 1.0 nicht kennt (im Kopf, im Quiz, in der Stufe, in Frage und Option). Nur Feldnamen werden genannt. |
| `TOO_MANY_QUIZZES`, `TOO_MANY_QUESTIONS`, `TEXT_TOO_LONG`, `OPTION_TOO_LONG`, `RATIONALE_TOO_LONG` | Fehler | Obergrenzen: 1000 Quizze, 100 Fragen je Satz, 50.000 Fragen je Datei, Frage 2000, Option 1000, Erklärung 4000 Zeichen |
| `OPTION_COUNT`, `OPTION_ORDER`, `OPTION_EMPTY`, `OPTION_DUPLICATE`, `OPTION_INVALID` | Fehler | Genau vier Optionen A bis D in dieser Reihenfolge, keine leere, keine doppelte (ohne Rücksicht auf Groß und Kleinschreibung) |
| `ANSWER_MISSING`, `ANSWER_INVALID`                | Fehler  | `correct_answer` fehlt oder ist keine der Optionen A bis D                                                         |
| `TEXT_EMPTY`, `RATIONALE_MISSING`, `TEXT_CONTROL`, `QUESTION_DUPLICATE`, `QUESTION_NOT_OBJECT` | Fehler | Leere Frage oder Erklärung, Steuerzeichen (ein NUL bräche das Einfügen), dieselbe Frage zweimal im Satz |
| `ID_INVALID`, `ID_DUPLICATE`, `KEY_DUPLICATE`, `NUMBER_SEQUENCE` | Fehler | Kennung ohne Form (`10a`, `24_1a`, Global `06.1`), Kennung oder Enabler doppelt (keiner der Einträge wird gelesen), Fragenummern nicht 1 bis n |
| `COMPONENT_INVALID`, `COMPONENT_MISMATCH`, `SECTION_INVALID`, `PATH_MAPPING`, `COMPONENT_CONFLICT`, `COMPONENT_TITLE` | Fehler | Komponente, Abschnitt oder Kennung passen nicht zusammen oder ergeben keinen gültigen Schlüssel |
| `LEVEL_MISSING`, `LABEL_MISMATCH`, `NO_QUESTIONS`, `SOURCE_TYPE`, `SOURCE_WARNINGS_INVALID`, `QUIZ_NOT_OBJECT` | Fehler | Stufe fehlt oder falsch beschriftet, keine Fragen, ein Quellfeld ist kein Text, Eintrag ist kein Objekt |
| `QUESTION_COUNT`                                  | Hinweis bei Enabler-Quizzen (nicht 10 Fragen), Fehler bei Global-Quizzen (nicht 20) | Das Word-Verfahren kennt für Enabler-Quizze keine feste Zahl, deshalb nur ein Hinweis. Nachlieferung siehe `--extend-quizzes`. |
| `SOURCE_WARNING`                                  | Hinweis | Die Quelle markiert die Frage (zum Beispiel redaktionell ergänzte Optionen). Laut Eigentümer sind die Fragen fachlich geprüft, der Hinweis blockiert den Import nicht und wird nur gezählt. |
| `TITLE_REPAIRED`                                  | Hinweis | Vor dem Code im Titel stehen ein oder zwei fremde Zeichen (zum Beispiel ein Buchstabe vor `6g)`). Weil die Kennung des Quizzes den Code bestätigt, wird die Überschrift ohne die Zeichen gelesen und der Enabler angelegt. Passt der Code nicht zur Kennung, bleibt es bei `TITLE_HEADING`. |
| `TITLE_HEADING`, `CATEGORY_MISMATCH`, `SOURCE_FILES`, `SOURCE_PATH_MISMATCH`, `SOURCE_NULL` | Hinweis | Der Titel nennt keine Überschrift des Enablers, `category` weicht ab, `source_files` fehlt oder nennt einen anderen Schlüssel, ein Quellfeld ist `null` |

Der Lösungsschutz der Planung gilt unverändert: Eine Lösungsmarke in einem sichtbaren Feld (`SOLUTION_MARKER`) überspringt das Quiz, Erklärung und richtige Antwort stehen nur in `options.explanation` und `options.is_correct`.

### Zählung der echten Dateien (Stand 27.10.2026)

`check-quizzes` zählt in `alle_quizze 1.json` 226 Quizze mal drei Stufen (678 Sätze, 6744 Fragen, davon 18 Sätze mit 8 statt 10 Fragen) und in `global_quizze 1.json` 27 Quizze mit je 20 Fragen. Fehler gibt es keine, die Hinweise sind unter den Befunden aufgeführt. Der Plan aus beiden Dateien ohne Word-Baum ergibt 27 Komponenten, 226 Enabler (ohne Lehrtext), 675 Enabler-Quizze und 27 Global-Quizze. Übersprungen werden mit `alle_quizze 1.json` nur die drei Stufen von K14-a (Lösungsmarke im sichtbaren Text), mit `alle_quizze 1.korrigiert.json` keine. Der Titel des Enablers 6.2g trägt ein fremdes Zeichen vor dem Code und wird mit dem Hinweis `TITLE_REPAIRED` gelesen. Die Einzelheiten stehen im Bericht des Pull Requests.

## PDF-Import der Komponenten (OR1)

Der Ordner `Komponenten_PDF` enthält je Komponente die vier Unterordner Enabler, Szenarien, Use-Cases und Use-Cases_Musterlösung (der Unterordner Quizze gehört nicht dazu). Das Skript `scripts/import/kfbm-documents.mjs` (`npm run import:kfbm:documents`) macht daraus Zeilen in `content_documents` und Dateien im Speicher, in der Form, die FIAE für dieselbe Art Dokument nutzt. Sicherheitsaufbau wie bei den anderen Importskripten: Standard ist der Probelauf (Transaktion, am Ende Rückgängig, **kein Zugriff auf den Speicher**), ein echter Lauf braucht `--apply`, `--target local|preview` und bei der Preview `--confirm-host`. Production ist in jedem Fall verweigert.

### Welche Zeilen entstehen

| Datei | Typ | Sichtbarkeit | Ort | Bucket |
| --- | --- | --- | --- | --- |
| Enabler/…pdf | THEORY | ALL | am Enabler | `content` (öffentlich) |
| Szenarien/…pdf | EXERCISE | ALL | am Enabler | `content` (öffentlich) |
| Use-Cases/…pdf | TRAINEE_QUESTION | ALL | am Use Case | `content` (öffentlich) |
| Use-Cases_Musterlösung/…pdf | TRAINER_SOLUTION | TRAINER_ONLY | am Use Case | `content-solutions` (privat) |

- EXERCISE ist bei FIAE das Szenario: die Seite des Enablers zeigt diese Dokumente im Abschnitt Szenario (`scripts/upload-szenarien.mjs`, `src/app/trainee/enablers/[enablerId]/page.tsx`). THEORY zeigt sie als Lehrtext, TRAINEE_QUESTION und TRAINER_SOLUTION entsprechen `scripts/bulk-import-use-case-pdfs.ts`.
- Titel (Schlüssel einer Zeile, fest): `Enabler K6.2-d: Lehrtext (Original PDF)` (derselbe Titel wie beim Original des Uploads, so entstehen nie zwei Zeilen für einen Text), `Szenario K6.2-d (PDF)`, `Use Case K6.2-d: Aufgabe (PDF)`, `Use Case K6.2-d: Musterlösung (PDF)`. Spalten: `mime_type` application/pdf, `file_size`, `page_count` (aus der ersten Seite des Lesers), `organization_id` leer (gemeinsamer Lehrplan, wie die Zeilen der FIAE-Skripte), `uploaded_by_id` aus `--created-by`, `is_indexed_by_hai` falsch.
- Pfad im Speicher: `preview/kfbm/<Enablercode>/<enabler|szenario|aufgabe|musterloesung>/<Dateiname>` für die Preview, `kfbm/...` für local. Die Buckets teilen sich Preview und Production, das Präfix hält jeden Pfad von Production fern.
- Die bestehenden Textzeilen der KfBM (Szenario-Ausgangssituation am Enabler, "Behandelte Themen" am Use Case, ohne Datei) bleiben: sie speisen die Suche des Tutors. Die Azubi-Routen liefern keine Zeile ohne Datei mehr aus (vorher zeigte die Use-Case-Seite dafür einen toten Knopf).

### Zuordnung (nichts wird geraten)

Jede PDF wird über den Dateinamen und die erste Überschrift der ersten Seite einem Enabler zugeordnet (`6d_…`, `24_2e).pdf`, `Szenario_25_1a_…`, `UC_6d_…`; Überschrift `6d) …`, `Szenario 25/1a) …`, `25/1b - …`). Der Use Case hängt über `use_cases.enabler_id` am Enabler. Nicht übernommen und im Plan genannt werden: falsch benannte Dateien (`misnamed`, zum Beispiel `14i.pdf` im Ordner Szenarien), Dateien mit Vermerk im Namen (`annotated`, `Szenario_23c (aus 23b).pdf`), Überschrift eines anderen Enablers (`heading-mismatch`), keine Kennung in der Überschrift (`heading-missing`, zum Beispiel ein Tippfehler `F12l)`), kein PDF oder zu groß (`unreadable`) und zwei Dateien für einen Platz (`duplicate`). Der Plan enthält nur Namen, Kennungen, Größen und Prüfsummen, nie Text.

Stand der echten Dateien (27.10.2026, nur Plan): 934 PDF, davon 30 im Ordner Quizze. Zugeordnet 225 Enabler, 224 Szenarien, 226 Aufgaben, 226 Musterlösungen. Offen: `12l.pdf` (Überschrift mit Tippfehler), `14i.pdf` (Szenario, falscher Name), `Szenario_23c (aus 23b).pdf` (Inhalt 23c im Platz 23b, damit fehlt das Szenario 23b).

### Musterlösungen: privater Bucket

Ein öffentlicher Bucket gibt jedem mit der URL die Musterlösung. Darum liegen die Lösungs-PDF im privaten Bucket `content-solutions` (Name `content-solutions`, nicht öffentlich, Größenlimit 25 MB, erlaubter Typ `application/pdf`), den der Eigentümer von Hand anlegt. Die Zeile speichert keine URL, sondern die Referenz `private://content-solutions/<Pfad>`. Nur die Trainer-Liste der Use-Case-Dokumente (`GET /api/trainer/use-cases/[useCaseId]/documents`) macht daraus eine signierte URL, die zehn Minuten gilt, auf dem Server mit dem geheimen Schlüssel, nur für Zeilen mit TRAINER_ONLY, nur im Bucket `content-solutions`, mit streng geprüftem Pfad (`src/lib/solution-storage.ts`). Azubi-Routen liefern weder die Zeile noch die Referenz. Der Server liest die Referenz nie als Datei (die Prüfung `readableStorageUrl` lehnt sie ab), die Lösungs-PDF wird also auch nicht in die Suche des Tutors übernommen.

### Befehle

```
node scripts/import/kfbm-documents.mjs plan  <Quellordner> [--out plan.json] [--components K1,K6.2] [--hydrate]
node scripts/import/kfbm-documents.mjs check <Quellordner> --target local|preview --created-by <uuid>
node scripts/import/kfbm-documents.mjs run   <Quellordner> --target local|preview --created-by <uuid> [--apply] [--overwrite-files] [--confirm-host <host>]
```

Der echte Lauf liest Adresse und Schlüssel aus `NEXT_PUBLIC_SUPABASE_URL` und `SUPABASE_SECRET_KEY`. Ein lokales Ziel verlangt eine lokale Speicheradresse, die Preview die https-Adresse des Projekts. Reihenfolge: Inhaltsimport, Use-Case-Import, dann dieses Skript. Zweiter Lauf: legt nichts doppelt an, Dateien werden nie überschrieben (nur mit `--overwrite-files`, und nur Dateien, deren Zeile genau auf den Pfad dieses Imports zeigt). Zuerst werden die Dateien kopiert, danach die Zeilen geschrieben. Schlägt etwas fehl, auch der Commit, nimmt der Lauf die Dateien dieses Laufs wieder heraus. Große Läufe komponentenweise (`--components`), die Transaktion bleibt während des Kopierens offen. Die Laufzeit an der echten Preview ist ungemessen.

### Originale des Uploads im Reader

Das Original-PDF eines Enabler-Lehrtexts, das die Übernahme des Inhalts-Uploads in den Bucket `content` kopiert (`transfer/originals.ts`), hat dieselbe Form wie eine FIAE-Zeile (THEORY, ALL, Pfad `[preview/]<Person>/<Zeitstempel>_<Name>`, öffentliche URL). Der Reader der Azubi-Seite zeigt es nach der Freischaltung, ohne Sonderfall: Enabler aktiv, Azubi Mitglied des Kurses, Katalog und Organisation freigeschaltet. Word-Originale zeigt der Reader nicht (nur PDF). Ein direkter Speicherlink eines noch inaktiven Originals bleibt erreichbar, solange der Bucket `content` öffentlich ist (offene Frage H6, bei FIAE ebenso). In der Prüfliste markiert die Person die Originale (höchstens 25 je Übernahme), der Block "Originale für die Azubis bereitstellen" erscheint für angenommene PDF-Originale; die Probelauf- und Übernahme-Oberfläche muss die Auswahl als `publishOriginals` mitsenden. PDF-Metadaten (Info-Dictionary, XMP) lassen sich serverseitig mit `pdf-lib` (schon Abhängigkeit) entfernen, das ist noch nicht eingebaut.
