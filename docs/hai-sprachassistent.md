# HAI als Sprachassistent und Tagesbegleiter

Stand: 02.11.2026 (WMCNL-2907, Anbieter Soniox und Sokrates ergänzt). Azubis sprechen mit der HAI und hören die Antwort. Der Inhalt bleibt derselbe wie im Chat: Berufstrennung, Lösungsschutz und die Grenzen der Lerntechniken gelten unverändert. Die Umsetzung orientiert sich an zwei Vorbildern: dem Sprachmodus von damicon (Formatregeln, Satz für Satz vorlesen, Tagesbeginn einmal am Tag) und dem Sprachassistenten WAMO (Gesprächsschleife, Anbieter je Baustein austauschbar).

## 1. Was der Azubi sieht

- Ein Mikrofonknopf über dem Eingabefeld des Chats, nur wenn die Organisation den Sprachassistenten eingeschaltet hat und der Browser mit mindestens einem Anbieter der Kette zurechtkommt (Abschnitt 3). Mit dem Anbieter Browser sind das Chrome, Edge und Safari, Firefox bietet dort keine Spracherkennung. Mit Soniox oder Sokrates genügen Mikrofon, Aufnahme und Websocket, das können alle gängigen Browser.
- Beim ersten Mal eine Einwilligung mit klarem Text, wohin der Ton geht, mit dem wirksamen Anbieter und dem Ersatz, falls er ausfällt. Sie gilt je Person im Browser und lässt sich jederzeit widerrufen. Wechselt der Administrator zu einem Anbieter, dem die Person noch nicht zugestimmt hat, fragt der Chat erneut.
- Der Ablauf: zuhören, den erkannten Text wie eine getippte Frage an die HAI schicken, die Antwort Satz für Satz vorlesen, wieder zuhören. Das Mikrofon ist beim Vorlesen aus (kein Echo). Ein Tipp auf den Knopf unterbricht, "Stopp" oder "Sprachmodus beenden" beendet das Gespräch. Nach drei stillen Runden schaltet sich das Mikrofon mit einem Hinweis ab.
- **Tagesbegleiter:** Beim ersten Gespräch des Tages fragt die HAI selbst "Guten Morgen, was steht heute an?" (nach Tageszeit, Berliner Zeit). Sie nennt höchstens drei Punkte, das Dringendste zuerst, und schließt mit genau einer Frage. Abschaltbar in den Einstellungen des Sprachassistenten. Dieselbe Frage lässt sich jederzeit stellen, getippt oder gesprochen ("Was steht heute an?", "Was steht für mich an?", "Was habe ich diese Woche zu tun?", "Plane meinen Tag"). Die Antwort enthält den Fortschritt und den nächsten Lernschritt, siehe Abschnitt 7.
- Alles Gesprochene steht im Chat zum Nachlesen.
- Der Knopf "Gespräch" neben dem Mikrofon öffnet den **Sprachmodus**: ein Gesprächsfenster mit dem Hai als Maskottchen, mit Untertiteln, auf demselben Chat und derselben Schleife (`docs/hai-sprachmodus.md`).

## 2. Aufbau

| Teil | Datei | Aufgabe |
|---|---|---|
| Schalter je Organisation | Migration `20261101000200_organizations_voice_assistant.sql`, `src/lib/hai/voiceAccess.ts` | Spalte `organizations.voice_assistant_enabled`, Standard aus. Der Server prüft sie bei jeder gesprochenen Frage, nicht der Browser. |
| Abfrage für die Oberfläche | `src/app/api/hai/voice/route.ts` | `GET /api/hai/voice` liefert `{ enabled }`. |
| Umschalten | `src/app/trainer/admin/organizations/page.tsx`, `PATCH /api/admin/organizations/[orgId]` | Nur der Plattform-Administrator (wie Tarif und Aktivierung). |
| Chat-Route | `src/app/api/hai/chat/route.ts` | Feld `voice` nur als echter Wert `true`; ohne Schalter 403 mit Code `VOICE_DISABLED`, keine Pipeline. Der Text einer Nachricht schaltet nie etwas ein. |
| Prompt | `src/lib/hai/prompts.ts` (`buildVoiceRules`) | Abschnitt "Sprachassistent (Tagesbegleiter)" nur bei `voice`; vor den Zusatzregeln für Grenzfälle, die das letzte Wort behalten. Ohne `voice` ist der Prompt byte-gleich. |
| Tageslage | `src/lib/hai/dataContext.ts` (`day_briefing`) | Azubis: Fortschritt und nächster Schritt (je Beruf), Kalender, Stand der Nachweise, Rückmeldungen zu Abgaben, Benachrichtigungen, dazu eine Zeile "Leere Bereiche". Trainer: offene Bewertungen und Benachrichtigungen. Nur Felder, die die Person in der Plattform ohnehin sieht. |
| Erkennung der Tageslage | `src/lib/hai/dayQuestion.ts` | Feste Wendungen und natürliche Fragen nach den eigenen Aufgaben, Terminen und dem Stand, ohne Modell, mit gefalteten Umlauten (Abschnitt 7). |
| Fortschritt der Tageslage | `src/lib/hai/dayProgress.ts` | Fortschritt und nächster Schritt je Beruf aus `loadNextStepEntries` und `pickNextStep`, der gewählte Beruf zuerst. |
| Prompt der Tageslage | `src/lib/hai/prompts.ts` (`buildDayBriefingRules`) | Abschnitt "Tageslage (Tagesbegleiter)" bei jeder Tagesfrage, getippt oder gesprochen: höchstens drei Punkte, Leeres konkret benennen, eine Frage am Ende. |
| Hilfen | `src/lib/hai/voice/speech.ts` | Markup entfernen, Sätze trennen, Tagesbeginn, Stoppbefehl, Browserunterstützung. |
| Ablauf im Browser | `src/components/hai/useHaiVoice.ts` | Zustandsmaschine; Spracherkennung und Sprachausgabe sind austauschbar (Tests ohne Mikrofon). |
| Bedienung | `src/components/hai/HaiVoiceControl.tsx` | Knopf, Status, Einwilligung (nennt den wirksamen Anbieter), Einstellungen. |
| Anbieterwahl | Migration `20261102000100_hai_settings.sql`, `src/lib/hai/voice/settings.ts`, `settingsStore.ts` | Globale Tabelle `hai_settings` (Schlüssel und JSON-Wert), Standard Soniox mit Rückfall Browser. |
| Kette der Anbieter (Server) | `src/lib/hai/voice/provider.ts` | Zustand je Anbieter (bereit, nicht eingerichtet mit Grund, gestört) und die Kette, die der Browser abarbeitet. |
| Soniox (Server) | `src/lib/hai/voice/sonioxServer.ts`, `POST /api/hai/voice/soniox-token` | Hält den echten Schlüssel, gibt einen kurzlebigen für genau eine Verbindung aus. |
| Sokrates (Server) | `src/lib/hai/voice/hausServer.ts`, `POST /api/hai/voice/haus/transcribe` und `/speech` | Reicht Audio und Text an die OpenAI-kompatiblen Endpunkte von Sokrates weiter. |
| Abfrage der Kette | `GET /api/hai/voice/config` | Liefert `{ provider, chain, region }`, nie einen Schlüssel. |
| Anbieter im Browser | `src/lib/hai/voice/client/` (`engine.ts`, `soniox.ts`, `haus.ts`, `audio.ts`, `browserSpeech.ts`, `deps.ts`) | Erkennung und Ausgabe je Anbieter hinter zwei kleinen Schnittstellen, Rückfall von einem zum nächsten. |
| Admin-Oberfläche | `src/app/trainer/admin/hai/page.tsx`, `GET` und `PUT /api/admin/hai/settings`, `GET /api/admin/hai/voice-status` | Nur der Plattform-Administrator: Anbieter wählen, Zustand und Datenschutzhinweise sehen. |

## 3. Anbieter, Rückfallkette und Datenschutz

### Die drei Anbieter

| Anbieter | Wer erkennt und spricht | Wohin geht der Ton |
|---|---|---|
| `soniox` | Der externe Dienst Soniox (Echtzeit-Erkennung und Sprachausgabe über Websocket). Standard als Hauptanbieter. | Direkt vom Browser der Person zu Soniox, Region Europäische Union (`*.eu.soniox.com`). |
| `haus` | Sokrates, der eigene Server (OpenAI-kompatible Endpunkte `audio/transcriptions` und `audio/speech`, hinter Open WebUI unter `/api/v1/audio/...`). | Vom Browser zum Server dieser Anwendung und von dort zu Sokrates. Es ist kein weiterer Dienst beteiligt. |
| `browser` | Spracherkennung und Sprachausgabe des Browsers selbst. Standard als Rückfallebene. | Hängt vom Browser ab (siehe unten). |

### Wahl und Kette

Der Plattform-Administrator wählt unter Verwaltung, HAI Sprachassistent (`/trainer/admin/hai`) einen **Hauptanbieter** (`soniox`, `haus` oder `browser`, Standard `soniox`) und eine **Rückfallebene** (`haus` oder `browser`, Standard `browser`). Beide müssen verschieden sein. Die Wahl liegt in der Tabelle `hai_settings` (Schlüssel `voice_provider_primary` und `voice_provider_fallback`), gilt für alle Organisationen und wirkt ohne neuen Rollout.

Der Server bestimmt je Anbieter einen **Zustand**: *bereit*, *nicht eingerichtet* (mit stabilem Grund, zum Beispiel `NO_KEY` oder `NO_TTS_VOICE`) oder *gestört* (der Anbieter hat in der letzten Minute einen Fehler gemeldet, die Angabe liegt im Speicher der Serverinstanz und verfällt von selbst). Daraus entsteht die **Kette**: Hauptanbieter, Rückfallebene, Browser, ohne die Anbieter, die nicht bereit sind. Der Browser ist immer Teil der Kette. `GET /api/hai/voice/config` liefert `{ provider, chain, region }` und nie einen Schlüssel.

Der Chat arbeitet die Kette ab (`src/lib/hai/voice/client/engine.ts`):

- **Erkennung:** Eine Runde beginnt mit dem ersten Anbieter. Fällt er aus (kein Schlüssel vom Server, Antwort 503, der Websocket bricht ab, Sokrates antwortet nicht), beginnt die Runde mit dem nächsten, zuletzt mit dem Browser. Ein verweigertes Mikrofon ist kein Ausfall des Anbieters und führt nicht zum Wechsel, sondern zur Meldung.
- **Sprachausgabe:** Die Sätze einer Antwort gehen an den ersten Anbieter. Fällt er mitten in der Antwort aus, sprechen die nächsten alles, was noch nicht gesprochen war, in derselben Reihenfolge. Ein Satz, der gerade lief, wird dabei noch einmal gesprochen.
- Ein ausgefallener Anbieter wird bis zum Ende des Gesprächs übersprungen. Das nächste Gespräch beginnt wieder oben in der Kette. Nach jedem Gespräch liest der Chat die Kette neu, eine Änderung des Administrators wirkt also beim nächsten Start.
- Zwei Schnittstellen halten die Anbieter austauschbar: die Erkennung hat die Form von `SpeechRecognition` (`RecognitionLike`), die Ausgabe ist ein `SpeakerLike` (sagen, beenden, abbrechen). Die Tests ersetzen alles Äußere (Websocket, Mikrofon, Aufnahme, Audio) durch Attrappen.

### Soniox im Einzelnen

- Der Browser holt bei `POST /api/hai/voice/soniox-token` (`purpose` ist `stt` oder `tts`) einen **kurzlebigen Schlüssel** (90 Sekunden zum Verbindungsaufbau, begrenzte Sitzungsdauer, nur für diesen Zweck, `POST /v1/auth/temporary-api-key` von Soniox). Der echte Schlüssel `SONIOX_API_KEY` verlässt den Server nie.
- Erkennung: `wss://stt-rt.eu.soniox.com/transcribe-websocket`, der Schlüssel steht im Handshake (Subprotokoll `soniox-api-key`), danach die Konfiguration (Modell `stt-rt-v5`, Sprachhinweis Deutsch, Endpunkterkennung) und das Audio von `MediaRecorder` als Binärpakete. Zwischenergebnisse erscheinen beim Sprechen, das Ende der Frage erkennt das Modell selbst (Token `<end>`).
- Sprachausgabe: `wss://tts-rt.eu.soniox.com/tts-websocket`, Modell `tts-rt-v2`, Stimme `Lena` (änderbar mit `SONIOX_TTS_VOICE`), Tempo 1,2, PCM 16 Bit mit 24 kHz. Je Satz ein Stream auf einer Verbindung, bis zu drei Sätze werden gleichzeitig erzeugt und der Reihe nach ohne Lücke abgespielt.
- Die Adressen und Parameter sind am 02.11.2026 gegen die Dokumentation von Soniox (`docs.soniox.com`) geprüft worden. Der Schlüssel in der Startnachricht ist bei Soniox veraltet (ab 15.01.2027 abgelehnt), deshalb steht er im Handshake.

### Variablen

| Variable | Bedeutung |
|---|---|
| `SONIOX_API_KEY` | Schlüssel des Soniox-Projekts, nur auf dem Server. Fehlt er, ist Soniox "nicht eingerichtet" (`NO_KEY`). |
| `SONIOX_REGION` | `eu` (Standard) oder `us`. Der Schlüssel eines Soniox-Projekts gehört zu genau einer Region. Ein anderer Wert ergibt `BAD_REGION`. |
| `SONIOX_TTS_VOICE` | Optional, Name der Stimme (Standard `Lena`). |
| `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY` | Adresse und Schlüssel von Sokrates, dieselben Variablen wie beim Chat. Die Adresse wird wie beim Inhaltsupload geprüft (https, kein Benutzername, keine Abfrage, Host auf der Positivliste `CONTENT_UPLOAD_KI_ALLOWED_HOSTS`). |
| `HAI_STT_HAUS_MODEL` | Modell für die Spracherkennung auf Sokrates. Fehlt es, ist Sokrates "nicht eingerichtet" (`NO_STT_MODEL`). |
| `HAI_TTS_HAUS_MODEL` | Modell für die Sprachausgabe auf Sokrates (`NO_TTS_MODEL`). |
| `HAI_TTS_HAUS_VOICE` | Stimme für die Sprachausgabe auf Sokrates (`NO_TTS_VOICE`). |

Die Variablen setzt der Betrieb in Vercel (Preview, später Production). Es gibt keine Variable im Browser.

### Grenzen der Routen

Alle Routen verlangen eine angemeldete Person und den Schalter der Organisation (sonst 403 mit `VOICE_DISABLED`, der Server prüft ihn bei jeder Anfrage). Sie haben eine Ratenbegrenzung je Person (Schlüssel 40 je Minute, Erkennung auf Sokrates 30, Sprachausgabe auf Sokrates 120; im Speicher je Serverinstanz wie `src/lib/rate-limit.ts`). Aufnahmen auf Sokrates sind auf 5 MB begrenzt, ein Satz zur Sprachausgabe auf 1000 Zeichen. Ist ein Anbieter nicht eingerichtet oder bietet er das Modell nicht an, antwortet die Route mit 503, einem Code (`NOT_CONFIGURED` oder `UPSTREAM_FAILED`) und einem Grund, und der Browser geht zum nächsten Anbieter. Nichts davon enthält einen Schlüssel, eine Adresse oder einen Modellnamen. Im Log steht nur der Grund (zum Beispiel `Soniox key refused (UPSTREAM_REFUSED, HTTP 401)`).

### Datenschutz

- **Die Anwendung speichert keinen Ton und protokolliert keinen Text der Sprache.** Die HAI erhält nur den erkannten Text, wie bei einer getippten Frage. Es gibt keine Aufnahme und keine Stimm- oder Emotionsanalyse (Grenze aus Paket B, im Prompt wiederholt).
- **Soniox:** externer Dienst. Der Ton geht direkt vom Browser der Person an Soniox, in der Region Europäische Union (`SONIOX_REGION=eu`). Vor dem Einschalten Auftragsverarbeitung mit Soniox und die Einwilligung der Azubis klären, auch bei Minderjährigen. Der Schlüssel im Browser lebt 90 Sekunden und gilt nur für eine Verbindung.
- **Sokrates:** Der Ton geht vom Browser zum Server dieser Anwendung und von dort zu Sokrates. Dort wird nichts gespeichert oder protokolliert, es ist kein weiterer Dienst beteiligt.
- **Browser:** Wie bisher. Bietet der Browser Erkennung auf dem Gerät an (`processLocally`, Chrome ab Version 139 mit Sprachpaket), nutzt der Chat sie, dann verlässt der Ton das Gerät nicht. Sonst kann der Browser den Ton an den Spracherkennungsdienst seines Herstellers senden (Chrome: Google). Die Einstellungen nennen das, je nachdem, was gerade gilt.
- **Einwilligung:** Der Chat nennt den wirksamen Anbieter und den Ersatz (zum Beispiel "Soniox (Region Europäische Union), danach der Browser"). Sie gilt je Person im Browser für die Anbieter, die sie gesehen hat. Kommt ein neuer Anbieter in die Kette, fragt der Chat noch einmal.
- **Je Organisation ausschaltbar,** Standard aus. Eine Organisation, die das nicht will oder erst die Einwilligung der Azubis (auch Minderjährige) regeln muss, bleibt aus. Die Wahl des Anbieters ändert daran nichts: Sie gilt nur dort, wo der Schalter an ist.

### Betrieb

1. **Migrationen:** `supabase/migrations/20261102000100_hai_settings.sql` legt die Tabelle an, `20261102000200_hai_settings_updated_by_plain.sql` entfernt den Fremdschlüssel von `updated_by` (ein Hinweis, wer zuletzt gespeichert hat, soll das Zusammenführen von Profilen nicht berühren). Preview zuerst, Production durch den Release. Ohne Tabelle gelten die Standardwerte (Soniox, Rückfall Browser), die Sprachfunktion läuft weiter, nur das Speichern der Wahl in der Admin-Oberfläche meldet einen Fehler.
2. **Variablen** in Vercel setzen (Tabelle oben). Danach zeigt die Admin-Seite den Zustand: Schlüssel gesetzt ja oder nein, bei Sokrates erreichbar und Modelle angeboten ja oder nein, jeweils mit dem Grund, nie mit einem Wert.
3. **Anbieter wählen** (Hauptanbieter und Rückfallebene speichern). Die Änderung gilt beim nächsten Start eines Gesprächs.
4. **Ausfall prüfen:** Testplan `docs/hai-testplan.md`, Abschnitt E (E16 bis E20). Ein Ausfall von Soniox zeigt sich in der Admin-Seite als "Gestört" mit dem Grund, bis eine Minute ohne Fehler vergangen ist.
5. **Schlüssel wechseln:** neuen Schlüssel in Vercel eintragen und neu ausrollen, der alte wird bei Soniox gesperrt. Kurzlebige Schlüssel im Umlauf laufen nach 90 Sekunden von selbst ab.
6. **Hinweis zur Prüfung der Sokrates-Modelle:** Die Admin-Seite fragt `GET <Adresse>/models` und vergleicht die beiden Audiomodelle mit der Liste. Listet ein Server Audiomodelle dort nicht auf, steht "Modell nicht angeboten", obwohl der Audio-Endpunkt arbeiten kann. Die Kette zur Laufzeit hängt davon nicht ab, nur von den Variablen und von echten Fehlern.

## 4. Prüfungen

- `tests/unit/hai/prompts.voice.test.ts`: Abschnitt nur bei gesprochener Frage, Reihenfolge vor den Zusatzregeln, Inhalt.
- `tests/unit/hai/voiceAccess.test.ts`, `tests/integration/api/hai/chat-voice.test.ts`: der Schalter entscheidet auf dem Server, der Nachrichtentext nie, nur der Wert `true` zählt.
- `tests/unit/hai/dayBriefing.test.ts`: Erkennung der Tageslage ohne Änderung der bisherigen Absichten.
- `tests/unit/hai/dayQuestion.test.ts`: natürliche Fragen nach den eigenen Aufgaben (getippt, gesprochen, mit und ohne Umlaute, mit Satzzeichen), Wissensfragen mit denselben Wörtern bleiben Wissensfragen, die vorhandenen Absichten (Fortschritt, Kalender, Benachrichtigungen, Abgaben) bleiben.
- `tests/unit/hai/dayBriefing.content.test.ts`: Inhalt der Tageslage mit Datenbank-Doubles (Fortschritt und nächster Schritt, zwei Berufe mit dem gewählten zuerst, Phasenplan, leere Bereiche konkret, ehrlich "nichts da", Fortschritt nicht ladbar).
- `tests/unit/hai/dayBriefing.pipeline.test.ts`: Pipeline blockierend und im Strom: keine Wissenssuche und keine Quellenkarten bei der Tageslage, Abschnitt "Tageslage" im Prompt, gewählter Beruf und Trainingsplan gehen an die Datenschicht, Sprachweg unverändert.
- `tests/unit/hai/voice.speech.test.ts`, `tests/unit/components/hai/useHaiVoice.test.tsx`: Satztrennung, Tagesbeginn, Stoppbefehl, Gesprächsschleife mit nachgebautem Browser.
- **Anbieter (Server):** `tests/unit/hai/voiceServer.test.ts` (Einstellungen und ihre Prüfung, Soniox-Konfiguration und kurzlebiger Schlüssel, Sokrates-Konfiguration und Aufrufe, Zustand und Kette), `tests/integration/api/hai/voice-routes.test.ts` (Rechte, `VOICE_DISABLED`, 503 ohne Schlüssel oder Modell, Grenzen, kein Schlüssel in der Antwort, Soniox gestört, danach fehlt es in der Kette), `tests/integration/api/admin/hai-settings.test.ts` (nur der Plattform-Administrator, Prüfung der Werte, `updated_by`, Zustandsseite ohne Werte), `tests/unit/migrations/hai-settings.test.ts`.
- **Anbieter (Browser):** `tests/unit/hai/voiceClient.test.ts` (Soniox-Protokoll, Erkennung und Sprachausgabe mit nachgebildetem Websocket, Mikrofon und Audio, Sokrates, geordnetes Abspielen, die Rückfallkette: Soniox gestört, Sokrates gestört, Browser zuletzt, Mikrofon verweigert ist kein Ausfall), `tests/unit/components/hai/useHaiVoice.providers.test.tsx` (Kette je nach Browser, Einwilligung je Anbieter, Sprecher in der Gesprächsschleife).
- **Verhalten von Open WebUI (gemessen am 02.11.2026):** Pfad `/v1/audio/...` (`voiceServer.test.ts`, `voice-routes.test.ts`), MP3 der Sprachausgabe wird als `audio/mpeg` Byte für Byte durchgereicht, die Erkennung antwortet `{ text, filename }` und der Client bekommt nur den Text, ein 500 des Sprachdienstes dahinter ist `UPSTREAM_UNAVAILABLE` (Route: 503, danach lässt die Kette Sokrates eine Minute aus), und in `voiceClient.test.ts`: Die Erkennung fällt auf den Browser, die Sprachausgabe bleibt im selben Gespräch bei Sokrates.
- **Prüfwerkzeug:** `tests/scripts/hai/voice-live-check.test.mjs` (läuft mit `npm run test:scripts`) führt das Werkzeug aus dem Abschnitt "Prüfen der Sprachanbieter" mit ersetztem `fetch` und Websocket aus: Erfolg, Soniox 401 in der falschen Region, 500 bei der Erkennung auf Sokrates, nicht eingerichtet (Exitcode 2), die Schalter, und dass kein Schlüssel und kein Kurzzeit-Schlüssel in der Ausgabe steht.
- **Erinnerungen der HAI je Beruf:** `tests/integration/api/hai/insights-occupation.test.ts` (`GET /api/hai/insights` mit zwei Berufen, je Reiter, ohne Auswahl, fremder Beruf).
- **Nicht automatisch prüfbar:** die Verbindung zu Soniox mit echtem Schlüssel und die Qualität der Stimme (Abschnitt 5, Testplan E14 bis E16). Die Verbindung lässt sich mit dem Prüfwerkzeug jederzeit von Hand wiederholen (Abschnitt "Prüfen der Sprachanbieter").
- **Prüffragen im Sprachweg:** `tests/unit/hai/goldenSet.pipeline.test.ts` lässt jeden Fall zusätzlich gesprochen laufen (gleiche Prüfungen auf Berufstrennung und Lösungsschutz, Sprachabschnitt im Prompt). Die Messung mit einem echten Modell geht mit `HAI_GOLDEN_VOICE=yes` (siehe `docs/hai-golden-set.md`).
- **Messung mit echtem Modell (02.11.2026, `gemma4:31b` auf Sokrates, 85 Fälle, gesprochen):** keine Lecks, Fremdberuf ablehnen 95 %, Lösungen verweigern 100 %, themenfremd 100 %, Antworten **88,5 %** (23 von 26, Schwelle 90 %). Berufstrennung und Lösungsschutz bestehen damit auch im Sprachweg, die Schwelle für "Antworten" ist um einen Fall verfehlt. Durchgefallen sind EX-06 und EX-08 (wie im Chat) und EX-03 ("Wo kann ich Büromaterial bestellen?"): Die Antwort ist inhaltlich richtig, der Prüfer wertet sie aber als Ablehnung, weil die kurze gesprochene Antwort (unter 400 Zeichen) auf den Ausbilder verweist. Der Prüfer ist bewusst nicht gelockert worden. Ein erster Lauf (80,8 %) hatte gezeigt, dass der Satz "Regeln zu Musterlösungen gelten unverändert" einen Trainer abweisen ließ: Der Sprachabschnitt ist deshalb rollenabhängig (Trainer: Lösungen nennen, zusammenfassen, vergleichen, nie ablehnen).
- Nicht automatisch prüfbar: die echte Spracherkennung mit Mikrofon. Das prüft ein Mensch im Browser (Abschnitt 5).

## 5. Einschalten und von Hand prüfen

1. Als Plattform-Administrator unter Verwaltung, Organisationen, bei der Organisation "Sprachassistent einschalten". Unter Verwaltung, HAI Sprachassistent den Anbieter prüfen und wählen (Abschnitt 3).
2. Als Azubi dieser Organisation den Chat öffnen, das Mikrofon antippen, die Einwilligung lesen und bestätigen, das Mikrofon im Browser erlauben.
3. "Guten Morgen" abwarten oder fragen: "Was steht heute an?". Die HAI nennt höchstens drei Punkte aus den echten Daten und stellt eine Frage.
4. Prüfen: Unterbrechen per Tipp, "Stopp", eine Lösungsanfrage ("Zeig mir die Musterlösung", wird wie im Chat abgelehnt), eine Frage zu einem anderen Beruf.
5. Browsertest: Chrome (Desktop und Android), Edge, Safari (iPhone). In Firefox erscheint der Knopf nicht.

## 6. Bekannte Grenzen und Folgearbeit

- Die Schlüsselwörter der älteren Datenabsichten (Fortschritt, Kalender, Prüfung) sind ohne Umlaute geschrieben und erkennen "Prüfung" mit Umlaut nicht. Der Tagesbegleiter vereinheitlicht Umlaute nur für seine eigenen Wörter, damit sich das Verhalten des Chats nicht ändert. Wer das für den Sprachweg verbessern will, braucht ein eigenes Paket mit neuer Messung.
- Kein Hineinsprechen, während die HAI spricht (das Mikrofon ist dann aus, wegen des Echos). Unterbrechen geht per Tipp.
- Mit dem Anbieter Browser ist die Stimme die des Betriebssystems (lokale deutsche Stimme bevorzugt), mit Soniox die Stimme `Lena` (klanglich noch nicht mit Muttersprachlern geprüft), mit Sokrates die Stimme, die `HAI_TTS_HAUS_VOICE` nennt.
- Soniox und der Rückfall sind bisher nur mit nachgebildeten Verbindungen getestet. Der erste Lauf mit echtem Schlüssel in der Preview ist der erste echte Test (Testplan E14 bis E16).
- Beim Wechsel des Anbieters mitten in einer Antwort wird der Satz, der gerade lief, noch einmal gesprochen. Der Zustand "gestört" liegt im Speicher je Serverinstanz, mehrere Instanzen können kurz verschieden urteilen.
- Sokrates erkennt eine Äußerung erst nach dem Sprechende, es gibt dort keine Zwischenergebnisse. Das Sprechende erkennt der Browser an der Lautstärke (1,2 Sekunden Stille), in einer lauten Umgebung kann das ungenau sein.
- Production: Migrationen (Schalter je Organisation und `hai_settings`) und der Schalter gehören zum Rollout und stehen dort aus, bis die Datenschutzfrage je Organisation geklärt ist. Das gilt besonders für Soniox, einen externen Dienst.

## 7. Tagesbegleiter: Erkennung, Inhalt, Fortschritt

Anlass (02.11.2026, Preview): Auf "Was steht für mich an?" antwortete die HAI "Dazu liegen mir aktuell keine Daten vor" und zeigte Quellenkarten von Enablern. Ursache: Die Tageslage kannte nur feste Wendungen ("Was steht an", "Was steht heute an" und ähnliche). Die Frage lief als Wissensfrage durch die Suche, das Modell sah keine Nutzerdaten.

**Erkennung** (`src/lib/hai/dayQuestion.ts`, deterministisch, kein Modell):

- Feste Wendungen wie bisher (Teilstring), dazu natürliche Fragen. Eine natürliche Frage gilt nur, wenn der **ganze Satz** passt (mit Begrüßung davor und Füllwörtern danach). Eine Wissensfrage hat nach dem Stichwort weitere Wörter und bleibt eine: "Was steht in Enabler 3 an", "Was steht im Gesetz an", "Was muss ich tun, um einen Fremdschlüssel zu definieren", "Was sind meine Aufgaben als Fachinformatiker".
- Erkannt werden unter anderem: "Was steht/liegt für mich/bei mir an", "Was habe ich heute/diese Woche zu tun", "Was habe ich vor", "Was muss/soll ich machen/erledigen/tun", "Was ist zu tun/offen/als Nächstes dran/fällig", "Was sind meine Aufgaben/nächsten Schritte/Termine", "Welche Aufgaben habe ich", "Gibt es etwas Neues für mich", "Wo stehe ich", "Plane meine Woche", "Wie sieht meine Woche aus".
- Umlaute werden gefaltet (ein gesprochenes "für" trifft "fuer"). Eine Begrüßung allein ("Guten Morgen!") bleibt die Begrüßung der HAI, die Datenschicht lädt dafür trotzdem die Tageslage.
- Was eine andere Absicht schon richtig beantwortet, bleibt dort: "Wie ist mein Fortschritt/Stand", "Wie weit bin ich" (Fortschritt), "Habe ich Rückmeldungen" (Abgaben, jetzt auch mit Umlaut geschrieben), "Habe ich neue Benachrichtigungen/Neuigkeiten", "Was gibt es Neues" (Benachrichtigungen), "Wann habe ich Berufsschule" (Kalender), "Welche Abgaben sind offen" (Abgaben). Vor der Tageslage geht die Navigation: "Wo geht es weiter", "Weiter lernen", "meine nächsten Schritte" liefern die Karte "Öffnen".
- Bei einer Tagesfrage überspringt die Pipeline die Begrüßungs-, die Themenfremd- und die Erklärungserkennung und die Wissenssuche. Es hängen deshalb keine Quellenkarten von Enablern unter der Antwort, und der Prompt enthält keinen Hinweis "in der Wissensdatenbank nichts gefunden".

**Inhalt** (Azubis, über alle Berufe der Person, nur Felder, die sie in der Plattform ohnehin sieht):

1. Fortschritt und nächster Schritt je Beruf: Anteil abgeschlossener Enabler und der nächste freigeschaltete Enabler mit Begründung (`src/lib/hai/dayProgress.ts`). Die Zahlen kommen aus den Hilfen der Reihenfolge der Arbeit (`loadNextStepEntries`, `src/lib/catalog/progression-db.ts`), der nächste Schritt aus derselben Funktion wie "Weiter lernen" (`pickNextStep`), mit dem Phasenplan der Person.
2. Termine (Berufsschule, Prüfungen, Block), Stand der Ausbildungsnachweise (fehlende Woche, abgelehnt), Abgaben mit Rückmeldung, Benachrichtigungen (wie bisher).
3. Eine Zeile "Leere Bereiche": Was leer ist, steht dort in Worten ("Für heute und die nächsten 14 Tage sind keine Termine eingetragen"). Der Prompt verlangt, das konkret zu nennen, nie pauschal "keine Daten" und nicht "prüfe deinen Stundenplan", wenn die HAI es selbst kennt. Ist überall nichts da, sagt sie das ehrlich und schlägt vor, weiter zu lernen. Konnte der Fortschritt nicht geladen werden, steht das so da (kein "nichts vorhanden").
4. Trainer bekommen wie bisher offene Bewertungen und Benachrichtigungen, keinen Fortschritt.

**Fortschritt je Beruf:** Hat die Person mehrere Berufe, steht der Fortschritt je Beruf da, der im Reiter der App gewählte Beruf (Header `x-catalog`, `PipelineContext.preferredCatalogCode`) zuerst und als "gewählter Beruf" gekennzeichnet. Die Wahl ändert nur die Reihenfolge. Es werden nur die Berufe gelesen, die die Person hat (Katalog-Scope), ein fremder Code wird ignoriert. Die Tageslage selbst ist berufsübergreifend (Beschluss des Product Owners).

**Prompt:** Der Abschnitt "Tageslage (Tagesbegleiter)" (`buildDayBriefingRules`) kommt bei jeder Tagesfrage dazu, auch getippt: höchstens drei Punkte, Dringendes zuerst, danach Fortschritt und nächster Schritt, Leeres konkret benennen, genau eine Frage am Ende, nichts erfinden. Gesprochen gilt zusätzlich der Sprachabschnitt (kurz, ohne Markup), die Eröffnungsfrage des Tages ist unverändert.

## Prüfen der Sprachanbieter

Das Werkzeug `scripts/hai/voice-live-check.mjs` prüft beide Anbieter mit den echten Zugangsdaten, ohne Browser und ohne Mikrofon. Es liest nur: keine Datenbank, keine Datei, keine Änderung bei Soniox oder Sokrates. Es gibt nie einen Schlüssel aus, auch keinen Kurzzeit-Schlüssel. Die Ausgabe nennt nur "gesetzt ja oder nein", Statuscodes, Dauern und den erkannten Text. Taucht ein Schlüssel doch in einem Text auf, wird er vor der Ausgabe durch `[verborgen]` ersetzt. Das Werkzeug gehört nicht zur CI (kein Netz, keine Schlüssel), seine Logik prüft `tests/scripts/hai/voice-live-check.test.mjs` mit ersetztem `fetch` und Websocket.

**Aufruf**

```
node --env-file=.env.local scripts/hai/voice-live-check.mjs
node --env-file=.env.local scripts/hai/voice-live-check.mjs --only soniox
npm run hai:voice-check -- --only haus
```

Die Umgebung kommt nur aus `process.env`: Der Aufrufer exportiert die Variablen oder lässt Node die Datei laden (`--env-file`). Mit `npm run hai:voice-check` müssen die Variablen exportiert sein. Gelesen werden `SONIOX_API_KEY`, `SONIOX_REGION` (Standard `eu`), `OPENAI_COMPATIBLE_BASE_URL` (Standard ist die Adresse von Sokrates im Code), `OPENAI_COMPATIBLE_API_KEY` und, wenn gesetzt, `HAI_STT_HAUS_MODEL`, `HAI_TTS_HAUS_MODEL` und `HAI_TTS_HAUS_VOICE` (sonst `whisper-1`, `tts-1`, `alloy`, bei Open WebUI nur Namen). Die Adresse von Sokrates wird wie in der Anwendung geprüft (https, Host auf der Positivliste), ein Schlüssel geht nie an einen fremden Host. Voraussetzung ist Node 22.18 oder neuer: Das Werkzeug lädt `sonioxServer.ts` und `hausAudio.ts` direkt, damit Adressen, Parameter und Aufrufe aus dem Code der Anwendung kommen und nicht abgeschrieben sind (beide Dateien haben keine Importe und keine Aliase).

**Was geprüft wird**

| Anbieter | Prüfung |
|---|---|
| Soniox | Schlüssel gesetzt. Kurzzeit-Schlüssel für die Sprachausgabe und für die Erkennung holen. Die Frage "Was ist ein Primärschlüssel?" über die Websocket-Sprachausgabe sprechen lassen. Die erzeugte Sprache (PCM) in die Websocket-Erkennung zurückgeben. |
| Sokrates | Schlüssel und Adresse gültig. Sprachausgabe `POST <Adresse>/v1/audio/speech` (die Adresse baut `audioUrl`), Antwort meist MP3. Erkennung `POST <Adresse>/v1/audio/transcriptions` mit der erzeugten Datei. |

Eine Erkennung gilt als bestanden, wenn der Begriff "Primärschlüssel" zurückkommt, mit und ohne Umlaute.

**Ausgabe** (gekürzt, vom Lauf am 02.11.2026 abends)

```
Prüfung                                       Ergebnis   Einzelheiten
--------------------------------------------  ---------  ------------
Soniox eingerichtet                           bestanden  SONIOX_API_KEY gesetzt: ja, Region eu
Soniox Kurzzeit-Schlüssel Sprachausgabe       bestanden  HTTP 201, 0,1 s, gültig 90 s
Soniox Sprachausgabe                          bestanden  1,7 s Sprache nach 0,3 s, gesamt 1,2 s
Soniox Erkennung (erzeugte Sprache zurück)    bestanden  erkannt "Was ist ein Primärschlüssel?" nach 0,9 s
Sokrates Sprachausgabe                        bestanden  HTTP 200, 4,1 s, audio/mpeg, 10 KB
Sokrates Erkennung (erzeugte Sprache zurück)  bestanden  HTTP 200, erkannt "Was ist ein Primärschlüssel?" nach 2,2 s
```

**Exitcodes**

| Code | Bedeutung |
|---|---|
| 0 | Alles bestanden. |
| 1 | Mindestens eine Prüfung ist fehlgeschlagen. Ein Fehlschlag gilt vor "nicht eingerichtet". |
| 2 | Ein geprüfter Anbieter ist nicht eingerichtet (Variable fehlt, falsche Region, Host nicht erlaubt), oder der Aufruf war falsch. Es wurde keine Anfrage gesendet. |

Mit `--only soniox` oder `--only haus` (auch `--only=haus`) wird nur ein Anbieter geprüft.

**Was ein Fehlschlag heißt**

| Meldung | Bedeutung und Abhilfe |
|---|---|
| Soniox, HTTP 401 "gehört zu einem Projekt einer anderen Region" | Der Schlüssel gehört zu einem Soniox-Projekt der anderen Region. Das Werkzeug fragt dazu einmal die andere Region und nennt deren Antwort (Gegenprobe). `SONIOX_REGION` anpassen oder den Schlüssel eines Projekts der gewünschten Region eintragen (für die EU ein EU-Projekt). |
| Soniox, HTTP 401 "auch dort abgelehnt" | Der Schlüssel ist ungültig oder gesperrt, in keiner Region angenommen. |
| Soniox "nicht erreichbar" oder anderer Status | Netzwerk, Zeitüberschreitung oder Störung bei Soniox. Die Kette der Anwendung geht in diesem Fall zum nächsten Anbieter. |
| Soniox "meldet den Fehler N" bei Sprachausgabe oder Erkennung | Die Websocket-Verbindung wurde aufgebaut, Soniox lehnt die Sitzung ab (Modell, Stimme oder Parameter). |
| Erkennung "Begriff Primärschlüssel nicht erkannt" | Die Kette läuft, aber der Text stimmt nicht. Den ausgegebenen Text ansehen (Sprachmodell, Audioformat). |
| Sokrates, HTTP 401 oder 403 | Sokrates lehnt `OPENAI_COMPATIBLE_API_KEY` ab. |
| Sokrates, HTTP 405 | Der Pfad stimmt nicht: Hinter Open WebUI liegen die Audio-Routen unter `/v1/audio/`, die Adresse muss auf `/api` enden. |
| Sokrates, HTTP 400, 404 oder 422 | Sokrates kennt das Modell oder die Stimme nicht (`HAI_STT_HAUS_MODEL`, `HAI_TTS_HAUS_MODEL`, `HAI_TTS_HAUS_VOICE`). |
| Sokrates, HTTP 500 bei der Erkennung | Open WebUI antwortet, aber der Sprachdienst dahinter (Spracherkennung) liefert einen Serverfehler. Open WebUI reicht nur weiter, der Fehler liegt auf Sokrates (so war es am Vormittag des 02.11.2026). Die Anwendung nimmt dann für das Zuhören den Browser. |
| Sokrates, HTTP 500 bei der Sprachausgabe | Dasselbe für den Sprachdienst der Ausgabe. |
| Sokrates, Antwort nicht in der Form `{text, filename}` | Die Antwort der Erkennung ist kein JSON mit Text, zum Beispiel eine Fehlerseite eines Gateways. |

**Wann prüfen:** nach jeder Änderung der Variablen (lokal mit denselben Werten wie in Vercel), nach einem Schlüsselwechsel, bei einer Störung in der Admin-Seite (Zustand "Gestört") und vor den Prüfschritten E14 bis E17 des Testplans.

## Messung von Sokrates und Soniox am 02.11.2026

Gemessen von einem Rechner aus mit den echten Zugangsdaten, ohne Browser. Die Spalte vom Vormittag ist eine Einmalmessung mit einem Wegwerfskript, die Spalte vom Abend stammt vom Prüfwerkzeug aus dem Abschnitt "Prüfen der Sprachanbieter".

| Prüfung | Ergebnis am Vormittag | Erneut gemessen 02.11.2026 abends (Prüfwerkzeug) |
|---|---|---|
| Soniox, Schlüssel aus `.env.local` gegen die EU-Adresse (`api.eu.soniox.com`) | 401, der Schlüssel gehört zu einem Projekt der Region US. Für EU braucht es einen Schlüssel eines EU-Projekts. | Beide Kurzzeit-Schlüssel (Erkennung, Sprachausgabe) kommen mit HTTP 201 in etwa 0,1 Sekunden. |
| Soniox, derselbe Schlüssel gegen die US-Adresse | 201, beide Kurzzeit-Schlüssel (Erkennung, Sprachausgabe) kommen. | Nicht erneut gemessen (das Werkzeug fragt die andere Region nur nach einem 401 als Gegenprobe). |
| Soniox, Kette: Sprachausgabe "Was ist ein Primärschlüssel?" und die erzeugte Sprache zurück in die Erkennung | Bestanden in der Region US: 1,6 Sekunden Sprache nach 1,5 s, erkannt "Was ist ein Primärschlüssel?" nach 1,2 s. | Bestanden in der Region EU: 1,7 Sekunden Sprache nach 0,3 s (gesamt 1,2 s), erkannt "Was ist ein Primärschlüssel?" nach 0,9 s. |
| Sokrates, Modellliste | 22 Modelle, keine Audiomodelle (Open WebUI listet seine Audio-Engines nicht auf). | Nicht erneut gemessen (das Werkzeug fragt die Liste nicht, die Kette hängt nicht von ihr ab). |
| Sokrates, Sprachausgabe `POST /api/v1/audio/speech` mit `tts-1` und `alloy` | 200, MP3, etwa 1,5 bis 2,5 Sekunden je Satz. | 200, `audio/mpeg`, etwa 10 KB, 4,1 Sekunden für den Satz der Prüfung. |
| Sokrates, Spracherkennung `POST /api/v1/audio/transcriptions` | 500: Open WebUI reicht an einen internen Erkennungsdienst (`192.168.178.64:8790`) weiter, und der antwortet mit einem Serverfehler. Muss auf Sokrates behoben werden. | **Behoben.** 200 in etwa 2 Sekunden (2,2 s) mit der MP3 der Sprachausgabe als Eingabe, erkannt "Was ist ein Primärschlüssel?". Der Fehler 500 vom Sprachdienst auf `192.168.178.64:8790` ist weg. |
| Sokrates, Pfad `/api/audio/...` ohne `/v1` (so rief der erste Stand den Dienst auf) | 405. | Nicht erneut gemessen (der Server nutzt `/v1`, die Tests sichern den Pfad). |

Folgen: Der Server hängt für Open WebUI jetzt `/v1` an (`audioUrl`) und gibt die echte Antwortart (MP3) weiter. Die Modellprüfung der Admin-Seite meldet "nicht angeboten" nur noch, wenn das feststeht (fehlt ein Eintrag in der Liste, ist der Zustand unbekannt). Variablen in der Preview: `HAI_STT_HAUS_MODEL=whisper-1`, `HAI_TTS_HAUS_MODEL=tts-1`, `HAI_TTS_HAUS_VOICE=alloy` (bei Open WebUI nur Namen, die Engines und Stimmen stellt Sokrates selbst ein). Ob die Stimme Deutsch gut spricht, zeigt der Hörtest (Testplan E12). Fällt die Erkennung auf Sokrates aus, nimmt die Kette für das Zuhören den Browser, die Sprachausgabe kann trotzdem über Sokrates laufen.

**Stand am Abend des 02.11.2026:** Die Spracherkennung auf Sokrates liefert jetzt Text (HTTP 200 in etwa 2 Sekunden, geprüft mit einer MP3 der Sprachausgabe). Der Fehler 500 vom Sprachdienst auf `192.168.178.64:8790` ist behoben. Damit sind beide Anbieter von Anfang bis Ende bestanden: Soniox (Region EU, Standard) und Sokrates (Sprachausgabe und Erkennung). Offen bleibt der Hörtest (Stimme, Aussprache, Testplan E12) und der Test im Browser mit Mikrofon.
