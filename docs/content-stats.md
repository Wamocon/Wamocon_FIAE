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

## Inhaltsprüfung

Zu jeder Ausbildung gehört auf der Statistikseite ein Abschnitt "Inhaltsprüfung" (Komponente `src/components/admin/ContentCheckPanel.tsx`). Er prüft die Inhalte der Ausbildung auf Fehler, Auffälligkeiten und Abweichungen vom Plan. Der Bericht wird nicht gespeichert: Die Prüfung läuft bei jedem Klick neu, der Bericht liegt nur im Browser und lässt sich als JSON oder CSV herunterladen. Die einzige Migration dazu ist die Prüfsumme der Dokumente (`content_documents.content_sha256`, Abschnitt "Prüfsummen und Dateiprüfung"), sie ist optional: Ohne Wert in der Spalte läuft die Prüfung wie zuvor.

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
| `enabler.usecase.missing` | Warnung, sonst Hinweis | Enabler ohne Use Case. Nur dort eine Warnung mit Liste, wo die Ausbildung die 1:1-Beziehung hat (mindestens 80 Prozent der Enabler haben einen Use Case, der Rest ist eine Auffälligkeit, KfBM: 225 von 226). Sonst ein einziger Hinweis "In dieser Ausbildung hat nicht jeder Enabler einen Use Case (x von y)" ohne Liste. Entfällt, wenn die Ausbildung gar keinen Use Case hat |
| `usecase.enabler.missing` | Warnung, sonst Hinweis | Use Case ohne Enabler, dieselbe Logik spiegelbildlich: Warnung mit Liste ab 80 Prozent der Use Cases mit Enabler, sonst ein Hinweis mit der Zahl |
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
| `document.copy.identical` | Hinweis | Dokumente mit gleicher Prüfsumme (SHA-256, byte-gleich) an verschiedenen Enablern oder Use Cases, das ist der Beweis einer Kopie. Gilt nur für Dokumente mit Prüfsumme, die Prüfsumme einer leeren Datei zählt nicht |
| `document.copy.suspected` | Hinweis | Dokumente derselben Art mit gleicher Größe und gleicher Seitenzahl in verschiedenen Enablern (mögliche Kopie, Vorbild `scripts/import/fiae-copy-check.mjs`). Bleibt für Dokumente ohne Prüfsumme, Dokumente mit Prüfsumme prüft `document.copy.identical` |
| `document.storage.missing` | Fehler | Dokument, dessen Datei im Speicher fehlt. Kommt nicht aus dem Lauf der Skriptregeln, sondern vom Knopf "Dateien prüfen" (Stichprobe, siehe unten). Die Regel `document.file.missing` oben meint etwas anderes: ein Dokument, das gar keine Datei und keinen Text nennt |
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

**Bewusst nicht im Lauf der Skriptregeln.** Ob die Dateien im Speicher liegen: Ein Lauf über alle Dateien wäre für eine Admin-Seite zu schwer, deshalb gibt es dafür den Knopf "Dateien prüfen" (Stichprobe, Abschnitt unten) und das Skript `content:hash` (alle Dokumente, auf Zuruf). Byte-Gleichheit der Dokumente: Sie wird nur für Dokumente gemeldet, die eine Prüfsumme haben, für alle anderen gilt weiter der Hinweis `document.copy.suspected`. Beides steht in jedem Bericht als Anmerkung.

### KI-Prüfung

Auf Knopfdruck ("Prüfen mit KI") liest Sokrates Stichproben und nennt Auffälligkeiten, die keine Regel sieht: ein Szenario, das nicht zum Thema des Enablers passt, Widersprüche, Fehler in Titeln und Texten, Rechtschreibfehler im Titel, auffällige Lücken in der Folge der Themen, dasselbe Thema in anderer Formulierung (`src/lib/catalog/content-check/ki-review.ts`, Eingabe in `ki-input.ts`).

- **Schranken wie beim Inhalts-Upload, aus denselben Bausteinen.** Nur Sokrates, kein Fremdanbieter: Konfiguration über `loadKiConfig` (aus `src/lib/content-upload/ki/config.ts`: https, Positivliste der Hosts, Schlüssel nur aus der Umgebung, kein Rückfall auf einen anderen Anbieter), derselbe Client (`client.ts`: keine Wiederholung im Aufruf, keine Weiterleitung, kein Protokoll), derselbe Wächter (`guard.ts`: Form, Länge, Markierungswörter einer Lösung, Anweisungstext, Personenmuster) unmittelbar vor jedem Aufruf, dieselbe Bremse (`budget.ts`: Aufrufe je Lauf und je Tag, Schutzschalter nach fünf Fehlern in Folge). Die KI-Prüfung läuft nur, wo der Inhalts-Upload läuft (`contentUploadAvailability`: nicht in Production) oder wo der Schalter `CONTENT_CHECK_KI_PRODUCTION=true` sie für Production erlaubt (Abschnitt "KI-Stufen in Production"), und nur mit `CONTENT_UPLOAD_KI_ENABLED=true` (in Production mit dem Schalter ersetzt) und gesetztem `OPENAI_COMPATIBLE_API_KEY`. Den Modellnamen bestimmt `OPENAI_COMPATIBLE_MODEL` (bei Sokrates `sokrates-fast`, der Standardname existiert dort nicht).
- **Was die KI sieht.** Je Komponente ein Auszug von höchstens 2500 Zeichen: Titel der Komponente und der Enabler, Szenario-Titel (Dokumente vom Typ `EXERCISE`), Use-Case-Titel und der Kopf der Beschreibung eines Enablers (höchstens 140 Zeichen, nur wenn er mehr sagt als der Titel). Eine Komponente mit vielen Enablern wird auf mehrere Auszüge verteilt. Gekürzte Texte enden mit "…", die Anweisung sagt der KI, dass das kein Fehler ist.
- **Was nie hinausgeht.** Dokumentinhalte (Szenariotexte nennen Personen, Lösungstexte dürfen die Plattform gar nicht verlassen), Dateinamen und Pfade, Ids und Codes der Datenbank, Nutzer, Organisationen, Schlüssel. Jeder Text läuft durch dieselbe Bereinigung wie im Upload (Personenmuster werden ersetzt, Texte mit Lösungsmarkierung oder Anweisungswortlaut gar nicht gesendet, Ersatz "(Text nicht gesendet)"). Fehlende Dokumente, Quizze und Enabler sind kein Thema der KI, das prüft das Skript.
- **Antwort.** Genau ein JSON-Objekt nach festem Schema, geprüft mit zod. Die KI nennt Objekte nur über Kürzel der Anfrage (K für die Komponente, E1, E2 für die Enabler), ein erfundenes Kürzel wird verworfen, ebenso Hinweise mit weniger als 40 Prozent Sicherheit und mehr als fünf Hinweise je Auszug. Die Begründung wird bereinigt (keine Links, kein Markup, keine Personenmuster) und auf 200 Zeichen gekürzt, die Sicherheit liegt bei höchstens 0,8. Eine Antwort wird nie ausgeführt oder gespeichert.
- **Schweregrad.** Ein KI-Befund ist nie ein Fehler: höchstens `warning`, Rechtschreibung `info`. Die Zusammenfassung beginnt mit "KI-Einschätzung", die Oberfläche kennzeichnet ihn mit Symbol, Text und gestrichelter Linie, die Empfehlung lautet, dass ein Mensch prüft. Die KI behauptet, ein Mensch entscheidet.
- **Budget.** Je Lauf höchstens `CONTENT_CHECK_KI_MAX_CALLS` Aufrufe (Standard 30, 0 bis 60) und `CONTENT_CHECK_KI_MAX_TOKENS` Tokens (Standard 60000, geschätzt vor dem Aufruf, nach der Antwort mit den echten Zahlen), dazu die Grenzen des Uploads (`CONTENT_UPLOAD_KI_MAX_CALLS_PER_RUN`, `CONTENT_UPLOAD_KI_MAX_CALLS_PER_DAY`, der Tageszähler gilt je Serverinstanz), vier Aufrufe gleichzeitig und 40 Sekunden für den ganzen Lauf. Ist eine Grenze erreicht, hört der Lauf auf und sagt es in den Anmerkungen ("Die KI hat 9 von 27 Auszügen geprüft (Stichprobe, jeder Lauf wählt neu)"). Weil ein Aufruf bei Sokrates 10 bis 20 Sekunden dauert, prüft ein Lauf nur einen Teil der Komponenten, in zufälliger Reihenfolge: Mehrere Läufe decken mehr ab.
- **Kein Lauf ohne Schalter.** Ohne `{ "ki": true }` im Aufruf, ohne `CONTENT_UPLOAD_KI_ENABLED`, ohne Schlüssel oder mit einer Adresse außerhalb der Positivliste wird nichts gesendet, der Bericht sagt in den Anmerkungen, warum die KI nicht lief.

### Prüfsummen und Dateiprüfung

**Migration `20261103000200_content_documents_sha256.sql`.** Fügt `content_documents.content_sha256` hinzu (`text`, nullable, ohne Standardwert, kein Index, schreibt keinen Wert). Mit Vorprüfung (Tabelle und `storage_url` vorhanden, sonst Abbruch ohne Änderung), Nachprüfung (Typ `text`, nullable, ohne Standardwert), wiederholbar. Rückweg im Kopf der Datei: `alter table public.content_documents drop column if exists content_sha256;`, vorher die App des vorigen Releases deployen. Die Preview-Migration läuft in der CI, Rollout-Dokumente (N01, N02, Go-Checkliste, Release Notes) kennen die Datei. Die App liest die Spalte beim Prüfen der Dokumente, sie setzt die Migration also voraus (die Release-Strecke migriert vor dem Deploy).

**Skript `scripts/content/hash-documents.ts` (npm-Skript `content:hash`).** Liest je Dokument ohne Prüfsumme die Datei aus dem Speicher (`readContentObject` aus `src/lib/storage/contentRead.ts`, dieselbe Leseart wie der Server), berechnet SHA-256 und schreibt die Spalte in Blöcken (Standard 50 je Anweisung, nur Zeilen ohne Wert, ein vorhandener Wert wird nie überschrieben). Es ist rein additiv und wiederholbar. Dateiinhalte werden weder protokolliert noch aufgehoben, nur Prüfsumme und Bytezahl. Zwei Dokumente mit derselben Adresse werden einmal gelesen.

```
npm run content:hash -- --target preview                          Probelauf, zählt nur, liest keine Datei
npm run content:hash -- --target preview --limit 20               liest 20 Dateien, schreibt nichts
npm run content:hash -- --target preview --apply --confirm-host <Host der Verbindung>
npm run content:hash -- --target production --i-know-this-is-production [--apply --confirm-host <Host>]
```

Das Ziel `--target preview|production` ist nur eine Option und hat keinen Standard. Preview arbeitet auf `public_preview` und verlangt die Rolle `app_preview_migrator` (Verbindung aus `PREVIEW_IMPORT_DB_URL`). Production arbeitet auf `public` (Verbindung aus `PRODUCTION_ADMIN_DB_URL`) und verweigert jeden Lauf, auch den Probelauf, ohne `--i-know-this-is-production`. Ein echter Lauf braucht `--apply` und `--confirm-host` mit dem Host der Verbindung. Das Skript kennt weiter `--block-size`, `--concurrency`, `--max-mb` (Standard 100) und `--report-dir`.

**Bericht der Speicherprüfung.** Jeder Lauf schreibt einen JSON-Bericht (Standard im temporären Verzeichnis, Pfad am Ende der Ausgabe) mit den Zahlen (Dokumente mit Adresse, schon mit Prüfsumme, gelesen, gehasht, geschrieben, fehlend, ungültige Adresse, externe Adresse, nicht lesbar) und der Liste der Dokumente, deren Datei im Speicher fehlt (Dokument-Id, Titel, Pfad im Bucket). Eine fehlende Datei bricht den Lauf nicht ab. Ob eine Datei fehlt oder nur nicht lesbar war, entscheidet eine Existenzabfrage nach dem fehlgeschlagenen Download.

**Probelauf gegen die Preview (03.11.2026, ohne `--apply`).** 1958 Dokumente mit Adresse in `public_preview`, keines mit Prüfsumme (die Spalte gibt es dort noch nicht, die Migration läuft mit der CI dieses Branches). Eine Stichprobe von 30 zufälligen Dokumenten wurde lesend gehasht: 27 gehasht, 3 externe Adressen, keine fehlende Datei, 2,6 Sekunden. Den echten Lauf macht der Koordinator nach der Migration.

**Knopf "Dateien prüfen" (Stichprobe).** `POST /api/admin/catalogs/[catalogId]/content-check/files` (`src/lib/catalog/content-check/file-check.ts`, Funktion `checkDocumentFiles(catalogId)`). Nur auf Knopfdruck, Plattform-Admin (wie die Inhaltsprüfung), je Ausbildung höchstens ein Lauf gleichzeitig (409 `FILES_RUNNING`), zehn Läufe je Person und zehn Minuten. Sie zieht höchstens 50 zufällige Dokumente der Ausbildung (die Dokumente der Plattform, wie der Lesevorgang der Prüfung) und fragt den Speicher je Datei, ob sie existiert (HEAD-Abfrage über `storage.exists`, die Datei wird nie geladen, fünf Abfragen gleichzeitig, nach 30 Sekunden werden keine neuen mehr gestartet). Fehlende Dateien werden als Fehler `document.storage.missing` gemeldet (Titel der Dokumente, nie der Pfad, höchstens 20 genannt). Die Antwort nennt Zahl der Stichprobe, der geprüften, fehlenden und nicht beantworteten Dokumente, die Dauer in Millisekunden und Anmerkungen (Zeitlimit, Fehler des Speichers, externe Adressen). Gespeichert wird nichts. Weil es eine Stichprobe ist, kann sie fehlende Dateien übersehen, das Skript `content:hash` listet alle.

### KI-Stufen in Production

Die KI-Prüfung und der KI-Plan-Leser liefen bisher nur dort, wo der Inhalts-Upload läuft, also nicht in Production. Niko hat am 03.11.2026 entschieden: Sie kommen mit dem Produktivgang. Dafür gibt es den Schalter `CONTENT_CHECK_KI_PRODUCTION` (Umgebungsvariable, Standard aus, `src/lib/catalog/content-check/ki-availability.ts`). Nur genau `true` zählt, und nur in Production (Vercel `production` oder ein Production-Build ohne Vercel). In jeder anderen Umgebung entscheidet weiter die Regel des Inhalts-Uploads, der Schalter kann also weder eine Preview auf dem falschen Schema öffnen noch eine unbekannte Umgebung (fail closed). In Production zählt `CONTENT_UPLOAD_KI_ENABLED` mit dem Schalter als gesetzt, eine Variable genügt dort.

Was der Schalter nicht ändert: die Zugriffsprüfung (Plattform-Admin, `requireCurriculumEditor`), das Ziel (nur Sokrates: https, Positivliste der Hosts, Schlüssel aus der Umgebung, kein Rückfall), Budget, Wächter vor jeder Anfrage und Schutzschalter. Der Inhalts-Upload selbst bleibt in Production aus.

**Der Schalter ist bis zum Go in Production NICHT gesetzt und wird mit dem Produktivgang gesetzt, zusammen mit `OPENAI_COMPATIBLE_MODEL`.** Das Modell muss in Production gesetzt sein (bei Sokrates `sokrates-fast`), sonst fragt die KI nach dem Standardmodell `gpt-4o-mini`, das Sokrates nicht kennt. Der Punkt steht als V8 in `docs/go-checkliste.md`. `OPENAI_COMPATIBLE_BASE_URL` und `OPENAI_COMPATIBLE_API_KEY` sind für den HAI-Produktivgang schon vorgesehen (`docs/hai-produktivgang.md`). Tests: `tests/unit/lib/catalog/content-check/ki-availability.test.ts` (beide Zustände, Fail closed, Prüfung bleibt auf Sokrates, ohne Schlüssel und mit fremdem Host wird nichts gesendet) und die Fälle "in Production" in `tests/integration/api/admin/content-plan.test.ts`.

### Vergleich mit dem Plan-Dokument

Der Teil mit der Quelle `plan`, der ein hochgeladenes Plan-Dokument auswertet, kommt als Funktion `planFindings(catalogId)` aus `src/lib/catalog/content-plan/plan-check.ts`. Die Inhaltsprüfung lädt sie über `src/lib/catalog/content-check/plan-hook.ts`, wenn die Datei existiert, sonst fehlt der Teil und der Bericht sagt "Plan: nicht gelaufen". Die Abweichungen vom Soll und die Stunden des Phasenplans (Quelle `plan`) kommen aus der Skriptprüfung und brauchen die Datei nicht.

### Bericht herunterladen

JSON (der Bericht, wie er kam) und CSV (eine Zeile je Befund, Semikolon, UTF-8 mit Markierung für Excel, Texte in der Sprache der Oberfläche, Zellen, die mit `=`, `+`, `-` oder `@` beginnen, bekommen ein Hochkomma davor). Beides entsteht im Browser, es geht nichts an den Server.

### Prüfung und Abnahmefälle

- Tests: `tests/unit/lib/catalog/content-check/` (Regeln mit kleinem Datensatz, Lesen der Anweisungen, KI mit gefälschtem Client: gültige und ungültige Antwort, Budget, Zeitlimit, Schutzschalter, erlaubte Felder der Anfrage, Begrenzung des Schweregrads, Einhängepunkt für den Plan, Export), `tests/unit/components/admin/ContentCheckPanel.test.tsx` (Oberfläche), `tests/integration/api/admin/content-check.test.ts` (Berechtigungen, Ratenbegrenzung, Sperre je Ausbildung), `tests/unit/lib/catalog/content-check/file-check.test.ts` und `tests/integration/api/admin/content-check-files.test.ts` (Dateiprüfung), `tests/unit/content-scripts/hash-documents.test.ts` (Skript `content:hash`), `tests/unit/migrations/content-documents-sha256.test.ts` (Migration). Die Route steht in `tests/helpers/guardedRoutes.ts`.
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
| P13 | Plattform-Admin | "Dateien prüfen" | Ergebnis "x von y Dokumenten der Stichprobe geprüft (insgesamt n Dokumente mit Datei), Dauer z Sekunden", fehlende Dateien als Fehler mit Titeln, sonst "Alle geprüften Dateien liegen im Speicher.", Anmerkungen bei Zeitlimit oder Fehlern des Speichers |

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

- Nur Sokrates (`https`, Positivliste der Hosts), kein Fremdanbieter, kein Ausweichen. Der Schalter ist `CONTENT_UPLOAD_KI_ENABLED`, die KI-Stufe läuft nur dort, wo auch der Inhalts-Upload läuft (nicht in Production) oder wo `CONTENT_CHECK_KI_PRODUCTION=true` sie für Production erlaubt (Abschnitt "KI-Stufen in Production"). Excel, CSV und JSON gehen überall.
- Der Text wird bereinigt, personenbezogene Muster und Links werden ersetzt, ein Text mit Formulierungen an ein Modell wird nicht gesendet (Wächter). Die Anfrage steht zwischen Markierungen mit zufälliger Kennung. Höchstens 4 Anfragen mit je 10000 Zeichen je Dokument, der Rest wird nicht gelesen und als solcher gemeldet.
- Die KI erfindet nichts: Jede Angabe kommt mit einer Fundstelle, einem kurzen wörtlichen Zitat (höchstens 160 Zeichen). Die Prüfung verwirft ein Feld, wenn die Fundstelle fehlt, nicht im gesendeten Text steht, der Wert (Zahl, Code, Titel, Phase, Art) nicht in der Fundstelle steht, der Code der Komponente oder des Lernfeldes nicht im Text steht oder der Wert außerhalb der Grenzen des Plan-Modells liegt. Was verworfen wurde, wird gezählt und mit Stelle gemeldet.
- Die Antwort wird nie ausgeführt, gespeichert oder weitergegeben, sie wird nur zu einem Vorschlag. Er ist als "KI-Einschätzung, bitte prüfen" gekennzeichnet.
- Kostenbremse und Schutzschalter (`plan-budget.ts`, die Regeln aus `ki/budget.ts`): höchstens 40 Aufrufe je Stunde, 150 je 24 Stunden, 4 je Dokument. Nach drei Fehlern in Folge pausiert die Stufe zehn Minuten. Der Zähler liegt im Speicher des Serverprozesses (kein eigenes Tabellenschema, keine Migration), er ist eine Bremse und kein genauer Zähler.

Grenzen der KI: Sie liest nur Text. Gescannte PDFs ohne Text, Bilder und verschlüsselte oder mit Makros versehene Dateien werden abgelehnt. Tabellen werden zeilenweise als Text gelesen, über Seitengrenzen hinweg geht der Zusammenhang der Kopfzeile verloren. Eine Zahl, die das Dokument nicht nennt, sondern nur aus anderen ergibt, wird nicht eingetragen.

Probelauf der KI-Stufe gegen den echten Sokrates (03.11.2026, `OPENAI_COMPATIBLE_MODEL=sokrates-fast`, erfundener Text, einmaliges Skript, nichts gespeichert): **Die Stufe ist mit dem echten Sokrates nur an einem Text von zwei Zeilen belegt, an einem Text von etwa zehn Zeilen ist der Probelauf gescheitert.** Sokrates war an dem Tag überlastet. Gemessen: Eine kurze Frage antwortet in 1,5 bis 4,7 Sekunden (am Mittag 58 Sekunden, im ersten Versuch am Nachmittag 22 Sekunden), aber die Erzeugung läuft nur mit etwa 6 Token je Sekunde (120 Token Antwort in 21 Sekunden, 42 Token in 6,9 Sekunden). Damit passt nur eine kurze Antwort in das Zeitlimit von 30 bis 40 Sekunden je Aufruf:

| Text | Ergebnis |
| --- | --- |
| zwei Zeilen (Kopfzeile und ein Satz mit Gesamtzahlen), mit `CONTENT_UPLOAD_KI_TIMEOUT_MS=45000` | gelesen: 2 Felder, verworfen ohne Fundstelle oder mit Wert außerhalb der Fundstelle: 0, ein Aufruf, 26,6 Sekunden |
| drei Zeilen (zusätzlich eine Komponente mit Stunden, Wochen und Enablern) | Zeitüberschreitung nach 40 Sekunden, `KI_FAILED` |
| etwa zehn Zeilen (Komponenten, Enabler, Stunden, Lernfelder, Beziehungen), Standardzeitlimit 30 Sekunden | Zeitüberschreitung nach 30 Sekunden, `KI_FAILED` |
| dieselben zehn Zeilen mit 40 Sekunden | Zeitüberschreitung nach 40 Sekunden, `KI_FAILED` |
| dieselben zehn Zeilen, direkter Aufruf ohne Zeitlimit der Stufe (`max_tokens` 3500 und 800) | HTTP 524 (Zeitüberschreitung des Vorschalt-Servers) nach 125 Sekunden, beide Male |

Die zwei gelesenen Felder (Beispiele, nur die erfundenen Zahlen): "Komponenten = 12" mit der Fundstelle "umfasst insgesamt 12 Komponenten", "Stunden = 640" mit der Fundstelle "zusammen 640 Stunden". Ein drittes Beispiel gibt es nicht, weil kein längerer Text durchlief. Die Wiederholung folgte der Regel (bis zu dreimal im Abstand von zwei Minuten nach der ersten Messung über 20 Sekunden). **Stand:** Die Verwerfungsregeln (Fundstelle fehlt, Wert nicht in der Fundstelle, Grenzen) sind mit gefälschtem Client geprüft, mit dem echten Sokrates nur an zwei Feldern. Ein Dokument mit langem Fließtext braucht bei dieser Last länger als das Zeitlimit, bis Sokrates wieder schneller erzeugt (oder bis die Antwort kürzer wird, zum Beispiel durch kleinere Abschnitte je Aufruf). Der Probelauf mit zehn Zeilen gehört in den Preview-Test, sobald Sokrates wieder zügig antwortet.

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
