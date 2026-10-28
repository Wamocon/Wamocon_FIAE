# Freigabe und Zuweisung der Inhalte einer Ausbildung

Stand: 28.10.2026. Dieses Paket enthält keine Migration und hat keine Wirkung auf Production.

## Warum ein Azubi nichts sieht

Ein Azubi sieht einen Inhalt nur, wenn zwei Dinge zusammenkommen:

| Was                | Bedingung                                                                                        | Gesetzt von                                      |
| ------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Kurs (Lernen)      | Mitgliedschaft in `course_members` (die Spalten `is_active` und `is_published` zählen dort nicht) | Ausbilder je Kurs (`POST /api/trainer/courses/[id]/members`), neu: Werkzeug und Einschreibung |
| Enabler            | `enablers.is_active` und Mitgliedschaft im Kurs                                                  | Plattform-Admin (`PATCH /api/trainer/enablers/[id]`), neu: Werkzeug |
| Use Case           | `use_cases.is_active` und Mitgliedschaft im Kurs                                                 | wie Enabler                                      |
| Quiz zum Enabler   | `quizzes.is_active`, Enabler aktiv, Mitgliedschaft im Kurs                                       | Plattform-Admin, neu: Werkzeug                   |
| Global-Quiz (Quizze) | `quizzes.is_active` und eine Zeile in `quiz_assignments` für den Azubi                         | Ausbilder beim Anlegen des Quiz, neu: Werkzeug und Einschreibung |
| Ausbildung         | Katalog aktiv, für die Organisation freigeschaltet, Azubi eingeschrieben                          | Plattform-Admin (Organisationen, Ausbildungsberufe) |

Der Import legt alles inaktiv an und schreibt keine Mitgliedschaften. Bei FIAE geben Ausbilder beides von Hand. Bei KfBM sind das 27 Kurse, 226 Enabler und 705 Quizze, deshalb gibt es zwei Werkzeuge.

## Lernen oder Quizze leer, obwohl der Inhalt da ist (Stand 28.10.2026)

Der Katalog eines Azubis kommt aus seiner Einschreibung (`trainee_enrollments`, eine Zeile je Azubi), nie aus den Mitgliedschaften und nie aus einem Cookie: Ohne Einschreibung gilt FIAE, mit Einschreibung der Katalog der Zeile, sofern der Katalog aktiv und für die Organisation freigeschaltet ist, sonst `403 NO_CATALOG` auf allen Seiten. Ein Header `x-catalog` darf nur einen dieser Kataloge nennen, sonst `403`. Hat ein Azubi Mitgliedschaften in Kursen zweier Kataloge und die Einschreibung nennt einen, zeigen Lernen und Quizze nur diesen (die Mitgliedschaften des anderen Katalogs bleiben unsichtbar, aber erhalten). Das haben Läufe der echten Routen gegen einen Wegwerf-Postgres bestätigt (Tabelle im Bericht des Pull Requests). Die Seiten sind leer, wenn eine dieser Bedingungen fehlt:

- **Quizze:** keine Zeile in `quiz_assignments` des Azubis auf ein Global-Quiz mit `quiz_type = 'GLOBAL'`, `is_active = true` und dem Katalog der Einschreibung. Bei FIAE legt der Ausbilder die Zeilen von Hand an, die Synchronisierung nach Phasenplan gilt nur für Kurse und Quizze mit Komponente. Wer von KfBM nach FIAE wechselt, behält nur die Zuweisungen der KfBM-Quizze.
- **Lernen:** keine Zeile in `course_members` auf einen Kurs mit dem Katalog der Einschreibung. Die Spalten `is_active` und `is_published` des Kurses zählen für die Liste nicht (die Liste zählt nur aktive Enabler).
- **Zwischenspeicher:** Beide Listen liegen unter `trainee_courses_<Azubi>_<Katalog>` und `trainee_quizzes_<Azubi>_<Katalog>` fünf Minuten im Data Cache, danach wird der alte Wert einmal noch geliefert, während er erneuert wird. Wer Mitgliedschaften, Zuweisungen oder die Einschreibung per SQL ändert, leert ihn nicht und sieht die alte Liste bis zu 5 bis 6 Minuten. Über die Oberfläche leeren ihn jetzt: Kursmitglied hinzufügen oder entfernen, Global-Quiz einem Azubi zu- oder abweisen, eine geänderte Einschreibung (auch wenn die Synchronisierung danach scheitert, vorher blieb der Zwischenspeicher dann stehen), das Werkzeug "Inhalte freigeben" und das Werkzeug zum Zuweisen. Die Hilfsfunktion ist `invalidateTraineeListCaches` (`src/lib/catalog/trainee-cache.ts`), sie leert die Marken `trainee_courses`, `trainee_quizzes` und `trainee_dashboard` für alle Azubis.
- **Lernfeld-Seite:** Sie nennt Enabler und Use Cases des Lernfelds, auch von Kursen, in denen der Azubi nicht Mitglied ist (dort ohne Link, Hinweis "nicht zugewiesen"). Den Text eines Use Cases, die Kurs-ID und den Kursnamen bekommt nur ein Mitglied des Kurses, ein anonymer Aufruf nur Titel und Zeiten.

## Werkzeug 1: Inhalte freigeben oder sperren

Ort: Seite Organisationen, Karte "Ausbildungsberufe", Schaltfläche "Inhalte freigeben oder sperren" je Beruf. Nur Plattform-Admin (SUPER_ADMIN, ADMIN der Plattformorganisation). API: `POST /api/admin/catalogs/[catalogId]/content-release` mit `{ mode: "release" | "lock", execute?, confirmCode? }`.

- Ablauf: Zahlen ansehen, Probelauf (zählt, schreibt nichts), den Katalogcode eintippen, ausführen.
- Die Zeile "Komponenten" der Tabelle zählt die Kurse der Ausbildung (`courses`) und ist dieselbe Zahl wie die Kennzahl "Komponenten" der Inhaltsstatistik (`docs/content-stats.md`).
- Geändert werden nur `is_active` (alle vier Arten), `is_published` (Kurse) und `activated_at` (Enabler und Use Cases, nur wo leer, wie die Ausbilder-Route). Keine Texte, Fragen oder Antworten.
- Freigeben und Sperren sind Gegenstücke. Es wird immer der ganze Katalog geschaltet, auch Zeilen, die ein Ausbilder vorher einzeln aktiviert hatte.
- Wiederholbar: ein zweiter Lauf zeigt 0 Änderungen.
- Protokoll: eine Zeile in `activity_log` (`CONTENT_RELEASE` oder `CONTENT_LOCK`, Katalogcode, Zahlen) und eine Logzeile. Fehlt die Protokollzeile, meldet die Oberfläche das.
- Die Standardausbildung FIAE ist im Betrieb: ein echter Lauf wird mit 409 abgelehnt, der Probelauf geht.
- Die Zwischenspeicher der Azubi-Listen werden nach einem echten Lauf geleert.

## Werkzeug 2: Azubis den Kursen zuweisen

Ort: Seite Organisationen, in der Karte der Organisation, Schaltfläche "Zuweisen" je Beruf. API: `POST /api/admin/catalogs/[catalogId]/trainee-content` mit `{ execute?, organizationId? }`.

- Regel (Phasenplan): Pflichtkomponenten der aktuellen Phase des Azubis, integrative Komponenten, gewählte Wahlkomponenten (`trainee_elective_choices`). Die Phase folgt aus Startdatum, Dauer und den Phasenmonaten des Katalogs (KfBM 15 und 21). Ohne Startdatum gilt Phase 1.
- Geschrieben werden `course_members` (Rolle TRAINEE) und `quiz_assignments` (Global-Quiz der Komponente), nur einfügen, `ON CONFLICT DO NOTHING`, nie löschen. Eine Zuweisung von Hand bleibt.
- Kurse ohne Komponente (alle FIAE-Kurse) werden nie berührt.
- Global-Quizze ("Quizze" der Azubis): KfBM bekommt nur die Global-Quizze der Komponenten des Phasenplans, dieselbe Auswahl wie bei den Kursen. Das Werkzeug (nicht die automatischen Läufe) weist zusätzlich alle aktiven Global-Quizze zu, die an keine Komponente gebunden sind. Das ist bei FIAE das Muster (die 22 Global-Quizze hat bisher ein Ausbilder von Hand je Azubi zugewiesen). Nur einfügen, nie löschen, Wiederholung fügt nichts ein. `assigned_by_id` ist der Administrator, der das Werkzeug auslöst (beim automatischen Lauf der Einschreibende), `organization_id` die des Azubis, ohne Organisation wird nichts geschrieben. Der Probelauf zählt die Quiz-Zuweisungen mit. Inaktive Global-Quizze werden nicht zugewiesen, sie erscheinen erst nach der Freigabe.
- Vorschlag: Die automatischen Läufe (Einschreibung, Anlegen eines Azubis) weisen die FIAE-Global-Quizze nicht von selbst zu, damit sich für neue FIAE-Azubis in Production nichts ungefragt ändert. Soll das so werden, genügt es, die Option beim automatischen Lauf zu setzen.
- Wer darf: Plattform-Admin für jede Organisation, ADMIN und TEMP_ADMIN einer Organisation nur für die eigene Organisation und nur für einen Beruf, der für sie freigeschaltet und aktiv ist. Das ist dasselbe Recht, das Ausbilder und Admins mit den bestehenden Routen je Kurs schon haben, hier als Sammelaufruf. Azubis ohne Organisation werden nie angefasst (Org-Admin) oder nur als übersprungen gezählt (Plattform-Admin).
- Automatisch ausgelöst wird dieselbe Logik bei der Einschreibung (`PUT /api/admin/users/[userId]/enrollment`) und beim Anlegen eines Azubis (`POST /api/admin/users`). Der Registrierungsabgleich (`sync-profile`) übernimmt Mitgliedschaften und Zuweisungen eines vorab angelegten Profils bereits (`mergeProfileReferences`).
- Bei einem Phasenwechsel oder neuen Wahlkomponenten das Werkzeug erneut ausführen, es fügt nur Fehlendes ein.

## Reihenfolge in der Preview

1. Beruf aktiv und für die Organisation freigeschaltet (Karte "Ausbildungsberufe", Organisationskarte).
2. Azubi eingeschrieben (Nutzerverwaltung).
3. Werkzeug 2: Probelauf, ausführen.
4. Werkzeug 1: Probelauf, Code eintippen, freigeben.
5. Als Azubi prüfen: Lernen, Quizze, Berufsschule, Lernfelder.

## Lösungsschutz

Die Werkzeuge ändern keine Lesepfade. Azubis bekommen Dokumente mit `TRAINER_ONLY` und `TRAINER_SOLUTION` nie, Antworten und Begründungen eines Quiz erst nach der Abgabe. Das HAI liest aktive Inhalte nur bei einer eigenen Indexierung, die Antworten der Quizze liegen dort im Trainerteil. Die Werkzeuge lösen keine Indexierung aus (Test `tests/unit/lib/catalog/content-release.static.test.ts`).

## Prüfung

- `tests/unit/lib/catalog/trainee-content-pg.test.ts` (Wegwerf-Postgres, Variable `TRAINEE_CONTENT_TEST_DB`, nur lokale Hosts): zwei Kataloge, Rollenmatrix, Lösungsschutz, Probelauf, Wiederholung, Sperren.
- `tests/integration/api/admin/catalog-content.test.ts`: Rollen, Eingaben, Tippbestätigung.
- `tests/unit/app/internalLinks.test.ts`: jedes Linkziel im Quelltext führt auf eine vorhandene Seite.
