# Inhaltsstatistik je Ausbildung

Die Seite `/trainer/admin/content-stats` zeigt den Admins, wie viel Inhalt je Ausbildung (Ausbildungskatalog, zum Beispiel KfBM und FIAE) vorhanden ist (Ist), was geplant ist (Soll) und wie groß die Abweichung ist. Es gibt keine Migration, die Soll-Werte liegen in `training_catalogs.settings`.

## Wer sieht was

| Rolle                                                           | Sieht                                                                                                       | Ändert Soll-Werte |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------- |
| Plattform-Admin (SUPER_ADMIN, ADMIN der Plattform-Organisation) | alle Ausbildungen, auch inaktive, mit Ist, Soll, Abweichung und Status                                      | ja                |
| ADMIN und TEMP_ADMIN einer Organisation                         | nur die Ausbildungen, die für die eigene Organisation freigeschaltet und aktiv sind, nur das Ist, kein Soll | nein              |
| Trainer, Azubi                                                  | nichts (403)                                                                                                | nein              |
| ohne Sitzung                                                    | nichts (401)                                                                                                | nein              |

- Die Soll-Werte sind die Planung der Plattform. Sie verlassen den Server nur für den Plattform-Admin. Für Organisations-Admins fehlen Soll, Abweichung, Status und Fortschrittsbalken in der Antwort, nicht erst in der Oberfläche.
- Die Organisation kommt aus der Sitzung, nie aus der Anfrage. Eine Organisation ohne Katalogzeilen gilt als FIAE freigeschaltet (Altbestand, wie im Rest der Katalogverwaltung). Zeigt die Sitzung auf eine Organisation, die es nicht gibt, ist die Liste leer (fail closed).
- Soll-Werte ändert nur `requireCurriculumEditor` (gleiches Recht wie jede Änderung am Lehrplan).

## Zählregeln (Ist)

Eine SQL-Anweisung zählt alle Ausbildungen auf einmal (`src/lib/catalog/content-stats.ts`, kein N+1). Jede Zahl hängt an der Katalogspalte der eigenen Tabelle, nie an einem Join, der Zeilen vervielfachen könnte.

| Kennzahl       | Zählregel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Komponenten    | **Kurse der Ausbildung:** Zeilen in `courses` mit `training_catalog_id` der Ausbildung, ohne Join. Dieselbe Zahl und dieselbe Bezeichnung wie die Zeile "Komponenten" in der Karte "Inhalte von ... freigeben oder sperren". **Nicht** die Zeilen in `training_components` (siehe unten)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Enabler        | Zeilen in `enablers` der Ausbildung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Szenarien      | **Enabler mit Szenario, nie Dokumentzeilen.** Der KfBM-Import schreibt bis zu drei Zeilen je Szenario (Ausgangssituation, Lösung, Fachwissen), gezählt wird ein Enabler einmal. Ein Enabler hat ein Szenario, wenn er eine Dokumentzeile am Enabler (ohne Use Case, ohne Organisation: das Dokument einer Organisation ist deren eigenes und kein Plattforminhalt) hat vom Typ `EXERCISE` (die Szenario-Dokumente der Plattform) oder vom Typ `TRAINEE_QUESTION` oder `TRAINER_SOLUTION` mit Titel `Szenario <Enabler-Code>: ...` (Import), oder wenn `enablers.scenario_pdf_url` gefüllt ist (altes Einzel-PDF, nur Leerzeichen zählen nicht) |
| Use Cases      | Zeilen in `use_cases` der Ausbildung (die Inhalts-Use-Cases am Enabler). **Nicht** `training_use_cases`: das sind die zeitlich geplanten Aufgaben einer Komponente für die Tätigkeitsberichte, etwas anderes                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Enabler-Quizze | `quizzes` vom Typ `LESSON` der Ausbildung (je Enabler drei: LOW, MEDIUM, HIGH)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Global-Quizze  | `quizzes` vom Typ `GLOBAL` der Ausbildung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Lernfelder     | Zeilen in `training_catalog_learning_fields` der Ausbildung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Fragen gesamt  | alle `questions` der Quizze der Ausbildung (Zusatz, ohne Soll)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Zuordnungen    | Zeilen in `training_catalog_content_mappings` der Ausbildung (Enabler und Use Cases zu Lernfeldern, Zusatz, ohne Soll)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| aktiv, inaktiv | bei Enablern, Use Cases, Enabler-Quizzen und Global-Quizzen: `is_active` ist wahr. Inaktiv ist Ist minus aktiv. Komponenten, Szenarien und Lernfelder haben keine eigene Aktivierung                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Komponente und Kurs.** In der Anwendung heißt ein Lernbaustein "Komponente" (Anzeige) und ist technisch ein Kurs (`courses`). Ein Kurs gehört zu höchstens einer Zeile in `training_components` (`courses.training_component_id`, je Komponente höchstens ein Kurs). Die Tabelle `training_components` ist der Phasenplan (Ausbildungsrahmenplan): Komponente mit Zeitrichtwert in Wochen und Stunden, Phase, Art (Pflicht, Wahl, integrativ) und Reihenfolge. Daran hängen die geplanten Aufgaben für die Tätigkeitsberichte (`training_use_cases`) und die Zuweisung der Azubis nach Phasenplan. Eine Ausbildung kann Kurse ohne eine einzige Zeile im Phasenplan haben: FIAE hat 26 Kurse und keine Zeile in `training_components`. Würde die Statistik die Zeilen des Phasenplans zählen, zeigte FIAE 0 Komponenten, während die Freigabe-Karte 26 nennt. Bei KfBM sind beide Zahlen 27, weil der Import je Komponente des Phasenplans genau einen Kurs anlegt.

Erwartete Werte KfBM nach dem Import: 27 Komponenten (Kurse), 226 Enabler, 225 Szenarien, 225 Use Cases, 678 Enabler-Quizze, 27 Global-Quizze. Mit den Soll-Werten 226 für Szenarien und Use Cases zeigt die Seite je eine fehlende Einheit. Erwartete Werte FIAE (Stand der Preview): 26 Komponenten (Kurse), 189 Enabler, davon 138 mit Szenario-Dokument.

## Soll-Werte

- Ablage: `training_catalogs.settings.content_targets` (jsonb), Schlüssel `components`, `enablers`, `scenarios`, `use_cases`, `lesson_quizzes`, `global_quizzes`, `learning_fields`. Ganze Zahlen von 0 bis 100000. Das Zod-Schema (`src/lib/catalog/content-targets.ts`, eingebunden in `catalogSettingsSchema`) verweigert unbekannte Schlüssel und alle anderen Werte.
- Kein Standard: Ein fehlender Schlüssel heißt "kein Soll" (Anzeige "kein Soll", Status `no_target`).
- Wirksames Soll: Die Statistik rechnet mit der manuellen Zahl, sonst mit der Zahl eines hochgeladenen Plan-Dokuments, sonst ohne Soll (siehe "Plan-Dokument" unten). Die manuellen Werte bleiben unverändert und haben immer Vorrang.
- Ändern: `PUT /api/admin/catalogs/[catalogId]/content-targets` mit `{ "targets": { "enablers": 226, "scenarios": null } }`. Der Aufruf ersetzt die ganze Menge, ein fehlender Schlüssel oder `null` heißt "kein Soll". Die Änderung ist eine Anweisung (`jsonb_set` auf `settings`), die übrigen Einstellungen bleiben unberührt, eine leere Menge entfernt den Schlüssel.
- Das Formular dafür liegt auf der Statistikseite (Schaltfläche "Soll-Werte bearbeiten" je Ausbildung, nur für den Plattform-Admin). Ein Formular zum Anlegen einer Ausbildung gibt es in der Anwendung nicht, Ausbildungen entstehen über Migrationen und Importe. Wer eine Ausbildung anlegt, trägt danach hier die Soll-Werte ein.

## Status

| Status      | Bedeutung                             | Anzeige                                |
| ----------- | ------------------------------------- | -------------------------------------- |
| `met`       | Ist gleich Soll                       | Häkchen, "erfüllt"                     |
| `missing`   | Ist kleiner als Soll                  | Warnzeichen, "fehlt", Abweichung < 0   |
| `exceeds`   | Ist größer als Soll                   | Pfeil, "mehr als Soll", Abweichung > 0 |
| `no_target` | kein Soll gesetzt oder nicht sichtbar | Minuszeichen, "kein Soll"              |

Die Abweichung ist Ist minus Soll. Der Fortschritt wird abgerundet (225 von 226 zeigt 99 Prozent, nie 100). Farbe ist nie der einzige Hinweis: Symbol und Text stehen immer dabei.

## Prüfung

- `tests/unit/lib/catalog/content-stats-pg.test.ts` zählt gegen ein lokales Wegwerf-Postgres (Variable `CONTENT_STATS_TEST_DB`, optional `CONTENT_STATS_TEST_SCHEMA=public_preview` und `CONTENT_STATS_TEST_APP_DB` für die Rolle `app_preview`). Ohne die Variable wird der Test übersprungen, gehostete Hosts werden verweigert.
- `tests/integration/api/admin/content-stats.test.ts` prüft Berechtigungen und Mandantentrennung der beiden Routen.

## Plan-Dokument (optional)

Zusätzlich zur manuellen Eingabe der Soll-Zahlen kann der Plattform-Admin je Ausbildung ein Dokument hochladen, das die Hierarchie des Berufes beschreibt: Gesamtzahlen, Komponenten mit ihren Zahlen, Lernfelder, Beziehungen und freie Hinweise. Alles daran ist freiwillig. Es gibt keine Migration, der bestätigte Plan liegt in `training_catalogs.settings.content_plan`.

### Vorrang: manuell, sonst Plan, sonst kein Soll

Ein Plan ersetzt oder ändert nie die manuellen Zahlen. Je Kennzahl gilt das wirksame Soll (`effectiveTargets(catalog)` in `src/lib/catalog/content-plan/effective.ts`):

1. die manuelle Zahl aus `content_targets`, wenn gesetzt (auch 0),
2. sonst die Zahl des Plans,
3. sonst kein Soll (nie null oder 0 aus Mangel an Angaben).

Der Plan liefert eine Zahl, wenn die Gesamtzahl im Plan steht. Fehlt sie, wird nur dort abgeleitet, wo der Plan die Teile aufführt: die Zahl der Komponenten und der Lernfelder aus den Listen, die Summe über die Komponenten nur dann, wenn jede Komponente ihren Teil nennt (eine Lücke würde die Summe zur Vermutung machen). Die Statistikseite zeigt je Soll ein kleines Etikett mit der Herkunft ("manuell" oder "Plan") und, wo manuelle Zahl und Plan beide da sind und sich unterscheiden, den Hinweis "Manuell 226, laut Plan 225. Die manuelle Zahl gilt." Das Formular "Soll-Werte bearbeiten" zeigt nur die manuelle Zahl, damit eine Planzahl nicht versehentlich als manuelle gespeichert wird.

### Plan-Modell

`src/lib/catalog/content-plan/types.ts` (Zod, strikt, alles optional, Zahlen begrenzt, nie null):

| Teil            | Felder                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `totals`        | `components`, `enablers`, `scenarios`, `useCases`, `lessonQuizzes`, `globalQuizzes`, `learningFields` (ganze Zahlen 0 bis 100000), `questionsPerQuiz` (1 bis 200), `hours` (0 bis 20000) |
| `components`    | je Komponente `code` oder `title` (eines muss stehen), `phase` (1 oder 2), `kind` (pflicht, wahl, integrativ), `hours`, `weeks`, `enablers`, `scenarios`, `useCases`, `quizzes`, `globalQuiz`, `order`, `learningFields` (Liste von Codes), höchstens 100 Komponenten |
| `learningFields`| `code` oder `title`, `hours` (Zeitrichtwert), höchstens 100                                                                                                               |
| `relations`     | `type` (`component_learning_field`, `enabler_learning_field`, `use_case_enabler`), `from`, `to` als Codes, höchstens 2000                                                  |
| `notes`         | Freitext-Hinweise, höchstens 20 mal 500 Zeichen                                                                                                                           |

Gespeichert wird `{ plan, source }`. Die Quelle (`source`) hält nur Dateiname (ohne Pfad), Zeit, Anzahl der Felder und die Art des Lesens (`script` oder `ki`), nie den Inhalt der Datei. Plan und Quelle zusammen sind höchstens 200 KB als JSON (das Zod-Schema `storedContentPlanSchema`, eingebunden in `catalogSettingsSchema`, verweigert mehr). Die Datei selbst wird nicht gespeichert.

### Vorlage (Stufe 1: Skript)

`GET /api/admin/catalogs/[catalogId]/content-plan/template?format=xlsx|json` liefert die Vorlage mit erfundenen Beispielzeilen und einer Spaltenerklärung (Blatt "Anleitung" in der Excel-Datei, Schlüssel `_anleitung` in der JSON-Datei). Die Excel-Vorlage wird mit der vorhandenen Bibliothek `xlsx` erzeugt, ein Test macht den Rundlauf Vorlage, Lesen, gleicher Plan.

Gelesen werden xlsx, csv und json (`src/lib/catalog/content-plan/read-structured.ts`), ohne KI. Die Excel-Datei geht durch den sicheren Leser des Inhalts-Uploads (`read-xlsx.ts`: Größe, Zip, Makros, Verknüpfungen), nie durch einen eigenen Parser.

| Blatt (xlsx) oder Abschnitt `# Name` (csv) | Spalten                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Gesamt                                     | Kennzahl, Wert (Komponenten, Enabler, Szenarien, Use Cases, Lektionsquizze, Global-Quizze, Lernfelder, Fragen je Quiz, Stunden gesamt) |
| Komponenten                                | Code, Titel, Phase, Art, Stunden, Wochen, Enabler, Szenarien, Use Cases, Quizze, Global-Quiz (ja oder nein), Reihenfolge, Lernfelder (durch Komma) |
| Lernfelder                                 | Code, Titel, Stunden                                                                                           |
| Beziehungen                                | Art (Komponente-Lernfeld, Enabler-Lernfeld, UseCase-Enabler), Von, Nach                                        |
| Hinweise                                   | ein Hinweis je Zeile                                                                                           |

Regeln: Eine leere Zelle heißt "nicht angegeben". Eine Zeile, deren erste Zelle mit `#` beginnt, wird nicht gelesen. Die Blattnamen werden ohne Rücksicht auf Groß- und Kleinschreibung erkannt (auch Aliase wie "Gesamtzahlen"), eine CSV ohne Abschnitte wird an der Kopfzeile erkannt, Trennzeichen Semikolon, Komma oder Tabulator. Die JSON-Datei hat die Form des Plan-Modells, Schlüssel mit führendem Unterstrich werden nicht gelesen. Was nicht lesbar ist (keine Zahl, außerhalb der Grenzen, unbekanntes Feld), wird mit seiner Stelle gemeldet und ausgelassen. Die unveränderte Vorlage wird erkannt (Hinweis `EXAMPLE_TEMPLATE`, nichts vorgewählt).

### KI (Stufe 2: nur Word und PDF, nur auf Wunsch)

`src/lib/catalog/content-plan/read-ki.ts`. Word und PDF (Fließtext, Tabellen, Rahmenplan) liest die KI nur, wenn die Person es nach einem Hinweis bestätigt (`ki=true`). Es gilt, wie im Inhalts-Upload:

- Nur Sokrates (`https`, Positivliste der Hosts), kein Fremdanbieter, kein Ausweichen. Der Schalter ist `CONTENT_UPLOAD_KI_ENABLED`, die KI-Stufe läuft nur dort, wo auch der Inhalts-Upload läuft (nicht in der Produktion). Excel, CSV und JSON gehen überall.
- Der Text wird bereinigt, personenbezogene Muster und Links werden ersetzt, ein Text mit Formulierungen an ein Modell wird nicht gesendet (Wächter). Die Anfrage steht zwischen Markierungen mit zufälliger Kennung. Höchstens 4 Anfragen mit je 10000 Zeichen je Dokument, der Rest wird nicht gelesen und als solcher gemeldet.
- Die KI erfindet nichts: Jede Angabe kommt mit einer Fundstelle, einem kurzen wörtlichen Zitat (höchstens 160 Zeichen). Die Prüfung verwirft ein Feld, wenn die Fundstelle fehlt, nicht im gesendeten Text steht, der Wert (Zahl, Code, Titel, Phase, Art) nicht in der Fundstelle steht, der Code der Komponente oder des Lernfeldes nicht im Text steht oder der Wert außerhalb der Grenzen des Plan-Modells liegt. Was verworfen wurde, wird gezählt und mit Stelle gemeldet.
- Die Antwort wird nie ausgeführt, gespeichert oder weitergegeben, sie wird nur zu einem Vorschlag. Er ist als "KI-Einschätzung, bitte prüfen" gekennzeichnet.
- Kostenbremse und Schutzschalter (`plan-budget.ts`, die Regeln aus `ki/budget.ts`): höchstens 40 Aufrufe je Stunde, 150 je 24 Stunden, 4 je Dokument. Nach drei Fehlern in Folge pausiert die Stufe zehn Minuten. Der Zähler liegt im Speicher des Serverprozesses (kein eigenes Tabellenschema, keine Migration), er ist eine Bremse und kein genauer Zähler.

Grenzen der KI: Sie liest nur Text. Gescannte PDFs ohne Text, Bilder und verschlüsselte oder mit Makros versehene Dateien werden abgelehnt. Tabellen werden zeilenweise als Text gelesen, über Seitengrenzen hinweg geht der Zusammenhang der Kopfzeile verloren. Eine Zahl, die das Dokument nicht nennt, sondern nur aus anderen ergibt, wird nicht eingetragen.

### Routen

Alle nur für den Plattform-Admin (`requireCurriculumEditor`), Organisations-Admins sehen weder Plan noch Soll.

| Route                                                   | Aufgabe                                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET .../content-plan`                                  | gespeicherter Plan mit Quelle                                                                                                                   |
| `PUT .../content-plan`                                  | bestätigten Plan speichern (`{ plan, fileName, method }`, Zeit und Feldzahl setzt der Server, leerer Plan 400, über 200 KB 413)                  |
| `DELETE .../content-plan`                               | Plan entfernen, die manuellen Soll-Zahlen bleiben                                                                                               |
| `POST .../content-plan/parse`                           | Datei lesen, multipart mit einer Datei (docx, xlsx, csv, json, pdf, bis 5 MB) und optional `ki=true`. Typ (Endung und erste Bytes) und Größe prüft der Server, die Katalog-Id wird geprüft. Antwort ist ein Vorschlag mit Fundstellen, gespeichert wird nichts |
| `GET .../content-plan/template`                         | Vorlage herunterladen                                                                                                                           |

### Oberfläche

`ContentPlanPanel` (`src/components/admin/ContentPlanPanel.tsx`) hängt mit einer Zeile je Ausbildung in der Statistikseite, zugeklappt, der gespeicherte Plan wird erst beim Öffnen geladen. Ablauf: Vorlage herunterladen, Datei hochladen (Ziehen und Ablegen oder Dateiwahl, auch per Tastatur), bei Word und PDF erst die Bestätigung für die KI, dann der Vorschlag als Tabelle mit Haken je Feld, änderbarem Wert und Fundstelle, "Übernehmen" und "Verwerfen". Geänderte Werte werden vor dem Speichern wie in einem Leser erneut geprüft. Der gespeicherte Plan zeigt Quelle, Datum und Anzahl der Felder und lässt sich nach einer Rückfrage entfernen. Die Texte stehen im Block `_comment.content_plan` am Ende von `de.json` und `en.json`.

### Plan-Prüfung

`planFindings(catalogId): Promise<Finding[]>` in `src/lib/catalog/content-plan/plan-check.ts` liefert Befunde der Quelle `plan` (Typen in `src/lib/catalog/content-check/types.ts`). Das Ist zählt allein `content-stats.ts` (die Regel "Enabler hat ein Szenario" steht als `enablerHasScenarioSql` an einer Stelle und gilt auch je Komponente). Verglichen werden Ist und wirksames Soll je Kennzahl, je Komponente die Zahl der Enabler, Szenarien, Use Cases und Quizze sowie das Global-Quiz, fehlende und überzählige Komponenten (Zuordnung nach Code, dann nach gleichem Titel, nach ähnlichem Titel nur bei eindeutigem Treffer, der dann als Info gemeldet wird), Stunden je Komponente und gesamt gegen den Phasenplan, Lernfelder gegen die geplanten und die Beziehungen (Komponente zu Lernfeld, Enabler zu Lernfeld, Use Case zu Enabler) gegen die Zuordnungen. Schweregrad: fehlende Einheiten `warning`, bei mehr als 10 Prozent der geplanten Menge `error`, überzählige `info`. Ohne Plan und ohne Soll gibt es nur eine Info-Meldung.

### Datenschutz

Das Plan-Dokument enthält Planungsdaten der Plattform und keinen Personenbezug. Trotzdem geht der Text nur an Sokrates, nie an einen Fremdanbieter, personenbezogene Muster werden vorher ersetzt, die Datei wird nicht gespeichert, nur der bestätigte Plan mit seiner Quelle. Weder Dateiname noch Inhalt stehen in Protokollen.

### Prüfung des Plan-Dokuments

`tests/unit/lib/catalog/content-plan/*` (Modell, Zeilen, Vorlage-Rundlauf und Leser je Format, KI-Stufe mit gefälschtem Client, wirksames Soll, Plan-Prüfung), `tests/integration/api/admin/content-plan.test.ts` (Rechte, Typ, Größe, Katalog-Id, KI nur auf Wunsch) und `tests/unit/components/admin/ContentPlanPanel.test.tsx`.
