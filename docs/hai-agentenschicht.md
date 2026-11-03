# HAI Agentenschicht: Führung durch die Plattform

Stand: 03.11.2026. Teil des Zielbilds DamiAI. Die HAI hatte schon eine Aktionsschicht mit Bestätigung (Schreibaktionen wie "Bericht anlegen" oder "Enabler abschließen") und Informationsaktionen. Neu ist die Führung: Die HAI bringt die Person gezielt dorthin, wo sie hinwill oder als Nächstes hin sollte. Das Vorbild ist damicon (Werkzeuge für die Oberfläche, Freigabe, Führung), nur gelesen und für die LFA angepasst.

## 1. Zweck

- Die Person sagt, wohin sie will ("öffne meine Berichte", "zeig mir die Berufsschule", "bring mich zum Quiz von Enabler 3") oder wie es weitergeht ("wo geht es weiter"). Bei einer **eindeutigen Aufforderung** ("Öffne ...", "Bring mich zu ...", "Geh zu ...", "Ich will zum ...") **öffnet die HAI die Seite sofort** und sagt kurz "Ich öffne die Seite ...", getippt wie gesprochen. Bei einer **Frage nach dem Weg** ("Wo finde ich ...") oder einer weichen Bitte ("Zeig mir ...", "Ich möchte ... sehen") zeigt sie eine **Karte mit dem Knopf "Öffnen"** und wartet auf den Tipp (gesprochen auf ein "ja").
- Das Modell wählt **nie einen Pfad**. Die Plattform erkennt die Bitte selbst (Stichwörter und Muster, kein Modell), prüft sie gegen eine feste Zulassungsliste, die Rolle, den Beruf und die Freigabe und baut die Antwort auf dem Server. Der Modellaufruf entfällt dabei ganz.
- Eine Navigation **schreibt nie etwas**. Schreibaktionen bleiben bei der Bestätigungskarte der Aktionsschicht. Bei einer Bitte, die beides sein könnte ("öffne meine Berichte und erstelle einen"), gewinnt die Schreibaktion mit ihrer Bestätigung.

## 2. Ziele und Rechte

Die Pfade sind die echten Routen aus `src/app`. Die Ebene (Azubi, Trainer, Admin) kommt vom Server: Azubi oder Trainerebene aus dem Zugriff der Datenbank (`resolveRetrievalAccess`), Admin aus der Sitzung (`me.isAdmin`, gesetzt von der Chat-Route). Weder die Rolle im Request noch ein Text der Nachricht ändern sie. Ein Azubi wird durch kein Flag zum Admin.

| Ziel | Azubi | Trainer | Admin |
|---|---|---|---|
| Dashboard | `/trainee/dashboard` | `/trainer/dashboard` | wie Trainer |
| Berichtsheft, Tätigkeitsnachweise, Ausbildungsnachweis | `/trainee/activity-reports` | `/trainer/activity-reports` | wie Trainer |
| Berufsschule | `/trainee/school` | `/trainer/school` | wie Trainer |
| Kalender | `/trainee/school?tab=calendar` (Blockkalender) | `/trainer/calendar` | wie Trainer |
| Profil | `/trainee/profile` | `/trainer/profile` | wie Trainer |
| Quizze | `/trainee/quizzes` | `/trainer/quiz-management` | wie Trainer |
| Kurse (Menüpunkt "Lernen") | `/trainee/courses` | Ersatzseite `/trainer/content-management` (Angebot, kein Befehl) | wie Trainer |
| Ausbilder-Feedback | `/trainee/trainer-feedback` | nein (nur für Auszubildende, freundliche Ablehnung) | nein |
| Auszubildende | nein | `/trainer/trainees` | wie Trainer |
| Offene Bewertungen | nein | `/trainer/reviews` | wie Trainer |
| Inhaltsverwaltung | nein | `/trainer/content-management` | wie Trainer |
| Statistik | nein | `/trainer/dashboard` (die Kennzahlen der Auszubildenden stehen dort) | `/trainer/admin/content-stats` (Inhaltsstatistik) |
| Organisationen | nein | nein | `/trainer/admin/organizations` |
| Benutzer | nein | nein | `/trainer/admin/users` |
| Enabler nach Nummer oder Name | `/trainee/enablers/<id>` | Hinweis auf die Inhaltsverwaltung | wie Trainer |
| Use Case nach Nummer oder Name | `/trainee/use-cases/<id>` | Hinweis auf die Inhaltsverwaltung | wie Trainer |
| Quiz eines Enablers | `/trainee/enablers/<id>` (die Quizze liegen auf der Seite des Enablers) | nein | nein |
| Weiter lernen | nächster freigeschalteter Enabler | nein | nein |

Anmerkungen zur Liste:

- Für Azubis gibt es eine Seite für "Berichtsheft", "Tätigkeitsnachweise" und "Ausbildungsnachweis": In der Plattform heißt der Menüpunkt "Ausbildungsnachweis" und führt zu den wöchentlichen Tätigkeitsnachweisen. Ein eigenes Ziel dafür gibt es nicht.
- Der Quiz-Modus (HaiQuizCard, `/api/hai/quiz-mode`) liegt noch nicht auf master. Ein Ziel "Quiz-Modus starten" ist deshalb **nicht** angeboten. Es kommt erst, wenn der Modus gemergt ist.
- Ein einfacher Trainer hat keine eigene Statistikseite. Die Kennzahlen seiner Auszubildenden stehen auf dem Dashboard, deshalb führt "Statistik" dorthin. Die Seite der Inhaltsstatistik ist nur für Admin-Ebenen.
- Die Zulassungsliste steht in `src/lib/hai/navigation/targets.ts`. `isAllowedNavigationPath` lässt nur diese Pfade und die beiden Seiten mit einer uuid zu. Der Server prüft jeden Pfad vor dem Angebot, der Browser noch einmal vor dem Öffnen.

## 3. Ablauf

1. **Chat-Route** (`src/app/api/hai/chat/route.ts`): Sitzung, Pro-Plan, bei gesprochener Frage der Schalter der Organisation. Die Route gibt `isAdmin` aus der Sitzung an die Pipeline.
2. **Persona-Tor** (unverändert): Ohne Beruf oder bei einer Frage, die einen anderen Beruf nennt, endet die Runde hier mit der Ablehnung mit Grund (Beruf oder Freigabe, `docs/hai-ablehnungen.md`). Eine Bitte um eine KfBM-Seite von einem FIAE-Azubi (und umgekehrt) kommt nie zur Navigation.
3. **Lösungsschutz und Aktionsschritt** (unverändert): Eine Bitte um eine Lösung wird abgelehnt, eine Schreibaktion wird zum Vorschlag mit Bestätigungskarte.
4. **Navigationsschritt** (`src/lib/hai/navigation/flow.ts`, in `processMessage` und `processMessageStream`):
   - `intent.ts` erkennt die Bitte. Es braucht ein Signal (ein Verb wie "öffne", "bring mich", "geh zu", "zeig mir", "mach ... auf", "nimm mich mit", "kannst du mich zu ... bringen", "ich will zum", eine kurze Richtung wie "zum Dashboard bitte", das Wort "Seite", oder "wo geht es weiter") und ein Ziel. Zahlwörter der Spracherkennung zählen wie Ziffern ("Enabler drei", "Enabler e drei", "Enabler E3"). Der Text wird gefaltet (ä wird ae, ß wird ss, Satzzeichen weg), ein gesprochenes "für" trifft also dasselbe wie ein getipptes. Nicht erkannt werden: Erklärungen, Lösungsbitten, Fragen nach Zahlen ("wie viele Berichte"), Texte über 160 Zeichen und Fragen nach einem Thema ("den Use Case zur Anwendungsentwicklung"). Das Prüfset der HAI läuft als Gegenprobe durch die Erkennung, keine Frage daraus wird zur Navigation.
   - `resolve.ts` löst die Bitte gegen Zulassungsliste, Ebene und Datensätze der Person auf.
   - `isDirectCommand` (ebenfalls `intent.ts`) sagt, WIE es gesagt wurde. **Direkt** (sofort öffnen) sind: "öffne", "geh zu", "bring/führ/leite mich", "navigiere", "wechsle", "spring", "mach ... auf", "ruf ... auf", "nimm mich mit", "lass uns ... gehen", "ich will/möchte zu(m)", "kannst du mich zu ... bringen", die kurze Richtung ("zum Dashboard bitte"), "weiter lernen". **Nur Angebot** bleiben: "zeig mir", "ich möchte ... sehen", "wo finde ich", "wo ist", "wie komme ich", "wo geht es weiter", "was soll ich als Nächstes lernen" (eine Frage nach dem Weg ist kein Befehl, auch nicht mit "öffnen" darin).
   - Die Antwort eines Befehls ist ein kurzer Satz ohne Rückfrage ("Ich öffne die Seite Ausbildungsnachweis."). Ein Angebot hat einen kurzen Text mit dem Grund, der getippt mit dem Hinweis auf den Knopf endet, gesprochen mit "Soll ich sie öffnen?". Eine Ersatzseite (der Trainer fragt nach "Kurse", bekommt die Inhaltsverwaltung) ist immer nur ein Angebot.
5. **Antwort an den Browser:** `navigationOffer` mit `path`, `label` und `reason`, bei einem Befehl zusätzlich `auto: true`, im Schlussereignis des Streams und in der Antwort ohne Stream. Der Text steht in der gespeicherten Antwort des Verlaufs. Das Kennzeichen `auto` setzt nur der Server aus dem Befehl, nie das Modell; der Browser nimmt es nur bei genau `true` und nur für einen Pfad der Zulassungsliste.
6. **Oberfläche:** Trägt das Angebot `auto`, öffnet der `HaiProvider` die Seite sofort über den Router (`attachNavigationOffer`, Prüfung des Pfads gegen die Liste noch einmal im Browser) und setzt die Karte auf "geöffnet". Sonst zeigt `HaiNavigationCard` Seite, Grund und den Knopf "Öffnen", ein Tipp oder Enter öffnet die Seite (`openNavigation`). Ein offener Vollbild-Chat wechselt in die Seitenansicht, damit die Seite sichtbar ist.
7. **Gesprochen:** Ein Befehl öffnet die Seite wie getippt sofort. Der Sprachmodus bleibt aktiv und hört weiter zu (das Maskottchen wird klein am Rand, wie bisher bei einer geöffneten Seite), die HAI sagt nur kurz "Ich öffne die Seite ...". Bei einer Frage nach dem Weg erscheint die Karte mit "Soll ich sie öffnen?", folgt ein gesprochenes "ja", "öffnen" oder ähnlich, öffnet der Provider die Seite und antwortet lokal "Ich öffne die Seite ...". Ein "nein" verwirft das Angebot ("In Ordnung, ich bleibe hier."). Jede andere Frage verwirft es ebenfalls und geht normal an den Server, ein späteres "ja" öffnet dann nichts. Die Schnittstelle im Provider ist `sendMessage(text, { voice: true })` (bestehend) und `openNavigation(messageId)`. `useHaiVoice.ts` ist unverändert.

### Weiter lernen

Der nächste Schritt ist der erste aktive Enabler der Kurse der Person, der nicht abgeschlossen und nicht gesperrt ist. Die Reihenfolge ist Phase (`courses.year`), Kapitel, Reihenfolge im Kurs, so wie das Dashboard sie für "Weiter" nimmt. Abgeschlossen und gesperrt kommen aus `loadCourseProgressions` (die Reihenfolge der Arbeit mit den Ausnahmen des Trainers). Der Phasenplan (`trainingScope`, gebaut aus Beginn, Dauer und Phasenplan des Berufs) legt fest, welche Phasen schon dran sind: Ein Enabler einer späteren Phase kommt erst nach den Enablern der aktuellen Phase, und wenn nur er übrig ist, sagt der Begründungssatz das. Beispiel: "Das ist dein nächster freigeschalteter Enabler im Kurs Datenbanken (Phase 1), den du noch nicht abgeschlossen hast."

Ist alles abgeschlossen, führt die Karte zum Dashboard. Ist nichts freigeschaltet oder gibt es keinen Kurs, sagt die HAI das und verweist auf den Trainer, ohne Karte.

## 4. Schutz

- **Berechtigung:** Eine Seite, die nicht zur Ebene der Person gehört, wird freundlich abgelehnt, mit dem Grund Rolle ("Diese Seite kann ich dir nicht öffnen, weil sie zum Trainerbereich gehört und für deine Rolle nicht freigegeben ist"). Der Bereich wird grob genannt (Trainerbereich, Verwaltungsbereich der Administratoren), nie der Name einer Seite, und die Beispiele sind Seiten, die die Person selbst öffnen darf. Eine Seite, die die HAI nicht kennt ("Öffne die Seite Wetter"), bekommt einen eigenen Text ohne Berechtigungsgrund ("Diese Seite kenne ich nicht ... das hat nichts mit deinen Rechten zu tun"). Es gibt keinen Pfad. Seit dem 02.11.2026 (vorher derselbe Text für beides).
- **Berufstrennung:** Enabler und Use Cases kommen nur aus den Katalogen der Person (`access.catalogIds`), nur aktive, nur aus aktiven Kursen, in denen die Person Mitglied ist, wie es die Seiten selbst prüfen. Ein Eintrag eines anderen Berufs wird nicht verglichen, nicht genannt und von einem nicht vorhandenen nicht unterschieden ("In deinen freigeschalteten Inhalten habe ich dazu keinen passenden Eintrag gefunden, das heißt aber nicht, dass es ihn nicht gibt", Grund Umfang). Das ist Absicht: Ein Text, der "gehört zu einem anderen Beruf" sagt, würde verraten, dass es den Eintrag dort gibt.
- **Gesperrter Enabler:** Titel und Grund ("noch gesperrt, weil in der Reihenfolge der Arbeit zuerst ... abgeschlossen sein muss", dazu der Weg weiter), kein Link, auch nicht zum Quiz. So zeigt es auch die Seite des Enablers.
- **Keine IDs in Antworten:** Der Text nennt Titel, nie eine Kennung. Der Pfad mit der uuid steht nur im Angebot und nur für einen Eintrag, der alle Prüfungen bestanden hat. Titel werden als reiner Text geschrieben (kein Markdown, kein Link, keine Anführungszeichen).
- **Fail closed:** Schlägt eine Abfrage fehl, sagt die HAI "Das kann ich gerade nicht prüfen, weil eine technische Störung vorliegt und nicht, weil dir etwas fehlt" und bietet nichts an.
- **Mehrdeutig:** Passen mehrere Einträge, nennt die HAI bis zu drei Titel aus dem eigenen Lernstoff und bittet um den genauen Namen.
- **Das Modell:** Der Prompt (`buildNavigationRules` in `src/lib/hai/prompts.ts`, gesetzt über `navigation: true` von beiden Pipelines) sagt, dass die Plattform die Karten selbst anbietet und dass das Modell keine Links, Pfade oder Adressen erfindet und nur den Namen des Menüpunkts nennt. Ohne das Flag bleibt der Prompt byte-gleich (Baseline von FIAE).
- **Der Browser:** Ein Angebot mit einem Pfad außerhalb der Liste wird nicht als Karte gezeigt und nie geöffnet. Die Seite selbst prüft die Rechte bei jedem Aufruf neu, wie bei einer eingetippten Adresse. Das Angebot gibt keine Berechtigung.

## 5. Grenzen

- Die Karte gehört zur Antwort des Moments. Nach dem Neuladen oder dem Öffnen des Verlaufs steht der Text da, die Karte nicht.
- Das gesprochene "ja" und die lokale Antwort darauf werden nicht auf dem Server gespeichert, im Verlauf fehlt diese Zwischenrunde.
- Die Erkennung ist eine Musterliste. Ungewöhnliche Formulierungen gehen an das Modell wie jede andere Frage, es antwortet dann ohne Karte und nennt den Menüpunkt in Worten. Das ist gewollt: Lieber keine Karte als eine falsche.
- Ein Eintrag wird nach Nummer (Code des Enablers oder Nummer am Anfang des Titels) oder Namen (ganz oder Teil des Titels) gefunden. "3" meint nicht "3.6". Bei mehreren Treffern fragt die HAI nach.
- Das Angebot gilt für die Kataloge, die der Zugriff der Person kennt. Ein Azubi mit zwei Berufen bekommt Treffer aus beiden, wie die Wissensdatenbank.
- Unterseiten mit Parametern (`?catalog=...`) bietet die HAI nicht an. Die Seite wählt den Beruf wie beim normalen Öffnen.

## 6. Was bewusst nicht gebaut ist

- **Freies Klicken und Ausfüllen:** Die HAI bedient die Oberfläche nicht. Sie klickt keine Knöpfe, füllt keine Formulare und tippt nichts ein. Es gibt keinen Werkzeugaufruf mit freiem Ziel. Das ist anders als bei den Werkzeugen von damicon, die der Browser ausführt: Hier gibt es nur Seiten aus einer festen Liste, und das Öffnen ist eine Handlung der Person.
- **Automatisches Wechseln der Seite bei einer Frage oder einer weichen Bitte:** Die Seite wechselt dann erst auf den Knopf oder auf ein gesprochenes "ja". (Bis 02.11.2026 galt das für jede Bitte im Text-Chat. Das war die Ursache der Beschwerde vom 03.11.2026 "Die HAI kann mich nicht navigieren": Auch auf "Öffne den Ausbildungsnachweis" kam nur eine Karte, und gesprochen musste ein "ja" folgen. Der Beschluss wurde für **eindeutige Befehle** zurückgenommen, siehe Ablauf Schritt 4 bis 7.)
- **Navigation, die etwas verändert:** Ein Ziel führt nie zu einem Schreibvorgang. Keine Seite wird mit Parametern angeboten, die etwas auslösen.
- **Der Quiz-Modus als Ziel:** Er ist ein eigenes Paket (anderer Agent) und liegt noch nicht auf master.
- **Pfade aus dem Modell, aus Zitaten oder aus der Nachricht:** Es gibt keine.
- **Speichern des Angebots im Verlauf:** Siehe Grenzen.

## 6a. Wendungen, die erkannt werden (Stand 03.11.2026)

Die Fälle stehen als Prüfliste `phrases` in `tests/unit/hai/golden/hai-navigation-cases.json` (74 Sätze, getippt und gesprochen, Azubi und Ausbilder, FIAE und KfBM).

- **Sofort geöffnet:** "Öffne den Ausbildungsnachweis", "Bring mich zu den Quizzen", "Geh zum Dashboard", "Navigiere zu Profil", "Bring mich zurück zur Startseite", "Kannst du mich zum Berichtsheft bringen?", "Mach das Dashboard auf", "Nimm mich mit zum Dashboard", "Ich will zum Kalender", "Zum Dashboard bitte", "Öffne meine Kurse", "Öffne Enabler 3", "Ich will weiterlernen", "Starte das Quiz von Enabler 3" und gesprochen "öffne enabler drei", "geh zum dashboard".
- **Angebot mit Knopf (gesprochen mit Rückfrage):** "Zeig mir meine Berufsschule", "Ich möchte meine Berufsschule sehen", "Wo finde ich das Berichtsheft?", "Wo ist das Dashboard?", "Wie komme ich zu meinen Quizzen?", "Wo geht es weiter?".
- **Keine Navigation (das Modell antwortet):** "Was ist ein Dashboard?", "Erkläre mir den Ausbildungsnachweis", "Wie viele Berichte habe ich?", "Wo ist der Fehler in meinem Bericht?", "Ich habe ein Problem mit dem Dashboard", "Wo finde ich die Benachrichtigungen?" (die Glocke ist kein Seitenziel).
- **Quiz-Modus:** "Starte ein Quiz" und "Frag mich ab" gehen weiter an den Quiz-Modus (er kommt in der Pipeline vor der Navigation), "Starte das Quiz von Enabler 3" ist die Seite des Enablers.
- **Nicht erkannt, bewusst:** englische Sätze ("Open the dashboard"), Ordnungszahlen ("den dritten Enabler"), einzelne Wörter ohne Verb ("Dashboard"), Kurse nach Namen ("Öffne den Kurs Datenbanken").
- **Das Modell:** Erkennt die Erkennung einen Satz nicht, sagt der Prompt dem Modell, nie "ich kann nicht navigieren" zu antworten, sondern den Menüpunkt zu nennen und zu sagen, dass die Plattform die Seite öffnet, sobald sie beim Namen genannt wird.

## 7. Dateien

| Datei | Aufgabe |
|---|---|
| `src/lib/hai/navigation/targets.ts` | Zulassungsliste je Ebene, Pfade der Seiten mit Datensatz, `isAllowedNavigationPath` |
| `src/lib/hai/navigation/intent.ts`, `fold.ts` | Erkennung der Bitte (`detectNavigationIntent`), Befehl oder Frage (`isDirectCommand`), Zahlwörter, Faltung der Umlaute |
| `src/lib/hai/navigation/match.ts` | Enabler oder Use Case nach Nummer oder Name unter den Einträgen der Person |
| `src/lib/hai/navigation/nextStep.ts` | "Weiter lernen": der nächste Schritt mit Begründung |
| `src/lib/hai/navigation/data.ts` | Abfragen: Einträge der Person, Sperre, nächster Schritt (Helfer der Reihenfolge der Arbeit) |
| `src/lib/hai/navigation/resolve.ts` | Auflösung gegen Liste, Ebene und Einträge, Texte der Antworten |
| `src/lib/hai/navigation/flow.ts` | Schritt der Pipeline, Schlusssatz getippt oder gesprochen |
| `src/lib/hai/navigation/offer.ts`, `confirm.ts`, `text.ts` | Angebot (Server und Browser), Antworten auf "Soll ich sie öffnen?", Titel als reiner Text |
| `src/components/hai/HaiNavigationCard.tsx` | Karte mit dem Knopf "Öffnen" |
| `src/components/hai/HaiProvider.tsx`, `HaiMessage.tsx` | Angebot an der Nachricht, `openNavigation`, gesprochenes "ja" |
| `src/lib/hai/ragPipeline.ts`, `src/app/api/hai/chat/route.ts`, `src/lib/hai/prompts.ts` | Einhängen in beide Pipelines, `isAdmin` aus der Sitzung, Abschnitt im Prompt |

## 8. Prüfungen

- `tests/unit/hai/navigation.intent.test.ts`: Erkennung mit Umlauten und gesprochenen Formen, was nicht erkannt wird, Gegenprobe mit dem Prüfset.
- `tests/unit/hai/navigation.targets.test.ts`: jede Seite der Liste existiert in `src/app`, die Ziele je Ebene, Zulassung und Ablehnung von Pfaden, Angebot im Browser.
- `tests/unit/hai/navigation.resolve.test.ts`, `navigation.nextStep.test.ts`, `navigation.data.test.ts`: Rechte je Ebene, Berufstrennung, gesperrter Enabler, Weiter lernen, die Abfragen mit ihren Filtern.
- `tests/unit/hai/ragPipeline.navigation.test.ts`: beide Pipelines, kein Modellaufruf, Ebene vom Server, Persona-Tor und Aktionsschritt zuerst, gesprochen und getippt.
- `tests/unit/hai/goldenNavigation.pipeline.test.ts` mit `golden/hai-navigation-cases.json` (Fälle `cases` und die 74 Sätze `phrases`, je durch beide Pipelines) und die Fälle NV-01 und NV-02 im Prüfset (`docs/hai-golden-set.md`).
- `tests/unit/components/hai/HaiNavigationAuto.test.tsx`: ein Befehl öffnet über den Router sofort (getippt, Stream, gesprochen, Sprachmodus hört weiter zu), ein Angebot ohne `auto` wartet, kein Pfad außerhalb der Liste wird geöffnet.
- `tests/unit/hai/prompts.navigation.test.ts`: Abschnitt nur mit dem Flag.
- `tests/unit/components/hai/HaiNavigationCard.test.tsx`: Karte, Tipp und Enter, Provider (getippt öffnet nie, gesprochenes "ja", "nein", andere Frage, Pfad außerhalb der Liste).
- `tests/integration/api/hai/chat-navigation.test.ts`: die Route liefert das Angebot (Stream und ohne Stream), die gesprochene Variante, `isAdmin` aus der Sitzung, und mit der echten Pipeline dahinter.
- Test in der Preview: `docs/hai-testplan.md`, Abschnitt H.
