# HAI: Quiz-Modus

Stand: 02.11.2026. Teil des Ausbaus "Agentenschicht und Quiz-Modus". Der Test in der Preview steht im Testplan (`docs/hai-testplan.md`, Abschnitt G).

## 1. Zweck

Ein Azubi (oder ein Trainer in der Vorschau) lässt sich von der HAI abfragen, Frage für Frage, **ohne Wertung**. Das ist eine Abrufübung nach der Lerntechnik 1 aus `docs/hai-lerntechniken.md` (Practice testing, hoher Nutzen): erst selbst abrufen, dann die Rückmeldung mit Erklärung. Die Fragen sind die der bestehenden Lektionsquizze. Das Modell stellt keine Fragen und kennt keine Lösung, es ist an dieser Stelle nicht beteiligt.

Der Modus schreibt nichts: keine Abgabe (`quiz_submissions`), keine Antworten, kein Fortschritt, keine Benachrichtigung an den Trainer. Die Oberfläche sagt das auch ("Übung ohne Wertung. Es wird nichts gespeichert und es zählt nicht für deinen Fortschritt.").

## 2. Ablauf

**Einstieg, zwei Wege:**

1. Knopf "Quiz-Modus" in der Kopfzeile des Chats (Widget und Vollbild). Im Enabler-Kontext startet er für diesen Enabler, sonst gemischt. Ein zweiter Druck beendet den Modus.
2. Text im Chat. Die Pipeline erkennt die Bitte fest und ohne Modell (`src/lib/hai/quizMode/detect.ts`, wie die Datenabsichten in `dataContext.ts`): "Frag mich zu SQL ab", "Quiz mich zu diesem Enabler", "Teste mich", "Kannst du mich abfragen?", "Starte den Quiz-Modus", "/quiz SQL". Keine Bitte sind Fragen über das Wort ("Was ist ein Quiz?", "Wie funktioniert der Quiz-Modus?") und Texte über 200 Zeichen. Die HAI antwortet mit einem festen Text und schickt das Startsignal `quizMode: { topic, enablerId }` mit der Antwort. Der Browser öffnet daraufhin die Karte. Die Erkennung steht in `processMessage` und `processMessageStream` hinter dem Berufsfilter und der Lösungsablehnung und vor Suche, Datenkontext und Modell.

**Welcher Umfang:** Im Enabler-Kontext gilt der Enabler, wenn die Person ihn meint ("diesen Enabler") oder kein Thema nennt. Nennt sie ein Thema ("zu SQL"), gilt das Thema gemischt über alle Enabler der Person. Ohne Enabler-Kontext ist es immer gemischt, mit Thema eingegrenzt. Das Thema wird gegen Enabler-Titel, Kurs-Titel und Fragetext verglichen (alle Wörter, Wortstamm, ohne Umlaute und Groß-/Kleinschreibung). Passt nichts, sagt die Karte das und bietet "Gemischt abfragen" an.

**Die Karte** (`src/components/hai/HaiQuizCard.tsx`): Frage, Antwortknöpfe, "Antwort prüfen". Nach der Prüfung: richtig oder falsch, die richtigen Antworten markiert (Farbe, Haken und Text), die Erklärung des Autors, "Nächste Frage" und "Quiz beenden". Am Ende die Zusammenfassung: x von y richtig und die Enabler zum Wiederholen (nach Zahl der Fehler) mit Link auf den Enabler (nur Azubis, für Trainer gibt es keine Enabler-Seite). Tastatur: Zahl oder Buchstabe wählt aus, Enter prüft, Enter geht weiter. Eine Frage mit mehr als einer richtigen Option wird als Mehrfachauswahl gezeigt (nur die vollständige Auswahl ist richtig). Die Fragenart gibt es im Datenmodell nicht (alle Fragen sind Einzelauswahl), die Unterstützung greift nur, wenn Daten mehrere richtige Optionen enthalten.

**Verlauf:** Der Server hat keinen Zustand. Der Browser merkt sich die gestellten Fragen der Sitzung und sendet sie als `exclude` mit jeder Anforderung. Keine Frage kommt zweimal, bis alle durch sind. Dann antwortet der Server mit `exhausted`, die Karte zeigt die Zusammenfassung und "Noch eine Runde" (Verlauf von vorn). Die Antwortoptionen werden bei jeder Lieferung neu gemischt. Optionen wie "Alle genannten Antworten" oder "Keine der oben genannten" bleiben am Ende.

## 3. Routen

| Route | Zweck |
|---|---|
| `POST /api/hai/quiz-mode/next` | Body `{ enablerId?, topic?, exclude? }`. Liefert `{ status: 'ok', question, total, remaining }` oder `{ status: 'empty', reason }` (`no_content`, `no_topic_match`) oder `{ status: 'exhausted', total }`. Die Frage hat nur Text, Optionen (Id und Text, gemischt), `multiple`, Enabler und Kurs. |
| `POST /api/hai/quiz-mode/answer` | Body `{ questionId, optionIds }`. Prüft auf dem Server. Liefert `{ correct, selectedOptionIds, correctOptionIds, explanation, multiple, enablerId }`. Die Lösung und die Erklärung stehen nur in dieser Antwort. |

Beide Routen: `requireUser` (die Person ist die Sitzung, nie ein Feld der Anfrage), PRO-Plan wie der Chat, Ratenbegrenzung pro Person und Route (40 Aufrufe `next` und 80 Aufrufe `answer` je Minute, im Speicher einer Instanz, siehe `src/lib/rate-limit.ts`), Eingabeprüfung (alle Ids sind UUIDs, `exclude` höchstens 500 Einträge, `optionIds` höchstens 12, Thema auf 80 Zeichen gekürzt), `Cache-Control: no-store`, bei Fehlern eine allgemeine Meldung ohne Details. Sie stehen in `tests/helpers/guardedRoutes.ts` (Wächter für Anmeldung und Rolle) und der Browseraufruf läuft über `authFetch` (`tests/unit/hai/browserCalls.test.ts`).

Die Chat-Route hat selbst keine Ratenbegrenzung, der Auftrag "wie die HAI-Chat-Route" ließ sich deshalb nicht übernehmen. Die neuen Routen nutzen den vorhandenen Begrenzer.

## 4. Zugriffsregeln

Dieselben wie beim echten Lektionsquiz (`GET /api/trainee/enablers/[id]/quizzes/[difficulty]` und `POST /api/trainee/quizzes/[id]/submit`), immer aus Sitzung und Datenbank abgeleitet (`src/lib/hai/quizMode/access.ts`):

- **Beruf (Katalog):** `requireCatalogScopeForUser`. Ein Azubi sieht nur den Katalog seiner Einschreibung (bei mehreren Berufen den gewählten), ein Trainer die Kataloge seiner Organisation. Ein Enabler außerhalb ist 404, die gleiche Antwort wie für einen fehlenden. Auch Quiz und Kurs müssen im Katalog liegen.
- **Kurs und Enabler:** Der Azubi muss Mitglied des Kurses sein, Kurs, Enabler und Quiz müssen aktiv sein.
- **Reihenfolge der Arbeit:** gesperrte Enabler liefern nichts (benannter Enabler: 403 `ENABLER_LOCKED`, gemischt: übersprungen). Innerhalb eines Enablers zählt die Kette LOW, MEDIUM, HIGH wie im echten Quiz. Beides über `loadCourseProgressions`, `quizChainOf` und `requireQuizOpen`.
- **Nur Lektionsquizze:** Ein globales (zugewiesenes) Quiz ist eine Prüfung und bleibt draußen. Freitextfragen entfallen (es gibt nichts zum Anklicken). Fragen ohne richtige Option oder mit weniger als zwei Optionen werden übersprungen.
- **Trainer** (Trainer, Administratoren): alle aktiven Enabler der Kataloge im Geltungsbereich, ohne Mitgliedschaft und ohne Reihenfolge der Arbeit. In der Vorschau soll ein Trainer prüfen können, was Azubis später sehen.
- Die Prüfung der Antwort läuft durch dieselbe Zugriffsprüfung wie die Lieferung der Frage, eine Frage-Id eines gesperrten Enablers oder eines anderen Berufs liefert keine Lösung.

## 5. Schutz der Lösung

- Die Frage für den Browser wird Feld für Feld gebaut (`toPublicQuestion` in `src/lib/hai/quizMode/logic.ts`). Eine neue Spalte der Datenbank gelangt so nicht versehentlich in die Antwort. `is_correct` und Erklärung werden nur für die eine gelieferte oder geprüfte Frage geladen und verlassen den Server nur über `gradeAnswer` nach dem Versuch.
- Tests: Das `next`-Antwortobjekt hat genau die erlaubten Schlüssel und keinen Treffer auf `isCorrect`, `is_correct`, `correct`, `explanation`, `correctOptionIds` und die Erklärungstexte (`tests/integration/api/hai/quiz-mode.test.ts`, `tests/unit/hai/quizMode.logic.test.ts`). Fehlerantworten enthalten weder Lösung noch Optionen, Logs nur die Fehlermeldung.
- Der Chat des Modells kennt die Frage nicht (der Verlauf des Chats enthält nur den festen Text) und hat weiter die Prompt-Regeln zur Lösung (Fall C5 und G5 im Testplan, `solutionRequestRefusal` greift vor dem Modell).
- Nichts wird geschrieben: kein `insert`, `update` oder `delete` in den Tests der Routen.

## 6. Entscheidungen und Grenzen

1. **Freigabe der Lösung nach dem Versuch, auch bei noch nicht bestandenen Lektionsquizzen.** Das echte Quiz hält die Lösung zurück, bis das Quiz bestanden ist (`withholdKey` in `submit/route.ts`, damit ein misslungener Versuch nicht den Schlüssel für den nächsten liefert). Der Quiz-Modus gibt die Lösung nach jedem Versuch heraus, so verlangt es der Auftrag, und das gehört zur Abrufübung (Rückmeldung mit Erklärung). Folge: Ein Azubi kann sich die Antworten eines Lektionsquizzes über den Quiz-Modus erarbeiten, bevor er es ablegt. Die Ratenbegrenzung bremst nur das Auslesen im Skript. **Entscheidung für Niko:** akzeptieren, oder den Modus auf Fragen bereits bestandener Quizze begrenzen (kleine Änderung in `loadQuizCandidates` und `authorizeQuestion`), oder bei nicht bestandenen Quizzen nur richtig oder falsch ohne Lösung zeigen.
2. **Kein Modell, kein Chat-Anbieter nötig für den Knopf.** Die Texteingabe geht durch die Pipeline, die zuerst prüft, ob ein Chat-Anbieter bereitsteht. Fällt der aus, startet die Bitte per Text nicht, der Knopf geht weiter.
3. **Kein Verlauf im Server, keine Sitzung über Neuladen.** Schließt die Person das Fenster oder lädt neu, ist die Runde weg. Der Wechsel zwischen Widget und Vollbild behält sie.
4. **Spracherkennung:** Der Sprachassistent (`useHaiVoice.ts`) wurde nicht angefasst. Gebaut ist die kleine Schnittstelle: `speechTextOf(frage)` liefert den vorlesbaren Text (Frage, Buchstaben, Optionen, ohne Lösung) und `matchSpokenChoice(text, anzahl)` erkennt "A", "Antwort b", "die zweite", "Option 3" (nur kurze Äußerungen). Die Karte hat einen Knopf "Frage vorlesen" mit der Sprachausgabe des Browsers. **Nächste Stufe:** die Antwort per Sprache. Dazu müsste `useHaiVoice` die erkannte Äußerung an die Quizkarte geben, wenn eine Frage offen ist (statt an den Chat), und die Frage nach dem Aufbau der Karte selbst vorlesen. Das ist ein Eingriff in die Datei, die ein anderer Agent umbaut, und ohne Test mit echter Spracherkennung nicht sicher.
5. **Die Frage wird nicht in den Chatverlauf geschrieben.** Der Chat zeigt die Karte unter den Nachrichten, die Nachrichten selbst bleiben normale Chatnachrichten.
6. **Ein Thema aus dem Text hat Vorrang vor dem Enabler-Kontext** (Abschnitt 2). Wer im Enabler "Frag mich zu Netzwerken ab" schreibt, bekommt Netzwerke über alle Enabler.
7. **Golden Set:** Die Bitte "Teste mich zur Beschaffung mit einer Quizfrage." (Fall AL-08) gehört seit dem Quiz-Modus zur festen Erkennung. Der Fall wurde auf "Stelle mir eine Quizfrage zur Beschaffung." umformuliert, damit er den Weg über das Modell weiter prüft (siehe `docs/hai-golden-set.md`).
8. **Alte Quizanfrage:** Die Eingabe "/quiz" und die Karte "Quiz starten" auf dem Startbildschirm des Vollbilds führen jetzt in den Quiz-Modus (Erkennung von "/quiz"). Der bisherige Weg über das Modell bleibt für andere Formulierungen (zum Beispiel "Erstelle mir ein Quiz").

## 7. Dateien

| Teil | Ort |
|---|---|
| Reine Regeln (Mischen, Prüfen, Thema, Sprache) | `src/lib/hai/quizMode/logic.ts` |
| Erkennung der Bitte und fester Antworttext | `src/lib/hai/quizMode/detect.ts`, `start.ts` |
| Zugriff und Fragen aus der Datenbank | `src/lib/hai/quizMode/access.ts` |
| Eingaben, Ratenbegrenzung | `src/lib/hai/quizMode/validate.ts`, `limits.ts` |
| Zustand der Sitzung im Browser, Aufrufe | `src/lib/hai/quizMode/session.ts`, `client.ts` |
| Routen | `src/app/api/hai/quiz-mode/next/route.ts`, `answer/route.ts` |
| Oberfläche | `src/components/hai/HaiQuizCard.tsx`, `HaiQuizMode.tsx` (Zustand), `HaiQuizPanel.tsx` (Knopf und Platz im Chat) |
| Texte | `src/locales/de.json`, `en.json` (Schlüssel `hai.quiz.*`) |
| Eingriffe in bestehende Dateien | `ragPipeline.ts` (Erkennung vor dem Modell), `chat/route.ts` (Signal in der Antwort), `HaiProvider.tsx` (Signal öffnet die Karte), `HaiChat.tsx` (Knopf und Platz), `HaiWrapper.tsx` (Zustand über dem Chat) |
| Tests | `tests/unit/hai/quizMode.*.test.ts`, `tests/integration/api/hai/quiz-mode.test.ts`, `tests/unit/components/hai/HaiQuizCard.test.tsx`, `HaiQuizMode.test.tsx` |
