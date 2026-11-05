WAMOCON GmbH, Mergenthalerallee 79-81, 65760 Eschborn

# Regression und Abnahme: Matrix Test gegen Annahme

Stand: 29.10.2026, Paket PH6 (Jira WMCNL-2815, Phase 6). Dieses Dokument gehört zum Runbook `docs/kfbm-production-rollout.md`. Es sagt, welcher automatische Test welche Annahme belegt, damit die Abnahme (Runbook, Abschnitt 6) nicht von Hand wiederholt, was ein Test schon beweist. Die Annahmen A1 bis A17 des Runbooks (Abschnitt 1.2) betreffen den Zustand von Production, Vercel und Supabase. Sie lassen sich nicht mit einem Test belegen, nur mit einer Messung (Abfragen V01 bis V14b). Dieses Dokument verweist nur auf sie.

Alle Tests laufen ohne Verbindung zu einem gehosteten System: Jest mit Tabellen-Attrappe (`tests/helpers/mockDb.ts`), Node-Test für Skripte, Docker nur für den lokalen Probelauf der Migrationen.

## 1. FIAE bleibt unverändert (Regression)

Annahmen dieses Blocks: **F1** Der Katalogfilter ändert die Ergebnisse für FIAE nicht. **F2** FIAE ist der Standardberuf, ohne Auswahl und ohne Reiter. **F3** Rollen und Tore verhalten sich wie vorher. **F4** Quiz-Regeln wie in Runbook 2.7, W3. **F5** Der Azubi sieht keine Lösung.

| Nr | Annahme | Test (Datei, Block) | Was er beweist |
| -- | ------- | ------------------- | -------------- |
| F1 | Der Katalogfilter lässt FIAE unverändert | `tests/integration/api/regression/fiae-regression.test.ts`, Block "R1" | Dieselbe Route liefert in drei Zuständen (vor dem Umbau ohne Katalogzeilen, FIAE freigegeben, KfBM vorhanden und für die Organisation freigeschaltet, der Azubi nur FIAE) dieselbe Antwort. Der gerenderte Filter nennt nur FIAE, nie KfBM. Der Super-Admin sieht weiter alles, eine gewählte Berufswahl engt ein. Geprüft an Kursliste Ausbilder, Lernfelder, Kursliste Azubi |
| F2 | FIAE ist der Standardberuf | gleiche Datei, Block "R2" | Azubi ohne Einschreibung, Azubi mit FIAE-Einschreibung, Ausbilder einer Organisation ohne Katalogzeilen: Umfang `[FIAE]`, aktiv FIAE, `selected = false`. `/api/me/catalogs` liefert einem FIAE-Azubi einen Beruf, also keinen Reiter. Ein Besucher ohne Anmeldung bekommt FIAE |
| F3 | `AWAITING_ACTIVATION` trifft nur einen Azubi mit `trainer_activated = false` | `tests/unit/lib/auth/gates.regression.test.ts` (ergänzt `tests/unit/lib/auth/session.test.ts` und `access-state.test.ts`) | Alle fünf Rollen mal drei Werte (`false`, `true`, leer): nur `TRAINEE` mit `false` bekommt 403 mit dem Code, alle anderen behalten die Sitzung. Dieselbe Regel in der Oberfläche (`resolveAccessState`). Die Freigabe öffnet das Konto ohne neue Anmeldung. Ein deaktiviertes Konto bekommt 403 ohne den Code |
| F4 | Global-Quiz mehrfach, Lektions-Quiz nach dem Bestehen gesperrt, Antworten erst nach der Abgabe | `fiae-regression.test.ts`, Block "R3" (vertieft in `tests/integration/api/trainee/quiz-submit.feedback.test.ts`, `quiz-submit.grading.test.ts`, `progression-guards.test.ts`) | Versuchszähler 1, 2, 5 beim Global-Quiz ohne Sperre. Lektions-Quiz: nicht bestanden wiederholbar, bestanden gesperrt und ohne neue Zeile. Bestehensgrenze 50 Prozent. Fragen ohne Lösungsfelder, Rückblick vor der Abgabe 404, Lösung nur für beantwortete Fragen, Schlüssel eines nicht bestandenen Lektions-Quiz bleibt zurück |
| F5 | Lösungsschutz für Azubis | `fiae-regression.test.ts`, Block "R4" (vertieft in `enablers.documents.get.test.ts`, `use-case-solution-documents.test.ts`) | Dokumente von Use Case und Enabler: eine Musterlösung (`TRAINER_SOLUTION`), eine private Referenz (`private://`), ein Dokument nur für Ausbilder, ein Word-Original und eine Zeile ohne Datei erscheinen nie in der Antwort, auch nicht, wenn die Abfrage sie zurückgäbe. Ein Ausbilder wird von der Azubi-Route abgewiesen (403) |
| F6 | HAI-Texte für FIAE sind unverändert | `tests/unit/hai/persona.fiae-baseline.test.ts` (vorhanden) | Byte-gleiche Prompts, Absicht von 133 Nachrichten, `settings.hai` wirkt für FIAE nicht |

Die vorhandenen Tests zu Dashboard, Berichtsheft, Arbeitszeugnis, Zeugnisnoten und Trainer-Ansichten (Runbook 6.2) bleiben in `npm test` und wurden nicht dupliziert. Die Zeilenzahlen aus V07 vor und nach dem Rollout bleiben Handarbeit in Production, der lokale Probelauf (Abschnitt 4) prüft dasselbe an Beispieldaten.

## 2. Trennung der Berufe

Annahmen: **B1** Ein FIAE-Azubi sieht nichts von KfBM und umgekehrt. **B2** Ein Azubi mit zwei Berufen erreicht beide, arbeitet aber in einem zugleich. **B3** Ein Ausbilder sieht nur die Berufe seiner Organisation. **B4** Jede lesende Route mit Katalogfilter hat einen Trennungstest (Runbook 6.5, Mandanten).

Test: `tests/integration/api/regression/occupation-separation.test.ts` (über 100 Fälle). Die Routenliste stammt aus dem Code: Ein Durchlauf über `src/app/api` findet jede GET-Route, die den Katalogfilter nutzt (`requireCatalogScope`, `requireContentScope`, `catalogCondition` und verwandte Aufrufe). Für Unterrouten, die dieselbe Prüfung des Umfangs mit derselben Art von Datensatz wie ihre Hauptroute nutzen, vergleicht ein Test die Arten im Quelltext. Der letzte Block fällt durch, sobald eine solche Route weder in den Listen dieser Datei noch in der Tabelle "anderweitig abgedeckt" steht. Eine neue Route ohne Trennungstest kann damit nicht unbemerkt live gehen.

| Nr | Prüfung | Routen (Auszug) |
| -- | ------- | --------------- |
| B1 | Listen: Der gerenderte Filter nennt nur den Beruf des Azubis, die Anfrage nach dem anderen Beruf endet mit 403, bevor Inhalt gelesen wird | `trainee/courses`, `trainee/quizzes`, `trainee/lernfelder`, `trainee/school/lernfelder`, `trainee/use-case-hours`, `trainee/dashboard` |
| B1 | Einzelne Datensätze: Inhalt des anderen Berufs ist "nicht gefunden" (404, kein Hinweis auf Existenz), eigener Inhalt wird zugelassen | Azubi: Kurs, Enabler, Dokumente, Quizliste, Quiz je Stufe, Einzelquiz, Use Case, Use-Case-Dokumente, Global-Quiz. Ausbilder: Kurs, Enabler, Use Case, Quiz |
| B2 | Azubi mit zwei Berufen: ohne Auswahl der zuerst eingeschriebene Beruf, nie beide vermischt, mit Auswahl genau der gewählte, Datensätze beider Berufe erreichbar, `/api/me/catalogs` nennt beide | alle Routen aus B1 |
| B3 | Ausbilder: FIAE-Organisation liest FIAE, KfBM-Organisation liest KfBM, Organisation mit beiden liest beide und lässt sich einengen, ein fremder Beruf ist 403 | `trainer/courses`, `trainer/quizzes`, `trainer/lernfelder`, `trainer/dashboard` |
| B4 | Vollständigkeit | Block "completeness" |

Weitere Trennungsnachweise, die schon vorhanden waren und im Block "anderweitig abgedeckt" benannt sind: `tests/integration/api/catalog/isolation.test.ts`, `tab-matrix.test.ts`, `me-catalogs.test.ts`, die HAI-Tests (`tests/unit/hai/indexScope.test.ts`, `retrievalAccess.test.ts`, `vectorSearch.scope.test.ts`) und `tests/integration/api/trainer/scope-*.test.ts`.

Bei der Arbeit fiel auf, dass die Fälle für Azubi-Routen in `isolation.test.ts` von der Reihenfolge der Datei abhingen (eine Sitzung aus einem Ausbilder-Test blieb stehen). Der Block meldet jetzt seine Azubi-Sitzung selbst an.

## 3. Ende-zu-Ende-Smoketest (Skript)

Datei: `scripts/smoke/run-smoke.mjs`, Tests: `tests/scripts/smoke/run-smoke.test.mjs` (gemocktes `fetch`, 30 Fälle). Das Skript wurde **nicht** gegen ein gehostetes System ausgeführt.

```
node scripts/smoke/run-smoke.mjs                          Plan und Prüfung der Umgebung, nichts wird gesendet
node scripts/smoke/run-smoke.mjs --run --base-url <https-Adresse> [--catalog KFBM] [--hai]
```

Konto und Zugang kommen nur aus der Umgebung (Namen: `SMOKE_TRAINEE_EMAIL`, `SMOKE_TRAINEE_PASSWORD`, `SMOKE_SUPABASE_URL`, `SMOKE_SUPABASE_ANON_KEY`, dazu die Bestätigung `SMOKE_ACCOUNT_IS_TEST=yes`, ohne sie meldet sich das Skript nicht an, und optional `SMOKE_HAI=1`). Es druckt nie ein Kennwort, ein Token, eine Adresse des Kontos oder eine Antwort, nur Schrittname, Statuscode und eine kurze feste Notiz. Ein Test belegt, dass keines dieser Werte in der Ausgabe auftaucht und dass das Token nur an die App und den Anmeldedienst geht, nie in eine verfolgte Weiterleitung.

| Schritt | Erwartung |
| ------- | --------- |
| Startseite, Login-Seite | 200 |
| Öffentliche Berufsliste | 200 mit mindestens einem Beruf |
| Anonymer Zugriff auf Azubi-Daten | 401 |
| Anmeldung als Test-Azubi | 200 mit Token |
| Kursliste, ein Kurs | 200 |
| Ein Enabler mit Dokument | 200, Dokumentliste ohne Musterlösung und ohne private Referenz |
| Quiz laden | 200, im Antworttext kein Lösungsfeld |
| HAI-Frage | nur mit `--hai` oder `SMOKE_HAI=1`, sonst übersprungen |
| Abmelden | 204, läuft auch nach einem Fehler |

Ausgang: 0 alles OK, 1 mindestens ein Fehler, 3 kein Fehler, aber ein Schritt hatte keine Daten (zum Beispiel ein Test-Azubi ohne Kurs), 2 falsche Aufrufe oder fehlende Umgebung. Der Lauf in Production gehört in die Phase 7 (Produktivschaltung), nicht in diese Phase.

## 4. Probelauf der Migrationen

Siehe `docs/kfbm-rollout-probelauf.md` (Skript, Ergebnis vom 29.10.2026, Lücke beim Ausgangsschema). Er belegt die Annahmen A15 (Reihe rückwärtskompatibel angewendet) und das Verhalten des Tors **lokal**. Die Annahmen über Production (A1 bis A14, A16, A17) bleiben Messungen durch Niko.

## 5. Was die Tests nicht belegen

- Verhalten gegen eine echte Datenbank: Die Tabellen-Attrappe ignoriert `where()`. Bewiesen werden der gerenderte Filter und die Antworten, nicht die Zeilen, die Postgres zurückgäbe. Läufe der echten Routen gegen einen Wegwerf-Postgres hat ein früheres Paket gemacht (siehe `docs/kfbm-freigabe-zuweisung.md`, Abschnitt "Lernen oder Quizze leer").
- Oberfläche im Browser: nicht Teil dieses Pakets.
- Alles an Production: Messungen V01 bis V14b, Smoketest S1 bis S13 und K1 bis K10 liegen bei Niko (Phase 7).
