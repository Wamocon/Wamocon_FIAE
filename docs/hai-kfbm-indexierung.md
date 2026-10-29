# HAI: Quellen der Indexierung, Kostenschätzung und Ablauf der Neuindexierung für KfBM (Paket KI5.3)

Stand: 29.10.2026. Jira WMCNL-2812 (Phase 5: HAI für KfBM), Punkt 5.3. Ergänzt am 29.10.2026 um die Trainer-Musterlösungen aus dem privaten Speicher (Abschnitt 8).

**Es wurde nichts ausgeführt.** Kein Lauf gegen die Preview oder Production, kein Modellaufruf, keine Einbettung, keine Migration. Für die Neuindexierung gibt es kein Go. Dieses Dokument beschreibt, was der Code indexiert, was dabei fehlte (und jetzt im Code geschlossen ist), wie man die Kosten ohne Aufruf schätzt und wie der Lauf in der Preview später abliefe.

## 1. Kurzfassung

- Der Reindex (`scripts/reindex-gemini.ts`) indexierte schon alle Quellen mit Berufsfilter (`training_catalog_id`) und Sichtbarkeit (`all` oder `trainer`). Es fehlten die **Textzeilen** der Dokumente (Szenario-Ausgangssituation, Lösungs- und Fachwissenstext, Themenzeilen der Use Cases). Die sind jetzt dabei.
- Use-Case-Musterlösungen landen nie in einem Index, den Azubis lesen. Das ist an vier Stellen abgesichert und mit Tests belegt (Abschnitt 4).
- Der Trockenlauf zählt jetzt Zeichen, geschätzte Token und Seiten der PDF-Dateien. Ein eigenes Werkzeug schätzt daraus die Einbettungskosten, **offline**, mit Preisen aus einer Konfigurationsdatei (Abschnitt 5).
- Die Kosten sind klein. Beispiel mit angenommenen Zahlen: 2 000 Textchunks und 226 PDF-Dateien mit 1 500 Seiten, zwei Läufe (Preview und Production), ergeben etwa 0,34 bis 0,61 USD, je nach Token-Annahme und Modell.
- **Neu (Beschluss Niko, 29.10.2026):** Die KfBM-Musterlösungen im privaten Bucket `content-solutions` dürfen von **Trainern** in der HAI genutzt werden, von Azubis nie. Der Code dafür ist gebaut, aber **standardmäßig aus** (Schalter `HAI_TRAINER_SOLUTIONS=on`). Im Aus-Zustand liest kein Skript den privaten Bucket, die Suche liefert keinen solchen Chunk und kein Chatverlauf damit wird als Kontext benutzt. Die Aktivierung ist eine **Weitergabe der Musterlösungen an den Anbieter** (Gemini), die Niko bewusst entscheidet. Siehe Abschnitt 8.

## 2. Was indexiert wird, je Ausbildung

Alle Quellen tragen den Beruf der Quelle (`training_catalog_id`), `--catalog KFBM` begrenzt jede Abfrage auf einen Beruf. Ein Chunk ohne Beruf wird nicht geschrieben.

| Quelle | Tabelle und Feld | Typ im Index | Sichtbarkeit | Hinweis |
| --- | --- | --- | --- | --- |
| Kurse | `courses` (Titel, Beschreibung) | `course` | `all` | |
| Enabler (die Basis) | `enablers` (Titel, Beschreibung, Kurs, `scenario_text`, `scenarios[].text`, Lernfelder) | `enabler`, Index ab 0 | `all` | Lehrtext der KfBM-Enabler: Kurzfassung, der Volltext kommt über das PDF |
| Hinweis eines Szenarios | `enablers.hint_text`, `scenarios[].hint` | `enabler`, Index ab 10 000 | `trainer` | eigener Chunk, getrennt vor dem Zerlegen |
| Use Case, Aufgabe | `use_cases` (Titel, Beschreibung, Jahr, Abschnitt, Lernfelder) | `use_case`, Index unter 1 000 | `all` | die Aufgabe, nie die Lösung |
| Use Case, Musterlösung (PDF-Seiten) | `ingestUseCase.ts` (`TRAINER_SOLUTION`) | `use_case`, Index Seite mal 1 000 plus n | `trainer` | nur über den Admin-Weg, nicht im Reindex-Skript, nicht für den privaten Bucket lesbar |
| Quizze | `quizzes`, `questions`, `options` | `quiz` | Fragen und Optionen `all`, Antworten, Erklärungen, erwartete Antworten `trainer` | vor dem Zerlegen getrennt |
| Lernfelder | `training_catalog_learning_fields`, Zuordnungen | `document` (Quelle ist das Lernfeld) | `all` | je Beruf, nicht nur FIAE |
| Rahmenplan | `training_components`, `training_use_cases` | `document` (Quelle ist die Komponente) | `all` | |
| Dokumente als PDF-Datei | `content_documents` (THEORY, EXERCISE, REFERENCE, OTHER, TRAINEE_QUESTION) | `document` | `all` | Beruf über Enabler, Use Case oder Kurs. Szenario-PDF (EXERCISE, ALL) ganz sichtbar |
| Dokumente mit Lösung | `content_documents` mit `TRAINER_SOLUTION` oder `TRAINER_ONLY` | `document` | `trainer` | in jeder Form (Datei oder Text) |
| **Textzeilen (neu)** | `content_documents` ohne Datei, Text in `description` | `document` | wie das Dokument: `all` oder `trainer` | Szenario-Ausgangssituation, Lösung und Fachwissen, Themenzeilen |
| **Trainer-Musterlösungen (neu, Schalter aus)** | `content_documents` mit `TRAINER_SOLUTION`, `TRAINER_ONLY`, `private://content-solutions/...` an einem Use Case | `document`, Markierung `trainerSolution` in den Metadaten | `trainer` | nur mit `HAI_TRAINER_SOLUTIONS=on`, nur im echten Lauf, Abschnitt 8 |
| Übrige private Verweise, Word-Dateien, andere Dateien | `private://...` (andere Bucket, andere Ordner, keine Lösung), `wordprocessingml`, kein PDF | nicht indexiert | | mit Grund gezählt |

Das PageIndex liest PDF-Dateien zusätzlich erst bei der Anfrage (nur `http`, PDF, im Beruf der Person, für Azubis ohne `TRAINER_SOLUTION` und `TRAINER_ONLY`). Textzeilen liest es nicht.

## 3. Lücken und was damit geschah

1. **Textzeilen wurden nie indexiert.** Der Importer legt Szenario-Ausgangssituation, Lösungs- und Fachwissenstext und die Themenzeile eines Use Case als Dokumentzeile ohne Datei ab (`storage_url` leer, `mime_type` `text/plain`, Text in `description`). Das Reindex-Skript übersprang jede Zeile ohne Adresse. Für KfBM wäre damit der sichtbare Text der Szenarien nicht auffindbar gewesen. **Geschlossen:** Die Entscheidung trifft eine reine Funktion, `planDocumentIndexing` in `src/lib/hai/indexScope.ts`. Eine Textzeile wird aus der Beschreibung gelesen, mit der Sichtbarkeit des Dokuments (Lösung: `trainer`).
2. **Private Verweise, Word-Dateien und andere Nicht-PDF-Zeilen wurden heruntergeladen und scheiterten.** Jetzt übersprungen, mit Grund und Zählung (`documents skipped by reason`). Geladen wird nur eine `http`- oder `https`-Adresse. Ein übersprungenes Dokument verliert in einem echten Lauf seine alten Chunks (ein Dokument, das nachträglich zur Lösung oder zum privaten Verweis wurde, darf nicht mit dem alten Scope lesbar bleiben). Nicht geprüft wird der Host einer gespeicherten Adresse (sie stammt aus einem Import oder von einem Trainer); eine Positivliste wie bei der Lösungsablage wäre ein eigenes Paket.
3. **Der Trockenlauf war zu grob für eine Kostenschätzung.** PDF-Dateien zählten als "1 Chunk", Lernfelder, Rahmenplan und PDFs hießen alle `document`, Zeichen gab es nicht. Jetzt: Zeichen und geschätzte Token je Zeile, Seiten der PDF-Dateien, eigene Bezeichnungen (`document (lernfeld)`, `document (training_component)`, `document (text row)`, `document (PDF files, not chunks)`), Chunks, die nur ihren Beruf oder ihre Sichtbarkeit wechseln, getrennt (kosten nichts). Das Protokoll `logs/reindex-<Zeit>.json` enthält alles.
4. **Es gab kein Kostenmodell.** Jetzt `scripts/hai-embedding-cost.ts` (Abschnitt 5).
5. **Musterlösungen im privaten Bucket: entschieden, gebaut, aus.** KfBM-Musterlösungen (`private://content-solutions/...`) las bisher weder das Reindex-Skript noch das PageIndex. Niko hat am 29.10.2026 beschlossen, dass Trainer sie nutzen dürfen, Azubis nie. Das Skript hat jetzt dafür eine eigene Quelle (Abschnitt 8), die nur mit dem Schalter `HAI_TRAINER_SOLUTIONS=on` arbeitet. Das PageIndex liest den privaten Bucket weiterhin nicht. Die Texte der Lösungszeilen (Textzeilen mit `TRAINER_SOLUTION`) sind unabhängig davon im Index, nur für Trainer.
6. **Doppelte Lösungs-Chunks möglich.** Eine `TRAINER_SOLUTION`-PDF mit Adresse wird vom Reindex-Skript als `document` und vom Admin-Weg `ingestUseCase.ts` als `use_case` indexiert, beide `trainer`. Das kostet doppelt, schadet dem Schutz nicht. Entscheidung offen, ob einer der beiden Wege entfällt.
7. **Szenario-Hinweis** (`hint_text`) ist als Trainerhinweis eingestellt (`SCENARIO_HINT_VISIBILITY`, Änderung auf `all` braucht eine Neuindexierung). Das bleibt, bis Niko anders entscheidet.

## 4. Lösungsschutz: wo er greift und wie er belegt ist

Eine Use-Case-Musterlösung (`TRAINER_SOLUTION`) kommt nur in `trainer`-Chunks, und die liest nur die Trainersicht.

| Stelle | Regel | Beleg |
| --- | --- | --- |
| Schreiben | `documentVisibility` und `planDocumentIndexing`: `TRAINER_SOLUTION` und `TRAINER_ONLY` sind `trainer`, in jeder Form | `tests/unit/hai/documentIndexPlan.test.ts` (alle Typen mal alle Sichtbarkeiten mal Datei, Text, ohne Datei) |
| Parität mit der Oberfläche | Eine Zeile ist für Azubis lesbar genau dann, wenn die Routen der Azubis sie öffnen lassen | derselbe Test (`traineeMayOpen` gegen den Plan) |
| Skript | keine eigene Regel im Skript, jede Zeile geht durch `planDocumentIndexing`, private Verweise werden nie geladen | `tests/unit/hai/reindexScript.sources.static.test.ts` |
| Lesen | SQL-Filter `visibility = 'all'` für alle außer `trainer`, Beruf als gebundener Parameter | `tests/unit/hai/vectorSearch.scope.test.ts`, `goldenSet.pipeline.test.ts` (Filter je Fall gerendert) |
| Antwort | Kein Treffer, kein Prompt, keine Quellenangabe, keine Antwort eines Azubis trägt Lösungstext | `tests/unit/hai/goldenSet.pipeline.test.ts` (85 Fälle, zwei Pipelines, Prüfwörter je Chunk) |
| PageIndex | `TRAINER_SOLUTION` und `TRAINER_ONLY` nur bei `trainer`, kein Link zu einem Lösungsdokument | `tests/unit/hai/pageIndexService.scope.test.ts`, `ragPipeline.retrieval.test.ts` |
| Musterlösungen aus dem privaten Speicher: Suche | Jeder Chunk mit `metadata.trainerSolution` ist ausgeschlossen, außer für die Trainersicht mit Erlaubnis (Rolle aus der Datenbank und Schalter). Die Bedingung steht im SQL, dazu eine zweite Sperre in der Pipeline | `vectorSearch.scope.test.ts`, `retrievalAccess.test.ts`, `ragPipeline.retrieval.test.ts`, `goldenSet.pipeline.test.ts` |
| Musterlösungen aus dem privaten Speicher: Quellenangabe | Kein Zitatlink auf `private://`, auf signierte Adressen (`/object/sign/`, `token=`) oder auf `content-solutions` | `tests/unit/hai/citationUrl.test.ts` |
| Chatverlauf, Zusammenfassung, Gedächtnis | Eine Antwort mit Musterlösung und ihre Sitzung tragen die Markierung `trainerKnowledge`. Eine solche Sitzung sieht nur die Trainersicht (Liste, Suche, Einzelansicht). Als Kontext für das Modell zählt sie nur bei Trainersicht und eingeschaltetem Schalter | `tests/integration/api/hai/chat-trainer-knowledge.test.ts`, `tests/unit/hai/chatHistoryAccess.test.ts` |

Ein **Szenario** ist ein ganzes Dokument und für Azubis ganz sichtbar (Beschluss Niko). Es wird deshalb nicht getrennt. Nur Use Cases werden getrennt (Aufgabe sichtbar, Musterlösung nur Trainer).

## 5. Kostenschätzung ohne Aufruf

Das Werkzeug `scripts/hai-embedding-cost.ts` macht **keinen Netzaufruf, liest keine Datenbank und kein Geheimnis, ruft kein Modell**. Es liest zwei JSON-Dateien: eine Zählung (Quellen, Chunks, Zeichen, Seiten) und die Preise.

```
npx tsx scripts/hai-embedding-cost.ts --inventory <Zählung.json> [--runs 2] [--which changes|inventory] [--eur-per-usd <Kurs>] [--json]
```

**Zählung.** Entweder von Hand:

```json
{
  "groups": [
    { "sourceType": "enabler", "catalog": "KFBM", "visibility": "all", "unit": "chunks", "chunks": 2000, "chars": 800000 },
    { "sourceType": "document (PDF)", "catalog": "KFBM", "visibility": "all", "unit": "files", "files": 226, "pages": 1500 }
  ]
}
```

oder das Protokoll eines Trockenlaufs (`logs/reindex-<Zeit>.json`). Davon nimmt das Werkzeug `plan.changes` (was ein echter Lauf jetzt einbetten würde) oder mit `--which inventory` alles, was der Index danach enthält. Mit `--runs 2` rechnet es zwei Läufe (Preview und Production betten denselben Text zweimal ein).

**Rechnung.** Je Zeile: Chunks, Zeichen (gemessen, sonst angenommen und als `assumed` markiert), daraus Token mit drei Annahmen (optimistisch 4,0, Basis 3,5, pessimistisch 3,0 Zeichen je Token), daraus Kosten je Modell, Standard und Batch. PDF-Dateien werden aus gemessenen Zeichen, sonst aus Seiten (Standard: 2 500 Zeichen je Seite, 6 Seiten je Datei) und der Chunkgröße (Standard 400 Zeichen) in Chunks umgerechnet. Ein Chunk ist eine Anfrage an das Modell. Nicht enthalten: Chat, Einbettung von Nutzerfragen, Wiederholungen nach einer Ratenbegrenzung. Das Ergebnis ist eine Schätzung, weil Token ohne Modellaufruf nicht exakt zu zählen sind.

**Preise sind Konfiguration**, nicht im Code: `scripts/config/hai-embedding-pricing.json` (Modell, Preis je Million Eingabetoken Standard und Batch, Status, Quelle, Stand, optional `eurPerUsd`, die Annahmen). Ein Test prüft, dass jeder Preis eine Quelle und ein Datum nennt.

| Modell | Standard | Batch | Status | Quelle, Stand |
| --- | --- | --- | --- | --- |
| `gemini-embedding-001` (heute im Index) | 0,15 USD je Million | 0,075 USD je Million | zuletzt bekannt | https://ai.google.dev/gemini-api/docs/pricing, Seite am 28.10.2026 gelesen (Stand der Seite 27.10.2026): das Modell steht dort **nicht mehr** in der Preisliste, der Wert ist der letzte bekannte |
| `gemini-embedding-2` (Obergrenze zum Vergleich) | 0,20 USD je Million | 0,10 USD je Million | gelistet | dieselbe Seite |

Die Seite https://ai.google.dev/gemini-api/docs/deprecations nennt für `gemini-embedding-001` eine Abschaltung frühestens am 14.05.2028 und `gemini-embedding-2` als Nachfolger. Ein Wechsel des Einbettungsmodells ist kein Teil dieses Pakets (Beschluss: Einbettungen bleiben Gemini, `gemini-embedding-001`, `vector(3072)`). **Vor der Kostenfreigabe den Preis noch einmal prüfen**, weil das Modell nicht mehr auf der Preisseite steht.

Beispiel (angenommene Zahlen, nicht gemessen): 2 000 Chunks Text und 226 PDF-Dateien mit 1 500 Seiten, `--runs 2`. Ergebnis: rund 22 750 Anfragen, 2,3 bis 3,0 Millionen Token, **0,34 bis 0,46 USD** mit dem letzten Preis von `gemini-embedding-001` (Standard), mit dem Preis von `gemini-embedding-2` 0,46 bis 0,61 USD, im Batch die Hälfte.

### Zahlen, die für die echte Schätzung gebraucht werden

Aus einem Trockenlauf gegen die Preview (liest nur, schreibt nichts, kein Modellaufruf, braucht aber die Verbindung zur Preview und damit ein Go) und aus den Quelldateien:

1. Das Protokoll `logs/reindex-<Zeit>.json` des Trockenlaufs mit `--catalog KFBM` (Chunks und Zeichen je Quelle, Beruf, Sichtbarkeit).
2. Für die **PDF-Dateien** (der Trockenlauf lädt sie nicht, `plan.changes` zählt sie alle, das ist eine Obergrenze, weil ein echter Lauf nur einbettet, was neu oder geändert ist oder mit einem anderen Modell erzeugt wurde): Anzahl und Seitenzahl je Beruf und Sichtbarkeit (die Spalte `page_count`, falls leer: gemessene Zeichen aus den Quelldateien lokal). Ohne diese Zahl rechnet das Werkzeug mit 6 Seiten je Datei und markiert es.
3. Wie viele Läufe: nur Preview (1) oder Preview und Production (2). Ein Lauf mit `--force` bettet alles neu ein, ohne `--force` nur Neues und Geändertes.
4. Gilt für KfBM der Preis von `gemini-embedding-001` noch? Der aktuelle Preis und die Frage, ob das Konto im bezahlten Tarif ist.
5. Optional der Wechselkurs für Euro (`--eur-per-usd`).

## 6. Ablauf der Neuindexierung für KfBM in der Preview (nur mit Go von Niko, und nach der Kostenfreigabe)

Nichts davon wurde ausgeführt.

**Voraussetzungen**

- Go von Niko für die Neuindexierung und Freigabe der Kosten (Abschnitt 5, mit gemessenen Zahlen).
- Migration `20261027000100` (Spalten `training_catalog_id`, `visibility`, `organization_id` in `hai_embeddings`) in der Preview angewendet. Das Skript prüft es und bricht sonst ab.
- KfBM-Inhalte in der Preview (Katalog `KFBM`, Kurse, Enabler, Use Cases, Szenario-PDF, Lernfelder).
- `GEMINI_API_KEY` in der Umgebung des Prozesses (nur für den echten Lauf). `DB_CONNECTION_STRING` oder `HAI_DB_CONNECTION_STRING` der Preview (Rolle `app_preview` oder `app_preview_migrator`, Schema `public_preview`), nur aus der Shell, nie in eine Datei.
- `KFBM_ROLLOUT_APPROVED` wird **nicht** gesetzt (das Tor ist nur für Production).

**Schritte**

1. Probelauf (Standard, schreibt nichts, kein Modellaufruf):
   ```
   npx tsx scripts/reindex-gemini.ts --target preview --catalog KFBM
   ```
   Das Skript prüft zuerst, ob Host, Schema und Rolle zum Ziel passen. Ausgabe: Chunks, Zeichen und geschätzte Token je Quelle, Beruf und Sichtbarkeit, dazu die Gründe für übersprungene Dokumente. Das Protokoll liegt unter `logs/`.
2. Kosten schätzen (offline):
   ```
   npx tsx scripts/hai-embedding-cost.ts --inventory logs/reindex-<Zeit>.json --runs 1
   ```
   Die Zahlen aus Abschnitt 5 eintragen, den Preis prüfen, Kosten an Niko geben.
3. Go und Kostenfreigabe abwarten.
4. Echter Lauf (nur Neues und Geändertes, Fortsetzung nach Abbruch möglich, der Fortschritt steht in der Datenbank):
   ```
   npx tsx scripts/reindex-gemini.ts --target preview --catalog KFBM --apply
   ```
   Vorher prüft das Skript einmal mit einem Test-Einbettungsaufruf, ob der Schlüssel und die Dimension (3072) stimmen. Ein Lauf mit `--force` bettet alles neu ein, nur wenn es nötig ist.
5. Prüfen:
   - Dieselbe Zählung als Probelauf noch einmal: er soll nichts mehr zu ändern finden.
   - Lesend in der Preview, Anzahl je Typ und Sichtbarkeit für KfBM:
     ```sql
     select source_type, visibility, count(*)
     from public_preview.hai_embeddings
     where training_catalog_id = (select id from public_preview.training_catalogs where code = 'KFBM')
     group by 1, 2 order by 1, 2;
     ```
   - Lösungsprobe: kein sichtbarer Chunk darf aus einer Lösungsquelle stammen. Es darf keine Zeile mit `visibility = 'all'` und `metadata->>'documentType' = 'TRAINER_SOLUTION'` geben:
     ```sql
     select count(*) from public_preview.hai_embeddings
     where visibility = 'all' and metadata->>'documentType' = 'TRAINER_SOLUTION';
     ```
     Erwartet: 0.
   - Berufsprobe: kein Chunk ohne Beruf (`training_catalog_id is null`), keine KfBM-Chunks bei FIAE und umgekehrt.
   - Golden Set (offline) und die Messung mit dem Modell nach `docs/hai-golden-set.md`, nur mit Go.
6. Dauer: das Skript schickt bis zu 5 Anfragen gleichzeitig, bei einigen tausend Chunks dauert ein Lauf einige Minuten. Das Protokoll nennt Anfragen und Zeit.

**Kosten:** Abschnitt 5, je Lauf die Token der geänderten Chunks mal dem Preis. Ein zweiter Lauf ohne Änderung kostet nichts (Prüfung über den Inhalts-Hash).

**Rückbau**

- Alle KfBM-Chunks der Preview löschen, nichts anderes (nur mit `--catalog`, löscht Kurse, Enabler, Quizze, Dokumente und die Use-Case-Chunks unter Index 1 000 des Berufs):
  ```
  npx tsx scripts/reindex-gemini.ts --target preview --catalog KFBM --purge          # zählt nur
  npx tsx scripts/reindex-gemini.ts --target preview --catalog KFBM --purge --apply  # löscht
  ```
- Nur die Chunks, die nicht von `gemini-embedding-001` stammen: `--purge-stale`.
- Lösungsseiten des Admin-Wegs (`use_case`, Index ab 1 000) und persönliche Chunks (`trainee_*`) fasst der Rückbau nicht an. Sie entfernt man bei Bedarf gezielt (`deleteUseCaseEmbeddings`).
- Die Chat-Antworten der HAI hängen am Index. Nach dem Rückbau antwortet die HAI zu KfBM ohne Wissen (die Persona und die Sperren bleiben).
- Production bleibt unberührt: `--target production` verlangt `--confirm-production <Host>` und das Tor `KFBM_ROLLOUT_APPROVED` in der Umgebung des Prozesses.

## 7. Prüfungen dieses Pakets

- Tests: `tests/unit/hai/embeddingCost.test.ts`, `embeddingCostCli.test.ts` (Schätzung, Preiskonfiguration, Aufruf), `documentIndexPlan.test.ts` (Dokumentzeilen, Lösungsschutz), `reindexScript.sources.static.test.ts` (Nutzung im Skript), `reindexArgs.test.ts` (Zählung mit Zeichen und Seiten), `goldenSet*.test.ts` (Prüfset).
- Das Skript selbst läuft beim Import und wurde in diesem Paket **nicht gegen eine Datenbank ausgeführt**: die neue Abfrage (zwei Spalten mehr, `description` und `mime_type`) und der Textzeilen-Pfad sind durch den Typ-Check und die statischen Tests abgedeckt, nicht durch einen Lauf. Vor dem ersten Probelauf in der Preview ein Probelauf gegen eine lokale Wegwerf-Datenbank ist möglich.

## 8. Trainer-Musterlösungen aus dem privaten Speicher (Beschluss Niko, 29.10.2026; gebaut, Schalter aus)

**Es wurde nichts ausgeführt:** kein Zugriff auf einen Speicher, keine Datenbank, kein Modellaufruf, keine Einbettung, keine Migration. Alles ist mit Tests belegt, die offline laufen.

### 8.1 Entscheidung für Niko: Datenweitergabe an den Anbieter

Die Musterlösungen sind die geschützteste Quelle der Plattform. Mit dem Schalter gehen sie an externe Dienste. **Das ist eine Weitergabe der Lösungen an den Anbieter, und Niko entscheidet bewusst, ob und wann.** Standard ist aus.

| Was | Wohin | Wann |
| --- | --- | --- |
| Der Text jeder Musterlösung (in Chunks) | Gemini, Einbettungsmodell `gemini-embedding-001` | bei jedem echten Lauf des Reindex mit eingeschaltetem Schalter, nur Neues und Geändertes (Prüfsumme) |
| Bis zu fünf Treffer als Antwortkontext (Auszüge der Lösung) | das Chatmodell des Chats (Gemini, als einziger Rückfall Sokrates) | bei jeder Frage eines Trainers, die auf eine Lösung trifft |
| Frühere Antworten mit Lösungstext (Verlauf der letzten Nachrichten) | dasselbe Chatmodell | bei weiteren Fragen in einer solchen Sitzung, solange der Schalter an ist |
| Die Frage des Trainers (ohne Lösungstext) zur Suche | Gemini, Einbettung der Anfrage | wie bei jeder Frage, ändert sich nicht |

Die Einbettung der Lösungen läuft über Gemini, weil der Index so aufgebaut ist (`vector(3072)`, `gemini-embedding-001`). Ein Wechsel auf Sokrates für die Einbettung ist ein eigener Beschluss und braucht eine Neuindexierung des ganzen Index (Stand 26.10.2026: kein Go).

**Zweiter Schalter für den Chat:** `HAI_TRAINER_SOLUTIONS_CHAT=sokrates` lässt jede Runde, die Trainerwissen enthält (Treffer aus einer Musterlösung oder Verlauf aus einer markierten Sitzung), **nur über Sokrates** beantworten. Gemini sieht diesen Antwortkontext dann nicht. Ist Sokrates nicht erreichbar, bekommt der Trainer die Meldung "HAI nicht erreichbar", die Lösung wird nicht an einen anderen Anbieter geschickt. Ohne den zweiten Schalter (Standard) läuft der Chat wie bisher (Gemini, Rückfall Sokrates). Die Einbettung der Lösungen bleibt in beiden Fällen bei Gemini.

**Empfehlung:** Zuerst nur Preview, `HAI_TRAINER_SOLUTIONS=on` mit `HAI_TRAINER_SOLUTIONS_CHAT=sokrates`, damit der Antwortkontext nicht zu Gemini geht. Danach entscheiden, ob die Einbettung bei Gemini bleiben darf.

### 8.2 Schalter und Standard

| Schalter | Wirkung | Standard |
| --- | --- | --- |
| `HAI_TRAINER_SOLUTIONS=on` (nur dieser Wert zählt, "true" oder "1" nicht) | Skript darf den privaten Bucket lesen und einbetten. Die Suche darf Trainern der zugeordneten Berufe Lösungs-Chunks liefern. Verlauf mit Trainerwissen darf Kontext sein | aus |
| `HAI_TRAINER_SOLUTIONS_CHAT=sokrates` | Runden mit Trainerwissen nur über Sokrates | nicht gesetzt |

Das Skript liest `HAI_TRAINER_SOLUTIONS` nur aus der Umgebung des Prozesses (Shell), nie aus `.env.local` oder `.env`, wie das Tor `KFBM_ROLLOUT_APPROVED`. Die App liest die Variable aus ihrer Umgebung (Vercel). Ist der Schalter aus, entfernt ein echter Lauf des Skripts die alten Chunks der Lösungszeilen.

### 8.3 Lesen aus dem privaten Speicher

Die Entscheidung trifft `planDocumentIndexing` in `src/lib/hai/indexScope.ts` (neue Art `private_pdf`), das Lesen `src/lib/hai/privateSolutionReader.ts`.

- Eine Zeile wird nur gelesen, wenn **alle** Bedingungen gelten: Typ `TRAINER_SOLUTION` **und** Sichtbarkeit `TRAINER_ONLY`, die Zeile hängt an einem Use Case, alle Berufe der Zeile (Enabler, Use Case, Kurs) sind derselbe Beruf, MIME leer oder `application/pdf`.
- Der Verweis wird so geprüft, wie er gespeichert ist (kein Kürzen, kein Dekodieren): Schema `private://`, Bucket genau `content-solutions`, Pfad im Ordner des Ziels (`preview/kfbm/` für Preview, `kfbm/` für Production und lokal, weil die Buckets geteilt sind), Pfad nur aus Buchstaben, Ziffern, Punkt, Unterstrich, Bindestrich und Schrägstrich, kein leeres, `.`- oder `..`-Segment, höchstens 300 Zeichen, Endung `.pdf`.
- Der Leser prüft Bucket und Pfad **noch einmal**, schickt den Schlüssel nur an die https-Adresse des eigenen Projekts (ohne Zugangsdaten und Port, kein Loopback; lokal nur `http://localhost` bei `--target local`) und nirgends sonst, folgt keiner Weiterleitung (`redirect: 'error'`), hat 30 Sekunden Zeit und höchstens 25 MB (so groß ist die Grenze des Buckets; geprüft an der angegebenen Länge und beim Lesen des Datenstroms). Die Datei muss mit `%PDF-` beginnen, der Text ist auf 400 000 Zeichen begrenzt (größer wird abgelehnt, nicht gekürzt). Ein Fehler nennt nie die Adresse, den Pfad oder den Schlüssel.
- Der Zugriff geht über den Server-Schlüssel (`SUPABASE_SECRET_KEY`), nur im echten Lauf. Das Skript verlangt dafür `--confirm-storage-host <Host des Speichers>` (wie beim Import der Dokumente) und prüft, dass Ziel und Adresse zusammenpassen (lokal nur lokaler Speicher, Preview und Production nur ein gehostetes Projekt per https).
- Die Chunks tragen Beruf des Use Case, Sichtbarkeit `trainer`, Organisation der Zeile und in den Metadaten `trainerSolution: true`, `documentType`, Titel, Use Case, Seitenzahl. **Nie** den Pfad, den Bucket oder eine Adresse.

### 8.4 Trockenlauf und Kosten

- Der Trockenlauf liest den privaten Bucket nie. Er zählt die Dateien und Seiten der Musterlösungen **getrennt** (Abschnitt "Trainer solutions" der Ausgabe, `plan.trainerSolutions` im Protokoll), ob der Schalter an oder aus ist. Bei eingeschaltetem Schalter stehen sie zusätzlich in `plan.inventory` und `plan.changes`.
- `scripts/hai-embedding-cost.ts` kennt die Quelle: `--which trainer-solutions` schätzt nur die Musterlösungen. Der Bericht jeder anderen Schätzung weist ihren Anteil getrennt aus ("Of this, trainer solutions"), mit dem Hinweis auf die Weitergabe an den Anbieter.
- **Kostenänderung:** Die Lösungen kommen zur bisherigen Schätzung dazu, sobald der Schalter an ist. Beispiel mit angenommenen Zahlen: 60 Musterlösungen mit je 6 Seiten, also 360 Seiten zu 2 500 Zeichen, sind rund 900 000 Zeichen und etwa 257 000 Token (Basis 3,5 Zeichen je Token). Mit dem letzten bekannten Preis von `gemini-embedding-001` (0,15 USD je Million) sind das etwa **0,04 USD je Lauf**, mit dem Preis von `gemini-embedding-2` etwa 0,05 USD. Die echte Zahl kommt aus dem Trockenlauf (Seiten der Dateien aus `page_count`, sonst angenommen) und aus `--which trainer-solutions`. Die Kosten im Chat (Auszüge im Antwortkontext) sind klein: ein paar hundert Zeichen je Treffer.

### 8.5 Zugriff: wer die Lösungen finden kann

- **Nur Trainersicht:** `TRAINER`, `TEMP_ADMIN`, `ADMIN`, `SUPER_ADMIN` laut Datenbank (`resolveRetrievalAccess`, wie bisher für alle Trainer-Chunks), **und** nur für die Berufe, die der Person zugeordnet sind (Berufsfilter bleibt). Ein Trainer eines anderen Berufs findet nichts. `TEMP_ADMIN` zählt dazu, weil die Rollenordnung ihn über dem Trainer führt; ob das gewollt ist, kann Niko ändern (eine Zeile in `src/lib/hai/chatHistoryAccess.ts` und `retrievalAccess.ts` wäre nötig, heute teilen sich beide `isTrainerLevelRole`).
- **Azubis nie:** Die Rolle kommt aus der Datenbank, nie aus der Anfrage (eine behauptete Rolle im Text oder im Request ändert nichts, getestet). Die SQL-Bedingung schließt jeden Chunk mit `trainerSolution` für alle außer einer Trainersicht mit Erlaubnis aus. Eine zweite Sperre in der Pipeline entfernt einen solchen Chunk, falls die Suche ihn je liefert. Das gilt für Eingaben wie Umschreiben, Zitieren, Übersetzen, eingeschleusten Systemtext und Rollenspiel, weil das Modell eines Azubis den Text nie bekommt (kein Schlüsselwortfilter nötig, Golden Set SP-26 bis SP-33).
- **Quellenangabe und Zitatlink:** Treffer aus dem Index bekommen nie eine Adresse. Zusätzlich verwirft `citationUrl` jede Adresse mit `private://`, `content-solutions`, `/object/sign/`, `/object/authenticated/` oder einer Signatur im Aufruf. Die Quellenangabe zeigt den Titel des Dokuments.
- **PageIndex:** unverändert, liest den privaten Bucket nicht.

### 8.6 Chatverlauf, Zusammenfassung, Gedächtnis

- Chats gehören einer Person (`hai_chat_sessions.user_id`, jede Abfrage filtert darauf). Der Chat eines Trainers gelangt deshalb nicht in die Sicht eines Azubis. Die Zusammenfassung wird lokal aus den **Fragen** der Person gebildet (nicht aus den Antworten), das Gedächtnis (Cross-Session) liest nur die eigenen Sitzungen.
- Die eine Lücke ist ein **Rollenwechsel**: Wer Trainer war und jetzt Azubi ist, besitzt die alten Sitzungen. Deshalb tragen eine Antwort mit Lösungstext und ihre Sitzung die Markierung `trainerKnowledge`. Eine markierte Sitzung erscheint für Nicht-Trainer weder in der Liste noch in der Suche noch als Einzelansicht, liefert weder Nachrichten noch Zusammenfassung noch Gedächtnis als Kontext und gehört bei ausgeschaltetem Schalter auch für Trainer nicht zum Kontext (damit nichts davon erneut an den Anbieter geht). Die Markierung steht in den JSON-Metadaten, es gibt **keine Migration**.
- Bestehende Chats vor der Aktivierung enthalten keine Lösungen und werden nicht markiert.

### 8.7 Grenzen und offene Punkte

- Der Weg über den Admin-Dialog der App (`ingestUseCase.ts`, Seiten als `use_case`) liest den privaten Bucket weiterhin nicht (eine private Zeile wird dort abgelehnt). Der neue Weg gilt nur für das Reindex-Skript.
- Löscht oder ersetzt jemand eine Musterlösung im Bucket, bleibt der Chunk bis zum nächsten Lauf mit Schalter stehen. Ein Lauf mit ausgeschaltetem Schalter entfernt alle Chunks der Lösungszeilen.
- Das Skript wurde in diesem Paket nicht gegen eine Datenbank oder einen Speicher ausgeführt. Der Lesepfad ist durch Tests mit gestelltem Netz (Leser, Plan, statische Prüfung des Skripts) belegt, nicht durch einen Lauf. Vor dem ersten echten Lauf: Probelauf in der Preview ohne Schalter (zählt nur), dann mit Schalter und `--target local` gegen einen lokalen Wegwerf-Speicher, erst danach Preview.
- Die Messung der Antworten mit dem Modell (Golden Set, Abschnitt 5) läuft nur mit Nikos Go. Die 13 neuen Fälle sind darin enthalten.
