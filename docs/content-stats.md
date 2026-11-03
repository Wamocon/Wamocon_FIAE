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

## Inhaltsprüfung

Zu jeder Ausbildung gehört auf der Statistikseite ein Abschnitt "Inhaltsprüfung" (Komponente `src/components/admin/ContentCheckPanel.tsx`). Er prüft die Inhalte der Ausbildung auf Fehler, Auffälligkeiten und Abweichungen vom Plan. Es gibt keine Migration und keine Speicherung: Die Prüfung läuft bei jedem Klick neu, der Bericht liegt nur im Browser und lässt sich als JSON oder CSV herunterladen.

**Wer.** Nur der Plattform-Admin (`requireCurriculumEditor`, wie die Soll-Werte). Der Abschnitt steht nur auf den Karten, auf denen auch die Soll-Werte bearbeitbar sind. Organisations-Admins sehen ihn nicht und bekommen von der Route 403, weil die Prüfung Soll und Planung enthält. Trainer und Azubis bekommen 403, ohne Sitzung gibt es 401.

**Ablauf.** `POST /api/admin/catalogs/[catalogId]/content-check` mit `{ "ki": false }` oder `{ "ki": true }` (der Body ist optional, ohne Body läuft nur das Skript). Die Antwort ist der Bericht (`ContentCheckReport`, Typen in `src/lib/catalog/content-check/types.ts`): Befunde mit Schweregrad (`error`, `warning`, `info`), Quelle (`script`, `ki`, `plan`), Kategorie, Zusammenfassung, Details, Empfehlung und den betroffenen Objekten (`refs`, höchstens 20 je Befund, die Gesamtzahl steht in `details`), dazu Zähler, welche Teile liefen, und Anmerkungen zum Lauf. Zeitlimit der Route 60 Sekunden, Ratenbegrenzung je Person (Skript 20 je Minute, KI 5 je 10 Minuten), je Ausbildung höchstens ein KI-Lauf gleichzeitig (sonst 409 `KI_RUNNING`).

**Lesen.** Je Ausbildung zehn Anweisungen, eine je Regelgruppe (Ausbildung, Kurse, Enabler, Use Cases, Quizze, Fragen, Dokumente, Lernfelder, Zuordnungen, Phasenplan) und eine für die Statistik (damit die Zählregeln dieselben sind wie oben). Jede ist über die Katalogspalte der eigenen Tabelle an die Ausbildung gebunden, keine Anweisung je Enabler oder Quiz, nur lesend (`src/lib/catalog/content-check/snapshot.ts`).

### Regeln der Skriptprüfung

Schweregrad: **Fehler** bricht an, was der Azubi sieht oder tut. **Warnung** ist eine Lücke oder Unstimmigkeit, die ein Mensch ansehen soll. **Hinweis** kann Absicht sein. Eine Regel liefert höchstens einen Befund je Ausbildung, mit den betroffenen Objekten als Liste (`src/lib/catalog/content-check/script-checks.ts`).

| Regel | Schweregrad | Was geprüft wird |
| --- | --- | --- |
| `course.enabler.missing` | Fehler | Komponente (Kurs) ohne Enabler |
| `enabler.course.missing` | Fehler | Enabler, dessen Kurs fehlt (durch den Fremdschlüssel nur bei einem Datenfehler möglich) |
| `enabler.catalog.mismatch` | Fehler | Enabler mit anderem `training_catalog_id` als sein Kurs |
| `quiz.catalog.mismatch`, `usecase.catalog.mismatch` | Fehler | Quiz oder Use Case in einer anderen Ausbildung als der Enabler, mit dem sie verbunden sind |
| `component.course.missing` | Warnung | Komponente des Phasenplans (`training_components`) ohne Kurs, nur wo überhaupt Kurse mit Komponenten verbunden sind (FIAE hat keine Zeile im Phasenplan, dort entfällt die Regel) |
| `enabler.usecase.missing` | Warnung | Enabler ohne Use Case (entfällt, wenn die Ausbildung gar keinen Use Case hat) |
| `usecase.enabler.missing` | Warnung | Use Case ohne Enabler |
| `enabler.order.duplicate`, `usecase.order.duplicate` | Warnung | dieselbe `order_index` bei mehreren Enablern oder Use Cases desselben Kurses |
| `enabler.order.gap`, `usecase.order.gap` | Hinweis | Nummer fehlt in der Reihenfolge eines Kurses (kann gewollt sein) |
| `course.inactive.activeEnablers` | Warnung | Kurs nicht freigegeben, enthält aber aktive Enabler |
| `enabler.inactive`, `usecase.inactive`, `quiz.inactive` | Hinweis, Warnung ab einem Viertel inaktiv in einer aktiven Ausbildung | inaktive Inhalte im Verhältnis zu allen |
| `enabler.quiz.missing` | Fehler | Enabler ohne alle drei Lektionsquizze (LOW, MEDIUM, HIGH), das Objekt nennt die fehlenden Stufen |
| `quiz.empty` | Fehler | Quiz ohne Fragen |
| `question.correct.missing` | Fehler | Frage mit Auswahlantworten ohne richtige Antwort (Freitextfragen sind ausgenommen) |
| `question.options.few` | Warnung | Auswahlfrage mit weniger als zwei Antworten |
| `question.correct.multiple` | Hinweis | mehr als eine richtige Antwort (bei Einfachauswahl ein Hinweis, kein Fehler) |
| `question.text.empty`, `question.option.empty` | Fehler | Frage ohne Text, Antwort ohne Text |
| `question.duplicate` | Warnung | dieselbe Frage (Groß- und Kleinschreibung, Leerzeichen egal) zweimal im selben Quiz, genannt wird die zweite Kopie |
| `enabler.theory.missing` | Warnung | Enabler ohne Theoriedokument (`THEORY`) |
| `enabler.scenario.missing` | Warnung | Enabler ohne Szenario, nach der Zählregel der Statistik (siehe oben) |
| `scenario.part.gap` | Warnung | Szenario-Teile mit Lücke in der Nummerierung (Part 1, 2, 4) |
| `usecase.task.missing`, `usecase.solution.missing` | Warnung | Use Case ohne Aufgabendokument (`TRAINEE_QUESTION`) oder ohne Trainerlösung (`TRAINER_SOLUTION`) |
| `document.file.missing` | Fehler | Dokument ohne Datei und ohne Text (der KfBM-Import legt die Szenario-Teile als Text in der Beschreibung ab, ohne Datei, das zählt nicht) oder ohne Dateinamen |
| `document.copy.suspected` | Hinweis | Dokumente derselben Art mit gleicher Größe und gleicher Seitenzahl in verschiedenen Enablern (mögliche Kopie, Vorbild `scripts/import/fiae-copy-check.mjs`, aber ohne Prüfsumme) |
| `title.empty` | Fehler | leerer Titel (Kurse, Enabler, Use Cases, Dokumente, Quizze, Lernfelder) |
| `title.encoding` | Fehler | kaputte Zeichen im Titel (Ersatzzeichen, UTF-8 als Latin-1 gelesen) |
| `title.glued` | Warnung | zusammengeklebte Wörter (Kleinbuchstabe direkt vor Großbuchstabe im Wort, zum Beispiel "gestaltenInhaltsverzeichnis"). Eigennamen stehen auf der Ausnahmeliste `GLUED_WORD_EXCEPTIONS` in `title-rules.ts` und werden nicht gemeldet. Meldet die Regel einen Eigennamen, kommt er auf diese Liste |
| `title.duplicate` | Warnung | gleicher Titel im selben Zusammenhang (Enabler im Kurs, Use Case im Kurs, Dokument am Enabler, Quiz am Enabler). Kurstitel werden nicht verglichen, denn Grundkurs und Vertiefung heißen gleich |
| `description.equalsTitle` | Hinweis | Beschreibung gleich Titel (Enabler, Use Case) |
| `enabler.learningField.missing`, `usecase.learningField.missing` | Warnung | ohne Zuordnung zu einem Lernfeld, nur wo die Ausbildung überhaupt Zuordnungen hat |
| `learningField.empty` | Hinweis | Lernfeld ohne zugeordneten Inhalt |
| `plan.target.<Kennzahl>` | Warnung bei "fehlt", Hinweis bei "mehr" | Ist weicht vom Soll (`content_targets`) ab, Quelle `plan`, Zahlen aus derselben Zählung wie die Statistik |
| `plan.hours.weeks` | Warnung | Stunden einer Komponente passen nicht zu den Wochen (Stunden gleich Wochen mal 40), Quelle `plan` |
| `plan.hours.phase` | Warnung | Summe der Wochen der Pflichtkomponenten einer Phase gegen die Länge der Phase (`phase_months`, Monate mal 52 durch 12), Toleranz zwei Wochen. Zu wenig Wochen zählen nur, wo es keine Wahlkomponenten gibt (bei KfBM füllen sie den Rest), Quelle `plan` |

**Bewusst nicht geprüft.** Ob die Datei eines Dokuments im Speicher liegt: Der Speicherzugriff (`src/lib/storage/contentRead.ts`) kann nur herunterladen, ein Download aller Dateien wäre für eine Admin-Seite viel zu schwer. Ob Dokumente byte-gleich sind: `content_documents` hat keine Prüfsumme, deshalb nur der Hinweis `document.copy.suspected`. Beides steht in jedem Bericht als Anmerkung.

### KI-Prüfung

Auf Knopfdruck ("Prüfen mit KI") liest Sokrates Stichproben und nennt Auffälligkeiten, die keine Regel sieht: ein Szenario, das nicht zum Thema des Enablers passt, Widersprüche, Fehler in Titeln und Texten, Rechtschreibfehler im Titel, auffällige Lücken in der Folge der Themen, dasselbe Thema in anderer Formulierung (`src/lib/catalog/content-check/ki-review.ts`, Eingabe in `ki-input.ts`).

- **Schranken wie beim Inhalts-Upload, aus denselben Bausteinen.** Nur Sokrates, kein Fremdanbieter: Konfiguration über `loadKiConfig` (aus `src/lib/content-upload/ki/config.ts`: https, Positivliste der Hosts, Schlüssel nur aus der Umgebung, kein Rückfall auf einen anderen Anbieter), derselbe Client (`client.ts`: keine Wiederholung im Aufruf, keine Weiterleitung, kein Protokoll), derselbe Wächter (`guard.ts`: Form, Länge, Markierungswörter einer Lösung, Anweisungstext, Personenmuster) unmittelbar vor jedem Aufruf, dieselbe Bremse (`budget.ts`: Aufrufe je Lauf und je Tag, Schutzschalter nach fünf Fehlern in Folge). Die KI-Prüfung läuft nur, wo der Inhalts-Upload läuft (`contentUploadAvailability`: nicht in Production) und nur mit `CONTENT_UPLOAD_KI_ENABLED=true` und gesetztem `OPENAI_COMPATIBLE_API_KEY`. Den Modellnamen bestimmt `OPENAI_COMPATIBLE_MODEL` (bei Sokrates `sokrates-fast`, der Standardname existiert dort nicht).
- **Was die KI sieht.** Je Komponente ein Auszug von höchstens 2500 Zeichen: Titel der Komponente und der Enabler, Szenario-Titel (Dokumente vom Typ `EXERCISE`), Use-Case-Titel und der Kopf der Beschreibung eines Enablers (höchstens 140 Zeichen, nur wenn er mehr sagt als der Titel). Eine Komponente mit vielen Enablern wird auf mehrere Auszüge verteilt. Gekürzte Texte enden mit "…", die Anweisung sagt der KI, dass das kein Fehler ist.
- **Was nie hinausgeht.** Dokumentinhalte (Szenariotexte nennen Personen, Lösungstexte dürfen die Plattform gar nicht verlassen), Dateinamen und Pfade, Ids und Codes der Datenbank, Nutzer, Organisationen, Schlüssel. Jeder Text läuft durch dieselbe Bereinigung wie im Upload (Personenmuster werden ersetzt, Texte mit Lösungsmarkierung oder Anweisungswortlaut gar nicht gesendet, Ersatz "(Text nicht gesendet)"). Fehlende Dokumente, Quizze und Enabler sind kein Thema der KI, das prüft das Skript.
- **Antwort.** Genau ein JSON-Objekt nach festem Schema, geprüft mit zod. Die KI nennt Objekte nur über Kürzel der Anfrage (K für die Komponente, E1, E2 für die Enabler), ein erfundenes Kürzel wird verworfen, ebenso Hinweise mit weniger als 40 Prozent Sicherheit und mehr als fünf Hinweise je Auszug. Die Begründung wird bereinigt (keine Links, kein Markup, keine Personenmuster) und auf 200 Zeichen gekürzt, die Sicherheit liegt bei höchstens 0,8. Eine Antwort wird nie ausgeführt oder gespeichert.
- **Schweregrad.** Ein KI-Befund ist nie ein Fehler: höchstens `warning`, Rechtschreibung `info`. Die Zusammenfassung beginnt mit "KI-Einschätzung", die Oberfläche kennzeichnet ihn mit Symbol, Text und gestrichelter Linie, die Empfehlung lautet, dass ein Mensch prüft. Die KI behauptet, ein Mensch entscheidet.
- **Budget.** Je Lauf höchstens `CONTENT_CHECK_KI_MAX_CALLS` Aufrufe (Standard 30, 0 bis 60) und `CONTENT_CHECK_KI_MAX_TOKENS` Tokens (Standard 60000, geschätzt vor dem Aufruf, nach der Antwort mit den echten Zahlen), dazu die Grenzen des Uploads (`CONTENT_UPLOAD_KI_MAX_CALLS_PER_RUN`, `CONTENT_UPLOAD_KI_MAX_CALLS_PER_DAY`, der Tageszähler gilt je Serverinstanz), vier Aufrufe gleichzeitig und 40 Sekunden für den ganzen Lauf. Ist eine Grenze erreicht, hört der Lauf auf und sagt es in den Anmerkungen ("Die KI hat 9 von 27 Auszügen geprüft (Stichprobe, jeder Lauf wählt neu)"). Weil ein Aufruf bei Sokrates 10 bis 20 Sekunden dauert, prüft ein Lauf nur einen Teil der Komponenten, in zufälliger Reihenfolge: Mehrere Läufe decken mehr ab.
- **Kein Lauf ohne Schalter.** Ohne `{ "ki": true }` im Aufruf, ohne `CONTENT_UPLOAD_KI_ENABLED`, ohne Schlüssel oder mit einer Adresse außerhalb der Positivliste wird nichts gesendet, der Bericht sagt in den Anmerkungen, warum die KI nicht lief.

### Vergleich mit dem Plan-Dokument

Der Teil mit der Quelle `plan`, der ein hochgeladenes Plan-Dokument auswertet, kommt als Funktion `planFindings(catalogId)` aus `src/lib/catalog/content-plan/plan-check.ts`. Die Inhaltsprüfung lädt sie über `src/lib/catalog/content-check/plan-hook.ts`, wenn die Datei existiert, sonst fehlt der Teil und der Bericht sagt "Plan: nicht gelaufen". Die Abweichungen vom Soll und die Stunden des Phasenplans (Quelle `plan`) kommen aus der Skriptprüfung und brauchen die Datei nicht.

### Bericht herunterladen

JSON (der Bericht, wie er kam) und CSV (eine Zeile je Befund, Semikolon, UTF-8 mit Markierung für Excel, Texte in der Sprache der Oberfläche, Zellen, die mit `=`, `+`, `-` oder `@` beginnen, bekommen ein Hochkomma davor). Beides entsteht im Browser, es geht nichts an den Server.

### Prüfung und Abnahmefälle

- Tests: `tests/unit/lib/catalog/content-check/` (Regeln mit kleinem Datensatz, Lesen der Anweisungen, KI mit gefälschtem Client: gültige und ungültige Antwort, Budget, Zeitlimit, Schutzschalter, erlaubte Felder der Anfrage, Begrenzung des Schweregrads, Einhängepunkt für den Plan, Export), `tests/unit/components/admin/ContentCheckPanel.test.tsx` (Oberfläche), `tests/integration/api/admin/content-check.test.ts` (Berechtigungen, Ratenbegrenzung, Sperre je Ausbildung). Die Route steht in `tests/helpers/guardedRoutes.ts`.
- Ein eigener Testplan für Admin-Seiten existiert nicht (`docs/hai-testplan.md` gilt dem HAI), die Fälle für den Test in der Preview stehen deshalb hier:

| Nr | Rolle | Schritt | Erwartung |
| --- | --- | --- | --- |
| P1 | Plattform-Admin | Inhaltsstatistik öffnen | je Ausbildung ein Abschnitt "Inhaltsprüfung" mit "Prüfen" und "Prüfen mit KI", Hinweis "Noch keine Prüfung gestartet", noch kein Abruf |
| P2 | Plattform-Admin | "Prüfen" bei FIAE | Ladehinweis, danach Befunde nach Fehler, Warnung, Hinweis gruppiert (Hinweise zugeklappt), Kategorien, Zähler, "Skript: gelaufen", "KI: nicht angefordert" |
| P3 | Plattform-Admin | einen Befund öffnen (Pfeil oder Eingabetaste auf dem Titel) | Details, Empfehlung und betroffene Objekte erscheinen, höchstens 20, die Gesamtzahl steht in den Details |
| P4 | Plattform-Admin | Filter "Plan" und "Skript" | nur Befunde dieser Quelle, Zähler an den Knöpfen stimmen, bei leerer Quelle "Keine Auffälligkeiten aus dieser Quelle" |
| P5 | Plattform-Admin | Download JSON und CSV | Dateien `inhaltspruefung-<Code>-<Datum>.json` und `.csv`, CSV öffnet in Excel mit Umlauten, eine Zeile je Befund |
| P6 | Plattform-Admin | "Prüfen mit KI", Schalter der Umgebung aus | Bericht mit Anmerkung "KI-Prüfung nicht gelaufen: ... nicht eingeschaltet", "KI: nicht gelaufen", kein Aufruf an Sokrates |
| P7 | Plattform-Admin | "Prüfen mit KI", Schalter an | nach 10 bis 40 Sekunden KI-Befunde mit Kennzeichnung "KI-Einschätzung" (Symbol, Text, gestrichelte Linie), nie als Fehler, Anmerkung "Die KI hat x von y Auszügen geprüft" |
| P8 | Plattform-Admin | zweimal schnell "Prüfen mit KI" bei derselben Ausbildung (zwei Tabs) | der zweite Aufruf bekommt "Für diese Ausbildung läuft schon eine KI-Prüfung" |
| P9 | Plattform-Admin | sechsmal "Prüfen mit KI" innerhalb von zehn Minuten | der sechste Aufruf bekommt "Zu viele Prüfungen in kurzer Zeit" |
| P10 | Admin einer Organisation | Inhaltsstatistik öffnen, Route `POST .../content-check` aufrufen | kein Abschnitt "Inhaltsprüfung", die Route antwortet 403 |
| P11 | Trainer, ohne Sitzung | Route `POST .../content-check` aufrufen | 403 beziehungsweise 401 |
| P12 | Plattform-Admin | Tastatur: Tab durch Knöpfe, Gruppen und Befunde | alle Knöpfe erreichbar, sichtbarer Fokus, Gruppen und Befunde mit Eingabetaste und Leertaste auf- und zuklappbar, Zustand als `aria-expanded` |
