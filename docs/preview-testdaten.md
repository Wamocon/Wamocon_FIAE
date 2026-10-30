# Testdaten mit Fortschritt in der Preview

Stand: 30.10.2026. Zwei Skripte geben den Azubis der Preview einen Arbeitsstand, mit dem jede Rolle jede Funktion testen kann, ohne vorher Vorbedingungen und Testdaten aufzubauen. Nach einem Test setzt das zweite Skript alles auf diesen Stand zurück.

Beide Skripte arbeiten nur im Schema `public_preview`. Production wird nicht berührt und kann mit ihnen nicht erreicht werden (siehe "Schutz").

## Die zwei Skripte

| Zweck | Befehl |
| --- | --- |
| Arbeitsstand anlegen | `npm run preview:seed-progress -- --target preview` |
| Nach einem Test zurücksetzen | `npm run preview:reset-progress -- --target preview` |

Beide sind ein **Probelauf**, solange `--apply` fehlt. Der Probelauf schreibt alles in einer Transaktion, nimmt sie zurück, zeigt die Zahlen und liest den Speicher nur. Ein echter Lauf:

```
npm run preview:seed-progress -- --target preview --apply --confirm-host <Host der Datenbankverbindung>
npm run preview:reset-progress -- --target preview --apply --confirm-host <Host der Datenbankverbindung>
```

Weitere Schalter:

- `--email <a>,<b>` nur diese Konten (der Arbeitsstand eines Kontos bleibt derselbe, auch wenn nur es gewählt wird)
- `--clear-only` (nur Zurücksetzen) entfernt nur, legt nichts neu an
- `--keep-files` (nur Zurücksetzen) lässt hochgeladene Dateien liegen
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

Reihenfolge der Konten: weit, mittel, bereit, bereit, anfang, danach wieder von vorn. Ein Enabler gilt als erledigt, wenn alle Pflicht-Quizze mit mindestens 50 Prozent bestanden sind (`docs/reihenfolge-der-arbeit.md`). Das Skript legt dafür Quiz-Abgaben mit 60 bis 100 Punkten an.

Dazu bekommt jeder Azubi:

- **Use-Case-Abgaben:** je Beruf drei, eine in Prüfung (offen für den Trainer), eine zurückgewiesen mit Feedback, eine angenommen mit Feedback
- **Enabler-Abgaben (Szenario-Antworten):** drei in denselben drei Zuständen
- **Tätigkeitsnachweise:** drei Wochen, KW 41 angenommen, KW 42 eingereicht, KW 43 Entwurf, je mit einem Eintrag

Die Texte beginnen mit "Testabgabe", "Testantwort" oder "Testeintrag", so sind sie in den Listen erkennbar.

Das Anlegen ist wiederholbar: Was schon da ist, bleibt, nichts entsteht doppelt. Wer schon drei oder mehr Abgaben hat, bekommt keine weiteren. Ein zweiter Lauf direkt danach schreibt nichts.

## Was das Zurücksetzen tut

Das Zurücksetzen entfernt für die gewählten Azubis alles, was ein Test erzeugen kann, und legt danach den Arbeitsstand neu an. Alles in einer Transaktion: scheitert ein Schritt, bleibt der alte Stand.

Entfernt werden die Zeilen dieser Tabellen (Kinder gehen per CASCADE mit, zum Beispiel einzelne Quiz-Antworten, Links einer Abgabe, Einträge eines Nachweises, Wochenbewertungen, Chat-Nachrichten): `quiz_submissions`, `use_case_submissions`, `enabler_submissions`, `enabler_completions`, `progress`, `trainee_enabler_overrides`, `trainee_use_case_overrides`, `activity_reports`, `work_certificates`, `annual_performance_summaries`, `acceptance_protocols`, `trainee_achieved_skills`, `knowledge_notes`, `reflections`, `hai_chat_sessions`, `notifications`.

Hochgeladene Dateien der Abgaben (Bucket `submission-files`, Ordner `preview/<Organisation>/<Azubi>/`) werden nach dem Commit entfernt, weil eine Datei über ihren Ordner an Azubi und Use Case hängt und sonst nach dem Zurücksetzen noch angezeigt würde. Dafür braucht das Skript den Schlüssel des Servers in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL` und `SUPABASE_SECRET_KEY`). Fehlt er, sagt das Skript es und lässt die Dateien liegen.

**Bleibt bewusst unberührt (Einrichtung, kein Fortschritt):** `profiles`, `trainee_enrollments`, `course_members`, `quiz_assignments` (entstehen beim Einschreiben und Freischalten), der Kalender (`ausbildung_blocks`, `school_exams`, `school_exam_results`) und `activity_log`.

**Achtung:** Das Zurücksetzen entfernt alles Genannte, auch Daten, die jemand von Hand in der Preview angelegt hat (zum Beispiel einen eigenen Tätigkeitsnachweis oder eine HAI-Unterhaltung). Der Probelauf zeigt die Zahl je Tabelle vorher. Mit `--email` lässt sich das auf ein Konto begrenzen.

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
- Die Quiz-Abgaben haben nur Punktzahl und Zeitpunkt, keine einzelnen Antworten.
- Tests: `tests/unit/preview-setup/test-progress.test.ts`.
