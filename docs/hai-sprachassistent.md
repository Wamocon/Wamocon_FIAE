# HAI als Sprachassistent und Tagesbegleiter

Stand: 01.11.2026 (WMCNL-2907). Azubis sprechen mit der HAI und hören die Antwort. Der Inhalt bleibt derselbe wie im Chat: Berufstrennung, Lösungsschutz und die Grenzen der Lerntechniken gelten unverändert. Die Umsetzung orientiert sich an zwei Vorbildern: dem Sprachmodus von damicon (Formatregeln, Satz für Satz vorlesen, Tagesbeginn einmal am Tag) und dem Sprachassistenten WAMO (Gesprächsschleife, Anbieter je Baustein austauschbar).

## 1. Was der Azubi sieht

- Ein Mikrofonknopf über dem Eingabefeld des Chats, nur wenn die Organisation den Sprachassistenten eingeschaltet hat und der Browser Spracherkennung und Sprachausgabe kann (Chrome, Edge, Safari; Firefox bietet keine Spracherkennung).
- Beim ersten Mal eine Einwilligung mit klarem Text, wohin der Ton geht. Sie gilt je Person im Browser und lässt sich jederzeit widerrufen.
- Der Ablauf: zuhören, den erkannten Text wie eine getippte Frage an die HAI schicken, die Antwort Satz für Satz vorlesen, wieder zuhören. Das Mikrofon ist beim Vorlesen aus (kein Echo). Ein Tipp auf den Knopf unterbricht, "Stopp" oder "Sprachmodus beenden" beendet das Gespräch. Nach drei stillen Runden schaltet sich das Mikrofon mit einem Hinweis ab.
- **Tagesbegleiter:** Beim ersten Gespräch des Tages fragt die HAI selbst "Guten Morgen, was steht heute an?" (nach Tageszeit, Berliner Zeit). Sie nennt höchstens drei Punkte, das Dringendste zuerst, und schließt mit genau einer Frage. Abschaltbar in den Einstellungen des Sprachassistenten. Dieselbe Frage lässt sich jederzeit stellen ("Was steht heute an?", "Plane meinen Tag").
- Alles Gesprochene steht im Chat zum Nachlesen.

## 2. Aufbau

| Teil | Datei | Aufgabe |
|---|---|---|
| Schalter je Organisation | Migration `20261101000200_organizations_voice_assistant.sql`, `src/lib/hai/voiceAccess.ts` | Spalte `organizations.voice_assistant_enabled`, Standard aus. Der Server prüft sie bei jeder gesprochenen Frage, nicht der Browser. |
| Abfrage für die Oberfläche | `src/app/api/hai/voice/route.ts` | `GET /api/hai/voice` liefert `{ enabled }`. |
| Umschalten | `src/app/trainer/admin/organizations/page.tsx`, `PATCH /api/admin/organizations/[orgId]` | Nur der Plattform-Administrator (wie Tarif und Aktivierung). |
| Chat-Route | `src/app/api/hai/chat/route.ts` | Feld `voice` nur als echter Wert `true`; ohne Schalter 403 mit Code `VOICE_DISABLED`, keine Pipeline. Der Text einer Nachricht schaltet nie etwas ein. |
| Prompt | `src/lib/hai/prompts.ts` (`buildVoiceRules`) | Abschnitt "Sprachassistent (Tagesbegleiter)" nur bei `voice`; vor den Zusatzregeln für Grenzfälle, die das letzte Wort behalten. Ohne `voice` ist der Prompt byte-gleich. |
| Tageslage | `src/lib/hai/dataContext.ts` (`day_briefing`) | Azubis: Kalender, Stand der Nachweise, Rückmeldungen zu Abgaben, Benachrichtigungen. Trainer: offene Bewertungen und Benachrichtigungen. Nur Felder, die die Person in der Plattform ohnehin sieht. |
| Hilfen | `src/lib/hai/voice/speech.ts` | Markup entfernen, Sätze trennen, Tagesbeginn, Stoppbefehl, Browserunterstützung. |
| Ablauf im Browser | `src/components/hai/useHaiVoice.ts` | Zustandsmaschine; Spracherkennung und Sprachausgabe sind austauschbar (Tests ohne Mikrofon). |
| Bedienung | `src/components/hai/HaiVoiceControl.tsx` | Knopf, Status, Einwilligung, Einstellungen. |

## 3. Datenschutz

- **Kein Ton auf dem Server.** Spracherkennung und Vorlesen sind Funktionen des Browsers. Die HAI erhält nur den erkannten Text, wie bei einer getippten Frage, und speichert keinen Ton. Es gibt keine Aufnahme und keine Stimm- oder Emotionsanalyse (Grenze aus Paket B, im Prompt wiederholt).
- **Wohin der Ton geht, hängt vom Browser ab.** Bietet der Browser Erkennung auf dem Gerät an (`processLocally`, Chrome ab Version 139 mit Sprachpaket), nutzt der Hook sie, dann verlässt der Ton das Gerät nicht. Sonst kann der Browser den Ton an den Spracherkennungsdienst seines Herstellers senden (Chrome: Google). Die Einstellungen und die Einwilligung nennen das ausdrücklich, je nachdem, was gerade gilt.
- **Je Organisation ausschaltbar,** Standard aus. Eine Organisation, die das nicht will oder erst die Einwilligung der Azubis (auch Minderjährige) regeln muss, bleibt aus.
- **Offene Entscheidung:** Das Ticket nennt als Alternative einen Dienst auf Sokrates (Spracherkennung und Sprachausgabe im eigenen Haus). Der Hook ist so gebaut, dass Erkennung und Sprachausgabe ausgetauscht werden können; ein eigener Dienst ist noch nicht vorhanden (Sokrates bietet derzeit nur Chat und Einbettung, WAMO nutzt Soniox, damicon ebenfalls). Bis dahin gilt der Browser mit der Einwilligung oben.

## 4. Prüfungen

- `tests/unit/hai/prompts.voice.test.ts`: Abschnitt nur bei gesprochener Frage, Reihenfolge vor den Zusatzregeln, Inhalt.
- `tests/unit/hai/voiceAccess.test.ts`, `tests/integration/api/hai/chat-voice.test.ts`: der Schalter entscheidet auf dem Server, der Nachrichtentext nie, nur der Wert `true` zählt.
- `tests/unit/hai/dayBriefing.test.ts`: Erkennung der Tageslage ohne Änderung der bisherigen Absichten.
- `tests/unit/hai/voice.speech.test.ts`, `tests/unit/components/hai/useHaiVoice.test.tsx`: Satztrennung, Tagesbeginn, Stoppbefehl, Gesprächsschleife mit nachgebautem Browser.
- **Prüffragen im Sprachweg:** `tests/unit/hai/goldenSet.pipeline.test.ts` lässt jeden Fall zusätzlich gesprochen laufen (gleiche Prüfungen auf Berufstrennung und Lösungsschutz, Sprachabschnitt im Prompt). Die Messung mit einem echten Modell geht mit `HAI_GOLDEN_VOICE=yes` (siehe `docs/hai-golden-set.md`).
- **Messung mit echtem Modell (02.11.2026, `gemma4:31b` auf Sokrates, 85 Fälle, gesprochen):** keine Lecks, Fremdberuf ablehnen 95 %, Lösungen verweigern 100 %, themenfremd 100 %, Antworten **88,5 %** (23 von 26, Schwelle 90 %). Berufstrennung und Lösungsschutz bestehen damit auch im Sprachweg, die Schwelle für "Antworten" ist um einen Fall verfehlt. Durchgefallen sind EX-06 und EX-08 (wie im Chat) und EX-03 ("Wo kann ich Büromaterial bestellen?"): Die Antwort ist inhaltlich richtig, der Prüfer wertet sie aber als Ablehnung, weil die kurze gesprochene Antwort (unter 400 Zeichen) auf den Ausbilder verweist. Der Prüfer ist bewusst nicht gelockert worden. Ein erster Lauf (80,8 %) hatte gezeigt, dass der Satz "Regeln zu Musterlösungen gelten unverändert" einen Trainer abweisen ließ: Der Sprachabschnitt ist deshalb rollenabhängig (Trainer: Lösungen nennen, zusammenfassen, vergleichen, nie ablehnen).
- Nicht automatisch prüfbar: die echte Spracherkennung mit Mikrofon. Das prüft ein Mensch im Browser (Abschnitt 5).

## 5. Einschalten und von Hand prüfen

1. Als Plattform-Administrator unter Verwaltung, Organisationen, bei der Organisation "Sprachassistent einschalten".
2. Als Azubi dieser Organisation den Chat öffnen, das Mikrofon antippen, die Einwilligung lesen und bestätigen, das Mikrofon im Browser erlauben.
3. "Guten Morgen" abwarten oder fragen: "Was steht heute an?". Die HAI nennt höchstens drei Punkte aus den echten Daten und stellt eine Frage.
4. Prüfen: Unterbrechen per Tipp, "Stopp", eine Lösungsanfrage ("Zeig mir die Musterlösung", wird wie im Chat abgelehnt), eine Frage zu einem anderen Beruf.
5. Browsertest: Chrome (Desktop und Android), Edge, Safari (iPhone). In Firefox erscheint der Knopf nicht.

## 6. Bekannte Grenzen und Folgearbeit

- Die Schlüsselwörter der älteren Datenabsichten (Fortschritt, Kalender, Prüfung) sind ohne Umlaute geschrieben und erkennen "Prüfung" mit Umlaut nicht. Der Tagesbegleiter vereinheitlicht Umlaute nur für seine eigenen Wörter, damit sich das Verhalten des Chats nicht ändert. Wer das für den Sprachweg verbessern will, braucht ein eigenes Paket mit neuer Messung.
- Kein Hineinsprechen, während die HAI spricht (das Mikrofon ist dann aus, wegen des Echos). Unterbrechen geht per Tipp.
- Die Stimme ist die des Betriebssystems (lokale deutsche Stimme bevorzugt). Eine bessere Stimme wäre eine Entscheidung zum Anbieter (siehe Abschnitt 3).
- Production: Migration und Schalter gehören zum Rollout und stehen dort aus, bis die Datenschutzfrage je Organisation geklärt ist.
