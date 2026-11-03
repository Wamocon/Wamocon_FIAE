# HAI: Geschwindigkeit, Logs und Zeitkette

Stand: 03.11.2026. Auftrag von Niko: "Analysiere die Logs vom HAI!" und "Der HAI braucht immer sehr lange zum Antworten und zum Denken! Kann man das beschleunigen?" Branch `feat/hai0311c-speed`, kein Pull Request, keine Migration, nichts an Production.

## 1. Kurzfassung

- **Hauptursachen, in dieser Reihenfolge der Größe:**
  1. **Die Vektorsuche der Preview-Datenbank brauchte 22 bis 38 Sekunden je Frage.** Der Planer von Postgres schätzt den Zugriffsfilter auf 82 statt auf 16.407 Zeilen und sortiert deshalb den ganzen Berufskatalog (23.000 Seiten, die Vektoren sind je 12 KB), obwohl der halfvec-Index und der Schalter `HAI_HALFVEC_SEARCH=on` da sind. Mit einer Einstellung in der Transaktion (`enable_sort = off`) nimmt er den Index: 1,5 bis 55 Millisekunden, dieselben fünf besten Treffer. **Das ist behoben** (Abschnitt 5.1).
  2. **Sokrates ist ein geteilter Rechner und zeitweise überlastet.** Zwischen 11:15 und 11:20 brauchte ein Einzeiler 50 bis 77 Sekunden bis zum ersten Zeichen (einmal kam nach 100 Sekunden nichts), die Einbettung einer Frage 5, 22 und 24 Sekunden (zweimal Zeitüberschreitung nach 60 Sekunden). Um 11:30 war derselbe Rechner leer: Einzeiler 1,0 bis 1,5 Sekunden. Das Zeitlimit der HAI bis zum ersten Zeichen ist 45 Sekunden: bei dieser Last endet jede Antwort mit "nicht erreichbar", obwohl Sokrates nach 65 Sekunden geantwortet hätte. Das liegt nicht im Code der App, hier kann nur Niko etwas tun (Abschnitt 8).
  3. **Das Modell schreibt langsam.** `sokrates-fast` (gemma4:31b) erzeugt 8 bis 9 Stücke je Sekunde, gleichmäßig, auch wenn der Rechner leer ist. Eine Antwort von 300 Stücken (rund 1.300 Zeichen, 200 Wörter) dauert damit rund 35 Sekunden, auch ohne jede Last. Ein Stück ist ein Block des Stroms, etwa ein Token. Das Modell `sokrates` (qwen3.6, 35B mit wenigen aktiven Parametern) schreibt mit rund 70 Stücken je Sekunde, denkt aber vor dem ersten Zeichen 25 bis 38 Sekunden (Abschnitt 7).
- **Geändert** (Abschnitt 5): Suche über den Index, Live-Daten neben der Suche statt danach, vier Lesezugriffe der Route zugleich, Zwischenspeicher für die Einbettung einer Frage, Budget für den Kontext im Prompt, Daten für eine ehrliche Wartezeit-Anzeige (Stufen und "ausgelastet"), eine Logzeile mit den Zeiten je Frage.
- **Nicht geändert** (Abschnitt 6): Zeitlimits, Zweitversuch, Modell, Prompt-Dateien, Suche bei reinen Datenfragen. Je mit Begründung.
- **Was Niko tun kann** (Abschnitt 8): Last auf Sokrates ansehen, bei `sokrates` das Denken ausschalten lassen, Produktions-Index und Schalter, `ANALYZE`.

## 2. Logbefunde (Vercel, Projekt `wamocon-fiae-svfz`)

Quelle: die Anfrage-Logs der letzten 26 Stunden (`vercel logs`, nach Zeitfenstern geholt, weil jeder Aufruf höchstens 50 Zeilen liefert): 3.308 Serverless-Anfragen vom 02.11. 09:00 bis 20:00 und 03.11. 07:16 bis 07:20 und 10:38 bis 10:50 (die Tests von Niko). Der Datenstrom der Laufzeit-Logs (`/runtime-logs`) liefert nur Live-Einträge und blieb für alle Deployments leer.

| Anzahl | Pfad | Meldung (Ids ersetzt) | Einschätzung |
|---|---|---|---|
| 22 | `/api/hai/chat` 200 | 11 mal `HAI.ai Providers initialized: Chat: openai-compatible (ready) ... Chat fallback: primary_is_sokrates ... Embedding: openai-compatible (ready)`, 8 mal `DataContext fetched in 37 bis 82ms / intent=none / ~150 tokens`, 2 mal `... in 1451ms und 1610ms / intent=learning_query / ~700 tokens`, 1 ohne Meldung | In der Preview laufen Chat UND Einbettung über Sokrates, ohne Rückfall. Die Meldung "initialized" kommt je Kaltstart einer Instanz (11 mal in 26 Stunden). Die Live-Daten der Lernfragen brauchen 1,5 Sekunden (zwei Abfragen nacheinander), alle anderen unter 0,1 Sekunden. |
| 0 | `/api/hai/chat` 429, 5xx, 524, 503 | | Kein einziger Fehlerstatus in 26 Stunden. Das heißt nicht, dass nichts langsam war: ein Fehler der Modellseite kommt als 200 mit Fehlerereignis im Strom (`error` im SSE), das der Anfrage-Log nicht zeigt. |
| 151 / 13 / 1 | `/api/hai/session` 200 / 401 / 403 | | 401 und 403 sind abgelaufene Sitzungen (insgesamt 243 mal 401 im Projekt, darunter 67 bei `sync-profile`), kein HAI-Fehler. |
| 23 / 18 / 10 / 4 | `/api/hai/voice/soniox-token`, `/voice/config`, `/voice`, `/voice/warmup` 200 | | Alles 200. Keine Ablehnung des Soniox-Schlüssels und kein Rückfall auf den Browser-Anbieter zu sehen (Einschränkung unten). |
| 5 / 2 | `/api/hai/quiz-mode/next`, `/answer` 200 | | In Ordnung. |
| 35 | verschiedene Pfade (auch `/api/hai/quiz-mode/next`), Stufe `error`, Status 200 | `(node:7) TimeoutNegativeWarning: -77434.02 is a negative number. Timeout duration was set to 1.` | Eine Bibliothek setzt einen Zeitgeber mit einer negativen Zeit (Zeit minus 61 Millisekunden bis minus 558 Sekunden), Node setzt ihn auf 1 Millisekunde. Harmlos für die Antwort, aber Lärm in der Fehlerstufe. Die Ursache ist nicht belegt (verdächtig: der Zeitgeber zur Erneuerung der Sitzung bei schon abgelaufener Sitzung). Kein HAI-Code. |
| 1 | `/api/trainer/dashboard` 401, Stufe `warn` | `[session] token rejected: 400 / AuthSessionMissingError` | Sitzung fehlt, erwartet. |
| 0 | `[hai-...]`, `openai-compatible`, `Soniox key refused`, `chatWithFallback`, `stream`, Persona und Tore | | Nicht gesehen. |

**Was die Logs nicht hergeben (ehrlich):**

- **Keine Dauer.** Der Anfrage-Log kennt nur Zeitpunkt, Pfad und Status. Wie lange `/api/hai/chat` dauerte, steht nirgends. Die Dauer der Stufen ist deshalb unten gemessen (Abschnitt 3) und ab diesem Branch je Frage geloggt (Abschnitt 5.7).
- **Nur die erste Meldung je Anfrage.** Der Anfrage-Log zeigt je Anfrage eine Zeile. Eine Warnung wie `provider "openai-compatible" failed (timeout)` aus derselben Anfrage kann dahinter stehen und ist nicht zu sehen. "Nicht gesehen" heißt hier "nicht in der ersten Meldung".
- **Keine Zeiten aus dem Browser.** Die Messpunkte des Sprachmodus (`hai-voice-trace`) laufen im Browser und sind Nikos Sache beim Test.
- **Das Fenster ist klein:** 22 Chat-Anfragen, davon die meisten am 02.11. Die Last von Sokrates zur Zeit der Tests ist aus den Logs nicht abzulesen, sie steht in Abschnitt 3.

## 3. Zeitkette einer Textantwort (Preview, gemessen)

Eine Frage mit Wissenssuche, ohne Besonderheit. Quelle der Zahlen: Spalte "Beleg".

| Stufe | Code | Zeit (Messwerte) | Beleg |
|---|---|---|---|
| 1 Anmeldung, Plan, Benutzer, Sitzung, Verlauf, Gedächtnis, Beruf, Phasenplan | `src/app/api/hai/chat/route.ts` | rund 12 bis 16 Abfragen und Schreibzugriffe **nacheinander** (vorher, nach dem Quelltext gezählt). Eine einzelne Abfrage der Live-Daten dauert 10 bis 20 ms auf Vercel (`DataContext fetched in 37 bis 82ms` mit 4 bis 5 Abfragen), also grob 0,2 bis 0,3 s. Nicht einzeln gemessen. | Quelltext, Log |
| 2 Persona und Tore | `resolveTurnPersona`, `personaRefusal` | 3 bis 5 Abfragen (Zugriff, Katalog, Persona), danach reine Rechnung. Grob 50 bis 100 ms. | Quelltext |
| 3 Datenabsicht, Live-Daten | `fetchDataContext` | 37 bis 82 ms (keine Absicht), **1.451 und 1.610 ms** (Lernfrage: zwei Abfragen nacheinander) | Log |
| 4a Einbettung der Frage | `SokratesEmbeddingProvider` | **5,5 / 11,3 / 21,7 / 23,8 / 28,9 / 36,2 s** (Mittel 21 s, 6 Antworten) und zweimal Zeitüberschreitung (60 s). Nie unter 5 s, auch nicht, wenn das Chat-Modell leer war (Einzeiler gleichzeitig 1,3 s). Ursache nicht belegt: wahrscheinlich lädt der Rechner das Einbettungsmodell (8 Milliarden Parameter) bei jedem Wechsel neu oder die Anfrage steht in einer Schlange | Messung |
| 4b Datenbanksuche | `searchSimilar` | **22,1 / 34,6 / 37,7 s** (halfvec, Stand der App), 29,4 / 26,0 / 31,7 s (genau). Nachher 1,5 bis 55 ms | `EXPLAIN ANALYZE`, Abschnitt 5.1 |
| 4c PageIndex (PDF-Seiten) | `fetchPageIndexContext` | 0,3 bis 1,1 s je PDF bei kalter Instanz, parallel bis zu 5, danach 5 Minuten im Speicher | Messung an 4 PDF |
| 5 Prompt | `buildSystemPrompt` | fester Teil 6.900 Zeichen (rund 2.000 Token), mit fünf Textstücken 16.600 Zeichen (rund 4.700 Token), mit PDF-Seiten bis 40.600 Zeichen (rund 11.600 Token) | Messung, Abschnitt 4 |
| 6 Modell, erstes Zeichen | `OpenAICompatibleChatProvider` | Einzeiler: **1,0 bis 1,5 s** (leer), **50 bis 77 s** (überlastet). Prompt ungecacht: 13,0 / 5,0 / 5,1 s (2.700 Token), 6,7 / 6,7 / 6,7 s (4.400 Token) | Messung |
| 6 Modell, Schreiben | | **8 bis 9 Stücke je Sekunde** (`sokrates-fast`), also 300 Stücke in rund 35 s | Messung |
| 7 Strom zum Browser | `ReadableStream` | nicht messbar am Server, kein Befund | |

**Zusammenfassung der Kette** für eine Frage mit Suche und einer Antwort von 300 Stücken, vorher: Stufen 1 bis 3 rund 0,5 s, Einbettung 5,5 bis 36 s, **Datenbanksuche 22 bis 38 s**, erstes Zeichen 5 bis 7 s (Prompt mit 2.700 bis 4.400 Token, Chat-Modell leer), Schreiben 35 s. Zusammen **68 bis 117 Sekunden** (mittlere Werte: rund 94 Sekunden), davon rund ein Drittel die Datenbank. Nachher fällt die Datenbanksuche auf Millisekunden: **46 bis 79 Sekunden** (mittlere Werte: rund 62 Sekunden). Der Rest sind die Einbettung bei Sokrates (rund ein Drittel) und das Lesen des Prompts samt Schreiben des Modells (rund zwei Drittel). Bei überlastetem Sokrates kommen 50 bis 77 Sekunden bis zum ersten Zeichen dazu.

### Auslastung von Sokrates zu drei Zeitpunkten

Gleicher Einzeiler, `sokrates-fast`, Streaming, Zeit bis zum ersten Zeichen.

| Zeitpunkt (03.11.) | Messwerte | Lage |
|---|---|---|
| 11:15 bis 11:20 | 76,7 / 65,0 / (nichts nach 100 s) / 67,4 / 50,3 s | überlastet |
| 11:30 | 1,0 / 1,5 / 1,3 s | leer |
| 11:49 | 1,3 / 4,8 / 1,3 s | leer, ein Ausreißer |

Die Lage wechselt von Minute zu Minute um den Faktor 50. Zur Zeit der Messung liefen auf demselben Rechner auch andere Arbeiten (andere Agenten dieses Projekts rufen Sokrates für die Inhaltsprüfung und das Golden Set auf). Wie viel davon meine eigenen Aufrufe waren, ist nicht zu trennen. Die Last der Nutzer selbst ist nicht bekannt.

## 4. Messweise

- **Logs:** `vercel logs --no-branch --json` mit Zeitfenstern von 20 Minuten bis 30 Minuten, die bei 50 Zeilen halbiert werden. Auswertung nach Pfad, Status, Stufe und Meldung.
- **Sokrates:** Streaming-Aufrufe wie in der App (`reasoning_effort: none`, `max_tokens` 30 beim Einzeiler, 250 sonst, `temperature` 0,7), Python mit dem Header `User-Agent` (ohne ihn antwortet die Schranke vor dem Rechner mit 403). Pause 2 Sekunden zwischen den Aufrufen. 50 Aufrufe insgesamt. Der Prompt "m" (8.700 Zeichen, rund 2.700 Token) und "l" (14.100 Zeichen, rund 4.400 Token) kommen aus `buildSystemPrompt` mit der FIAE-Persona und Textstücken. Die Zahl der Token ist geschätzt (3,2 Zeichen je Token), der Server meldet im Strom keine Nutzung. Für "ungecacht" steht eine zufällige Zahl vor dem Prompt, damit der Präfix-Zwischenspeicher des Servers nichts findet (ohne sie sind gleiche Prompts nach dem ersten Mal in 1,1 bis 1,5 s da).
- **Datenbank:** `EXPLAIN (ANALYZE, BUFFERS)` auf die Preview-Datenbank, nur lesend (`default_transaction_read_only`), der echte SQL-Text der App mit den Einstellungen aus `HALFVEC_SEARCH_SETTINGS`. Als Suchvektoren dienten Vektoren echter Textstücke. Die Ausführungszeit ist die des Servers, ohne Netz.
- **Prompt:** `tmp`-Skript mit `buildSystemPrompt` (nicht eingecheckt), die Größen stehen in Zeichen, die Token sind geschätzt.
- **Vorher und nachher der Änderungen:** Suche mit `EXPLAIN ANALYZE` (6 Messungen vorher, 6 nachher), alles andere mit Tests, die die Reihenfolge und die Parallelität beweisen. Eine Messung der ganzen Antwort in der Preview vorher und nachher gibt es nicht: die Preview läuft mit dem Stand von `origin/preview`, dieser Branch ist dort nicht ausgerollt.

## 5. Änderungen

### 5.1 Suche über den Index (`src/lib/hai/vectorSearch.ts`)

**Befund.** Die Abfrage der App (`searchSimilar`, breite Suche über den ganzen Berufskatalog) nimmt trotz des Index `idx_hai_embeddings_embedding_hnsw` den Weg: Bitmap-Scan über den Zugriffsindex, dann Sortieren nach Abstand. Der Planer schätzt 82 Zeilen. Gefunden werden 16.407. Grund: die Prüfung `metadata->>'userId' IS NULL` hat keine Statistik und wird mit 0,5 Prozent angesetzt, das ist fast jede Zeile. Das Sortieren liest 22.900 Seiten (183 MB, die Vektoren liegen in TOAST), die Datenbank hat nur 224 MB `shared_buffers`. Der Index (380 MB) passt nicht in den Speicher und wird vom Planer nicht gewählt, auch nicht mit abgeschaltetem Bitmap- und Seq-Scan.

**Änderung.** Die breite Suche (keine Quellart, keine Quell-Ids, kein Kurs) setzt in ihrer Transaktion zusätzlich `enable_sort = off` (`set_config(..., true)`, nur für die Transaktion). Der Planer kann dann nur noch den Index nehmen, der die Reihenfolge selbst liefert. Abfrage, Filter und erlaubte Zeilen sind unverändert, nur der Weg zur Reihenfolge ändert sich. Eine enge Suche (Enabler, Kurs, Lernkarten) behält die Standard-Einstellung: ihr Filter wird gut geschätzt und ein B-Baum ist dort schneller als ein Indexlauf, der wenige Zeilen suchen muss.

**Vorher und nachher** (Preview-Datenbank, Ausführungszeit des Servers, derselbe SQL-Text):

| | Messungen | Mittel |
|---|---|---|
| vorher, halfvec und Schalter an (Stand der App) | 22,1 / 34,6 / 37,7 s | 31,5 s |
| vorher, genaue Suche | 29,4 / 26,0 / 31,7 s | 29,0 s |
| vorher, Bitmap und Seq-Scan abgeschaltet | 35,5 / 30,4 / 26,9 s | 30,9 s |
| **nachher**, `enable_sort = off`, 3 Fragen mal 2 Berufsumfänge | 2,8 / 2,9 / 1,5 / 1,5 / 5,7 / 54,6 ms | 11,5 ms (ohne den Ausreißer 2,9 ms) |

**Gegenprobe der Treffer.** Die fünf besten Treffer waren in allen 6 Fällen (3 Suchvektoren, jeweils mit einem und mit beiden Berufen) dieselben wie bei der genauen Suche ohne Index (30 von 30). Die Messung ist klein, und die Suchvektoren sind Vektoren von Textstücken (das Stück selbst ist sein bester Treffer, die übrigen vier sind es nicht). Die frühere Messung vom 01.11. (Abschnitt 9 in `docs/hai-kfbm-indexierung.md`) fand 74 von 80 gleich, mit dem iterativen Suchlauf, ohne dass ein Treffer fehlte. Der Index ist eine Näherung: ein anderer Treffer an Stelle fünf ist möglich und war schon vorher der Preis des Schalters.

**Grenze.** Die Änderung wirkt nur mit `HAI_HALFVEC_SEARCH=on` und vorhandenem Index. In Preview ist beides gesetzt (Variable per API gelesen). In Production ist die Variable nicht gesetzt und der Index laut Doku nicht angelegt: dort läuft die genaue Suche (24 bis 32 s, `docs/hai-kfbm-indexierung.md` Abschnitt 9). Das ist ein Schritt für Niko (Abschnitt 8).

**Test.** `tests/unit/hai/vectorSearch.scope.test.ts`: die breite Suche stellt `enable_sort` aus, der Suchtext ist unverändert, eine enge Suche (Quellart, Quell-Ids, Kurs) und der Betrieb ohne Schalter stellen es nicht aus.

### 5.2 Live-Daten neben der Suche (`src/lib/hai/ragPipeline.ts`)

Vorher holte `processMessageStream` und `processMessage` erst die Suche (Einbettung, Datenbank, PageIndex) und danach die Live-Daten (`fetchDataContext`, 37 bis 82 ms, bei Lernfragen 1,5 s). Beide hängen nicht voneinander ab. Jetzt starten sie zugleich, die Antwort wartet auf die langsamere. Der Gewinn ist die Zeit der kürzeren Stufe: meist unter 0,1 s, bei Lernfragen 1,5 s. Bei Tageslage-Fragen (keine Suche) ändert sich nichts. Fehler beider Stufen bleiben unschädlich (Suche leer, Daten leer).

**Test.** `tests/unit/hai/ragPipeline.speed.test.ts`: die Live-Daten werden abgefragt, während die Suche noch läuft (beide Pipelines), der Prompt enthält beides, der Ausfall einer Stufe stoppt die andere nicht, ohne Rolle gibt es keinen Datenabruf.

### 5.3 Lesezugriffe der Route zugleich (`src/app/api/hai/chat/route.ts`)

Verlauf (2 Abfragen), Gedächtnis aus anderen Chats, gewählter Beruf (2 bis 3 Abfragen) und Phasenplan liefen nacheinander. Jetzt laufen sie mit `Promise.all`. Das Speichern der Nutzernachricht läuft während der Pipeline und wird vor dem Speichern der Antwort abgewartet (Reihenfolge der beiden Nachrichten bleibt, ein Fehler wird dort geworfen). Der Gewinn sind rund 3 bis 4 Datenbankwege (je 10 bis 20 ms auf Vercel, also 40 bis 80 ms, nicht gemessen). Klein, aber ohne Risiko für die Rechte: dieselben Abfragen mit denselben Filtern.

### 5.4 Zwischenspeicher für die Einbettung (`src/lib/hai/providers/embeddingCache.ts`)

Eine Frage wird bei Sokrates eingebettet (5,5 bis 36 s, zweimal Zeitüberschreitung nach 60 s). Derselbe Text gibt immer denselben Vektor. Der Speicher hält den Vektor 10 Minuten (höchstens 100 Einträge, rund 2,5 MB, nur in der Instanz) und führt zwei gleichzeitige Anfragen mit demselben Text zu einem Aufruf zusammen. Nutzen: dieselbe Frage noch einmal, Bearbeiten und erneut senden, Neu erzeugen, dasselbe Quizthema.

**Datenschutz und Rechte.** Der Schlüssel ist ein SHA-256 aus Anbieter, Dimension und Text (Leerraum gefaltet). Weder Text noch Person, Sitzung oder Beruf stehen im Schlüssel oder im Wert, es wird nichts geschrieben. Der Vektor trägt kein Recht: wer welches Textstück lesen darf, entscheidet allein der Filter der Suche danach (Beruf, Zielgruppe, Organisation, Besitzer). Es werden nur einzelne Fragen gespeichert, nicht die Stapel der Indexierung. Ein Fehler wird nicht gespeichert, ein leerer Vektor auch nicht.

**Test.** `tests/unit/hai/providers/embeddingCache.test.ts` (14 Fälle: Treffer, Leerraum, Groß- und Kleinschreibung, gleichzeitige Anfragen, Fehler, leerer Vektor, Lebensdauer, Höchstzahl, älteste zuerst, Stapel durchgereicht, Schlüssel ist nur ein Hash).

**Grenze.** Der Nutzen ist ehrlich klein: nur wiederholte Fragen. Er ist hier wegen der Einbettung bei Last trotzdem das, was ein erneutes Senden sofort schnell macht.

### 5.5 Budget für den Kontext (`ragPipeline.ts`, `pageIndexService.ts`)

Das Modell liest jedes Token des Prompts vor dem ersten Zeichen. Ungecacht kostet das rund 1,3 Sekunden je 1.000 Token (Messung, Abschnitt 3). Der größte Teil des Prompts ist der Kontext:

- Textstücke: im Index im Mittel 1.522 Zeichen (Dokumente), 446 (Quiz), 357 (Enabler). Fünf Stücke sind im Mittel 5.000 Zeichen, im schlechten Fall 15.000.
- PDF-Seiten (PageIndex): bis 8 Seiten zu je 3.000 Zeichen, also bis 24.000 Zeichen (rund 7.000 Token) **zusätzlich**. Eine Seite der Kurs-PDF hat im Mittel 1.800 Zeichen.

Geändert: die Textstücke der Wissensdatenbank bekommen ein Budget von 9.000 Zeichen (`RETRIEVED_CONTEXT_MAX_CHARS`, die zwei relevantesten Stücke bleiben immer, danach fallen die am wenigsten relevanten weg; was nicht im Prompt steht, wird auch nicht zitiert). PageIndex nimmt höchstens 5 Seiten zu je 2.400 Zeichen (vorher 8 und 3.000). Der schlechteste Fall sinkt von 39.000 auf rund 21.000 Zeichen im Kontext (18.000 Zeichen oder 5.600 Token weniger, das sind rund 7 Sekunden bis zum ersten Zeichen), der übliche Fall (fünf Stücke mit zusammen 5.000 Zeichen und keine PDF-Seiten) bleibt gleich.

**Qualität.** Die Rangfolge nach Relevanz bleibt, es fallen nur die schwächsten Stücke und Seiten weg. Das Golden Set prüft mit erfundenen kurzen Textstücken und ändert sich dadurch nicht (alle deterministischen Fälle grün). Eine Messung der Antwortqualität mit Modell vorher und nachher gibt es nicht für diese Änderung, ihre Wirkung ist also nicht gemessen, nur begründet. Wer vorsichtig sein will, setzt `RETRIEVED_CONTEXT_MAX_CHARS` und die beiden Konstanten in `pageIndexService.ts` wieder hoch.

**Test.** `tests/unit/hai/ragPipeline.speed.test.ts` (Budget: übliche Stücke bleiben, lange Stücke werden begrenzt, die zwei besten bleiben, was fehlt wird nicht zitiert).

### 5.6 Daten für eine ehrliche Wartezeit-Anzeige (Route, Opt-in)

Das Ereignisformat für die Oberfläche (die baut ein anderer Agent): der Aufrufer sendet `stageEvents: true` im Body von `POST /api/hai/chat` (nur mit `stream: true`). Dann kommen vor dem ersten `chunk` Ereignisse der Form `data: {"stage":"<name>"}`:

| `stage` | Bedeutung | Wann |
|---|---|---|
| `search` | Die Pipeline sucht in den Unterlagen | vor der Suche, nur wenn gesucht wird (nicht bei Tageslage, Quiz, Navigation, Gruß) |
| `answer` | Suche und Live-Daten sind fertig, das Modell schreibt gleich | unmittelbar vor dem Modellaufruf |
| `busy` | Seit 12 Sekunden kommt kein erstes Zeichen: der Modellrechner ist ausgelastet | einmal, nur ohne erstes Zeichen |

Ohne `stageEvents: true` (der heutige Client) kommt nichts davon. Das ist Absicht: der Client von heute wertet jedes erste Byte als "erstes Zeichen" und löscht danach den Text "Denkt nach" (`HaiProvider.tsx`). Ein Ereignis vor dem ersten Zeichen würde ihn also abschalten.

Texte dazu (Vorschlag für die Oberfläche, nicht umgesetzt): `search` "Ich suche in den Unterlagen", `answer` "Ich formuliere die Antwort", `busy` "Der Server ist gerade ausgelastet, das kann etwas dauern."

**Test.** `tests/integration/api/hai/chat-voice.test.ts` (Ereignisse nur auf Wunsch, Reihenfolge, nur der Wert `true` zählt, `busy` einmal und nur ohne erstes Zeichen).

### 5.7 Eine Logzeile mit den Zeiten je Frage (Route)

Jede Frage schreibt am Ende eine Zeile `HAI.ai chat timing: mode=stream intent=question auth=12 prep=180 first=3400 total=21000 context=95 data=40 retrieval=1200 search=1250` (Millisekunden, nur Zahlen und die Absicht, kein Inhalt). So ist die Dauer der Stufen künftig im Laufzeit-Log zu lesen. Vorher gab es keine Dauer im Log (Abschnitt 2). Der Sprachmodus bekommt die zusätzlichen Stufen `context`, `data` und `retrieval` im Abschlussereignis mit (nur Zahlen). Eine getippte Frage bekommt weiter nichts davon im Browser.

## 6. Geprüft und nicht geändert

| Punkt | Befund | Entscheidung |
|---|---|---|
| (d) keine Suche bei Absichten ohne Wissensbedarf | Tageslage, Navigation, Aktionen, Quiz-Start, Gruß und Lösungsbitten überspringen die Suche schon. Reine Datenfragen ("Wie ist mein Fortschritt?") suchen noch. | Nicht umgesetzt. Ohne Suchtreffer trägt der Prompt den Hinweis "Zu dieser Frage wurde KEIN Kontext gefunden ... Dazu habe ich keine Informationen", der für eine Datenfrage falsch wäre. Den Hinweis kann nur `prompts.ts` unterdrücken, und die Datei gehört dem Agenten im Worktree `wt_golden`. Vorschlag: ein Schalter `dataOnly` wie `dayBriefing`. Wirkung: die ganze Suchzeit entfällt für diese Fragen. |
| (f) Zeitlimits und Zweitversuch | `openai-compatible.ts`: 45 s bis zum ersten Byte, danach 30 s Pause zwischen zwei Stücken, die Verbindung wird bei einem Fehler abgebrochen. Der Schutz arbeitet wie gedacht. Die Messung zeigt keinen hängenden Strom, sondern eine Warteschlange: 50 bis 77 s bis zum ersten Zeichen. Ein Zweitversuch stellt sich hinten in dieselbe Schlange. Nach der ersten Ausgabe gibt es nie einen Zweitversuch (zwei Antworten würden zusammenkleben). | Nicht geändert. Ein früheres Abbrechen würde die Antworten verlieren, die nach 65 s gekommen wären. Ein längeres Limit (90 s) wäre die Gegenrichtung: Antwort nach einer Minute statt Fehler nach 45 s. Das ist eine Entscheidung für Niko (Abschnitt 8). Ein Zweitversuch nach 502, 503 oder 504 wäre billig, in 26 Stunden gab es aber keinen einzigen solchen Status. |
| (c) Zwischenspeicher für gleiche Fragen | Antworten werden nicht gespeichert (Rechte, Personenbezug, Live-Daten). | Nur die Einbettung (5.4). |
| Persona und Katalog | `loadHaiPersona` liest die Tabelle `training_catalogs` bei jeder Frage. | Nicht geändert: ein Weg von 10 bis 20 ms. |
| Aufwärmen der Modelle | Das Aufwärmen des Sprachmodus (`/api/hai/voice/warmup`) ruft nur `GET /models` auf: es öffnet die Verbindung, lädt aber kein Modell. Die erste Einbettung nach einer Pause brauchte 11,3 s, ein nicht geladenes Chat-Modell 25 bis 28 s (`jarvis-general`, `sokrates`). Ein Modell, das 5 Minuten ungenutzt ist, wird vom Server entladen (Standard von Ollama, nicht geprüft). | Nicht umgesetzt: eine neue Route braucht die Oberfläche, die ein anderer Agent baut. Vorschlag: beim Öffnen der HAI eine Einbettung und einen Chat mit einem Token anstoßen, höchstens alle 2 Minuten je Instanz, oder `keep_alive` auf dem Server hoch setzen (Abschnitt 8). |
| Reihenfolge der Teile im Prompt | Die festen Regeln (Grenzen, Navigation) stehen hinter den veränderlichen Teilen. Der Präfix-Zwischenspeicher des Servers (gleicher Anfang, kein neues Lesen) greift deshalb nur für den Kern. | Nicht geändert (`prompts.ts` gehört `wt_golden`). Vorschlag: feste Teile nach vorn. |

## 7. Modellvergleich (Empfehlung, der Standard ist nicht geändert)

Gemessen an Prompt "m" (rund 2.700 Token), Streaming, Einzeiler dazu. Sokrates-Modelle über Open WebUI und LiteLLM (nach den Namen: `sokrates-fast` = gemma4:31b, `sokrates` und `sokrates-pro` = qwen3.6:35b).

| Modell | Einzeiler, erstes Zeichen | Prompt "m", erstes Zeichen | Schreibtempo | Anmerkung |
|---|---|---|---|---|
| `sokrates-fast` (Standard) | 1,0 / 1,5 / 1,3 s (leer) | 12,4 / 11,2 / 20,3 / 14,7 / 10,2 s (gemischte Last), ungecacht 13,0 / 5,0 / 5,1 s | 8 bis 9 Stücke/s | gleichmäßig, langsam beim Schreiben |
| `sokrates` (qwen3.6, MoE) | 25,5 / 35,5 s | 37,2 / 35,7 / 33,1 s | 70 bis 72 Stücke/s | 8 mal schneller beim Schreiben, aber 25 bis 38 s Denkzeit vor dem ersten Zeichen, auch beim Einzeiler: `reasoning_effort: none` wirkt hier nicht |
| `qwen3.8-27b` | 2 mal Zeitüberschreitung (100 s) | 3 mal Zeitüberschreitung (100 s) | | nicht nutzbar, antwortet nicht |
| `jarvis-general` | 28,2 s (Laden), 2,4 s | 79 s (einmal), 2 mal Zeitüberschreitung (100 s) | | nicht nutzbar für diese Größe |

Der Parameter `think: false` im Aufruf von `sokrates` (zwei Messungen, gleicher Prompt) änderte nichts Verlässliches: erstes Zeichen 11,7 s und 38,5 s, ohne den Parameter 33 bis 37 s. Er kommt über Open WebUI und LiteLLM wohl nicht beim Modell an. Abschalten muss der Betreiber im Modell selbst.

**Qualität.** Kleine Stichprobe aus dem Golden Set, 6 Fälle mit dem echten Modell (AL-01, AL-03, AL-05, EX-01, DR-04, SP-20; Messaufruf aus `docs/hai-golden-set.md` mit `HAI_GOLDEN_CASES`, Temperatur 0, ohne Rückfall). Beide Modelle bestehen 5 von 6, kein Leck:

| Modell | Bestanden | Auffällig | Dauer der 6 Fälle |
|---|---|---|---|
| `sokrates-fast` | 5 von 6 | AL-01 (falsche Ablehnung: das Szenario sei "bereits sichtbar", der Text wird nicht gezeigt) | 72 s |
| `sokrates` | 5 von 6 | DR-04 (lehnt ab, nennt aber den Grund nicht: `missing_reason`) | 200 s |

Mit 6 Fällen und einem Lauf je Modell ist das ein Hinweis, kein Beweis: der Unterschied ist Rauschen, ein Qualitätsvorteil eines der beiden Modelle ist nicht belegt. Für einen Wechsel braucht es den ganzen Lauf (106 Fälle).

**Empfehlung.** **Kein Modellwechsel jetzt.** `sokrates` schreibt zwar achtmal schneller, braucht aber 25 bis 38 s Denkzeit vor dem ersten Zeichen (in der Stichprobe dauerten 6 Fälle 200 statt 72 Sekunden). Die Rechnung: `sokrates-fast` liefert das erste Zeichen nach rund 1,5 s und schreibt 8,8 Stücke/s, `sokrates` nach rund 35 s und 71 Stücke/s. Erst ab rund 340 Stücken (1.400 Zeichen) wäre `sokrates` insgesamt schneller, die HAI antwortet meist mit 100 bis 250 Stücken, und der Nutzer sähe 35 Sekunden lang nichts. **Wenn der Betreiber das Denken bei `sokrates` abschaltet**, würde es gleichzeitig schnell anfangen und schnell schreiben: dann lohnt der ganze Lauf des Golden Sets und danach der Wechsel von `OPENAI_COMPATIBLE_MODEL`. Die Modelle `qwen3.8-27b` und `jarvis-general` sind für die HAI nicht nutzbar (Zeitüberschreitungen).

## 8. Empfehlungen und was Niko tun kann

1. **Sokrates entlasten.** Der Rechner ist geteilt. Wenn die HAI zum Testen genutzt wird, dürfen keine langen Läufe (Golden Set, Inhaltsprüfung, Reindex) gleichzeitig laufen. Die Lage wechselt von 1 s auf 70 s (Abschnitt 3).
2. **Größerer oder eigener Rechner für die HAI**, wenn mehrere Gruppen Sokrates nutzen: das Schreibtempo von `sokrates-fast` (8 bis 9 Stücke/s) ist für Antworten von 300 Stücken zu langsam, auch ohne Last.
3. **Das Denken bei `sokrates` ausschalten** (qwen3.6, im Modell oder in LiteLLM: `think: false`), dann wäre das Modell mit 70 Stücken/s achtmal schneller beim Schreiben, ohne die Denkzeit von 25 bis 38 s. Der Parameter `think: false` im Aufruf allein half nicht (Abschnitt 7). Erst danach die Qualität mit dem Golden Set (alle Fälle) messen, dann `OPENAI_COMPATIBLE_MODEL` umstellen.
4. **Production:** den halfvec-Index (`scripts/db/hai-halfvec-index.sql`) anlegen und `HAI_HALFVEC_SEARCH=on` setzen, sonst läuft dort die genaue Suche (24 bis 32 s je Frage). Der Code dieses Branches wirkt nur mit beidem. Ohne Go für Production passiert nichts.
5. **Preview:** einmal `ANALYZE public_preview.hai_embeddings;` und danach `CREATE STATISTICS hai_embeddings_userid ON (metadata->>'userId'), source_type, training_catalog_id FROM public_preview.hai_embeddings; ANALYZE public_preview.hai_embeddings;` Das ist ein Schreibzugriff (Wartung, keine Datenänderung) und gehört Niko. Die Anweisung ist nicht ausprobiert (nur lesend gearbeitet), die Syntax vorher prüfen. Dann schätzt der Planer die Zeilen richtig und nimmt den Index auch ohne die Einstellung dieses Branches. Mit der Einstellung ist der Schritt nicht nötig.
6. **Zeitlimit bis zum ersten Zeichen** (`DEFAULT_FIRST_BYTE_TIMEOUT_MS`, 45 s): bei Last bricht es Antworten ab, die nach 65 s gekommen wären. Entscheidung für Niko: 45 s (schnell Fehler) oder 90 s (langsam Antwort). Vorher prüfen, dass `maxDuration` der Route auf Vercel dafür reicht (die Route setzt keinen Wert).
7. **Oberfläche:** `stageEvents: true` senden und die Stufen anzeigen (Abschnitt 5.6).
8. **Prompt:** feste Teile nach vorn (Präfix-Zwischenspeicher), ein Schalter für reine Datenfragen (6, Punkt d). Beides in `prompts.ts`.
9. **Modelle warm halten:** Einbettungsmodell und Chat-Modell mit hohem `keep_alive` auf dem Server laden lassen (oder beim Öffnen der HAI anstoßen, Abschnitt 6). Die Einbettung allein brauchte 5,5 bis 36 s je Frage (Abschnitt 3), das ist neben der Datenbank die größte Einzelstufe.

## 9. Offene Punkte

- Die Wirkung der Änderungen auf die ganze Antwortzeit ist nicht in der Preview gemessen (der Branch ist dort nicht ausgerollt). Gemessen ist die Datenbanksuche, bewiesen sind Parallelität und Reihenfolge durch Tests.
- Die Last von Sokrates ist nicht von den Aufrufen anderer Agenten und Nutzer zu trennen.
- Die Qualität des Kontextbudgets und eines anderen Modells ist nicht mit dem ganzen Golden Set gemessen (6 Fälle für den Modellvergleich, keiner für das Budget).
- Aufrufe von Sokrates insgesamt: 50 in der Messreihe und etwa 10 in der Stichprobe des Golden Sets.
- Der Anfrage-Log zeigt nur die erste Meldung je Anfrage, die Warnungen der Provider-Kette sind darin nicht zu sehen. Die neue Logzeile (5.7) ist die erste Dauer im Log.
- `TimeoutNegativeWarning` in 35 Anfragen: Ursache nicht gefunden (keine HAI-Datei).
