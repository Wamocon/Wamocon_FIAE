# HAI: Wissen zu Lerntechniken (Paket B, WMCNL-2814)

Stand: 28.10.2026. Die HAI gibt Auszubildenden belegbare Tipps zum Lernen und Merken, berufsübergreifend auf Plattformebene, mit Beispielen je Beruf. Dieses Dokument beschreibt Aufbau, Freigabeablauf, Quelle, Grenzen und die offenen Prüfpunkte.

**Status der Inhalte: Entwurf, ungeprüft gegen Originaltext.** Keine Karte ist freigegeben. Solange das so ist, liefert der Index keine einzige Karte aus, die HAI antwortet ohne Lernkarten und nutzt nur den Abschnitt mit den Grenzen.

## 1. Aufbau

| Teil                                            | Ort                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Karten (12 Dateien, je Karte eine JSON)         | `content/hai/learning-techniques/NN-id.json`                                     |
| Schema, Satzregeln, Freigabefeld                | `src/lib/hai/learningTechniques/schema.ts`                                       |
| Indextext, Quell-ID, Freigabetor                | `src/lib/hai/learningTechniques/cards.ts`                                        |
| Einlesepfad in den Index (Trockenlauf Standard) | `src/lib/hai/learningTechniques/ingest.ts`, `scripts/hai-learning-techniques.ts` |
| Abschnitt mit Grenzen im Prompt                 | `src/lib/hai/learningTechniques/promptSection.ts`, eingebunden in `prompts.ts`   |
| Erkennung einer Lernfrage                       | `src/lib/hai/learningTechniques/detect.ts`                                       |
| Grenzprüfung für Antworten (offline)            | `src/lib/hai/learningTechniques/answerLint.ts`                                   |
| Prüffragen als Fixture                          | `tests/unit/hai/fixtures/learningTechniqueChecks.ts`                             |

Jede Karte hat: Technik (Titel), Nutzen (hoch, mittel, niedrig), Rang, "Was ist das", "Wann sinnvoll", genau drei Schritte, ein Beispiel für FIAE und eines für KfBM (neutral, ohne Kundendaten), Stichworte, Quelle und den Block `review`. Der Dateiname trägt Rang und ID (`01-abrufuebung.json`), das Schema ist streng (unbekannte Felder werden abgelehnt) und wird per Test geprüft.

### Rangfolge (nach Dunlosky et al. 2013)

| Rang | Karte                                 | Nutzen  | Einordnung der Quelle                  |
| ---- | ------------------------------------- | ------- | -------------------------------------- |
| 1    | Abrufübung                            | hoch    | Practice testing, hoch                 |
| 2    | Verteiltes Üben                       | hoch    | Distributed practice, hoch             |
| 3    | Quizfehler gezielt wiederholen        | hoch    | eigene Anwendung der Abrufübung        |
| 4    | Lernplan rückwärts vom Prüfungstermin | hoch    | eigene Anwendung des verteilten Übens  |
| 5    | Elaborative Befragung                 | mittel  | Elaborative interrogation, mittel      |
| 6    | Selbsterklärung                       | mittel  | Self-explanation, mittel               |
| 7    | Verschränktes Üben                    | mittel  | Interleaved practice, mittel           |
| 8    | Zusammenfassen                        | niedrig | Summarization, niedrig                 |
| 9    | Markieren                             | niedrig | Highlighting, niedrig                  |
| 10   | Schlüsselwortmethode                  | niedrig | Keyword mnemonic, niedrig              |
| 11   | Bilder beim Lesen vorstellen          | niedrig | Imagery use for text learning, niedrig |
| 12   | Erneutes Lesen                        | niedrig | Rereading, niedrig                     |

Die Karten 3 und 4 sind keine Dunlosky-Techniken, sondern Anwendungen auf Plattformdaten (Quizergebnis, Prüfungstermin). Sie sind als "Eigene Anwendung" markiert und nennen ihre Basiskarte.

### Was geprüft ist und was nicht

Der Volltext der Quelle war nicht lesbar (die Verlagsseite lieferte HTTP 403). Geprüft wurde die Einordnung hoch, mittel, niedrig und die Zitatdaten (Autoren, Jahr, Zeitschrift, Band, Seiten) gegen öffentliche Zusammenfassungen: Pressemitteilung der Association for Psychological Science (2013), Kent State University, ScienceDaily. Alle stimmen überein: zwei Techniken mit hohem Nutzen, drei mit mittlerem, fünf mit niedrigem.

**Nicht geprüft** (steht auf jeder Karte im Feld `review.notChecked`):

- die Begründungen und Bedingungen der Einordnung im Originaltext (zum Beispiel "elaborative Befragung wirkt besser mit Vorwissen", "Schlüsselwortmethode überträgt sich begrenzt")
- Seitenzahlen je Technik
- die Abstände 1 Tag, 1 Woche, 2 Wochen auf der Karte "Verteiltes Üben" (ein eigener Richtwert)
- alle Formulierungen, Schritte und Beispiele: eigener Text, nicht einzeln belegt

## 2. Freigabeablauf

1. Niko liest die Karte gegen den Originaltext (Dunlosky et al. 2013, Psychological Science in the Public Interest, 14(1), 4 bis 58) und korrigiert den Text, wo es nötig ist.
2. Bei Freigabe setzt er in der Kartendatei `review.reviewed` auf `true`, `review.status` auf `Freigegeben`, `review.reviewedBy` auf seinen Namen und `review.reviewedAt` auf das Datum (`JJJJ-MM-TT`). Das Schema lehnt eine halbe Freigabe ab (Name und Datum fehlen, Status passt nicht).
3. Änderung per Pull Request in den Hauptzweig.
4. Niko führt den Einlesepfad aus (siehe Abschnitt 3). Erst dann stehen die Karten im Index.
5. Rücknahme: `reviewed` wieder auf `false` und Status auf den Entwurfstext, danach den Einlesepfad erneut mit `--apply` ausführen. Der Lauf entfernt die Chunks nicht mehr freigegebener oder gelöschter Karten aus dem Index.

Eine Änderung am Text einer freigegebenen Karte ändert deren Hash, die Karte wird beim nächsten Lauf neu eingebettet. Wer Text ändert, setzt die Freigabe zurück und gibt neu frei.

## 3. Index und Sichtbarkeit

**Wissenstyp:** `source_type = 'learning_technique'`, ein Chunk je Karte (rund 1,2 bis 1,6 Tausend Zeichen). Die Quell-ID ist eine feste UUID (Version 5) aus der Karten-ID, ein zweiter Lauf aktualisiert dieselben Zeilen.

**Ohne Berufsfilter:** Die Zeilen werden mit `training_catalog_id = NULL`, `visibility = 'all'` und `organization_id = NULL` geschrieben. Bisher fand die Suche nur Zeilen, deren Beruf im Bereich des Nutzers liegt, eine Zeile ohne Beruf war für niemanden sichtbar. Die Suche hat jetzt genau eine zusätzliche, ausdrückliche Regel: Zeilen der Quellart `learning_technique` ohne Beruf und ohne Eigentümer sind für jeden sichtbar, der überhaupt einen Berufsbereich hat. Die Regel öffnet keinen Inhalt eines anderen Berufs, ändert die Regeln für Zielgruppe, Organisation und persönliche Zeilen nicht und greift nicht für Nutzer ohne Berufsbereich (kein Zugriff, keine Karten).

**Beweis:** Die echte SQL-Bedingung wurde gegen einen lokalen Wegwerf-Container (pgvector, Postgres 15) mit zehn Testzeilen geprüft: FIAE-Azubi sieht seinen Beruf plus Karte, KfBM-Azubi seinen Beruf plus Karte, Trainer die Karten, keine Zeile ohne Beruf einer anderen Quellart, keine Karte mit fremdem Eigentümer. Zusätzlich prüfen Tests das gerenderte SQL und beide Pipelines.

**Migration: nicht nötig.** `hai_embeddings.training_catalog_id` ist in der Datenbank nullable, `visibility` hat den Check `all` oder `trainer`, es gibt keine NOT-NULL-Regel und keinen Check auf `source_type` in den Migrationen der Katalogreihe. Der Trigger `hai_embeddings_set_scope` leitet für `learning_technique` keinen Beruf ab (die Ableitung findet keine Quelle) und lässt NULL stehen.

Drei Punkte, die vor dem ersten `--apply` zu prüfen sind (aus dem Code und den Migrationsdateien gelesen, nicht gegen die gehostete Datenbank geprüft):

1. In der Datenbank darf kein Check auf `source_type` aktiv sein, der `learning_technique` ablehnt. Die alte Migration `0019` legte einen solchen Check mit vier Werten an. Da die Schreiber schon `use_case` und `trainee_*` verwenden, ist er vermutlich nicht aktiv. Prüfung: `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.hai_embeddings'::regclass;`
2. Die Migration `20261027000100` schreibt am Ende alle Zeilen ohne Beruf auf FIAE. Läuft sie nach dem Einlesen der Karten noch einmal, würden die Karten FIAE zugeordnet und wären für KfBM nicht mehr auffindbar. Die Migration läuft vor dem Einlesen, nie danach.
3. Das Neuindexierungs-Skript löscht je Katalog und Quellart, die Karten (ohne Katalog) sind davon nicht betroffen. Wechselt die Einbettung (zum Beispiel auf ein anderes Modell), müssen die Karten mit `--apply` neu eingebettet werden, sonst passen Anfrage- und Kartenvektoren nicht zusammen.

**Falls später doch eine Migration gewünscht ist** (zum Beispiel eine ausdrückliche Plattformkennzeichnung statt NULL): neue Spalte `hai_embeddings.scope_kind text not null default 'occupation' check (scope_kind in ('occupation','platform'))`, ein Check `(scope_kind = 'platform') = (training_catalog_id is null)` und die Suche auf `scope_kind = 'platform'` umstellen. Das ist für Paket B nicht nötig und wurde nicht gebaut.

**Einlesepfad:** `npx tsx scripts/hai-learning-techniques.ts` ist ein Trockenlauf (Standard): liest und prüft die Kartendateien, zeigt je Karte Freigabe, Zeichen und Chunks, braucht weder Datenbank noch Modell. `--apply` bettet die freigegebenen Karten ein (ein Einbettungsaufruf je Chunk, höchstens zwölf) und entfernt Chunks nicht freigegebener Karten. Das Skript wurde nicht mit `--apply` ausgeführt.

## 4. Prompt und Grenzen (B.3)

Der Abschnitt "Lerntechniken: Tipps zum Lernen und Merken" steht am Ende des Systemprompts, in `processMessage` und in `processMessageStream` (beide rufen `buildSystemPrompt`). Er erscheint nur, wenn die Nachricht eine Lernfrage ist (Wortliste in `detect.ts`, bewusst großzügig) oder Lernkarten gefunden wurden. Für das neutrale Profil ohne Berufsbereich erscheint er nie.

**FIAE bleibt byte-gleich.** Ohne den Abschnitt ist jeder Prompt unverändert, die Baseline-Fixture `fiae-baseline.json` ist nicht angefasst und der Baseline-Test läuft grün. Mit dem Abschnitt ist der Prompt exakt der alte Prompt plus der Abschnitt (Test über alle rund 80 Fälle der Matrix).

Inhalt des Abschnitts: das Thema ist erlaubt (auch trotz des Verbots von Allgemeinwissen), Tipps nur auf Basis der Lernkarten mit Quelle, Rangfolge nach Nutzen, Beispiel passend zum Beruf des Azubis (nie das Beispiel des anderen Berufs), Verbindung mit Plattformdaten nur wenn sie im Abschnitt "Aktuelle Plattform-Daten" stehen, und die Grenzen:

- keine Diagnosen (bei Sorgen an Trainer oder Beratungsstelle verweisen)
- keine Stimm- oder Emotionsanalyse (keine Schlüsse aus Tonfall, Wortwahl, Schreibstil)
- keine Lerntypen und kein Lerntyp-Test
- keine Heilversprechen und keine Erfolgsgarantien
- keine erfundenen Studien oder Zahlen

## 5. Verbindung mit Plattformdaten (B.2)

So klein wie möglich: Für Azubis wird bei einer Lernfrage, die keine andere Datenabsicht trifft, die neue Absicht `learning_query` gewählt. Sie lädt nur vorhandene Felder des Datenkontexts, die der Azubi ohnehin in der Plattform sieht: Fortschritt je Kurs mit der letzten Quiznote (`fetchTraineeProgress`) und den Kalender mit Prüfungs- und Klausurterminen der nächsten 14 Tage (`fetchCalendar`). Trainer bekommen die Karten, aber keine Azubidaten durch diese Absicht. Der Abschnitt im Prompt verlangt, den Tipp nur dann mit diesen Angaben zu verbinden, wenn sie im Datenabschnitt stehen, und nie zu raten.

Nicht durch einen Test mit echter Datenbank abgedeckt: der Abruf selbst (`fetchDataContext` mit `learning_query`). Die Einstufung der Nachricht ist getestet.

## 6. Prüffragen

`tests/unit/hai/fixtures/learningTechniqueChecks.ts` enthält 23 Fälle (FIAE und KfBM, Azubi und Trainer): je drei zu Lerntypen, Diagnosen, Emotions- und Stimmanalyse und Heilversprechen, sechs Tipps, die sich auf eine Karte beziehen, zwei zum passenden Beispiel je Beruf, drei zur Verbindung mit Plattformdaten. Jeder Fall hat eine gute und, bei den Grenzfällen, eine schlechte Musterantwort.

Offline geprüft wird, was Code beweisen kann: Die Nachricht wird als Lernfrage erkannt, der Prompt des richtigen Berufs trägt die Grenzen und den Beispielhinweis, die Karte hinter dem Tipp existiert und hat ein Beispiel für den Beruf, die gute Antwort besteht die Grenzprüfung und die schlechte fällt durch. Die Grenzprüfung (`answerLint.ts`) ist eine Heuristik aus Mustern und kein Beweis: Sie findet typische Verstöße, keine verdeckten.

**Handprobe mit der echten HAI (offen, nur Niko):** dieselben Nachrichten an die HAI senden und die Antworten durch `lintLearningAnswer` laufen lassen, danach mit eigenen Augen lesen. Es wurde kein Modell aufgerufen.

## 7. Offene Prüfpunkte für Niko

1. Karten gegen den Originaltext lesen (Einordnung, Begründungen, Bedingungen), dann `review` je Karte setzen.
2. Die Richtwerte auf "Verteiltes Üben" (1 Tag, 1 Woche, 2 Wochen) bestätigen oder streichen.
3. Die Aussage im Prompt, Lerntypen seien nicht belastbar belegt, fachlich bestätigen (steht nicht auf einer Karte, die Karten nennen nur Dunlosky).
4. Die Beispiele je Beruf fachlich ansehen (zum Beispiel Pflichtangaben einer Rechnung, Angebotsvergleich, Normalisierung), vor allem die KfBM-Beispiele durch die Fachabteilung.
5. Prüfen, ob der Check auf `source_type` in der Zieldatenbank `learning_technique` zulässt (Abschnitt 3, Punkt 1).
6. Entscheidung, ob Trainer Lerntipps für ihre Azubis erwarten (heute: Karten ja, Azubidaten nein).
7. Freigabe des Einlesens mit `--apply` (Kosten: höchstens zwölf Einbettungsaufrufe).

## 8. Bekannte Grenzen

- Der Filter für Themen außerhalb des Fachgebiets (`classifyIntent`) kennt Stichworte wie "Musik" oder "Meditation". Eine Lernfrage, die so ein Wort enthält und kein Berufswort (zum Beispiel "Lernen mit Musik"), wird als fachfremd abgelehnt. Das wurde nicht geändert, um die Intents der Baseline nicht zu berühren.
- Der bestehende Erkennungsfilter für Prüfungstermine im Datenkontext sucht "pruefung" ohne Umlaut. Eine Frage mit "Prüfung" trifft deshalb nicht die Absicht `exam_query`, sondern (bei einer Lernfrage) die neue Absicht `learning_query`, die den Kalender ebenfalls lädt.
- Die Auswahl der Karte übernimmt das Modell aus dem gefundenen Kontext. Welches Beispiel (FIAE oder KfBM) es nennt, steuert der Prompt, erzwungen wird es nicht.
