# Inhaltsstatistik je Ausbildung

Die Seite `/trainer/admin/content-stats` zeigt den Admins, wie viel Inhalt je Ausbildung (Ausbildungskatalog, zum Beispiel KfBM und FIAE) vorhanden ist (Ist), was geplant ist (Soll) und wie groß die Abweichung ist. Es gibt keine Migration, die Soll-Werte liegen in `training_catalogs.settings`.

## Wer sieht was

| Rolle                                                        | Sieht                                                                                                           | Ändert Soll-Werte |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------- |
| Plattform-Admin (SUPER_ADMIN, ADMIN der Plattform-Organisation) | alle Ausbildungen, auch inaktive, mit Ist, Soll, Abweichung und Status                                         | ja                |
| ADMIN und TEMP_ADMIN einer Organisation                      | nur die Ausbildungen, die für die eigene Organisation freigeschaltet und aktiv sind, nur das Ist, kein Soll     | nein              |
| Trainer, Azubi                                               | nichts (403)                                                                                                    | nein              |
| ohne Sitzung                                                 | nichts (401)                                                                                                    | nein              |

- Die Soll-Werte sind die Planung der Plattform. Sie verlassen den Server nur für den Plattform-Admin. Für Organisations-Admins fehlen Soll, Abweichung, Status und Fortschrittsbalken in der Antwort, nicht erst in der Oberfläche.
- Die Organisation kommt aus der Sitzung, nie aus der Anfrage. Eine Organisation ohne Katalogzeilen gilt als FIAE freigeschaltet (Altbestand, wie im Rest der Katalogverwaltung). Zeigt die Sitzung auf eine Organisation, die es nicht gibt, ist die Liste leer (fail closed).
- Soll-Werte ändert nur `requireCurriculumEditor` (gleiches Recht wie jede Änderung am Lehrplan).

## Zählregeln (Ist)

Eine SQL-Anweisung zählt alle Ausbildungen auf einmal (`src/lib/catalog/content-stats.ts`, kein N+1). Jede Zahl hängt an der Katalogspalte der eigenen Tabelle, nie an einem Join, der Zeilen vervielfachen könnte.

| Kennzahl         | Zählregel                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Komponenten      | Zeilen in `training_components` der Ausbildung                                                                                                                                                                                                                                                                                                                                                                                                      |
| Enabler          | Zeilen in `enablers` der Ausbildung                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Szenarien        | **Enabler mit Szenario, nie Dokumentzeilen.** Der KfBM-Import schreibt bis zu drei Zeilen je Szenario (Ausgangssituation, Lösung, Fachwissen), gezählt wird ein Enabler einmal. Ein Enabler hat ein Szenario, wenn er eine Dokumentzeile am Enabler (ohne Use Case) hat vom Typ `EXERCISE` (die Szenario-Dokumente der Plattform) oder vom Typ `TRAINEE_QUESTION` oder `TRAINER_SOLUTION` mit Titel `Szenario <Enabler-Code>: ...` (Import), oder wenn `enablers.scenario_pdf_url` gefüllt ist (altes Einzel-PDF, nur Leerzeichen zählen nicht) |
| Use Cases        | Zeilen in `use_cases` der Ausbildung (die Inhalts-Use-Cases am Enabler). **Nicht** `training_use_cases`: das sind die zeitlich geplanten Aufgaben einer Komponente für die Tätigkeitsberichte, etwas anderes                                                                                                                                                                                                                                         |
| Enabler-Quizze   | `quizzes` vom Typ `LESSON` der Ausbildung (je Enabler drei: LOW, MEDIUM, HIGH)                                                                                                                                                                                                                                                                                                                                                                      |
| Global-Quizze    | `quizzes` vom Typ `GLOBAL` der Ausbildung                                                                                                                                                                                                                                                                                                                                                                                                           |
| Lernfelder       | Zeilen in `training_catalog_learning_fields` der Ausbildung                                                                                                                                                                                                                                                                                                                                                                                         |
| Fragen gesamt    | alle `questions` der Quizze der Ausbildung (Zusatz, ohne Soll)                                                                                                                                                                                                                                                                                                                                                                                      |
| Zuordnungen      | Zeilen in `training_catalog_content_mappings` der Ausbildung (Enabler und Use Cases zu Lernfeldern, Zusatz, ohne Soll)                                                                                                                                                                                                                                                                                                                              |
| aktiv, inaktiv   | bei Enablern, Use Cases, Enabler-Quizzen und Global-Quizzen: `is_active` ist wahr. Inaktiv ist Ist minus aktiv. Komponenten, Szenarien und Lernfelder haben keine eigene Aktivierung                                                                                                                                                                                                                                                                 |

Erwartete Werte KfBM nach dem Import: 27 Komponenten, 226 Enabler, 225 Szenarien, 225 Use Cases, 678 Enabler-Quizze, 27 Global-Quizze. Mit den Soll-Werten 226 für Szenarien und Use Cases zeigt die Seite je eine fehlende Einheit.

## Soll-Werte

- Ablage: `training_catalogs.settings.content_targets` (jsonb), Schlüssel `components`, `enablers`, `scenarios`, `use_cases`, `lesson_quizzes`, `global_quizzes`, `learning_fields`. Ganze Zahlen von 0 bis 100000. Das Zod-Schema (`src/lib/catalog/content-targets.ts`, eingebunden in `catalogSettingsSchema`) verweigert unbekannte Schlüssel und alle anderen Werte.
- Kein Standard: Ein fehlender Schlüssel heißt "kein Soll" (Anzeige "kein Soll", Status `no_target`).
- Ändern: `PUT /api/admin/catalogs/[catalogId]/content-targets` mit `{ "targets": { "enablers": 226, "scenarios": null } }`. Der Aufruf ersetzt die ganze Menge, ein fehlender Schlüssel oder `null` heißt "kein Soll". Die Änderung ist eine Anweisung (`jsonb_set` auf `settings`), die übrigen Einstellungen bleiben unberührt, eine leere Menge entfernt den Schlüssel.
- Das Formular dafür liegt auf der Statistikseite (Schaltfläche "Soll-Werte bearbeiten" je Ausbildung, nur für den Plattform-Admin). Ein Formular zum Anlegen einer Ausbildung gibt es in der Anwendung nicht, Ausbildungen entstehen über Migrationen und Importe. Wer eine Ausbildung anlegt, trägt danach hier die Soll-Werte ein.

## Status

| Status      | Bedeutung                 | Anzeige                              |
| ----------- | ------------------------- | ------------------------------------ |
| `met`       | Ist gleich Soll           | Häkchen, "erfüllt"                   |
| `missing`   | Ist kleiner als Soll      | Warnzeichen, "fehlt", Abweichung < 0 |
| `exceeds`   | Ist größer als Soll       | Pfeil, "mehr als Soll", Abweichung > 0 |
| `no_target` | kein Soll gesetzt oder nicht sichtbar | Minuszeichen, "kein Soll" |

Die Abweichung ist Ist minus Soll. Der Fortschritt wird abgerundet (225 von 226 zeigt 99 Prozent, nie 100). Farbe ist nie der einzige Hinweis: Symbol und Text stehen immer dabei.

## Prüfung

- `tests/unit/lib/catalog/content-stats-pg.test.ts` zählt gegen ein lokales Wegwerf-Postgres (Variable `CONTENT_STATS_TEST_DB`, optional `CONTENT_STATS_TEST_SCHEMA=public_preview` und `CONTENT_STATS_TEST_APP_DB` für die Rolle `app_preview`). Ohne die Variable wird der Test übersprungen, gehostete Hosts werden verweigert.
- `tests/integration/api/admin/content-stats.test.ts` prüft Berechtigungen und Mandantentrennung der beiden Routen.
