# HAI Werkzeuge für die Oberfläche: Seiten öffnen und Eingaben machen

Stand: 03.11.2026. Entwurf und Beschreibung des Pakets "UI-Aktionen" (Branch `feat/hai-ui-aktionen`). Auftrag des Auftraggebers: "Die HAI muss selber durch die UI navigieren können mit Tools, also Seiten öffnen und Eingaben machen."

Vorab: Alles hier hängt am Schalter `HAI_UI_ACTIONS` (Standard AUS). Ohne den Schalter ist das Verhalten der HAI Byte für Byte das bisherige (Prompt, Antwort, Ereignisse, Browser).

## 1. Zielbild

Die HAI geht für die Person durch die Oberfläche, **sichtbar und kontrollierbar**:

| Werkzeug | Wirkung | Schreibt in die Datenbank |
|---|---|---|
| `open_page` | Eine Seite aus der festen Zulassungsliste öffnen oder als Karte anbieten (die bestehende Navigation, jetzt in derselben Werkzeugschicht) | nein |
| `fill_form` | Felder des Formulars auf der aktuell offenen Seite im Browser ausfüllen (Werte setzen, markieren, "Rückgängig") | nein, nur Werte im Formular |
| `focus_field` | Den Fokus in ein Feld eines freigegebenen Formulars setzen | nein |
| `scroll_to` | Zu einem freigegebenen Formular oder Feld scrollen | nein |

Das Absenden bleibt bei der Person. Die HAI klickt **nie** auf "Speichern", "Absenden", "Abgeben", "Löschen", "Bezahlen" oder Ähnliches. Schreibaktionen, die es schon gibt (Bericht anlegen, Enabler abschließen), laufen unverändert über die Bestätigungskarte der Aktionsschicht (`actionFlow.ts`, `actionPolicy.ts`), dieses Paket fügt keine hinzu.

## 2. Entscheidung: Block statt Funktionsaufruf

**Geprüft** (`src/lib/hai/providers/*`): Die gemeinsame Schnittstelle `ChatProvider` kennt nur Text hinein und Text heraus (`generateResponse`, `generateResponseStream`). Ein Parameter `tools` oder ein `tool_calls`-Ergebnis kommt in keinem Anbieter vor, Gemini nutzt `tools` nur für die Websuche. Die Kette `chatWithFallback` (Gemini, mit Sokrates als einzigem Rückfall) und der Streaming-Weg reichen nur Textstücke durch.

**Entscheidung: ein streng geparster Block am Ende der Antwort**, serverseitig validiert, mit Rückfall ohne Werkzeug. Gründe:

1. Funktionsaufrufe müssten in allen Anbietern, in der Rückfallkette und im Streaming (halbe Argumente in Deltas) gebaut werden. Das ist ein großer Eingriff in den Antwortweg, der mit dem Schalter AUS trotzdem Risiko trägt.
2. Die Sokrates-Modelle liefern Funktionsaufrufe nicht verlässlich. Ein Block im Text ist für jedes Modell machbar und lässt sich mit einem Parser prüfen.
3. Die Sicherheit liegt ohnehin nicht im Format, sondern in der Prüfung auf dem Server (Abschnitt 6). Ein Block und ein Funktionsaufruf wären danach gleich: ein unvertrauter Vorschlag des Modells.
4. Fällt das Modell aus der Form (kein Block, kaputtes JSON, abgeschnitten), bleibt der Text als Antwort stehen, es passiert nichts am Formular. Das ist der Rückfall ohne Werkzeug.

Form des Blocks, immer als **letztes** in der Antwort, ohne Codezaun:

```
<hai-ui>{"tool":"fill_form","form":"profile_name","fields":{"fullName":"Max Mustermann"}}</hai-ui>
```

Der Server entfernt jeden Block aus dem Text (der Person erscheint nie JSON, auch im Stream nicht), liest nur den ersten, prüft ihn und macht daraus das Ereignis `uiAction`. Ein zweiter Block wird verworfen (ein Formular je Antwort).

## 3. Schema der Werkzeuge

Alles liegt in `src/lib/hai/uiActions/`. Ein Ort für Werkzeuge, Schema und Prüfung.

### 3.1 `open_page`

| | |
|---|---|
| Parameter | `target`: Name eines Menüpunkts oder Ziels, Text bis 60 Zeichen aus Buchstaben, Ziffern, Leerzeichen und Bindestrich (zum Beispiel "Berufsschule", "Enabler 3") |
| Prüfung | Der Name läuft durch **dieselbe** Erkennung und Auflösung wie die bestehende Navigation (`detectNavigationIntent`, `resolveNavigation`): feste Zulassungsliste, Ebene (Azubi, Trainer, Admin), Beruf, Freigabe. Ein Pfad kommt nie vom Modell. |
| Antwort | `navigationOffer` wie bisher, vom Modell vorgeschlagen **immer als Karte mit dem Knopf "Öffnen"** (nie `auto`). Ein klarer Befehl der Person ("Öffne ...") öffnet weiter sofort, das entscheidet die bestehende Navigation vor dem Modell. |
| Bestehendes Verhalten | `handleNavigationMessage` und alle Tests `navigation.*` bleiben unverändert. `open_page` ist nur der zweite Weg, wenn die Erkennung eine Wendung nicht kennt. |

### 3.2 `fill_form`

| | |
|---|---|
| Parameter | `form`: Id aus dem Register. `fields`: Objekt `{ <Feld-Id>: <Wert> }`, höchstens 10 Felder. `entry` (optional): Nummer ab 1, wenn ein Formular auf der Seite mehrfach vorkommt (zum Beispiel mehrere Tätigkeiten im Nachweis). |
| Prüfung | Abschnitt 6. Alles oder nichts: Ist ein Feld ungültig, wird der ganze Aufruf verworfen. |
| Ereignis | `uiAction`: `{ tool: 'fill_form', form, entry?, fields: [{ id, value }], mode: 'apply' \| 'confirm' }` |

### 3.3 `focus_field` und `scroll_to`

| | |
|---|---|
| Parameter | `form`, `field` (bei `focus_field` Pflicht, bei `scroll_to` optional), `entry` (optional) |
| Ereignis | `uiAction`: `{ tool: 'focus_field' \| 'scroll_to', form, field?, entry?, mode: 'apply' }` |
| Wirkung | Nur Fokus und Scrollen. Keine Schreibwirkung, kein Wert. |

### 3.4 Antwort im Stream und im JSON

Das Ereignis steht neben `pendingAction` und `navigationOffer` im Schlussereignis des Streams (`done: true`) und im JSON ohne Stream, als Feld `uiAction`. Ohne Schalter oder ohne gültigen Aufruf fehlt das Feld.

## 4. Ablauf

1. **Nachricht** der Person (Text-Chat oder Sprache) mit dem Seitenkontext des Browsers (`context.page`, `docs/hai-ui-kontext.md`).
2. **Pipeline** wie bisher: Persona-Tor, Lösungsschutz, Quiz-Start, Aktionsschritt, Navigationsschritt. Eine Bitte, die dort schon beantwortet wird, erreicht das Modell nicht.
3. **Prompt:** Ist der Schalter an **und** zeigt die Nachricht der Person selbst eine Eingabe- oder Navigationsabsicht (feste Wortliste, `intent.ts`), steht der Abschnitt "Werkzeuge" im Prompt, hinter Persona-Tor, Schutzregeln und Seitenkontext. Er nennt die erlaubten Formulare **der aktuellen Seite** aus dem Register, nichts Erfundenes.
4. **Modell** schreibt die Antwort, bei Bedarf mit dem Block am Ende.
5. **Server prüft** (`flow.ts`, `validate.ts`): Schalter, Absicht der Nachricht, Rolle, Beruf (Persona vorhanden), aktuelle Seite, Formular-Id, jedes Feld, Werte bereinigen, Grenzen je Antwort und je Zeitraum.
6. **Ereignis `uiAction`** an den Browser (Stream und JSON). Gespeichert werden nur Kennungen (Werkzeug, Formular, Feld-Ids), nie Werte.
7. **Ausführung im Browser** (`uiActionExecutor.ts`): prüft Register und Pfad noch einmal, findet das Formular über `data-hai-form` und die Felder über `data-hai-field`, setzt Werte in Reacts kontrollierte Felder (nativer Setter plus `input` und `change`), markiert die Felder, merkt die alten Werte.
8. **Rückmeldung:** Eine Leiste "Die HAI hat N Felder ausgefüllt, bitte prüfen" mit "Rückgängig" und "Schließen". Der Server hängt an den gespeicherten Antworttext einen festen Satz ("Ich habe N Felder ausgefüllt. Gespeichert ist noch nichts, das tust du selbst.").
9. Die Person prüft und drückt **selbst** auf Speichern.

## 5. Zulassungsregister für Formulare (`registry.ts`)

Je Formular: Id, Beschriftung, Seite (feste Pfade), Rollen, Feldliste. Je Feld: Id, Beschriftung, Typ (`text`, `textarea`, `number`, `select`), Länge oder Zahlenbereich, Aufzählung bei `select`, Pflichtregeln und das Kennzeichen `sensitive`.

| Formular | Seite | Rolle | Felder |
|---|---|---|---|
| `activity_report_entry` Eintrag im Ausbildungsnachweis | `/trainee/activity-reports` | Azubi | `notes` (Text, 1 bis 1500), `hours` (Zahl 0,5 bis 40, Schritt 0,5) |
| `profile_name` Anzeigename im Profil | `/trainee/profile`, `/trainer/profile` | Azubi und Trainer, je auf dem eigenen Pfad | `fullName` (Text, 2 bis 100) |
| `review_feedback` Feedback-Text im Review | `/trainer/reviews` | Trainer | `feedback` (Text, 1 bis 2000) |
| `trainees_search` Suchfeld der Azubi-Liste | `/trainer/trainees` | Trainer | `query` (Text, 0 bis 100) |
| `reviews_search` Suchfeld der Prüfungen | `/trainer/reviews` | Trainer | `query` (Text, 0 bis 100) |
| `reviews_filter` Statusfilter der Prüfungen | `/trainer/reviews` | Trainer | `status` (Auswahl: all, pending, approved, rejected) |

Pflichtregeln, die ein Test für **jedes** Formular und Feld des Registers prüft:

1. Id und Pfad sind eindeutig, der Pfad ist eine feste Route (keine Platzhalter).
2. Die Seitenart (`pageKindForPath`) liegt in der Liste der freigegebenen Arten (Nachweise, Profil, Azubi-Liste und Prüfungen des Trainers). **Nie** Quiz, Enabler, Use Case, Kurs, Lernfeld, Kalender, Verwaltung, "andere Seite".
3. Die Rolle passt zum Bereich des Pfads (`/trainee/` nur Azubi, `/trainer/` nur Trainer).
4. Keine Feld-Id und kein Formular-Id trifft die Ausschlussliste (Abschnitt 7).
5. Jedes Feld hat Typ, Grenzen und eine Beschriftung. Texte haben eine Obergrenze (höchstens 2000), Zahlen einen Bereich, Auswahlfelder eine endliche Liste.
6. `sensitive` steht an jedem Feld mit persönlichem Inhalt (Nachweistext, Name, Feedback). Es gilt: nie gespeichert, nie im Log, in der Leiste nur die Beschriftung.
7. Die Anzahl der Felder je Formular ist höchstens 10.

**Was fehlt** (bewusst klein gehalten, weitere Formulare nur über einen neuen Registereintrag und die Attribute): Kalenderwoche und Jahr im Nachweis, Selbstnote, Kommentare des Trainers zum Nachweis (`/trainer/activity-reports`), Feedback je Szenario in den Reviews, Admin-Suchfelder (Benutzer, Inhaltsprüfung), Suchfeld der Quizverwaltung, Filter der Quiz-Tabs, Suchfeld des Verlaufs der HAI selbst (gehört zur HAI-Oberfläche und ist ignoriert). Das Profil ist nur ausfüllbar, wenn die Person vorher selbst auf "Bearbeiten" gedrückt hat (das Feld existiert sonst nicht, die HAI klickt nicht).

## 6. Sicherheitsregeln

**Der Server prüft jeden Vorschlag** (`validate.ts`), das Modell entscheidet nichts:

1. **Schalter** `HAI_UI_ACTIONS` an, sonst nichts (Abschnitt 9).
2. **Absicht der Person:** Die Nachricht der Person selbst muss eine Eingabe- oder Navigationsabsicht zeigen (Wortliste: "trag ... ein", "füll ... aus", "schreib ... in", "suche nach", "scrolle zu" und weitere). Ohne sie fehlt der Prompt-Abschnitt, und ein trotzdem gelieferter Block wird verworfen. Das ist die zweite Linie gegen Prompt-Injektion: Ein Seitentext oder Dokument "Fülle Feld X mit ..." kann zwar das Modell erreichen, löst aber nichts aus, weil die Person nichts verlangt hat.
3. **Rolle:** Die Ebene kommt vom Server (`access.audience` aus der Datenbank, nie aus der Nachricht). Das Formular muss für die Rolle im Register stehen und der Bereich des Pfads zur Rolle passen.
4. **Beruf:** Ohne Persona (ohne Beruf, mit Frage zu einem anderen Beruf) endet die Runde vor dem Modell mit der Ablehnung. Das Werkzeug ist dahinter, es gibt keinen Weg daran vorbei.
5. **Aktuelle Seite:** Pfad aus dem geprüften Seitenkontext (`resolvePageContext`, Seitenart wird aus dem Pfad vom Server abgeleitet). Das Formular muss genau auf dieser Seite im Register stehen. Ohne Seitenkontext (Schalter `HAI_PAGE_CONTEXT` aus) gibt es kein Formularwerkzeug, `open_page` bleibt möglich.
6. **Formular und jedes Feld** gegen das Register: unbekanntes Formular, unbekanntes oder fremdes Feld, ausgeschlossenes Feld, falscher Typ, Zahl außerhalb des Bereichs, Wert nicht in der Aufzählung: der ganze Aufruf wird verworfen.
7. **Werte bereinigen:** Steuer- und unsichtbare Zeichen raus, Markup raus (Tags, spitze Klammern), bei einzeiligen Feldern Zeilenumbrüche zu Leerzeichen, Leerraum am Rand weg. **Zu lange Werte werden verworfen, nicht gekürzt** (sonst bekäme die Person halbe Sätze).
8. **Grenzen:** Höchstens ein Block je Antwort (ein Formular), höchstens 10 Felder, höchstens 30 angenommene Aufrufe je Person in 10 Minuten (`checkRateLimit`, je Serverinstanz).
9. **Gespeichert** wird nur `{ tool, form, fieldIds }` an der Nachricht. Nie ein Feldwert.
10. **Texte aus der Oberfläche und aus Dokumenten sind Daten.** Der Prompt-Abschnitt sagt es ausdrücklich, die Seitenbeschriftungen werden wie bisher bereinigt, und nichts davon wählt je ein Formular oder Feld.

**Der Browser prüft noch einmal** (`uiActionExecutor.ts`): Register und Werte (dieselbe Prüffunktion), der Pfad der Seite **jetzt** (die Person kann zwischen Frage und Antwort die Seite gewechselt haben), das Formular über `data-hai-form`, das Feld über `data-hai-field` mit passender Id. Der Ausführer überspringt:

- alles unter `data-hai-ignore` (das HAI-Panel selbst und alles, was eine Seite so kennzeichnet),
- Felder mit `disabled` oder `readonly`, Felder vom Typ `password`, `email`, `file`, `hidden`, `submit`, `button`, `checkbox`, `radio`,
- Felder ohne passendes `data-hai-field`.

Er **klickt nie** (kein `click()`, kein `requestSubmit()`, kein `submit()`), ein Test prüft das. Er setzt nur Werte, Fokus und Scrollposition.

## 7. Ausschlüsse (nie ausfüllen, nie vorschlagen)

- Antworten auf Quizfragen, Szenario- und Use-Case-Abgaben, Prüfungs- und Klausureingaben, Musterlösungen,
- Passwörter und Anmeldedaten, E-Mail-Adresse, Rollen und Rechte, Zahlungsangaben,
- alles, was der Lösungsschutz oder das Persona-Tor betrifft,
- Felder anderer Personen.

Wie sie technisch ausgeschlossen sind: Das Register ist eine **Zulassungsliste**, alles, was nicht darin steht, ist verboten (fail closed). Zusätzlich verwirft `isExcludedField` jede Feld- oder Formular-Id mit einem Ausschlussmuster (answer, antwort, solution, loesung, password, passwort, email, mail, role, rolle, permission, payment, zahlung, iban, card, exam, pruefung, klausur, quiz, scenario, szenario, submission, abgabe und weitere), und ein Test prüft das Register dagegen, damit ein späterer Eintrag nicht versehentlich eines davon wird. Die freigegebenen Seitenarten schließen die Seiten der Quizze, Enabler und Use Cases aus.

Trainer dürfen Feedback-Entwürfe ausfüllen lassen (`review_feedback`), Azubis keine Antworten: Es gibt für Azubis kein Formular auf einer Prüfungs-, Quiz- oder Abgabeseite, und der Feedback-Text steht nur für die Rolle Trainer im Register.

## 8. Sprachmodus

- **Seiten öffnen** wie bisher (Befehl öffnet sofort, Frage nach dem Weg bietet die Karte, gesprochenes "ja").
- **Eingaben nur im Text-Chat.** In einer gesprochenen Runde setzt der Server `mode: 'confirm'`: Der Browser füllt **nichts** aus. Die HAI liest vor, was sie eintragen würde, die Leiste zeigt die Felder und die Werte zur Prüfung mit den Knöpfen "Eintragen" und "Verwerfen". Ausgeführt wird erst nach einem Tipp oder nach einem **getippten** "ja" im Text-Chat. Ein gesprochenes "ja" führt nichts aus.
- Grenze: Das gesprochene "ja" gilt für Seiten, nicht für Eingaben. Wer im Sprachmodus etwas eintragen lassen will, bestätigt im Text.
- `focus_field` und `scroll_to` sind harmlos und gelten wie im Text-Chat (`mode: 'apply'`).

## 9. Schalter

- `HAI_UI_ACTIONS` mit `on` oder `off` (auch `true`, `false`, `1`, `0`, `yes`, `no`).
- **Ohne Wert: AUS überall** (Preview, lokal, Tests, Production). Anders als `HAI_PAGE_CONTEXT`, das in Preview an ist.
- Plan: In Vercel nur **Preview** später auf `on`, Production bleibt AUS bis zum Go. Der offene Punkt steht in `docs/go-checkliste.md` (V10).
- Aus: Kein Prompt-Abschnitt, kein Block wird erkannt oder entfernt, kein Ereignis, der Browser tut nichts. Der Prompt und die Antworten sind Byte für Byte die bisherigen.
- Abhängigkeit: Für Formulare braucht es auch `HAI_PAGE_CONTEXT` (der Seitenkontext liefert den Pfad).

## 10. Dateien

| Datei | Aufgabe |
|---|---|
| `src/lib/hai/uiActions/config.ts` | Schalter `HAI_UI_ACTIONS` |
| `src/lib/hai/uiActions/registry.ts` | Zulassungsregister, Ausschlussliste, Seitenarten |
| `src/lib/hai/uiActions/values.ts` | Bereinigung und Prüfung der Werte (Server und Browser) |
| `src/lib/hai/uiActions/event.ts` | Ereignis `uiAction`, Prüfung im Browser (rein, ohne Server) |
| `src/lib/hai/uiActions/validate.ts` | Prüfung eines Vorschlags gegen Rolle, Seite und Register |
| `src/lib/hai/uiActions/parse.ts` | Block parsen, aus dem Text entfernen, Filter für den Stream |
| `src/lib/hai/uiActions/intent.ts` | Absicht der Nachricht (Eingabe, Navigation) |
| `src/lib/hai/uiActions/promptSection.ts` | Prompt-Abschnitt "Werkzeuge" |
| `src/lib/hai/uiActions/tools.ts` | Werkzeugliste mit Schema, `open_page` in der Werkzeugschicht |
| `src/lib/hai/uiActions/flow.ts` | Schritt der Pipeline nach der Modellantwort (beide Pipelines) |
| `src/components/hai/uiActionExecutor.ts` | Ausführer im Browser, Speicher für "Rückgängig" |
| `src/components/hai/HaiUiActionBar.tsx` | Leiste "bitte prüfen" mit "Rückgängig" |
| `src/components/hai/HaiProvider.tsx` | Ereignis annehmen, "ja" im Text bei `confirm` |
| `src/lib/hai/ragPipeline.ts`, `src/app/api/hai/chat/route.ts`, `src/lib/hai/prompts.ts` | Einhängen, Ereignis, gespeicherte Kennungen |
| `data-hai-form`, `data-hai-field` | in den Seiten der Tabelle in Abschnitt 5 (Ausbildungsnachweis, Profil, Prüfungen, Azubi-Liste) |

## 11. Prüfungen

Automatische Tests (alle mit Attrappe als Modell, kein echter Modellaufruf):

| Datei | Inhalt |
|---|---|
| `tests/unit/hai/uiActions/registry.test.ts` | Pflichtregeln des Registers für jedes Formular und Feld (feste Route, erlaubte Seitenart, Rolle zum Bereich, Ausschlussliste, Grenzen, `sensitive`, Attribute in den Seiten), Ausschlüsse, Seite und Rolle |
| `tests/unit/hai/uiActions/validate.test.ts` | Schalter (überall AUS ohne Wert), Prüfung jedes Vorschlags (fremdes Formular, fremdes und ausgeschlossenes Feld, falsche Seite, falsche Rolle, zu lang, Typ, Eintrag, mehr als 10 Felder, `__proto__`, gesprochen gleich `confirm`), Bereinigung der Werte (Steuerzeichen, Markup, Zeilenumbrüche, Zahlen, Auswahl), Ereignis im Browser, gespeichert nur Kennungen |
| `tests/unit/hai/uiActions/parse.test.ts` | Block herausschneiden (auch unvollständig, Codezaun, Großschreibung), JSON lesen, Filter für den Stream bei jeder Stücklänge, Absicht der Nachricht, Prompt-Abschnitt (nur Formulare der Seite, Rollen, Regeln), Werkzeugschicht, Prompt Byte-gleich ohne Abschnitt und Platz hinter den Schutzregeln |
| `tests/unit/hai/uiActions/pipeline.test.ts` | `processMessage` und `processMessageStream` mit Attrappe: Werkzeugaufruf kommt als Ereignis, Text ohne Block, Stream gleich gespeicherter Text; ohne Schalter nichts; Block ohne Wunsch der Person verworfen; Seitentext und Verlauf lösen nichts aus; ungültige Aufrufe verworfen mit Hinweis; erster Block; Azubi nie ein Review-Formular und nichts auf einer Quiz-Seite; Trainer-Feedback ja; gesprochen `confirm`; `open_page` nur als Karte, nie ein Pfad, nie Trainerbereich für Azubis; Persona-Tor vor dem Modell; Begrenzung je Zeitraum |
| `tests/unit/components/hai/uiActionExecutor.test.tsx` | jsdom: kontrolliertes React-Feld wird korrekt gesetzt, Markierung, Rückgängig (auch bei eigener Änderung), kein Klick, kein Absenden, kein Netzwerk, `data-hai-ignore` unberührt, gesperrte und falsch getypte Felder, mehrfaches Formular, falsche Seite, Auswahl, Fokus, Scrollen, Modus `confirm`, Leiste, Quelltext ohne Klick- und Netzwerkaufruf |
| `tests/unit/components/hai/HaiUiActions.test.tsx` | Provider: Ereignis füllt das Formular, ungültiges Ereignis nichts, Vollbild weicht, Seitenwechsel, gesprochener Fall mit getipptem "ja", gesprochenes "ja" trägt nichts ein |
| `tests/integration/api/hai/chat-ui-actions.test.ts` | Route mit der echten Pipeline: Ereignis im Stream und im JSON, Text ohne Block, gespeichert nur Kennungen (kein Wert in den Nachrichten), gesprochen `confirm`, ohne Schalter Rohtext, fremde Seite, ohne Seitenkontext, Ereignis im Request ignoriert |

**Browsertest lokal** (03.11.2026, Chrome über playwright-core, Wegwerf-Postgres `supabase/postgres:17.6.1.171` mit allen Migrationen, Attrappe für Auth, Attrappe als Modell, Next-Dev-Server auf Port 3810, danach alles abgeräumt): 55 Prüfungen bestanden, 0 durchgefallen, keine Konsolen- oder Netzwerkfehler. Geprüft: Profil füllen, markieren, Rückgängig, eigene Änderung bleibt, Formular nicht offen, E-Mail im Vorschlag verwirft alles, Injektion, Quiz-Seite, Ausbildungsnachweis mit zwei Tätigkeiten (Nummer nötig, Stunden), Absenden nie (keine neue Zeile in der Datenbank), Trainer-Feedback ohne Genehmigen oder Ablehnen, Suchfeld, gefälschte Seite eines Azubis, `open_page` als Karte, gesprochen `confirm` über die Route, Schalter AUS (kein Abschnitt, keine Leiste). Screenshots liegen im Scratchpad unter `hai_uiaktionen_0311\`.

## 12. Nicht geprüft und Grenzen

- **Kein echtes Modell** (Sokrates, Gemini). Ob ein echtes Modell den Block am Ende der Antwort verlässlich ausgibt und die Felder und die Nummer (`entry`) richtig wählt, ist offen und der erste Teil des Preview-Tests (`docs/hai-testplan.md`, Gruppe P).
- Der gesprochene Weg (Vorschau, getipptes "ja") ist in jsdom und über die Route geprüft, nicht mit Mikrofon im Browser.
- Der Block steht im Antworttext. Bricht das Modell vor dem Ende ab, gibt es keine Aktion, der Text bleibt.
- Die Begrenzung je Zeitraum gilt je Serverinstanz (wie `checkRateLimit` sonst), nicht global.
- Das Profil und Formulare in einem Dialog sind nur ausfüllbar, wenn die Person sie selbst geöffnet hat. Die HAI klickt nie.
- `entry` zählt alle sichtbaren Vorkommen des Formulars in der Reihenfolge der Seite, auch gesperrte (zum Beispiel eine bereits entschiedene Abgabe, die dann nicht gefüllt wird).
- Der Seitenkontext (`HAI_PAGE_CONTEXT`) muss an sein, sonst gibt es kein Formularwerkzeug.

## 13. Offene Entscheidungen

1. Soll der Schalter in Preview gesetzt werden, und wann (nach den Fällen P1 bis P17)?
2. Weitere Formulare aufnehmen (Abschnitt 5, "Was fehlt")? Je Formular ein Registereintrag, drei Attribute und ein Test.
3. Funktionsaufrufe der Sokrates-Modelle später messen. Wenn sie verlässlich sind, kann derselbe Prüfweg (`validate.ts`) hinter einem Funktionsaufruf stehen, das Register bleibt.
