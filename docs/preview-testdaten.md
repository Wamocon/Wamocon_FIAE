# Testdaten mit Fortschritt in der Preview

Stand: 03.11.2026. Zwei Skripte geben den Azubis der Preview einen Arbeitsstand, mit dem jede Rolle jede Funktion testen kann, ohne vorher Vorbedingungen und Testdaten aufzubauen. Nach einem Test setzt das zweite Skript alles auf diesen Stand zurück. Ein drittes Skript ergänzt die einzelnen Quiz-Antworten zu Abgaben eines älteren Laufs.

**Zweck:** Jeder Tester soll in seinem Kontext jede Funktion prüfen können, ohne eigene Vorbedingungen herzustellen. Dazu gehört, dass ein Ausbilder zu jeder Quiz-Abgabe die Antworten des Azubis sieht und die Punktzahl daran nachvollziehen kann, und dass der Azubi in seinem Rückblick seine Antworten findet.

Beide Skripte arbeiten nur im Schema `public_preview`. Production wird nicht berührt und kann mit ihnen nicht erreicht werden (siehe "Schutz").

## Die drei Skripte

| Zweck | Befehl |
| --- | --- |
| Arbeitsstand anlegen | `npm run preview:seed-progress -- --target preview` |
| Nach einem Test zurücksetzen | `npm run preview:reset-progress -- --target preview` |
| Einzelantworten zu vorhandenen Quiz-Abgaben ergänzen | `npm run preview:seed-answers -- --target preview` |

Alle drei sind ein **Probelauf**, solange `--apply` fehlt. Der Probelauf schreibt alles in einer Transaktion, nimmt sie zurück, zeigt die Zahlen und liest den Speicher nur. Ein echter Lauf:

```
npm run preview:seed-progress -- --target preview --apply --confirm-host <Host der Datenbankverbindung>
npm run preview:reset-progress -- --target preview --apply --confirm-host <Host der Datenbankverbindung>
npm run preview:seed-answers -- --target preview --apply --confirm-host <Host der Datenbankverbindung>
```

Weitere Schalter:

- `--email <a>,<b>` nur diese Konten (der Arbeitsstand eines Kontos bleibt derselbe, auch wenn nur es gewählt wird)
- `--level weit|mittel|bereit|anfang` (braucht `--email`) gibt den gewählten Konten diesen Stand statt des Standes ihrer Position. Das Anlegen ergänzt nur, ein höherer Stand erweitert den vorhandenen. Für einen niedrigeren Stand zuerst zurücksetzen (`preview:reset-progress` mit demselben `--email` und `--level`).
- `--clear-only` (nur Zurücksetzen) entfernt nur, legt nichts neu an
- `--keep-files` (nur Zurücksetzen) lässt hochgeladene Dateien liegen
- `--fix-scores` (nur `preview:seed-answers`) setzt zusätzlich eine gespeicherte Punktzahl, die keine Zahl richtiger Antworten ergibt, auf den Wert, den die ergänzten Antworten ergeben (siehe unten)
- `--db-url-env <NAME>` Name der Variablen mit der Verbindung, Standard `PREVIEW_IMPORT_DB_URL`

Die Verbindung kommt aus `.env.local` (Rolle `app_preview_migrator`). Der Host steht im ersten Satz der Ausgabe, er ist auch der Wert für `--confirm-host`.

## Was das Anlegen erzeugt

Für jeden aktiven Azubi, nach der E-Mail-Adresse sortiert, ein Stand nach diesem Wechsel (`LEVEL_CYCLE` in `scripts/preview/lib/test-progress.ts`). Die Konten stehen nicht im Skript, weil das Repository öffentlich ist.

| Stand | Bedeutung in jedem Kurs des Azubis |
| --- | --- |
| weit | alle Enabler außer dem letzten erledigt |
| mittel | die erste Hälfte erledigt |
| bereit | alle außer den letzten zwei erledigt (einer offen, einer noch durch die Reihenfolge gesperrt) |
| anfang | nur der erste erledigt |

Reihenfolge der Konten: weit, mittel, bereit, bereit, anfang, danach wieder von vorn. Ein Enabler gilt als erledigt, wenn alle Pflicht-Quizze mit mindestens 50 Prozent bestanden sind (`docs/reihenfolge-der-arbeit.md`). Das Skript legt dafür Quiz-Abgaben mit etwa 60 bis 100 Punkten an, jeweils mit den einzelnen Antworten (siehe unten).

Dazu bekommt jeder Azubi:

- **Use-Case-Abgaben:** je Beruf drei, eine in Prüfung (offen für den Trainer), eine zurückgewiesen mit Feedback, eine angenommen mit Feedback
- **Enabler-Abgaben (Szenario-Antworten):** drei in denselben drei Zuständen
- **Tätigkeitsnachweise:** drei Wochen, KW 41 angenommen, KW 42 eingereicht, KW 43 Entwurf, je mit einem Eintrag

Die Texte beginnen mit "Testabgabe", "Testantwort" oder "Testeintrag", so sind sie in den Listen erkennbar.

**Quiz-Abgaben mit Antworten:** Wie eine echte Abgabe (`src/app/api/trainee/quizzes/[quizId]/submit/route.ts`) bekommt jede neue Quiz-Abgabe zu jeder Frage des Quiz eine Antwort in `quiz_submission_answers`: bei Auswahlfragen eine Option der Frage, bei Freitextfragen einen Text. Richtig oder falsch ergibt sich wie auf der Plattform aus `options.is_correct` beziehungsweise der erwarteten Antwort. Der bisherige Hash des Quiz legt weiter fest, wie viel Prozent richtig sind (60 bis 100), daraus wird die **Zahl der richtigen Antworten** bestimmt (gerundet, mindestens auf das Bestehen), und die **Punktzahl ist danach die Formel der Plattform** (`quizScore`: richtige geteilt durch bewertete Fragen, gerundet). Bei 10 Fragen gibt es deshalb nur 10er-Schritte (70, 80 ...), nie 68 Prozent. Welche Fragen richtig sind, ist je Azubi und Quiz fest, aber nicht bei allen gleich. Eine Freitextfrage ohne erwartete Antwort wird beantwortet, zählt aber nicht in die Punktzahl (Regel der Plattform). Ein Quiz ganz ohne bewertbare Frage bekommt wie auf der Plattform keine Punktzahl.

Das Anlegen ist wiederholbar: Was schon da ist, bleibt, nichts entsteht doppelt. Wer schon drei oder mehr Abgaben hat, bekommt keine weiteren. Ein zweiter Lauf direkt danach schreibt nichts.

## Was das Zurücksetzen tut

Das Zurücksetzen entfernt für die gewählten Azubis alles, was ein Test erzeugen kann, und legt danach den Arbeitsstand neu an. Alles in einer Transaktion: scheitert ein Schritt, bleibt der alte Stand.

Entfernt werden die Zeilen dieser Tabellen (Kinder gehen per CASCADE mit, zum Beispiel einzelne Quiz-Antworten, Links einer Abgabe, Einträge eines Nachweises, Wochenbewertungen, Chat-Nachrichten): `quiz_submissions`, `use_case_submissions`, `enabler_submissions`, `enabler_completions`, `progress`, `trainee_enabler_overrides`, `trainee_use_case_overrides`, `activity_reports`, `work_certificates`, `annual_performance_summaries`, `acceptance_protocols`, `trainee_achieved_skills`, `knowledge_notes`, `reflections`, `hai_chat_sessions`, `notifications`.

Hochgeladene Dateien der Abgaben (Bucket `submission-files`, Ordner `preview/<Organisation>/<Azubi>/`) werden nach dem Commit entfernt, weil eine Datei über ihren Ordner an Azubi und Use Case hängt und sonst nach dem Zurücksetzen noch angezeigt würde. Dafür braucht das Skript den Schlüssel des Servers in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL` und `SUPABASE_SECRET_KEY`). Fehlt er, sagt das Skript es und lässt die Dateien liegen.

**Bleibt bewusst unberührt (Einrichtung, kein Fortschritt):** `profiles`, `trainee_enrollments`, `course_members`, `quiz_assignments` (entstehen beim Einschreiben und Freischalten), der Kalender (`ausbildung_blocks`, `school_exams`, `school_exam_results`) und `activity_log`.

**Achtung:** Das Zurücksetzen entfernt alles Genannte, auch Daten, die jemand von Hand in der Preview angelegt hat (zum Beispiel einen eigenen Tätigkeitsnachweis oder eine HAI-Unterhaltung). Der Probelauf zeigt die Zahl je Tabelle vorher. Mit `--email` lässt sich das auf ein Konto begrenzen.

## Antworten zu vorhandenen Abgaben ergänzen

Abgaben, die ein älterer Lauf ohne Einzelantworten angelegt hat, zeigen dem Ausbilder keine Antworten (Quiz-Details leer) und dem Azubi im Rückblick den Hinweis "keine einzelnen Antworten gespeichert". `npm run preview:seed-answers` ergänzt sie.

Was es tut:

- Es erzeugt zu jeder betroffenen Abgabe für jede Frage eine Antwort, so dass die Zahl der richtigen Antworten zur gespeicherten Punktzahl passt. Kann die Formel die Punktzahl nicht ergeben (zum Beispiel 68 Prozent bei 10 Fragen), wählt es die nächste mögliche Zahl richtiger Antworten (70 Prozent) und meldet die Abweichung im Probelauf, gruppiert nach "gespeichert, ergibt, Zahl der Fragen".
- Es ändert die gespeicherte Punktzahl **nicht**. Erst `--fix-scores` setzt sie auf den Wert, den die Antworten ergeben, damit Punktzahl und Antworten übereinstimmen.
- Es arbeitet rein additiv: kein `delete`, kein Überschreiben. Betroffen sind nur Abgaben ohne jede Antwort.
- Es fasst nur Abgaben des Seeds an: gleicher Kreis von Azubis wie beim Zurücksetzen (aktive Azubis, mit `--email` eingegrenzt), erster Versuch, nicht geprüft und mit genau der Punktzahl, die der Seed vergeben hat (`60 + Hash des Quiz modulo 41`). Von Hand gemachte Abgaben haben immer Antworten und werden deshalb nie berührt. Im Zweifel bleibt eine Abgabe unangetastet.
- Es ist wiederholbar: Nach dem Lauf haben die Abgaben Antworten, ein zweiter Lauf findet nichts und schreibt 0 Zeilen.

Reihenfolge für einen Bestand: erst Probelauf, dann echter Lauf. Soll zusätzlich die Punktzahl angeglichen werden, denselben Befehl mit `--fix-scores` (zuerst als Probelauf).

## Schutz

- Jeder Aufruf braucht `--target preview`, jede andere Angabe wird abgelehnt.
- Das Skript arbeitet nur, wenn die Datenbankrolle `app_preview_migrator` ist (Eigentümer von `public_preview`, ohne Rechte auf `public`). Mit der Rolle der Production-App oder dem Standardbenutzer bricht es ab.
- Jede Anweisung nennt `public_preview` ausdrücklich, ein Test prüft das.
- Ein echter Lauf braucht `--apply` und `--confirm-host` mit dem Host der Verbindung.
- Das Protokoll nennt keine E-Mail-Adresse, keinen Schlüssel und keine Verbindungszeichenfolge, nur Zahlen und die ersten acht Zeichen einer Kennung.
- Dateien werden nur im Ordner `preview/<Organisation>/<Azubi>/` des jeweiligen Azubis gelesen und entfernt. Ein anderer Pfad löst einen Fehler aus.

## Hinweise

- Nach einem Reset der gesamten Preview (`Preview Reset`) sind die Daten weg. Dann das Anlegen neu laufen lassen.
- Die Trainer sehen nur Prüfungen aus ihren Kursen. Ein Trainer ohne Kursmitgliedschaft sieht keine (offene Entscheidung zu den Rechten).
- Quiz-Abgaben, die ein älterer Lauf angelegt hat, haben keine Einzelantworten, bis `preview:seed-answers` gelaufen ist.
- Tests: `tests/unit/preview-setup/test-progress.test.ts` und `tests/unit/preview-setup/quiz-answers.test.ts`.
