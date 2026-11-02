# HAI: Begründungen bei Ablehnungen

Stand: 02.11.2026. Auftrag von Niko: Wenn die HAI wegen Berechtigungen oder Zugriffen etwas nicht kann, gibt sie eine valide Begründung, warum sie es nicht kann. Der Test in der Preview steht im Testplan (`docs/hai-testplan.md`, Abschnitt I).

## 1. Zweck

Jede Ablehnung der HAI, die an Berechtigung, Rolle, Beruf, Freischaltung, Reihenfolge der Arbeit, Plan oder Schalter hängt, nennt in einem freundlichen deutschen Satz

1. was nicht geht,
2. den Grund in einer groben, wahren Kategorie,
3. was stattdessen möglich ist.

Eine technische Störung wird nie als fehlende Berechtigung ausgegeben und eine fehlende Berechtigung nie als Störung. Das gilt für die festen Texte der Pipeline (sie stehen vor Suche und Modell, kein Modellaufruf) und für Antworten des Sprachmodells (der Prompt trägt dann einen kurzen Hinweis).

Die Texte und Kategorien stehen an einer Stelle: `src/lib/hai/denial.ts` (rein, ohne Serverimporte, damit Pipeline, Prompt, Routen, Browser und Tests dieselbe Quelle nutzen). Was die Oberfläche zeigt, liegt in den Locale-Dateien (`hai.denial.*`, `hai.action.card.error.*`, `hai.quiz.error.*` in `src/locales/de.json` und `en.json`), was die Pipeline selbst sendet, sind Konstanten in `denial.ts`.

## 2. Die Kategorien

| Kategorie | Bedeutung in Klartext | Wo sie im Text steht |
|---|---|---|
| `ROLLE` | nicht für deine Rolle vorgesehen | "für deine Rolle", bei Seiten zusätzlich der Bereich grob (Trainerbereich, Verwaltungsbereich der Administratoren) |
| `BERUF` | gehört nicht zu deiner Ausbildung | "gehört nicht zu deiner Ausbildung", "Ausbildungsberuf, der für dich nicht freigeschaltet ist" |
| `GESPERRT` | gesperrt wegen der Reihenfolge der Arbeit | "weil in der Reihenfolge der Arbeit zuerst ... abgeschlossen sein muss" |
| `LOESUNGSSCHUTZ` | Musterlösungen nur für Trainer, Quizantworten erst nach dem bestandenen Quiz | "(Lösungsschutz)", "Trainern vorbehalten", "nach dem bestandenen Quiz" |
| `FREIGABE` | noch nicht freigeschaltet, das Konto wartet auf Freigabe | "freigeschaltet", "wartet noch auf die Freigabe" |
| `ORGANISATION_PLAN` | in deiner Organisation oder deinem Plan nicht enthalten | "in deiner Organisation oder deinem Plan nicht enthalten" |
| `SCHALTER_AUS` | für deine Organisation ausgeschaltet | "für deine Organisation ausgeschaltet" |
| `ZUSTAENDIGKEIT` | nur für die eigenen Auszubildenden | "Zuständigkeit", "nur zu den eigenen Auszubildenden" |
| `UMFANG` | in deinen freigeschalteten Inhalten nichts gefunden (das heißt nicht, dass es nichts gibt) | "in deinen freigeschalteten Inhalten", "das heißt aber nicht, dass es ihn nicht gibt" |

Dazu zwei Fälle ohne Kategorie, weil sie keine Berechtigung sind und das im Text auch so stehen soll:

- **Technische Störung** (Abfrage schlägt fehl): "... weil eine technische Störung vorliegt und nicht, weil dir etwas fehlt."
- **Unbekannte Seite**: "Diese Seite kenne ich nicht, deshalb kann ich sie nicht öffnen, das hat nichts mit deinen Rechten zu tun."

`DENIAL_KEYWORDS` in `denial.ts` hält je Kategorie ein Muster, mit dem Tests und das Prüfset prüfen, ob ein Text den Grund nennt (`namesDenialReason`).

## 3. Bestandsaufnahme: Fall, Stelle, Text, Kategorie

Spalte "heute" ist der Text vor dieser Änderung (gekürzt), Spalte "neu" der Text danach (gekürzt, der volle Wortlaut steht in `denial.ts` und in den Locale-Dateien).

### 3.1 Feste Texte der Pipeline (vor Suche und Modell)

| Fall | Stelle im Code | Heute | Neu | Kategorie |
|---|---|---|---|---|
| Persona ohne Beruf (neutral) | `ragPipeline.ts` `personaRefusal`, Text `DENIAL_NEUTRAL_TEXT` (früher `NEUTRAL_REFUSAL` in `persona.ts`) | "... weil deinem Konto kein Ausbildungsberuf zugeordnet werden konnte ..." | "... weil deinem Konto noch kein Ausbildungsberuf freigeschaltet oder zugeordnet werden konnte (oder weil die Prüfung gerade gestört ist) ... wende dich an deinen Trainer, er kann den Beruf für dich einrichten." | `FREIGABE` |
| Frage zu einem fremden Beruf | `personaRefusal`, Text `DENIAL_BERUF_TEXT` (früher `FOREIGN_OCCUPATION_TEXT`) | "... das gehört nicht zu deiner Ausbildung ..." | "... gehört nicht zu deiner Ausbildung, sondern zu einem anderen Ausbildungsberuf ... mit Lernfeldern, Aufgaben oder der Prüfungsvorbereitung." Nennt den anderen Beruf nicht. | `BERUF` |
| Musterlösung, Trainerlösung, Bewertungsschlüssel | `solutionRequest.ts` `SOLUTION_REFUSAL_TEXT` = `DENIAL_LOESUNGSSCHUTZ_TEXT` | "Die Lösung gebe ich nicht heraus, aber ich helfe dir gern mit Leitfragen und Hinweisen." | "Die Lösung gebe ich nicht heraus (Lösungsschutz): Musterlösungen und Bewertungsschlüssel sind Trainern vorbehalten, richtige Quizantworten gibt es erst nach dem bestandenen Quiz ... Leitfragen und Hinweisen" | `LOESUNGSSCHUTZ` |
| Themenfremde Frage | `persona.refusalText`, `getOffTopicResponse` | "Das liegt leider außerhalb meines Fachgebiets ..." | unverändert | keine: Fachgebiet der HAI, kein Zugriffsgrund (FIAE-Text Byte für Byte, Baseline) |
| Aktion in der falschen Rolle | `actionFlow.ts` (Vorschlag), `actions.ts` `executeAction` (Ausführung) | "Diese Aktion ist nur für Auszubildende möglich." und "... nur für Trainer möglich." | "Diese Aktion ist nur für Trainer vorgesehen, deshalb kann ich sie für deine Rolle als Azubi nicht ausführen ... zeigen, wo du den Stand deiner Abgaben und Nachweise findest." (und das Gegenstück für Trainer) | `ROLLE` |
| Aktion, Eintrag eines nicht freigeschalteten Berufs (403) | `actionGuards.ts` `fromResponse` | "Für diesen Beruf ist die Aktion nicht erlaubt." | "... weil der Eintrag zu einem Ausbildungsberuf gehört, der für dich nicht freigeschaltet ist." | `BERUF` |
| Aktion, Eintrag fehlt, fremd oder nicht zuständig (404) | `actionGuards.ts` `notFound` | "Datensatz nicht gefunden." | "Diesen Eintrag finde ich in deinen freigeschalteten Inhalten und in deinem Zuständigkeitsbereich nicht, das heißt aber nicht, dass es ihn nicht gibt ..." Für fehlend und fremd derselbe Text. | `UMFANG` (und `ZUSTAENDIGKEIT`) |
| Aktion, Enabler gesperrt | `actions.ts` `completeEnabler` | "Der Enabler ... ist noch gesperrt. Schließe zuerst ... ab." | "... gesperrt, weil in der Reihenfolge der Arbeit zuerst ... abgeschlossen sein muss. Schließe ... ab, dann kannst du ihn abschließen." | `GESPERRT` |
| Aktion, Prüfung gestört (503) | `actionGuards.ts` `unavailable` | "Die Berechtigung kann gerade nicht geprüft werden ..." | "... weil eine technische Störung vorliegt und nicht, weil dir etwas fehlt." | technisch |
| Aktion ohne Bestätigung (400) | `api/hai/action/route.ts` | "Die Aktion muss ausdrücklich bestätigt werden." | unverändert, die Karte sendet immer `confirmed: true`, die Person sieht den Fall nicht | Sicherheitsregel, keine Kategorie |
| Aktion, Angaben fehlen oder ungültig | `actionPolicy.ts` | "Ungültige Kennung." und ähnliche | unverändert, kein Zugriffsgrund | keine |
| Navigation, Seite eines anderen Bereichs | `navigation/resolve.ts` `denied` | "Diese Seite kann ich dir nicht öffnen. Ich bringe dich gern zu ... zum Beispiel ..." (derselbe Text für unbekannt und fremd) | "Diese Seite kann ich dir nicht öffnen, weil sie zum Trainerbereich gehört und für deine Rolle nicht freigegeben ist. Ich bringe dich gern zu ..." (oder "zum Verwaltungsbereich der Administratoren") | `ROLLE` |
| Navigation, "Weiter lernen" als Trainer | `navigation/resolve.ts` `resolveContinue` | derselbe Text wie oben | "Weiter lernen kann ich nur für Auszubildende anbieten, es ist für deine Rolle nicht vorgesehen ..." | `ROLLE` |
| Navigation, unbekannte Seite | `navigation/intent.ts` (neue Absicht `unknown_page`), `resolve.ts` | ging an das Modell | "Diese Seite kenne ich nicht, deshalb kann ich sie nicht öffnen, das hat nichts mit deinen Rechten zu tun ..." | keine, ausdrücklich kein Berechtigungsgrund |
| Navigation, Enabler oder Use Case nicht gefunden | `resolve.ts` `NOT_FOUND_TEXT` = `DENIAL_RECORD_NOT_FOUND_TEXT` | "Dazu finde ich in deinem Lernstoff keinen passenden Eintrag." | "In deinen freigeschalteten Inhalten habe ich dazu keinen passenden Eintrag gefunden, das heißt aber nicht, dass es ihn nicht gibt ..." | `UMFANG` |
| Navigation, Enabler gesperrt | `resolve.ts` | "Der Enabler ... ist noch gesperrt. Schließe zuerst ... ab." | "... ist noch gesperrt, weil in der Reihenfolge der Arbeit zuerst ... abgeschlossen sein muss. Schließe ... ab, dann wird er frei, und bis dahin helfe ich dir gern bei ..." Titel nur, wie die Seite sie dem Azubi ohnehin zeigt. | `GESPERRT` |
| Navigation, alle offenen Enabler gesperrt | `resolve.ts` (`DENIAL_ALL_LOCKED_TEXT`) | "Im Moment ist für dich kein Enabler freigeschaltet." | "... noch gesperrt (Reihenfolge der Arbeit oder eine Sperre deines Trainers) ... er sagt dir, was noch fehlt." | `GESPERRT` |
| Navigation, kein Kurs freigeschaltet | `resolve.ts` (`DENIAL_NO_COURSE_TEXT`) | "Dir ist noch kein Kurs mit Enablern zugeordnet." | "Für dich ist noch kein Kurs mit Enablern freigeschaltet ... er kann dich einem Kurs zuordnen." | `FREIGABE` |
| Navigation, Abfrage gestört | `resolve.ts` `NAVIGATION_UNAVAILABLE_TEXT` = `DENIAL_TECHNICAL_TEXT` | "Das kann ich gerade nicht prüfen." | "... weil eine technische Störung vorliegt und nicht, weil dir etwas fehlt." | technisch |

### 3.2 Routen und Oberfläche (stabile Codes, Texte aus den Locale-Dateien)

Die Codes sind neu oder ergänzt, bestehende Codes bleiben (`VOICE_DISABLED`, `ENABLER_LOCKED`, `QUESTION_ATTEMPTS_EXCEEDED`, `AWAITING_ACTIVATION`, `RATE_LIMITED`).

| Fall | Stelle im Code | Heute | Neu | Kategorie |
|---|---|---|---|---|
| PRO-Plan fehlt | `api/hai/chat`, `api/hai/action`, `api/hai/quiz-mode/*`: 403 mit neuem Code `PRO_REQUIRED` | Chat zeigte "Ups, da ist etwas schiefgelaufen" | `HaiProvider` zeigt `hai.denial.planRequired`, die Aktionskarte `...error.plan`, die Quizkarte `...error.planRequired` | `ORGANISATION_PLAN` |
| Konto wartet auf Freigabe | `auth/session.ts` (unverändert): 403 `AWAITING_ACTIVATION` | Chat: "Ups ...", Quizkarte: "Dafür hast du keine Berechtigung." | `hai.denial.awaitingActivation`, `...error.awaitingActivation` | `FREIGABE` |
| Sprachassistent ausgeschaltet | `api/hai/chat` (gesprochene Frage), Sprachrouten: 403 `VOICE_DISABLED` | Chat: "Ups ..." | `hai.denial.voiceDisabled`: "... ausgeschaltet (Grund: Schalter der Organisation). Du kannst mir stattdessen schreiben ..." | `SCHALTER_AUS` |
| Gesperrter Enabler im Quiz-Modus | 403 `ENABLER_LOCKED` oder `QUIZ_LOCKED`, `hai.quiz.error.locked` | "Dieser Enabler ist noch gesperrt. Schließe zuerst den davor ab." | "... gesperrt, weil in der Reihenfolge der Arbeit zuerst der davor abgeschlossen sein muss ..." | `GESPERRT` |
| Kurs nicht zugewiesen (Quiz-Modus) | `quizMode/access.ts`: 403 mit neuem Code `COURSE_NOT_ASSIGNED` | "Dafür hast du keine Berechtigung." | `hai.quiz.error.notAssigned`: "Der Kurs zu dieser Frage ist dir noch nicht zugewiesen ..." | `FREIGABE` |
| Sonstiges 403 im Quiz-Modus | `hai.quiz.error.forbidden` | "Dafür hast du keine Berechtigung." | "Dafür ist dein Konto nicht freigeschaltet: Der Inhalt gehört nicht zu deiner Ausbildung oder der Kurs ist dir noch nicht zugewiesen ..." | `BERUF` oder `FREIGABE` |
| Frage nicht auffindbar (404) | `hai.quiz.error.notFound` | "Diese Frage steht nicht mehr zur Verfügung." | "Diese Frage finde ich in deinen freigeschalteten Inhalten nicht (mehr), das heißt aber nicht, dass es sie nie gab ..." (fehlend und fremder Beruf gleich) | `UMFANG` |
| Lösung zurückgehalten | `hai.quiz.withheld.note` | "Die richtige Lösung ... siehst du, sobald du das Quiz ... bestanden hast." | "Zum Schutz der Lösung siehst du ..." | `LOESUNGSSCHUTZ` |
| Versuchsgrenze je Frage | 429 `QUESTION_ATTEMPTS_EXCEEDED`, `hai.quiz.error.attemptsExceeded` | "Diese Frage hast du in der letzten Stunde schon mehrfach beantwortet ..." | "Aus Gründen des Lösungsschutzes ist die Zahl der Versuche je Frage begrenzt ..." | `LOESUNGSSCHUTZ` |
| Keine Quizfragen im Umfang | `hai.quiz.empty.no_content`, `...no_topic_match` | "Dazu gibt es für dich noch keine Quizfragen." | "In deinen freigeschalteten Enablern habe ich dazu keine Quizfragen gefunden, das heißt aber nicht, dass es keine gibt ..." | `UMFANG` |
| Zu viele Anfragen | 429 `RATE_LIMITED` (Quiz-Routen, Sprachrouten), `hai.quiz.error.rateLimited`, `hai.denial.rateLimited` | "Das ging zu schnell." | "Du hast in kurzer Zeit sehr viele Anfragen gestellt ... Begrenzung zum Schutz der Plattform und kein Problem mit deinen Rechten." | keine, ausdrücklich keine Berechtigung |
| Eingabe leer oder zu lang | `api/hai/chat` 400, `hai.denial.inputInvalid` | "Ups, da ist etwas schiefgelaufen" | "Deine Nachricht konnte nicht verarbeitet werden, zum Beispiel weil sie leer oder zu lang ist (höchstens 5000 Zeichen) ..." | keine |
| Aktionskarte, Fehler nach Status | `HaiProvider` `actionErrorKey`, Route sendet `denial` | nur nach Status ("nicht erlaubt") | nach Kategorie: `role`, `occupation`, `locked`, `notResponsible`, `plan`, `awaitingActivation`, `notFound` | `ROLLE`, `BERUF`, `GESPERRT`, `ZUSTAENDIGKEIT`, `ORGANISATION_PLAN`, `FREIGABE`, `UMFANG` |
| Fehler des Servers (500, 502, 503) | alle Routen | allgemeine Meldung | unverändert allgemeine Meldung, nie als Recht dargestellt | technisch |

### 3.3 Antworten des Sprachmodells (Prompt)

Der Prompt erhält den Abschnitt "Begründung bei Zugriffsgrenzen" (`buildAccessReasonRules` in `prompts.ts`) nur dann, wenn der Kontext der Runde einen Grund trägt (`accessReasons` in `PromptContext`, gebildet in `accessReasons.ts`). Ohne Grund bleibt der Prompt Byte für Byte wie bisher (FIAE-Baseline `tests/unit/hai/fixtures/fiae-baseline.json` unverändert). Der Abschnitt steht vor den Zusatzregeln für Grenzfälle, die das letzte Wort behalten.

| Fall | Schlüssel | Wann die Pipeline ihn setzt | Kategorie |
|---|---|---|---|
| Leere Suche im Umfang der Person | `UMFANG_SEARCH` | Vektorsuche und PageIndex liefen und fanden nichts | `UMFANG` |
| Geöffneter Enabler oder Kurs außerhalb der Berufe der Person | `UMFANG_CONTEXT` | die Chat-Route hat die Kennung verworfen (`contextDropped`) | `UMFANG` |
| Azubi fragt nach einer Lösung oder richtigen Antwort | `LOESUNGSSCHUTZ_ANSWER` | Audience Azubi (aus der Datenbank) und ein Wort wie Lösung, Schlüssel, Antwort, richtig | `LOESUNGSSCHUTZ` |
| Azubi fragt nach Daten anderer Azubis | `ROLLE_OTHERS_DATA` | enges Muster ("meine Azubis", "Noten von den Azubis", "offene Bewertungen") | `ROLLE` |
| Trainer fragt nach einer Person, die nicht zu seinen Azubis gehört | `ZUSTAENDIGKEIT_TRAINEE` | die Datenzeile des Datenkontexts meldet "nicht gefunden" (`dataContext.ts`) | `ZUSTAENDIGKEIT` |

Die Regeln im Abschnitt: Grund nur aus der festen Liste der Kategorien nennen, keinen anderen Grund erfinden, eine technische Störung nie als fehlende Berechtigung ausgeben, nie Namen, Titel, Kennungen, Inhalte oder Zahlen aus einem anderen Beruf, aus Trainerbereichen oder von anderen Personen und nie einen Teil einer Lösung nennen, bei keinen Treffern "in deinen freigeschalteten Inhalten habe ich dazu nichts gefunden" sagen und nicht "es gibt nichts", am Ende eine Alternative nennen.

Die Hinweise sind feste Konstanten (`ACCESS_REASONS` in `denial.ts`). Es gelangt kein Text des Nutzers oder eines Datensatzes hinein.

### 3.4 Nicht geändert, mit Grund

- **Themenfremde Fragen** (`refusalText`): kein Zugriffsgrund, sondern das Fachgebiet der HAI. Der FIAE-Text bleibt Byte für Byte erhalten (Baseline).
- **Zusatzregeln für Grenzfälle** im Prompt (Beispielsatz zur Lösung): Eine Änderung würde die FIAE-Baseline ändern. Der neue Abschnitt ergänzt sie, ersetzt sie nicht.
- **Sprachanbieterkette** (`src/lib/hai/voice/*`, `NOT_CONFIGURED`, `UPSTREAM_FAILED`): technische Rückfälle ohne Berechtigung, die Kette wechselt von selbst. Der Schalter je Organisation kommt über `VOICE_DISABLED` und die Locale-Texte.
- **Schalter `HAI_TRAINER_SOLUTIONS`**: Auf master gibt es ihn nicht. Er steht nur in den Release Notes. Eine Ablehnung dazu ist nicht im Code, ein Text dafür deshalb noch nicht möglich. Kommt der Schalter, gehört er mit dem Grund `LOESUNGSSCHUTZ` an dieselbe Stelle wie die Lösungsablehnung.
- **Ratenbegrenzung der Chat-Route**: Die Chat-Route hat keine (nur die Quiz- und Sprachrouten haben eine). Der Text dafür ist vorbereitet (`hai.denial.rateLimited`), er erscheint, sobald die Route 429 sendet.
- **`persona.ts`** (gerade in Arbeit anderer): `NEUTRAL_REFUSAL` und `FOREIGN_OCCUPATION_TEXT` stehen dort weiter, die Pipeline sendet sie nicht mehr. Aufräumen, sobald die Datei frei ist.
- **Admin-Routen des Index** (`embed`, `sync`, `session`, `insights`, `verify-pin`) und die Admin-Oberfläche der HAI: kein Gespräch mit der HAI, hier gilt der allgemeine Zugriffsfehler der Plattform.
- **`useHaiVoice`** und die Sprachclients: unverändert. Eine gesprochene Frage läuft über den Chat und zeigt dieselben Texte.
- **`HaiNavigationCard`**: zeigt nur ein bereits geprüftes Angebot, ein Pfad außerhalb der Liste wird nie als Karte gezeigt. Es gibt hier keinen Fehlerfall mit Berechtigung.

## 4. Sicherheitsgrenze

Die Begründung darf nichts verraten, was die Person nicht wissen darf. Sie sagt, dass etwas nicht verfügbar ist und warum, in einer groben Kategorie, und nennt nie Namen, Kennungen, Inhalte oder Zahlen eines fremden Berufs, eines Trainerbereichs oder einer anderen Person.

- **Fremder Beruf:** `BERUF` nennt, dass es nicht zur Ausbildung gehört, nie den Titel und nie den Namen des anderen Berufs. Die Fremdberufserkennung (Persona) bleibt vor Suche und Modell.
- **Navigation:** Bei einer Seite eines anderen Bereichs nennt der Text den Bereich grob (Trainerbereich, Verwaltungsbereich der Administratoren), nie den Namen einer Seite. Die Beispiele sind Seiten der eigenen Ebene. Eine unbekannte Seite sagt "kenne ich nicht" und nennt keinen Berechtigungsgrund. Ein gesperrter Enabler nennt nur Titel, die die Seite dem Azubi ohnehin zeigt.
- **Lösungsschutz:** unverändert streng. Der Text sagt, dass es die Lösung nicht gibt und warum (Regel), nie einen Teil der Lösung. Die feste Ablehnung steht vor Suche und Modell.
- **Fehlend gleich fremd:** Ein Eintrag, den es nicht gibt, und einer eines anderen Berufs oder einer anderen Organisation bekommen denselben Text (`UMFANG`, "in deinen freigeschalteten Inhalten ... nicht gefunden, das heißt aber nicht, dass es ihn nicht gibt"). So lässt sich daraus nicht schließen, ob es ihn anderswo gibt.
- **Rolle, Beruf und Freischaltung** kommen weiter vom Server (Datenbank und Sitzung), nie aus der Nachricht. Die Hinweise an das Modell hängen an der Audience aus der Datenbank, eine behauptete Rolle ändert sie nicht.
- **Nur feste Texte im Prompt:** Der Abschnitt "Begründung bei Zugriffsgrenzen" enthält nur Konstanten.

Tests dazu: `tests/unit/hai/denial.test.ts` (jeder Text: Grund genannt, Alternative, kurz, ohne Gedankenstrich, ohne Namen oder Kennungen aus einem Fremdberuf-Fixture), `tests/unit/hai/prompts.accessReasons.test.ts`, `tests/unit/hai/ragPipeline.retrieval.test.ts` (Hinweise im Prompt, keine Namen im Abschnitt) und die Routentests unten.

## 5. Prüfungen

| Was | Datei |
|---|---|
| Kategorien, feste Texte, Schlüssel der Oberfläche in Deutsch und Englisch, Auswahl des Schlüssels nach Status und Code | `tests/unit/hai/denial.test.ts` |
| Abschnitt im Prompt nur mit Grund, Liste der Kategorien, Erkennung der Gründe | `tests/unit/hai/prompts.accessReasons.test.ts`, `tests/unit/hai/ragPipeline.retrieval.test.ts` |
| Navigation: Bereich grob, unbekannte Seite, gesperrt, nicht gefunden, nichts offen | `tests/unit/hai/navigation.resolve.test.ts`, `navigation.intent.test.ts`, `goldenNavigation.pipeline.test.ts` mit `golden/hai-navigation-cases.json` (NG-09, NG-10), `ragPipeline.navigation.test.ts`, `tests/integration/api/hai/chat-navigation.test.ts` |
| Aktionen: Rolle, Beruf, nicht gefunden gleich fremd, technische Störung ohne Kategorie, `PRO_REQUIRED` | `tests/unit/hai/ragPipeline.actions.test.ts`, `tests/integration/api/hai/action-confirmation.test.ts` |
| Chat-Route: `PRO_REQUIRED`, `VOICE_DISABLED`, verworfener Kontext | `tests/integration/api/hai/chat-voice.test.ts`, `chat-persona.test.ts` |
| Quiz-Modus: `PRO_REQUIRED`, `COURSE_NOT_ASSIGNED`, Fehlertexte der Karte | `tests/integration/api/hai/quiz-mode.test.ts`, `tests/unit/hai/quizMode.client.test.ts`, `tests/unit/components/hai/HaiQuizCard.test.tsx` |
| Browser: Grund statt "Fehler" im Chat und in der Aktionskarte | `tests/unit/components/hai/HaiProvider.test.tsx` |
| Lösungsschutz | `tests/unit/hai/solutionRequest.test.ts` |
| Prüfset: Fälle DR-01 bis DR-06 mit `expected.reason`, Bewertung `missing_reason` | `tests/unit/hai/golden/hai-golden-set.json`, `goldenSet.test.ts`, `goldenSet.pipeline.test.ts`, `docs/hai-golden-set.md` |

## 6. Wo man neue Fälle ergänzt

1. **Neuer fester Text der Pipeline:** Konstante oder Funktion in `src/lib/hai/denial.ts`, mit Kategorie, mit dem Grund in Klartext (ein Stichwort aus `DENIAL_KEYWORDS`) und mit einer Alternative. Eine Zeile in `TEXTS` in `tests/unit/hai/denial.test.ts` ergänzen, dann prüft der Test Grund, Alternative, Kürze, Gedankenstrich, Umlaute und fremde Namen.
2. **Neuer Text der Oberfläche:** Schlüssel in `src/locales/de.json` und `en.json` (`hai.denial.*` für den Chat, `hai.action.card.error.*`, `hai.quiz.error.*`), Auswahl in `chatFailureKey` (`denial.ts`), `actionErrorKey` (`HaiProvider.tsx`) oder `errorKeyFor` (`quizMode/client.ts`), und der Schlüssel in der Liste `KEYS` in `denial.test.ts`.
3. **Neuer stabiler Code einer Route:** additiv (`DENIAL_CODES` in `denial.ts`), bestehende Codes bleiben. Die Route sendet ihn mit dem 403 oder 429, ein Routentest prüft ihn.
4. **Neuer Grund für das Modell:** Schlüssel in `ACCESS_REASON_KEYS` und `ACCESS_REASONS` (`denial.ts`, mit fester Notiz ohne Namen und Zahlen), Erkennung in `detectAccessReasons` (`accessReasons.ts`), Test in `prompts.accessReasons.test.ts`.
5. **Neuer Fall im Prüfset:** Fall in `tests/unit/hai/golden/hai-golden-set.json` mit `expected.reason` (siehe `docs/hai-golden-set.md`), bei einem Navigationsfall in `hai-navigation-cases.json`.
6. **Immer:** Die Sicherheitsgrenze aus Abschnitt 4 prüfen. Kommt ein Titel, ein Name oder eine Zahl in den Text, gehört sie in eine Funktion, deren Eingabe nur Daten der Person selbst sind, und der Fall bekommt einen Test mit einem Fremdberuf-Fixture.
