# HAI Sprachmodus: Recherche zu Latenz und "hört nichts"

Stand: 03.11.2026. Auftrag von Niko nach dem Test in der Preview: (1) Im Gespräch "hört" die HAI noch nichts. (2) Die Stimme beginnt erst sehr versetzt, die Antwort vorzulesen, obwohl der Chat längst fertig ist. Dazu: alle Erfahrungen aus WAMO (und dem Schwesterprojekt Damicon) nutzen und im Internet recherchieren.

Dieses Dokument ist reine Recherche. Es wurde kein Quellcode geändert und kein echter Dienst aufgerufen (kein Soniox, kein Sokrates). Belegt ist, was mit Datei und Zeile oder mit Link und Abrufdatum (03.11.2026) dasteht. Alles andere ist als **Vermutung** gekennzeichnet.

Gelesen wurden: `src/lib/hai/voice/*`, `src/lib/hai/voice/client/*`, `src/components/hai/useHaiVoice.ts`, `HaiVoiceControl.tsx`, `voice-mode/HaiVoiceSession.tsx`, `HaiProvider.tsx`, `src/app/api/hai/chat/route.ts`, `src/lib/hai/ragPipeline.ts`, `next.config.ts`, `src/middleware.ts`, `vercel.json`, `docs/hai-sprachassistent.md`, `docs/hai-sprachmodus.md`. Im Repo WAMO: `voice-core/` (`sprache_anbieter.py`, `soniox_tts.py`, `bot.py`, `cache_waerme.py`, `latenz.py`, `wartesatz.py`, `soft_interrupt.py`), `docs/gespraech-optimierung.md`, README Abschnitt "Stimme messen". Im Repo Damicon: `docs/infra/sprachmodus.md`, `sprachausgabe-anbieter.md`, `src/components/ki/*`, `src/lib/domain/*`.

## 1. Kurzfassung

1. Die Zeitkette "erster Satz fertig bis erster Ton" beginnt bei uns kalt: Für die Sprachausgabe wird erst beim ersten fertigen Satz ein Kurzzeit-Schlüssel beim eigenen Server geholt und danach der WebSocket zu Soniox aufgebaut (`engine.ts` 197 bis 199 und 309, `soniox.ts` 597 bis 664). Das geschieht für jede Antwort neu. Das ist die wahrscheinlichste Hauptursache für "die Stimme beginnt erst sehr versetzt". Die Dauer ist nicht gemessen (Vermutung 0,4 bis 1,5 s, kalt mehr).
2. Der Chat streamt Token (`route.ts` 1002 bis 1015, `HaiProvider.tsx` 1348 bis 1459), und die Stimme wartet nicht auf die fertige Antwort. Satzweise Zerlegung und parallele Streams (bis zu drei) sind vorhanden und richtig gebaut. Sokrates "haus" lädt dagegen jeden Satz als ganze Datei, bevor er spielt (`haus.ts` 244 bis 260), ist aber nur Rückfall.
3. Die Erkennung nutzt Soniox protokollgerecht (Subprotokoll, `audio_format: auto`, Endpunkterkennung, leerer Textframe als Ende). Das Prüfwerkzeug `hai:voice-check` testet aber nur rohes PCM aus Node (`voice-live-check.mjs` 213 bis 218), nicht den Browserweg mit Mikrofon und `MediaRecorder`. Dieser Weg wurde nie live geprüft.
4. Für "hört nichts" ist am Code keine einzelne Ursache beweisbar. Am wahrscheinlichsten ist ein **stiller Rückfall** (Schlüssel, Organisation, Limit, Region) auf einen Anbieter, der nichts liefert (`engine.ts` 116 bis 168), gefolgt von der Mikrofonbehandlung (Rauschunterdrückung und Echounterdrückung an, `deps.ts` 175 bis 183, anders als im offiziellen Soniox-SDK).
5. Es gibt keine Sperre durch Sicherheitsheader: `next.config.ts`, `src/middleware.ts` und `vercel.json` setzen weder Content-Security-Policy noch Permissions-Policy. Mikrofon und beide Soniox-WebSockets sind von der App aus nicht blockiert.
6. Größter Hebel auf der Hörseite ist die Endpunkterkennung: `sttSessionConfig` setzt nur `max_endpoint_delay_ms: 1500` (`sonioxServer.ts` 123). Soniox nennt für Sprachassistenten Stufe 2 und Empfindlichkeit 0,3 als Startpunkt, Damicon maß mit den Vorgaben 2,2 s vom letzten Wort bis zum Endpunkt.
7. WAMO zeigt, was fehlt: Verbindung beim Sitzungsstart vorgewärmt (`bot.py` 1069 bis 1074), Messweg mit Zeitstempeln je Stufe (`latenz.py`), Wartesatz bei langsamem Modell (`wartesatz.py`), sanftes Unterbrechen. Damicon zeigt: Schlüssel auf Vorrat, Verbindung über Fragen hinweg offen, Vorlauf gegen Aussetzer, ein Mikrofonstrom für das ganze Gespräch.
8. Ein einzelner TTS-Fehler wie "Limit erreicht" schaltet die Stimme für den Rest des Gesprächs auf den Browser um (`engine.ts` 235 bis 259). Soniox erlaubt nur 3 gleichzeitige TTS-Streams für das ganze Konto, wir nutzen allein schon 3 (`soniox.ts` 501).
9. Ohne Messpunkte lässt sich keine Verbesserung belegen. Schritt 1 des Plans ist deshalb ein Messpunkt im Client, der nur Zeiten und Anbieter-Kennungen loggt, keine Inhalte.
10. Plan in Kurzform: Messpunkte, dann TTS vorwärmen und Schlüssel vorhalten, Endpunkt-Parameter, Mikrofon-Einstellungen mit Pegel, Robustheit bei Limit und Zeitüberschreitung, erster Satz kürzer plus Wartesatz. Optional und als Entscheidung für Niko: dauerhafte Erkennung für das ganze Gespräch, Unterbrechen per Stimme, Modell vorwärmen.

## 2. Was WAMO und Damicon können und wir nicht

| Nr | Technik | Wo (Beleg) | Wir heute (Beleg) | Wirkung |
|---|---|---|---|---|
| 1 | Verbindung zur Sprachausgabe steht schon beim Sitzungsstart, eine kurze Begrüßung wärmt sie auf ("der erste Soniox-Satz einer Verbindung brauchte einmal 10 s") | WAMO `voice-core/bot.py` 1069 bis 1074 | Neue Verbindung je Antwort, erst beim ersten Satz: `engine.ts` 309, `soniox.ts` 615 bis 664 | Erster Ton ohne Verbindungsaufbau |
| 2 | Schlüssel auf Vorrat, geholt noch während das Modell über den ersten Satz nachdenkt | Damicon `docs/infra/sprachausgabe-anbieter.md` 44 bis 50, `src/components/ki/sprachausgabe-strom.ts` 24 bis 26 und 294 bis 350 | Schlüssel erst beim ersten Satz: `soniox.ts` 626, `deps.ts` 98 bis 129 | Spart den Weg über Vercel (Anmeldung, Datenbank, Soniox) |
| 3 | Verbindung bleibt über Fragen offen (Keepalive alle 5 s, zu nach 20 s ohne Strom) | Damicon `sprachausgabe-anbieter.md` 64 bis 65 | `close()` nach jeder Antwort: `soniox.ts` 577 bis 587 | Folgeantworten ohne Handshake |
| 4 | Vorlauf von 0,25 s gegen Netzschwankungen, verdoppelt sich nach hörbarem Aussetzer (bis 1 s), `naechsterStart` | Damicon `src/lib/domain/sprachausgabe-strom.ts` 89 bis 109 und 315, `sprachausgabe-strom.ts` 573 bis 598 | Kein Vorlauf: `audio.ts` 211 (`Math.max(currentTime, nextStart)`) | Weniger Stocken, kostet bis 0,25 s |
| 5 | Endpunkterkennung für das Gespräch: Empfindlichkeit 0,2, Latenzstufe 2, höchstens 1000 ms; gemessen mit den Vorgaben 2,2 s vom letzten Wort bis zum Endpunkt | Damicon `src/lib/domain/diktat-live.ts` 130 bis 146 | Nur `max_endpoint_delay_ms: 1500`: `sonioxServer.ts` 123 | Bis etwa 1 s früher |
| 6 | Lokale Sprachaktivität schließt den Zug ab (0,15 s), Transkript etwa 270 ms nach dem Sprechende | WAMO `bot.py` 195 bis 198 und 660, `docs/gespraech-optimierung.md` 133 bis 140 | Wir warten auf die Endpunkterkennung von Soniox, Rückfallzeit 4 s (`soniox.ts` 222) | Spät beginnende Antwort |
| 7 | Messweg mit Zeitstempeln je Stufe (`turn_ende`, `stt_final`, `llm_token`, `tts_satz`, `tts_audio`, `ausgabe`), p50 und p95, nur Zeiten | WAMO `voice-core/latenz.py` 1 bis 23, README Abschnitt "Stimme messen" | Kein Messpunkt im Client | Ohne Messung kein Beleg |
| 8 | Wartesatz: kein Zeichen vom Modell nach 2,5 s, dann einmal "Einen Moment.", nicht im Verlauf | WAMO `voice-core/wartesatz.py` 1 bis 25 | Nur das Bild "HAI denkt nach" | Keine stumme Wartezeit |
| 9 | Prompt-Cache beim Sitzungsstart vorwärmen (erste Frage 100 bis 1100 ms langsamer ohne) | WAMO `voice-core/cache_waerme.py` 1 bis 16 | Kein Vorwärmen des Chat-Modells oder der Suche | Kürzere erste Antwort, hier nur Vermutung |
| 10 | Vorab-Satz: die Antwort beginnt mit einem kurzen Satz (höchstens acht Wörter), der sofort gesprochen wird | Damicon `docs/infra/sprachmodus.md` 98 bis 103 | `buildVoiceRules` verlangt kurze Sätze, aber keinen kurzen ersten (`prompts.ts` 183 bis 201) | Früherer erster Satz |
| 11 | Mikrofon: ein Strom und eine Live-Sitzung für das ganze Gespräch, wegen iOS (Audiosession wechselt sonst, Antwort kommt leise über den Hörer) | Damicon `docs/infra/sprachmodus.md` 188 bis 208, `sprachmodus-ohr.ts` 35 bis 49 | Mikrofon und WebSocket je Runde neu, Tracks gestoppt: `soniox.ts` 456 bis 465 | Weniger Anlauf je Runde, iOS stabiler |
| 12 | Mikrofon roh: Echo, Rauschunterdrückung aus, 16 kHz, Zeitscheibe 60 bis 100 ms (offizielles SDK und Damicon) | SDK `microphone.ts`, Damicon `src/lib/domain/diktat.ts` 62 bis 94 | `echoCancellation: true`, `noiseSuppression: true`, Zeitscheibe 250 ms: `deps.ts` 175 bis 183, `soniox.ts` 312 | Bessere Erkennung leiser Sprache |
| 13 | Sanftes Unterbrechen (Dämpfen nach 0,25 s, Stopp an der Wortgrenze, Echo und Rückmeldelaute filtern) | WAMO `soft_interrupt.py` 408 bis 418 | Nur Tipp (`useHaiVoice.ts` 582 bis 590), Mikrofon bei Wiedergabe aus | Natürlicheres Gespräch, braucht Echoschutz |
| 14 | Dazwischenreden über Lautstärke (RMS) gegen die eigene Ausgabe, erst nach 400 ms durchgehender Sprache | Damicon `docs/infra/sprachmodus.md` 169 bis 184 | nein | wie 13 |
| 15 | Fehlerfolge: schneller Verbindungsfehler gibt zwei Neuversuche nach 500 ms, erst dann Meldung | Damicon `docs/infra/sprachmodus.md` 226 bis 236 | Ein Fehler lässt den Anbieter für den Rest des Gesprächs ausfallen: `engine.ts` 243 bis 259 | Robuster bei kurzen Aussetzern |
| 16 | Immer nur ein TTS-Strom wegen des Kontolimits (3 gleichzeitige Ströme für die ganze Organisation) | Damicon `sprachausgabe-anbieter.md` 99 bis 105 | Bis zu 3 Streams gleichzeitig: `soniox.ts` 501 | Kein Fehler bei Mitnutzung durch WAMO oder Damicon (Vermutung, gleiches Konto) |

Was wir besser machen als WAMO: WAMO misst, dass Soniox in einem durchlaufenden Stream erst nach etwa 65 Zeichen Vorschau spricht, oder bei `text_end` (`soniox_tts.py` 9 bis 20). Wir senden jeden Satz als eigenen Stream mit `text_end: true` (`soniox.ts` 605 bis 609), dieser Rückhalt tritt bei uns nicht auf. WAMO baut dafür extra einen `StartAggregator` (`soniox_tts.py` 97 bis 124), den wir nicht brauchen.

## 3. Befunde der Internet-Recherche (Abruf 03.11.2026)

Alle Aussagen stammen aus den verlinkten Seiten. Herstellerseiten sind Primärquelle für ihr Produkt, aber interessengeleitet bei Messwerten.

### (a) Soniox, laut offizieller Dokumentation

- **Authentifizierung im Browser:** `new WebSocket(url, ['soniox-api-key', temporaryKey])`, kein `api_key` in der Startnachricht. Der `api_key` in der Startnachricht ist veraltet, ab 15. Januar 2027 wird eine Verbindung abgelehnt, die den Schlüssel nur dort sendet. Ein falscher Schlüssel lässt `onopen` trotzdem feuern, danach kommt ein Fehlerframe und die Verbindung schließt. Beides gleichzeitig (Header und Subprotokoll) ergibt Fehler 400. Quellen: [WebSocket authentication](https://docs.soniox.com/guides/websocket-authentication), [WebSocket API Erkennung](https://docs.soniox.com/stt/api-reference/websocket-api). Unser Code (`soniox.ts` 96 bis 98) entspricht dem.
- **Konfiguration der Erkennung:** `model: stt-rt-v5`, `audio_format: auto` (für Container wie von `MediaRecorder`), für rohes PCM `audio_format`, `sample_rate`, `num_channels`. `max_endpoint_delay_ms` 500 bis 3000, Standard 2000. `endpoint_sensitivity` -1,0 bis 1,0 (Standard 0), `endpoint_latency_adjustment_level` 0 bis 3 (Standard 0), beide nur für v5. Ende des Streams ist ein **leerer Textframe** (ein leerer Binärframe zählt nur als leeres Audiostück). Fehlerformat: `error_code`, `error_type`, `error_message`. Fehler 408 unter anderem bei "Timed out while waiting for the first audio chunk". Quelle: [WebSocket API Erkennung](https://docs.soniox.com/stt/api-reference/websocket-api).
- **Endpunkterkennung:** semantisch (Pausen, Betonung, Satzbau), liefert das Token `<end>`. Empfehlung für Sprachassistenten: `enable_endpoint_detection: true`, `endpoint_latency_adjustment_level: 2`, `endpoint_sensitivity: 0.3`, `max_endpoint_delay_ms: 1500`, "danach mit echten Gesprächen feinjustieren". Höhere Stufen erzeugen mehr Endpunkte und etwas geringere Genauigkeit. Quelle: [Endpoint detection](https://docs.soniox.com/stt/rt/endpoint-detection).
- **Manuelles Abschließen:** `{"type":"finalize"}` finalisiert alles bis dahin, Antwort `<fin>`. Soniox empfiehlt, etwa 200 ms Stille nach dem Sprechende zu senden, bevor man `finalize` ruft, und nicht öfter als alle paar Sekunden. Gedacht für Push-to-Talk und Voice-Activity im Client. Quelle: [Manual finalization](https://docs.soniox.com/stt/rt/manual-finalization).
- **Keepalive Erkennung:** `{"type":"keepalive"}`, mindestens alle 20 s ohne Audio, "alle 5 bis 10 s üblich". Ohne beides endet der Stream nach 20 s mit 408. Abgerechnet wird die **volle Streamdauer**, nicht nur das verarbeitete Audio. Quelle: [STT Connection keepalive](https://docs.soniox.com/stt/rt/connection-keepalive).
- **Sprachausgabe, Protokoll:** je Stream eine Konfiguration mit `stream_id`, dann `text` und `text_end`, bis 5000 Zeichen je Nachricht. Antworten `audio` (Base64), `audio_end`, danach `terminated: true`, erst das gilt als vollständig. `cancel` finalisiert ohne weiteres Audio und sendet `terminated`. Bis zu **5 Streams je Verbindung**. Ein Stream ohne Text über "mehr als ein paar Sekunden" ohne `text_end` endet mit `request_timeout`, Keepalive verhindert das nicht. Quelle: [TTS WebSocket API](https://docs.soniox.com/api-reference/tts/websocket-api).
- **Sprachausgabe, Verbindung offen halten:** `{"keep_alive": true}` alle 20 bis 30 s, ohne aktiven Stream schließt die Verbindung nach etwa 40 s. "Es gibt keine Frist für den ersten Stream nach dem Öffnen." Das passt für Agenten, bei denen zwischen den Äußerungen das Modell arbeitet. Quelle: [TTS Connection keepalive](https://docs.soniox.com/tts/rt/connection-keepalive).
- **Streaming von Modelltext:** "Jedes Token oder jeden Tokenblock direkt in einen Textblock geben", die Sprache beginnt, während das Modell noch erzeugt. Zahlen zur Zeit bis zum ersten Ton nennt die Doku nicht. Quelle: [Real-time generation](https://docs.soniox.com/tts/rt/real-time-generation).
- **Limits:** Sprachausgabe: 100 Anfragen je Minute, **3 gleichzeitige Streams über alle Verbindungen**, 5 Streams je Verbindung, höchstens 2 Minuten Audio je Stream. Erkennung: 100 Anfragen je Minute, 10 gleichzeitige Streams. Verbindungen (auch leere) zählen gegen ein Limit. Quellen: [TTS limits](https://docs.soniox.com/tts/rt/limits-and-quotas), [STT limits](https://docs.soniox.com/stt/rt/limits-and-quotas). Damicon beschreibt dieselben 3 Ströme als Limit "für die ganze Organisation (erhöhbar)".
- **Kurzzeit-Schlüssel:** `usage_type` `transcribe_websocket` oder `tts_rt`, `expires_in_seconds` 1 bis 3600, `max_session_duration_seconds` bis 18000, `single_use` optional. Ohne `single_use` ist der Schlüssel in seiner Laufzeit nicht auf eine Verbindung beschränkt (die Doku nennt keinen Standardwert, Vermutung: nicht einmalig). Quelle: [Create temporary API key](https://docs.soniox.com/stt/api-reference/auth/create_temporary_api_key).
- **Regionen:** EU `stt-rt.eu.soniox.com`, `tts-rt.eu.soniox.com`, `api.eu.soniox.com`. Schlüssel gehören je Projekt zu einer Region. Quelle: [Data residency](https://docs.soniox.com/data-residency).
- **Latenz laut Soniox:** Eine Verbindungszeit über 1 s kommt von Netzlaufzeit, Region und großem Anfangskontext. Tipp: "Audio lokal puffern, bis die Verbindung steht, dann alles sofort senden." Quelle: [FAQ](https://docs.soniox.com/faq). Direkt vom Mikrofon zu Soniox ohne Zwischenserver ist die latenzärmste Architektur, der Server stellt nur Schlüssel aus: [Direct stream](https://docs.soniox.com/guides/direct-stream). Das tun wir.
- **Offizielles Web-SDK:** nimmt mit `getUserMedia` und `MediaRecorder` auf, **ohne** Echo- und Rauschunterdrückung und ohne automatische Pegelregelung, mit `channelCount: 1`, `sampleRate: 16000` und 60 ms Zeitscheibe ([microphone.ts](https://github.com/soniox/soniox-js/blob/main/packages/client/src/audio/microphone.ts)). Es puffert Audio, solange der Schlüssel geholt wird: [Web SDK Erkennung](https://docs.soniox.com/sdk/web-SDK/stt/realtime-transcription). Die Wiedergabe der Sprachausgabe läuft im SDK-Beispiel über ein `MediaSource`-Audioelement, nicht über Web Audio: [Web SDK Sprachausgabe](https://docs.soniox.com/sdk/web-SDK/tts/realtime-speech-generation).
- **Latenzbudget von Soniox (Wiki, Stand 02.07.2026, Herstellerseite):** Ziel etwa 800 ms wahrgenommen. Richtwerte: Endpunkt 200 bis 400, Finalisierung 50 bis 150, erstes Modelltoken 300 bis 500, erster Ton 100 bis 200, Netz 100 bis 200 ms. Quelle: [Voice agent latency budget](https://soniox.com/wiki/voice-agent-latency-budget). WAMO misst im Betrieb 1,4 bis 1,9 s bis zum ersten Ton (`docs/gespraech-optimierung.md` 133 bis 140) und Damicon 2,9 bis 4,3 s (`sprachmodus.md` 210 bis 213).

### (b) Muster niedriger Latenz

- **Streamen und satzweise sprechen:** Pipecat fasst Tokens standardmäßig zu ganzen Sätzen zusammen (`TextAggregationMode.SENTENCE`), mit `TOKEN` gehen sie direkt an die Sprachausgabe "für geringere Latenz". WebSocket-Dienste liefern die niedrigste Latenz. Quelle: [Pipecat Text-to-Speech](https://docs.pipecat.ai/guides/learn/text-to-speech). Soniox-Wiki: "Die Zeit bis zum ersten Ton bestimmen die ersten Wörter, nicht der ganze Satz."
- **Satzweise Zerlegung als Hauptmuster:** Die Modellausgabe geht Satz für Satz an die Sprachausgabe, die Wiedergabe beginnt, während das Modell noch weiter erzeugt (Sammelaussage mehrerer Herstellerseiten, nur mit Vorsicht zu lesen, zum Beispiel [NVIDIA FAQ](https://perspectives.nvidia.com/nemotron-speech/task/faq/what-end-to-end-latency-should-i-target-for-a-conversational-voice-agent-to-feel/): Ziel unter 1 s vom Sprechende bis zum ersten Ton).
- **Mikrofon vor der Verbindung öffnen:** LiveKit nennt es "Instant connect": Das Mikrofon läuft schon, bevor der Agent verbunden ist, das Gesprochene wird gepuffert und nach dem Verbinden gesendet. Quelle: [LiveKit Speech](https://docs.livekit.io/agents/build/speech/). Wir tun das bereits (`soniox.ts` 308 bis 313 und 348 bis 354).
- **Spekulatives Starten des Modells:** LiveKit startet das Modell vor der Bestätigung des Turn-Endes ("preemptive generation", Standard an, die Sprachausgabe wartet). Preis: verworfene Modellaufrufe. Quelle: [LiveKit Speech](https://docs.livekit.io/agents/build/speech/). Für uns erst nach den billigen Schritten sinnvoll.
- **Turn-Erkennung:** OpenAI Realtime bietet `server_vad` (Stille) und `semantic_vad` mit `eagerness`, kürzere Stillezeit erkennt Turns schneller. Quelle: [OpenAI Realtime VAD](https://developers.openai.com/api/docs/guides/realtime-vad). Soniox deckt das semantisch über `<end>` ab.
- **Barge-in:** LiveKit stoppt den Agenten standardmäßig, sobald der Mensch zu sprechen beginnt, Pipecat nutzt Wortzeitstempel, um nur Gesprochenes in den Verlauf zu schreiben ([Pipecat](https://docs.pipecat.ai/guides/learn/text-to-speech)). WAMO und Damicon lösen es zusätzlich mit Dämpfen und Echofilter (siehe Abschnitt 2).
- **AudioContext freischalten:** Seit Chrome 71 gilt die Autoplay-Regel auch für Web Audio. Ein `AudioContext` vor der Nutzergeste startet `suspended`, `resume()` nach einem Klick oder Anlegen im Klick-Handler. Die Quelle empfiehlt "bei `click` bleiben". Quelle: [Chrome Autoplay](https://developer.chrome.com/blog/autoplay). Unser `unlockAudio` im Klick (`useHaiVoice.ts` 559, `engine.ts` 331 bis 337) entspricht dem.
- **AudioWorklet statt Pufferquellen:** Der Worklet läuft auf dem Audio-Thread ohne zusätzliche Latenz ([Chrome AudioWorklet](https://developer.chrome.com/blog/audio-worklet)), ist aber für eigene Signalverarbeitung gedacht. Damicon spielt PCM-Stücke lückenlos mit `AudioBufferSourceNode` und Zeitachse (`sprachausgabe-strom.ts` 573 bis 598), wir ebenso (`audio.ts` 207 bis 221). **Ein Worklet ist für unser Problem nicht nötig** (Einschätzung, nicht gemessen).
- **Jitter-Puffer:** Belegt ist nur Damicons Verfahren: 0,25 s Vorlauf, nach hörbarem Aussetzer verdoppelt, bis 1 s (Doku) bzw. 2 s (Konstante `STROM_VORLAUF_MAX_S`). Allgemeine Quellen zum Thema wurden nicht gefunden.

### (c) Typische Ursachen, warum die Aufnahme nichts liefert

- **Mikrofonfreigabe:** `getUserMedia` verlangt einen sicheren Kontext (HTTPS oder localhost), sonst ist `navigator.mediaDevices` undefiniert. `NotAllowedError` bei Ablehnung, bei unsicherem Kontext oder wenn die Permissions-Policy es nicht erlaubt. `NotFoundError` ohne passendes Gerät, `NotReadableError` bei Hardware- oder Betriebssystemproblem. **Das Versprechen kann dauerhaft offen bleiben**, wenn der Nutzer die Abfrage ignoriert. Quelle: [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- **Permissions-Policy:** Standard für `microphone` ist `self`, ein Block lässt `getUserMedia` mit `NotAllowedError` scheitern. Quelle: [MDN Permissions-Policy microphone](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/microphone). Für uns **nicht zutreffend**, siehe Abschnitt 6.
- **Eingestellte und tatsächliche Werte:** `getSettings()` meldet `sampleRate`, `echoCancellation`, `noiseSuppression`, `autoGainControl`. Die Werte können vom Wunsch abweichen oder fehlen. Quelle: [MDN getSettings](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings). Konsequenz: tatsächliche Werte im Messpunkt festhalten.
- **Abtastrate:** Browser nehmen oft mit 48 kHz auf, auch wenn 16 kHz gewünscht ist (Damicon, `diktat.ts` 62 bis 94: "viele Browser nehmen trotzdem mit 48 kHz auf, und das ist in Ordnung"). Bei `MediaRecorder` mit Container und `audio_format: auto` ist das für Soniox kein Problem. Bei rohem PCM wäre es eines, das nutzen wir nicht.
- **Container gegen PCM:** Soniox erwartet bei `auto` einen Container. Damicon nennt als Praxis: webm/opus, "auf dem iPhone mp4, genau so macht es das offizielle Web-SDK" (`diktat-live.ts` 166 bis 168). Unser `recorderOptions` (`deps.ts` 82 bis 91) wählt webm/opus, sonst mp4.
- **Rauschunterdrückung:** Damicon begründet das Abschalten mit dem SDK: Das Modell sei auf rohe Aufnahmen trainiert, die Unterdrückung "schneidet Silbenanfänge und leise Laute weg" (`diktat.ts` 62 bis 80). Das ist eine Herstellerempfehlung und eine Beobachtung eines Schwesterprojekts, keine unabhängige Messung.
- **Safari und iOS:** Berichte über WebKit-Fehler nach `getUserMedia`: Ausgabe sehr leise oder über den Hörer ([WebKit Bug 230902](https://bugs.webkit.org/show_bug.cgi?id=230902) und verwandte Einträge, überwiegend 2017 bis 2021, Stand der aktuellen iOS-Version nicht bestätigt). Als Abhilfe berichten einzelne Kommentare Wiedergabe über einen `AudioContext` mit Gain und `suspend`/`resume` während der Aufnahme (anekdotisch, nicht geprüft). Damicon hält deshalb den Mikrofonstrom für das ganze Gespräch offen (`sprachmodus-ohr.ts` 35 bis 49).
- **Verlust der Nutzer-Geste:** Chrome empfiehlt `resume()` im Klick. Bei iOS nennen Berichte Gesten wie `touchend`. In `HaiVoiceSession.tsx` 161 bis 165 startet die Einwilligung `start()` per `setTimeout(..., 0)`. Das hält die Chrome-Aktivierung noch, auf iOS ist es **Vermutung**, dass es nicht genügt.
- **CSP:** Würde eine CSP gesetzt, müssten `connect-src` `wss://stt-rt.eu.soniox.com` und `wss://tts-rt.eu.soniox.com` enthalten, `media-src` und `worker-src` nur bei Audio-Elementen und Worklets (wir nutzen beides nicht). Es ist keine CSP gesetzt (Abschnitt 6).

### (d) Wie andere Latenz unter einer Sekunde halten (nur Prinzipien)

1. Alle Stufen streamen und überlappen: Erkennung gibt Zwischenstände, das Modell startet früh, die Sprachausgabe beginnt mit den ersten Wörtern ([Soniox Wiki](https://soniox.com/wiki/voice-agent-latency-budget), [Pipecat](https://docs.pipecat.ai/guides/learn/text-to-speech)).
2. Turn-Ende semantisch und schnell erkennen statt feste Stille abzuwarten (Soniox, OpenAI `semantic_vad`).
3. Dienste in einer Region und kurze Wege ([Soniox Wiki](https://soniox.com/wiki/voice-agent-latency-budget): etwa 100 ms). Unsere Vercel-Funktionen laufen in `dub1` (`vercel.json`), Soniox EU ist passend.
4. Verbindungen und Mikrofon vor dem Bedarf öffnen und puffern ([LiveKit Instant connect](https://docs.livekit.io/agents/build/speech/), [Soniox FAQ](https://docs.soniox.com/faq)).
5. Spekulatives Modell vor dem Turn-Ende (LiveKit), nur wenn die billigen Schritte nicht reichen.
6. Barge-in, damit die Stimme beim Dazwischenreden sofort stoppt (LiveKit, Pipecat).

Nicht erreicht: Deepgram Voice Agent (die Seite war nur ein Verzeichnis ohne Latenzangaben), Vapi (keine Quelle gefunden), OpenAI Realtime zu Audiostreaming (nur die Seite zu Turn-Erkennung gelesen). Aus Zeitgründen nicht vertieft.

## 4. Zeitkette Ist: von "Antwort beginnt" bis "erster hörbarer Ton"

Reihenfolge in der Praxis, mit den Stellen im Code. Zeiten sind **nicht gemessen**, Vermutungen sind gekennzeichnet.

| Stufe | Was passiert | Datei, Zeile | Wartet auf die fertige Antwort? | Engpass |
|---|---|---|---|---|
| 0 | Frage gesprochen, Runde endet, `submit` sendet an `/api/hai/chat` mit `stream: true` | `useHaiVoice.ts` 441 bis 455, `HaiProvider.tsx` 1301 bis 1320 | nein | Vorlauf auf dem Server siehe Stufe 1 |
| 1 | Server arbeitet vor dem ersten Token: Anmeldung, Plan, Benutzer, Schalter, Sitzung, Nachricht speichern, Verlauf, Gedächtnis, Berufswahl, Titel, Phasenplan, dann Suche mit Einbettung und Live-Daten, dann Modellaufruf | `route.ts` 605 bis 998, `ragPipeline.ts` 1037 bis 1207 (`retrieveContext` 1115, `fetchDataContext` 1128, Modell 1199) | nein, aber **vor** jedem Token | Wahrscheinlich der größte Block bis zum ersten Zeichen (Vermutung). Einbettung läuft auf Sokrates, wo Modelle geladen werden, in früheren Messungen war der Server belegt |
| 2 | Token kommen als SSE (`data: {"chunk"}`), Header `text/event-stream`, kein Puffern erkennbar | `route.ts` 1010 bis 1013 und 1147 bis 1153, `openai-compatible.ts` 345 bis 461 | nein, streamt | nein |
| 3 | Client hängt jedes Stück an die Nachricht (`setMessages`) | `HaiProvider.tsx` 1390 bis 1410 | nein | nein |
| 4 | Effekt in `useHaiVoice` zerlegt den Text satzweise, erster Satz ab 24 Zeichen mit Satzzeichen und Leerraum danach | `useHaiVoice.ts` 592 bis 631, `speech.ts` 86 und 95 bis 134 | nein, satzweise | Der erste Satz kommt erst, wenn das Modell ihn (und das folgende Leerzeichen) erzeugt hat. Bei langem erstem Satz entsprechend später |
| 5 | Erster `say` erzeugt erst jetzt den Sprecher und damit die Soniox-Anbindung | `useHaiVoice.ts` 612 bis 624, `engine.ts` 193 bis 207 und 307 bis 313 | nein | **Kalt**: bis hierhin nichts vorbereitet |
| 6 | Schlüssel holen: `authFetch` (Token, ggf. Warten auf Berufswahl), POST `soniox-token`, dort Anmeldung, Datenbankabfrage des Organisationsschalters, Ratenbegrenzung, Aufruf an `api.eu.soniox.com` | `deps.ts` 98 bis 129, `authFetch.ts`, `soniox-token/route.ts` 38 bis 70, `routeGuard.ts` (`requireVoiceUser`), `voiceAccess.ts`, `sonioxServer.ts` 186 bis 246 | nein | **Je Antwort neu**, nicht je Satz. Vercel-Weg mit mindestens drei Teilschritten (Vermutung 0,3 bis 0,9 s, kalt mehr). Soniox selbst: 0,1 s (`docs/hai-sprachassistent.md` 240) |
| 7 | WebSocket zu `tts-rt.eu.soniox.com`: TLS und Upgrade, dann Konfiguration und Text je Satz (ein Stream je Satz) | `soniox.ts` 625 bis 664 und 597 bis 613 | nein | Handshake zählt bei uns zur Wartezeit (Vermutung 0,2 bis 0,4 s) |
| 8 | Soniox erzeugt Audio, erster Ton laut Messung 0,3 s nach dem Text (WAMO: +330 ms) | `docs/hai-sprachassistent.md` 200, WAMO `docs/gespraech-optimierung.md` 139 | nein | Dienst |
| 9 | Base64 zu PCM zu `AudioBuffer`, sofort eingeplant mit `start = max(currentTime, nextStart)`, keine Vorlaufzeit | `soniox.ts` 683 bis 696, `audio.ts` 207 bis 221 | nein | Gering. Bluetooth-Ausgabe addiert Verzögerung (Vermutung) |
| 10 | Weitere Sätze: bis zu 3 Streams parallel, Wiedergabe in Reihenfolge ohne Lücke | `soniox.ts` 501 und 589 bis 595, `audio.ts` 179 bis 205 | nein | Limit 3 für das ganze Konto |
| 11 | Mit dem Antwortende ruft `end()`, nach dem letzten gespielten Stück `onDone`, dann wieder Zuhören | `useHaiVoice.ts` 632 bis 642, `engine.ts` 209 bis 271 | ja, nur für das Weiterhören | Erst nach der letzten Silbe beginnt die nächste Runde (Schlüssel, Mikrofon, WebSocket neu) |

Antworten auf die Einzelfragen des Auftrags:

- Wartet die Sprachausgabe auf die fertige Antwort? **Nein**, nur der Wechsel zum Zuhören.
- Wird der Text satzweise gesendet? **Ja**, ein Stream je Satz mit `text_end` (`soniox.ts` 601 bis 609).
- Wird die Verbindung erst beim ersten Satz aufgebaut? **Ja** (Stufe 5 bis 7).
- Holt jeder Satz einen neuen Schlüssel? **Nein**, einer je Verbindung, also je Antwort (`soniox.ts` 615 bis 626).
- Lädt Sokrates "haus" erst eine ganze MP3? **Ja**, je Satz die ganze Datei, dann `decodeAudioData` (`haus.ts` 244 bis 260). Gemessen 1,5 bis 4,1 s je Satz (`docs/hai-sprachassistent.md` 244). Nur Rückfall.
- Gibt es Wartezeit durch `await` auf die Chat-Antwort im Sprachmodus? `submit` ruft `void sendMessage(...)` ohne `await` (`useHaiVoice.ts` 452), der Chat streamt. Eine Wartezeit durch ein Nicht-Streamen gibt es **nicht**. Es gibt stattdessen den Vorlauf vor dem ersten Token (Stufe 1).

Dazu Zeiten **vor** der Antwort, die Niko als Trägheit erlebt:

- Das Ende der Frage erkennt Soniox selbst. Mit `max_endpoint_delay_ms: 1500` und den Standardwerten für Stufe und Empfindlichkeit kann das bis zu 1,5 s nach dem letzten Wort dauern (Damicon maß 2,2 s mit den Vorgaben, `diktat-live.ts` 130 bis 146). Danach `finishRound` mit leerem Textframe und Warten auf `finished` (`soniox.ts` 422 bis 438, bis 3 s Reserve).
- Die Hörrunde beginnt jedes Mal neu: Schlüssel, Mikrofon, `MediaRecorder`, WebSocket (`soniox.ts` 294 bis 378).

## 5. Ursachen für "hört nichts", nach Wahrscheinlichkeit

Die Wahrscheinlichkeiten sind eine **Einschätzung**, abgeleitet aus dem Code. Keine Ursache ist bewiesen.

Zeitkette "Mikrofon bis erstes Zwischenergebnis":

1. Tippen: `start()` ruft `unlockAudio` und `listen()` (`useHaiVoice.ts` 553 bis 579).
2. `createRecognition` erzeugt `ChainedRecognition`, die den ersten Anbieter der Kette nimmt (`engine.ts` 116 bis 168).
3. Phase "listening" wird **sofort** gesetzt, vor dem Mikrofon (`useHaiVoice.ts` 534 bis 536).
4. `SonioxRecognition.run`: Schlüssel anfragen (parallel) und `getUserMedia` (`soniox.ts` 294 bis 303), `MediaRecorder` mit 250 ms Scheiben (`soniox.ts` 309 bis 313), dann auf den Schlüssel warten (kein Zeitlimit, `soniox.ts` 318 bis 324), dann WebSocket öffnen mit 8 s Frist (`soniox.ts` 329 bis 343).
5. `onopen`: Konfiguration senden, gepufferte Stücke hinterher (`soniox.ts` 344 bis 354).
6. Soniox sendet Tokens, `onMessage` ruft `onresult` (`soniox.ts` 393 bis 413).

| Rang | Ursache | Beleg im Code | Prüfung ohne Browser |
|---|---|---|---|
| 1 | **Stiller Rückfall.** Schlüssel verweigert (401, Region), Organisation ohne Schalter (403), Ratenbegrenzung (429, 40 je Minute), Fehler 503. Die Kette geht dann ohne Meldung zum nächsten Anbieter, zuletzt zum Browser (`SpeechRecognition`), der in Firefox fehlt und in Chrome je nach Netz nichts liefert | `engine.ts` 116 bis 168 (`markFailed`, `continue`), 147 bis 151, `useHaiVoice.ts` 504 bis 514 (`aborted` und `no-speech` werden ignoriert), `soniox.ts` 318 bis 324 | `npm run hai:voice-check -- --only soniox` mit `.env.local` (prüft Schlüssel und Region). `GET /api/hai/voice/config` mit Anmeldung ansehen: zeigt `chains.stt`. Adminseite `/trainer/admin/hai`: "Gestört" mit Grund je Funktion. Vercel-Laufzeitprotokoll der Preview nach `Soniox key refused`. Im Sprachmodus zeigt der Fuß, wohin der Ton geht (`docs/hai-sprachmodus.md` 62) |
| 2 | **Unbekannter Browserweg.** Das Prüfwerkzeug sendet rohes PCM (`pcm_s16le`), die App webm/opus mit `audio_format: auto` und Endpunkterkennung. Dieser Weg ist nur mit Attrappen getestet. Das Protokoll entspricht der Doku und der Praxis von SDK und Damicon, deshalb nur mittlere Wahrscheinlichkeit | `voice-live-check.mjs` 213 bis 218, `sonioxServer.ts` 117 bis 149, `deps.ts` 82 bis 91 | Erweiterung des Prüfwerkzeugs: eine Sprachprobe (aus der TTS) mit `ffmpeg` zu webm/opus kodieren und in 100 ms Stücken mit `sttSessionConfig()` senden, Tokens zählen (siehe Plan, Schritt 9) |
| 3 | **Mikrofonbehandlung.** Rauschunterdrückung und Echounterdrückung an, Pegelregelung nach Browserstandard, keine `sampleRate`. Das SDK schaltet alles ab, weil Unterdrückung leise Sprache beschneidet. Wirkt eher "versteht schlecht" als "nichts", bei leisem Mikrofon auch "nichts" | `deps.ts` 175 bis 183 | Nur mit Messpunkt und Pegelanzeige im Browser. Ohne Browser: nicht prüfbar |
| 4 | **Gesprochen, bevor das Mikrofon offen ist.** "HAI hört zu" erscheint vor `getUserMedia` und vor dem Schlüssel. Der erste Satz geht verloren, wenn er vor dem Mikrofonstart beginnt. Danach puffert `pending` zuverlässig. Dazu 8 s ohne Wort ab Verbindung und drei stille Runden führen in "Pause" | `useHaiVoice.ts` 534 bis 536, `soniox.ts` 220 und 360 bis 362, `useHaiVoice.ts` 524 bis 530 | Unit-Test mit Attrappen (zeitlich), im Browser nur mit Messpunkt |
| 5 | **Konkurrenz um Soniox-Limits.** 3 gleichzeitige TTS-Streams für das Konto, 100 Anfragen je Minute. Ein Fehler beim Sprechen schaltet die Stimme für den Rest des Gesprächs um, zeigt sich also nicht als "hört nichts" sondern als Stimmwechsel. Für die Erkennung selten (10 Streams) | `soniox.ts` 501, `engine.ts` 235 bis 259 | Fehlercode im Messpunkt loggen (nur `error_type`, keine Inhalte). Mit zwei Läufen des Prüfwerkzeugs gleichzeitig nachstellbar |
| 6 | **Schlüssel hängt.** `authFetch` hat kein Zeitlimit, die Erkennung wartet unbegrenzt auf den Schlüssel, die Oberfläche zeigt "hört zu" (Kaltstart der Funktion, Wartezeit der Berufswahl hat ein Limit in `whenCatalogSettled`) | `soniox.ts` 318 bis 324, `authFetch.ts`, `selection.ts` 153 bis 169 | `curl` auf die Route mit Zeitmessung (braucht Anmeldung der Preview) |
| 7 | **AudioContext bleibt `suspended`.** Dann spielt keine Quelle, `onended` kommt nie, `onDone` nie, die Schleife hört nach der Antwort nicht mehr zu. Niko hört die Stimme, deshalb unwahrscheinlich auf Desktop. Auf iOS möglich (Einwilligung startet per `setTimeout`) | `engine.ts` 331 bis 337, `audio.ts` 215 bis 220, `HaiVoiceSession.tsx` 161 bis 165 | Nur im Browser. `ctx.state` im Messpunkt loggen |
| 8 | **Netz, Proxy, Firewall** blockt `wss://stt-rt.eu.soniox.com` (Damicon kennt "Proxy blockt WebSockets"). Folge: Verbindung scheitert, Rückfall | `soniox.ts` 341 bis 377 | `Test-NetConnection stt-rt.eu.soniox.com -Port 443` und das Prüfwerkzeug vom selben Rechner |
| 9 | **Umgebung ändert sich im Gespräch.** `useEffect(() => stop, [stop])` beendet bei neuem `env` das Gespräch. Die Konfiguration wird nur im Leerlauf geholt und danach verworfen, wenn das Gespräch läuft (`cancelled`). Unwahrscheinlich | `useHaiVoice.ts` 284 bis 295 und 653, `HaiVoiceSession.tsx` 102 bis 118 | Unit-Test |
| 10 | Sicherheitsheader (CSP, Permissions-Policy) | siehe Abschnitt 6 | Antwortheader der Preview mit `curl -I` ansehen (Anmeldung nötig) |

## 6. Sicherheitsheader: geprüft

- `next.config.ts`: **keine** `headers()`-Funktion. Es gibt nur `redirects()`.
- `src/middleware.ts`: setzt nur `Cache-Control` für `/api/*` (Zeilen 6 bis 42). Keine CSP, keine Permissions-Policy.
- `vercel.json`: nur `git.deploymentEnabled: false` und `regions: ["dub1"]`. Keine `headers`.
- Suche im Quelltext (`src`, `public`, `next.config.ts`, `vercel.json`) nach `Content-Security-Policy`, `Permissions-Policy`, `Feature-Policy` und `http-equiv`: einziger Treffer ist `src/lib/submission-file/access.ts` 237 (`default-src 'none'; sandbox` für ausgelieferte Abgabedateien, nicht für die Seiten).
- Folge: Das Mikrofon (Standard `self`) und beide WebSockets (`wss://stt-rt.eu.soniox.com`, `wss://tts-rt.eu.soniox.com`) werden von der App **nicht** blockiert. `media-src` und `worker-src` sind irrelevant, weil weder Audioelement noch Worklet im Einsatz sind.
- Offen, nicht geprüft: Ob Vercel in der Preview eigene Header ergänzt (Annahme: keine CSP). Prüfbar mit `curl -I` gegen die Preview-Adresse mit Bypass-Token.

## 7. Umsetzungsplan, priorisiert

Reihenfolge nach Nutzen je Aufwand und Risiko. Alle Texte der Oberfläche über das Übersetzungssystem (`de.json`, `en.json`), neue Schlüssel in einem markierten Block. Gewinne sind **Vermutungen**, bis Schritt 1 sie misst.

### Schritt 1: Messpunkte im Client (Voraussetzung, kein Gewinn)

- **Neu:** `src/lib/hai/voice/client/trace.ts` mit `mark(name: string, data?: Record<string, string | number | boolean>)`. Schalter: `localStorage['hai-voice-trace'] === '1'` (try/catch). Ausgabe nur `console.info('[hai-voice]', name, ms seit erstem Zeichen, data)` und `performance.mark`. Erlaubte Felder: Zahlen, Anbieter-Kennung, `ctx.state`, `track.getSettings()` (`sampleRate`, `echoCancellation`, `noiseSuppression`, `autoGainControl`), Fehlercode oder `error_type`. **Nie** Text, Transkript, Schlüssel, Adresse.
- **Marken und Einfügestellen:**
  - `listen.start` (`useHaiVoice.ts` 470), `ctx.state` bei `start` (559)
  - `stt.token.start`, `stt.token.end` (`soniox.ts` 296 und 320), `stt.mic.ready` mit `getSettings` (299 bis 303), `stt.ws.open` (344), `stt.interim.first` (402), `stt.endpoint` (408), `stt.end` (440)
  - `submit` (`useHaiVoice.ts` 441), `chat.first.text` (beim ersten nicht leeren Antworttext im Effekt, 601), `piece.first` (624)
  - `tts.token.start`, `tts.token.end`, `tts.ws.open` (`soniox.ts` 626, 640), `tts.audio.first` (684), `play.first` (`audio.ts` 220, erste geplante Quelle), `answer.done` (`useHaiVoice.ts` 615)
- **Abgeleitete Zeiten:** A `stt.interim.first` bis `stt.endpoint` (Endpunktwartezeit, grob), B `submit` bis `chat.first.text` (Server bis erstes Zeichen), C `chat.first.text` bis `piece.first` (Satzzerlegung), D `piece.first` bis `play.first` (Anlauf der Sprachausgabe, **die Zahl für "Stimme versetzt"**), E `listen.start` bis `stt.interim.first`.
- **Test:** `tests/unit/hai/voiceTrace.test.ts` (aus ohne Schalter, nur erlaubte Felder, kein Text).
- **Erwartung:** keine. **Messung:** Niko öffnet die Preview mit gesetztem Schalter, ein Gespräch mit fünf Fragen, Zeiten A bis E kopieren. Ziel für D nach Schritt 2: unter 600 ms (Vermutung, aus Soniox 0,3 s plus Auslieferung).

### Schritt 2: Sprachausgabe vorwärmen und Schlüssel vorhalten (größter erwarteter Gewinn für D)

Änderungen:

1. `src/lib/hai/voice/client/types.ts`: `SpeakerLike` bekommt `warm?(): void`. `PieceEngine` in `browserSpeech.ts` bekommt `warm?(): void`.
2. `src/lib/hai/voice/client/soniox.ts`: `SonioxSpeaker.warm()` ruft `void this.connect().catch(() => undefined)` und startet einen Wartezeit-Timer `WARM_IDLE_MS = 20_000`: kommt bis dahin kein `speak`, `close()` (ähnlich Damicon, 20 s ohne Strom). Der Keepalive (alle 5 s, `soniox.ts` 658 bis 662) bleibt. Es darf **kein Stream ohne Text** geöffnet werden (Soniox beendet ihn nach wenigen Sekunden mit `request_timeout`, WAMO hat genau das erlebt, `soniox_tts.py` 1 bis 7).
3. `src/lib/hai/voice/client/engine.ts`: `ChainedSpeaker.warm()` erzeugt die Engine (`makeEngine`) und ruft `engine.warm?.()`. Wenn kein Anbieter sprechen kann, nichts tun.
4. `src/components/hai/useHaiVoice.ts`: den Speicher des Sprechers aus dem Effekt (Zeilen 612 bis 623) in eine Hilfsfunktion `ensureSpeaker(state)` heben. `submit` (Zeile 441) ruft sie nach `spokenRef.current = freshSpoken()` und danach `state.speaker?.warm?.()`. Der Effekt nutzt dieselbe Funktion. Wenn die Antwort keinen sprechbaren Text hat, endet der Sprecher über `end()` und `onDone` wie bisher (`check()` verlangt nur `ended` und alle Einträge fertig, `engine.ts` 261 bis 271). Wichtig: bei `answerSpokenNavigation` (`HaiProvider.tsx` 1251) kommt keine Serverantwort, der Wärm-Sprecher wird beim nächsten `submit` oder `stop` abgebrochen und fällt sonst nach 20 s von selbst zu.
5. `src/lib/hai/voice/client/deps.ts`: `fetchToken` mit Vorrat. `Map<'stt'|'tts', { grant, validUntil }>`, wiederverwenden, solange `Date.now() < validUntil - 15_000` (`expiresInSeconds` aus der Antwort, 90 s laut `sonioxServer.ts` 57). Neues `prefetchToken(purpose)` (ohne Fehler nach außen), aufgerufen in `start()` für beide Zwecke und nach jedem Rundenende für `stt`. Bei Fehler beim Öffnen (Socket schließt vor `onopen`) den Eintrag verwerfen. **Vermutung zu prüfen:** Der Schlüssel ist nicht einmalig (kein `single_use` im Aufruf, `sonioxServer.ts` 203 bis 209) und darf in seiner Laufzeit mehrere Verbindungen öffnen. Prüfung mit dem Prüfwerkzeug: zwei Verbindungen mit demselben Schlüssel nacheinander.
- **Tests:** `tests/unit/hai/voiceClient.test.ts` erweitern: `warm` öffnet genau eine Verbindung, kein Stream ohne Text, Schließen nach 20 s, `speak` nach `warm` nutzt dieselbe Verbindung, Vorrat gibt denselben Schlüssel zurück und verwirft abgelaufene. `tests/unit/components/hai/useHaiVoice.providers.test.tsx`: Sprecher entsteht bei `submit`, `onDone` bei Antworten ohne sprechbaren Text.
- **Erwartung (Vermutung):** D sinkt um Schlüsselweg plus Handshake, also etwa 0,4 bis 1,5 s, kalt mehr. Dazu spart der Vorrat bei jeder Hörrunde den Serverweg (E). **Messung:** D und E vor und nach.
- **Risiken:** Eine offene Verbindung zählt gegen das Verbindungslimit, deshalb nur zwischen `submit` und Antwortende (kein Dauerbetrieb). Ratenbegrenzung der Route: 40 je Minute (`soniox-token/route.ts` 36), der Vorrat senkt die Last.

### Schritt 3: Endpunkterkennung beschleunigen

- `src/lib/hai/voice/sonioxServer.ts` `sttSessionConfig()`: ergänzen `endpoint_latency_adjustment_level: 2`, `endpoint_sensitivity: 0.2`, `max_endpoint_delay_ms: 1_000`. Das sind die Werte, die Damicon nach Rückmeldungen gewählt hat (`diktat-live.ts` 130 bis 146), die Soniox-Empfehlung ist 2, 0,3 und 1500. **Achtung:** Damicon fängt zu frühe Schnitte mit einem "Nachsatz" ab, wir senden beim ersten Endpunkt (`soniox.ts` 408 bis 411). Deshalb vorsichtiger starten (Stufe 1, Empfindlichkeit 0,2, 1000 ms), mit Schritt 1 messen, dann Stufe 2 probieren.
- **Test:** `tests/unit/hai/voiceServer.test.ts` (Konfiguration enthält die Felder, Grenzen von Soniox: 500 bis 3000, -1 bis 1, 0 bis 3).
- **Erwartung (Vermutung):** bis etwa 1 s früherer Endpunkt (Damicon: 2,2 s mit den Vorgaben). **Messung:** Zeit A und Zahl der abgeschnittenen Fragen (Fragen, bei denen der Text am Ende fehlt) in zehn Läufen.
- **Optional, danach:** `VoiceActivity` (`audio.ts` 262 bis 313, bisher nur für Sokrates) mit `AnalyserNode` am Mikrofon betreiben und nach 200 ms Stille `{"type":"finalize"}` senden (Soniox-Empfehlung, [Manual finalization](https://docs.soniox.com/stt/rt/manual-finalization)). WAMO erreicht so Transkripte etwa 270 ms nach dem Sprechende (`bot.py` 195 bis 198, `docs/gespraech-optimierung.md` 133 bis 140). Größerer Eingriff, erst nach Schritt 3.

### Schritt 4: Mikrofon wie im offiziellen SDK, Pegel, ehrlicher Zustand

- `deps.ts` `getUserMedia` (Zeilen 175 bis 183): `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: true` (Damicon behält die Regelung, `diktat.ts` 62 bis 94, wegen leiser Sprecher), `channelCount: 1`, `sampleRate: 16_000` (nur Wunsch). Begründung: Das Mikrofon ist während der Wiedergabe aus (`useHaiVoice.ts` 23 bis 26), das Echo der eigenen Stimme spielt in der Hörrunde keine Rolle. **Zu beachten:** ohne Kopfhörer kann das Ende der Stimme in die nächste Runde reichen, deshalb nach `onDone` 150 ms warten, bevor `listen()` startet (`afterAnswer`, `useHaiVoice.ts` 548 bis 551).
- `soniox.ts` Zeile 312: `recorder.start(100)` statt 250 (Damicon 100 ms, SDK 60 ms).
- Pegel: `SonioxRecognition` hängt über `deps.audioContext().createMediaStreamSource` und `createAnalyser` (Typen in `audio.ts` 44 bis 49, `rmsOf` in 316 bis 321) einen Analysator an (nicht an das Ziel, sonst Echo) und ruft alle 100 ms `onlevel(rms)`. `ChainedRecognition` in `engine.ts` leitet `onlevel` weiter (heute fehlt das, deshalb meldet kein Anbieter den Pegel, `docs/hai-sprachmodus.md` 96). Das Maskottchen zeigt den Pegel schon (`useHaiVoice.ts` 497 bis 503). Ein sichtbarer Pegel ist die einfachste Diagnose für "hört nichts" (stummes oder falsches Mikrofon).
- Zustand: `listening` erst setzen, wenn das Mikrofon offen ist. Dazu `onaudiostart` im `RecognitionLike` (Name wie beim Browser) in `types.ts`, in `SonioxRecognition` nach `recorder.start`, in `ChainedRecognition` durchreichen, in `listen()` als `micReady`. Bis dahin Text "HAI richtet das Mikrofon ein" (neuer Übersetzungsschlüssel, im markierten Block).
- **Tests:** `voiceClient.test.ts` (Einstellungen, 100 ms, Pegel), `useHaiVoice.test.tsx`.
- **Erwartung (Vermutung):** bessere Erkennung leiser Sprache, weniger "nichts gehört", E um 150 ms kürzer. **Messung:** Pegel und `getSettings` im Messpunkt, Anteil leerer Runden vor und nach.

### Schritt 5: Robustheit bei Limit und Zeitüberschreitung

- `soniox.ts` `MAX_ACTIVE_STREAMS` von 3 auf 2 (Limit des Kontos ist 3, [TTS limits](https://docs.soniox.com/tts/rt/limits-and-quotas)), zusätzlich in `onMessage` bei Streamfehlern mit Code 429 (oder `error_type` mit "concurrent") den Satz einmal nach 400 ms neu einreihen, bevor `slot.fail` den Anbieter-Wechsel auslöst. Der genaue `error_type` für das Kontolimit ist **nicht dokumentiert**, deshalb in Schritt 1 mitloggen und dann eintragen.
- `engine.ts` `failOver` (Zeilen 243 bis 259): ein Fehler markiert den Anbieter bis Gesprächsende. Änderung: erst ein Neuversuch nach 500 ms (Damicon `sprachmodus.md` 226 bis 236), erst dann `markFailed`. Der Satz, der lief, wird heute schon wiederholt gesprochen (`docs/hai-sprachassistent.md` 63).
- `soniox.ts` `run()` (318 bis 324): `Promise.race` des Schlüssels gegen `CONNECT_MS` (8 s), danach `fail('provider-unavailable')`. Gleiches für `open()` der Sprachausgabe (Zeile 626).
- Tests: `voiceClient.test.ts` (Limit ergibt Neuversuch, Zeitüberschreitung ergibt Rückfall).
- **Erwartung:** kein Hänger bei "hört zu", keine unnötige Umschaltung auf die Browserstimme. **Messung:** Zähler der Rückfälle je Gespräch im Messpunkt.

### Schritt 6: Erster Satz früher, keine stumme Wartezeit

- **Prompt (einfach, wenig Risiko):** In `buildVoiceRules` (`prompts.ts` 189 bis 200) eine Regel: "Der erste Satz hat höchstens zwölf Wörter und beantwortet die Frage in der Sache." Das folgt Damicons Vorab-Satz (`sprachmodus.md` 98 bis 103). Test in den Prompt-Tests, danach der Lauf des Golden Sets im Sprachweg (`HAI_GOLDEN_VOICE=yes`, `docs/hai-golden-set.md`), weil der Prompt die Antwortqualität berührt. **Erwartung:** C sinkt bei langen ersten Sätzen.
- **Wartesatz (wie WAMO):** In `useHaiVoice.ts` ein Timer: Phase `thinking`, 3 s kein Stück, dann einmal `speaker.say(waitPhrase)` ("Einen Moment."), nicht in `spoken` und nicht im Verlauf, nie zweimal je Antwort, Abbruch bei `interrupt`/`stop`. Der Text kommt als Option `waitPhrase` aus `HaiVoiceSession.tsx` (wie `placeholderText`, Zeile 96) über den Schlüssel `hai.voice.wait`. Vorbild `wartesatz.py` (2,5 s, einmal je Zug).
- **Nicht tun:** den ersten Satz mitten im Satz am Komma teilen. Die Zählung `spokenCount` in `nextSpeechPieces` (`speech.ts` 126 bis 134) setzt eine stabile Zerlegung voraus, ein früher Schnitt würde bei wachsendem Text neu zerlegt und Stücke doppelt oder gar nicht sprechen. Wer es trotzdem will, braucht einen Zeichenzähler statt der Stückzahl und eine Rückfallregel, das ist ein eigenes Paket.
- Tests: `tests/unit/hai/*` (neue Regel), `useHaiVoice.test.tsx` (Wartesatz einmal, nicht im Verlauf).

### Schritt 7: Anzeige des tatsächlichen Anbieters

- Der Fuß des Sprachmodus nennt den Anbieter bereits (`providerStatement.ts`, `docs/hai-sprachmodus.md` 62). Ergänzen: bei Rückfall der Erkennung ein sichtbarer Zusatz ("Spracherkennung: Browser, Rückfall") aus `onActiveProvider` (`engine.ts` 321 bis 323), damit ein stiller Rückfall (Ursache 1) nie mehr unsichtbar ist. Marke `stt.provider` im Messpunkt.

### Schritt 8: iOS und Safari absichern (Vermutung, nur auf echtem Gerät prüfbar)

- `acceptConsent` (`HaiVoiceSession.tsx` 161 bis 165): `unlockAudio` **synchron im Klick** aufrufen (heute erst in `start()` nach `setTimeout`). Dazu `unlockAudio` im Rückgabewert von `useHaiVoice` bereitstellen.
- Nach jedem `getUserMedia` `ctx.resume()` rufen und `ctx.state` loggen (Berichte zu WebKit, siehe Abschnitt 3 c).
- Entscheidung zu Schritt 11 (Mikrofonstrom für das ganze Gespräch) hängt davon ab.

### Schritt 9: Prüfwerkzeug für den Browserweg ohne Browser

- `scripts/hai/voice-live-check.mjs` erweitern um `--webm`: eine Sprachprobe aus der TTS per `ffmpeg` zu webm/opus kodieren, in 100 ms Stücken mit der echten `sttSessionConfig()` (also `audio_format: auto` mit Endpunkterkennung) senden, Zeit bis zum ersten Token und bis `<end>` messen, und die Messung "zweite Verbindung mit demselben Schlüssel" und "TTS zweiter Stream auf derselben Verbindung" ausgeben. So lassen sich Ursache 2 und der Gewinn aus Schritt 2 ohne Browser belegen. Nur mit eigenem Schlüssel aus `.env.local`, nichts schreiben.

### Optionen mit Entscheidung von Niko (nicht ohne Freigabe)

1. **Dauerhafte Erkennung und offenes Mikrofon für das ganze Gespräch** (Damicon `sprachmodus.md` 188 bis 208). Vorteile: kein Anlauf je Runde, iOS stabiler, Voraussetzung für Unterbrechen per Stimme. Nachteile: Aufnahmeanzeige des Browsers dauerhaft an, Einwilligungstext anpassen, Kosten (Soniox rechnet die volle Streamdauer ab, [Keepalive](https://docs.soniox.com/stt/rt/connection-keepalive)), Sitzungsende nach 180 s im Schlüssel (`sonioxServer.ts` 59) anpassen. Aufwand mittel bis hoch.
2. **Unterbrechen per Stimme** (WAMO Dämpfen und Echofilter, Damicon Pegelvergleich). Braucht das Mikrofon während der Wiedergabe und damit Echoschutz. Erst nach Option 1.
3. **Chat-Modell und Suche vorwärmen** (WAMO `cache_waerme.py`): eine leichte Anfrage beim Start des Gesprächs, die das Modell auf Sokrates und die Einbettung lädt. Wirkung auf Stufe 1 ist unbekannt, Kosten und Rechte der Route prüfen. Zuerst B in Schritt 1 messen: Ist B groß, lohnt es.
4. **Serverzeiten für Stufe 1** als `Server-Timing`-Header der Chat-Route im Sprachmodus (Dauer je Block, keine Inhalte), um B in Teile zu zerlegen. Berührt `route.ts`, Freigabe nötig.
5. **Jitter-Vorlauf** nach Damicon (0,25 s, verdoppelt nach Aussetzer, `audio.ts` 211). Erst einführen, wenn der Messpunkt hörbare Lücken zählt (Lücke zwischen `onended` und nächstem `start`). Bis dahin nein, weil er die Wartezeit verlängert.
6. **Spekulatives Starten des Modells** (LiveKit `preemptive_generation`): erst wenn nach den Schritten 2 und 3 die Gesamtzeit über 1,5 s bleibt. Kosten: verworfene Modellaufrufe auf Sokrates.

## 8. Reihenfolge und Erwartung auf einen Blick

| Schritt | Aufwand | Erwarteter Gewinn (Vermutung) | Messgröße |
|---|---|---|---|
| 1 Messpunkte | klein | keiner, macht alles andere belegbar | A bis E |
| 2 Vorwärmen und Schlüsselvorrat | mittel | D um 0,4 bis 1,5 s, E um 0,3 bis 1 s | D, E |
| 3 Endpunkt-Parameter | klein | A um bis zu 1 s | A, Zahl abgeschnittener Fragen |
| 4 Mikrofon, Pegel, Zustand | mittel | bessere Erkennung, weniger leere Runden | Pegel, Anteil leerer Runden |
| 5 Limit und Zeitüberschreitung | klein bis mittel | kein Hänger, keine ungewollte Browserstimme | Zähler Rückfälle |
| 6 Prompt und Wartesatz | klein | C kürzer, keine stumme Wartezeit | C, Zahl Wartesätze |
| 7 Anzeige Anbieter | klein | Rückfall nie mehr unsichtbar | Sichtprüfung |
| 8 iOS | klein | nur auf Gerät prüfbar | `ctx.state` |
| 9 Prüfwerkzeug | klein | belegt Ursache 2 und Schritt 2 ohne Browser | Messwerte im Werkzeug |

Vor dem Merge jedes Schritts: gezielte Tests (`tests/unit/hai/*`, `tests/unit/components/hai/*`), Testplan `docs/hai-testplan.md` Abschnitt J (J4, J5, J8 bis J11) im Browser von Hand mit gesetztem Messschalter wiederholen, Zeiten A bis E in `docs/hai-sprachassistent.md` unter "Messung" nachtragen.

## 9. Nicht erreichbar oder nicht geprüft

- **Exa und Firecrawl** (die Quellen der ECC-Skills `ecc:deep-research` und `ecc:exa-search`) waren in dieser Sitzung nicht verbunden (Firecrawl erfordert Anmeldung, kein Exa-Werkzeug vorhanden). Recherche lief über WebSearch und WebFetch.
- **REA** war nicht nutzbar: Es gibt keinen Browser mit offenem Debug-Port auf `127.0.0.1:9222`. Es wurde kein Netzwerkverhalten einer fremden Seite beobachtet. WAMO hat REA an der Demo `unmute.sh` bereits eingesetzt (README "Stimme messen"), die Ergebnisse (Puffer nur 80 ms, leeren beim Unterbrechen) sind dort nachzulesen.
- **Nicht gefunden oder nur Verzeichnisseiten:** Deepgram Voice Agent (keine Latenzangaben), Vapi, OpenAI Realtime zu Audiostreaming. WebSearch liefert nur US-Treffer.
- **Nicht möglich ohne Gerät oder echten Dienst:** Zeiten der Zeitkette, Verhalten auf iOS und Safari, Mikrofonpegel, ob der Soniox-Schlüssel mehrere Verbindungen zulässt, der Fehlercode für das Kontolimit, Hörqualität.
- **Nicht geprüft:** ob Vercel in der Preview eigene Antwortheader ergänzt, ob in der Preview ein EU-Schlüssel für Soniox hinterlegt ist (der Stand vom 02.11.2026 abends sagt: ja, `project-kfbm-aktuell`, nicht in Vercel gelesen), ob WAMO und Damicon dasselbe Soniox-Konto nutzen (Vermutung).

## 10. Hintergrundstimmen: Befunde und Messwerte (04.11.2026)

Auftrag: Im Gesprächsmodus soll nur die Stimme des Nutzers zählen, leise Hintergrundgespräche und fremde Sprecher dürfen nicht in das Gespräch kommen, und es braucht Signalwörter, bei denen die HAI anhält. Die Umsetzung steht in `docs/hai-sprachmodus.md` (Abschnitt 14), die Prüffälle im Testplan (Gruppe S). Hier stehen die Belege.

### (a) Befund im Code vor der Änderung

- `micConstraints('live')`: Echo-Unterdrückung an, Rauschunterdrückung aus, **automatische Pegelregelung an**.
- Beim Zuhören zählte alles, was Soniox als Äußerung lieferte. Es gab keine Prüfung der Lautstärke, der Sicherheit (Konfidenz) oder des Sprechers. Die Lautstärkeschwelle `BARGE_IN_LEVEL` galt nur für ein einzelnes Wort beim Unterbrechen, zwei erkannte Wörter reichten immer.
- Es gab keine Anhaltwörter: "Stopp" beendete das ganze Gespräch (`isStopCommand`).

### (b) Was Soniox laut offizieller Dokumentation liefert (Abruf 04.11.2026)

- **Wörter (Tokens)** der Echtzeit-Schnittstelle (`docs.soniox.com/stt/api-reference/websocket-api`): `text`, `start_ms`, `end_ms`, `confidence` ("Confidence score 0.0 to 1.0"), `is_final`, `speaker` ("Speaker label (if diarization enabled)"). Die Konfidenz kommt ohne weiteren Schalter.
- **Sprechertrennung in Echtzeit** (`docs.soniox.com/stt/concepts/speaker-diarization`): möglich mit `enable_speaker_diarization: true`, je Wort ein Feld `speaker` (Zeichenkette, "1", "2", ...), bis 15 Sprecher je Sitzung. Aber: Echtzeit sei "anspruchsvoller wegen der Latenz", mit höheren Fehlern als im Nachhinein, vorübergehende Sprecherwechsel, die sich mit mehr Kontext stabilisieren. Und: Endpunkterkennung und manuelles Finalisieren erzwingen früheres Finalisieren und senken die Genauigkeit. Für die höchste Genauigkeit rät die Dokumentation, keine Endpunkterkennung zu verwenden (`docs.soniox.com/stt/rt/endpoint-detection` sagt dasselbe: "If speaker diarization is enabled, endpoint detection reduces diarization accuracy because it forces earlier finalization"). Zu kurzen Sitzungen sagt die Dokumentation nichts. Der Token `<end>` trägt nur `text` und `is_final`.

### (c) Messung: Konfidenz und Sprecher (synthetische Sprache)

Die Sprache kommt von Soniox selbst (Sprachausgabe `tts-rt-v2`, Stimmen Daniel und Lena), wird auf Pegel gebracht und an die Erkennung `stt-rt-v5` (Region EU, die echte Konfiguration der App, zusätzlich mit `enable_speaker_diarization`) geschickt. Kein Chatmodell. Skript im Scratchpad, nicht im Repository. Die Stimme "A" ist die Person (Daniel, Effektivwert 0,078), "B" die Stimme im Raum (Lena).

| Fall | Erkannt | Konfidenz Mittel, kleinster Wert | Sprecher |
|---|---|---|---|
| A allein | vollständig richtig | 0,998, 0,98 | 1 |
| B allein, minus 10 dB (Effektivwert 0,026) | vollständig richtig | 0,998, 0,94 | 1 |
| B allein, minus 20 dB (0,008) | vollständig richtig | 0,998, 0,95 | 1 |
| B allein, minus 30 dB (0,0025) | vollständig richtig | 0,997, 0,93 | 1 |
| B allein, minus 40 dB (0,0008, etwa minus 62 dBFS) | richtig, zwei Äußerungen | 0,999, 0,99 | **1 und 2** (dieselbe Stimme) |
| A laut, B minus 20 dB gleichzeitig | nur A | 0,999, 0,99 | 1 |
| A, danach B gleich laut | beide richtig | 0,986, 0,59 (B) | 1 und 2 (richtig) |
| A, danach B minus 15 dB | beide richtig | 0,983, 0,50 (B) | 1 und 2 (richtig) |
| B minus 15 dB **zuerst**, danach A | beide richtig | 0,997, 0,92 | B ist **Sprecher 1**, A Sprecher 2 |

Schlüsse:

1. **Die Konfidenz trennt nah von fern nicht.** Eine Stimme 40 Dezibel unter der Person wird mit 0,999 erkannt. Die Konfidenz fängt nur Genuschel (einzelne Wörter bei 0,5 bis 0,6). Deshalb ist sie nur eine Zusatzstufe mit niedriger Schwelle (0,6, streng 0,75).
2. **Soniox kennt kein "zu leise".** Die Erkennung schreibt auch Sprache mit, die weit unter der Person liegt. Ohne Pegelprüfung im Client kommt sie in das Gespräch. Das ist die Ursache der Meldung.
3. **Laut gegen leise zugleich:** Die leise Stimme verschwindet unter der lauten (nur A erkannt), nacheinander wird sie vollständig erkannt.
4. **Sprechertrennung ist für unseren Fall nicht tragfähig.** Sie trennt nacheinander gesprochene Stimmen richtig, aber (a) dieselbe leise Stimme wurde in zwei Äußerungen als zwei Sprecher geführt (die Endpunkterkennung finalisiert früh, so schreibt es die Dokumentation) und (b) spricht zuerst jemand im Hintergrund, ist der "erste Sprecher der Sitzung" der Hintergrund. Beides würde den Nutzer aussperren. Nicht gebaut.

### (d) Messung: Pegelregelung und Rauschunterdrückung im Browser

Chrome 157 (Windows, headless) mit gefälschtem Mikrofon (`--use-fake-device-for-media-stream`, `--use-file-for-fake-audio-capture=<wav>`). Die Datei: dreimal abwechselnd die laute Stimme A und die leise Stimme B (minus 20 dB), dazu Raumrauschen bei etwa minus 58 dBFS. Die Seite fordert das Mikrofon mit den Einschränkungen der Variante an (`channelCount: 1`, Echo-Unterdrückung an) und liest den Pegel (Effektivwert über 1024 Werte alle 100 ms) aus einem `AnalyserNode`. Zahlen: Mittelwert des Effektivwerts je Sprechabschnitt (drei Abschnitte je Stimme, Bereich), und der Rauschboden (20. Perzentil des Effektivwerts der Aufnahme).

| Variante | Rauschboden | A laut (Effektivwert) | B leise, nach A | B leise **allein im Raum** |
|---|---|---|---|---|
| Echo + Pegelregelung (bisheriges Profil `live`) | 0,0020 | 0,117 bis 0,162 | 0,016 bis 0,019 | Mittel der ganzen Aufnahme 0,030, Rauschboden 0,0039 (ein einziger Abschnitt, Rauschen mit angehoben) |
| Echo, **ohne** Pegelregelung (neu) | 0,00065 | 0,064 bis 0,071 | 0,0080 bis 0,0093 | 0,0076 bis 0,0093 |
| Echo + Rauschunterdrückung, ohne Pegelregelung | 0,00009 | 0,064 bis 0,070 | 0,0075 bis 0,0099 | 0,0081 bis 0,0094 |
| Echo + Rauschunterdrückung + Pegelregelung | 0,00034 | 0,124 bis 0,173 | 0,016 bis 0,022 | **0,053 bis 0,068** |

Schlüsse:

1. **Die Pegelregelung hebt eine leise Stimme allein im Raum um etwa 16 Dezibel an** (0,009 auf 0,053 bis 0,068) auf den Pegel der Person am Mikrofon ohne Regelung (0,064 bis 0,071). Mit ihr ist das Hintergrundgespräch für jedes Pegel-Tor so laut wie der Nutzer. Sie hebt auch das Rauschen an (Rauschboden 0,00065 auf 0,0020). Entscheidung: **aus** im Profil `live`.
2. **Die Rauschunterdrückung senkt nur gleichmäßiges Rauschen** (0,00065 auf 0,00009), eine leise Stimme lässt sie unverändert (0,0093 gegen 0,0099, die Erkennung der Stimme B ist in allen vier Varianten vollständig). Sie hilft gegen Hintergrundstimmen nicht. Entscheidung: **bleibt aus** (der Grund aus dem offiziellen SDK, dass sie Silbenanfänge abschneidet, bleibt unberührt).
3. **Die Wirkung auf die Erkennung** wurde mit den vier aufgezeichneten Dateien (`MediaRecorder`, webm/opus) an Soniox geschickt: beide Stimmen wurden in allen vier Varianten erkannt. Die kleinste Wortkonfidenz lag mit dem bisherigen Profil (Echo und Pegelregelung) bei 0,60 und 0,73, in den drei anderen Varianten über 0,85. Ein Nachteil der abgeschalteten Regelung zeigte sich nicht.
4. **Nicht gemessen** (nur am echten Gerät): Mikrofone mit sehr niedrigem Pegel ohne Regelung, die Echo-Unterdrückung gegen echte Lautsprecher. Hier greift die adaptive Schwelle und, als Ausweg, "Drücken zum Sprechen".

### (e) Messung im Browser mit echter Schleife und echtem Soniox

Wird nachgetragen (Laborlauf mit Chrome, gefälschtem Mikrofon, echter Schleife und echter Erkennung).
