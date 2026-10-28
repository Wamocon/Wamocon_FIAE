# HAI: Quellen der Indexierung, Kostenschätzung und Ablauf der Neuindexierung für KfBM (Paket KI5.3)

Stand: 28.10.2026. Jira WMCNL-2812 (Phase 5: HAI für KfBM), Punkt 5.3.

**Es wurde nichts ausgeführt.** Kein Lauf gegen die Preview oder Production, kein Modellaufruf, keine Einbettung, keine Migration. Für die Neuindexierung gibt es kein Go. Dieses Dokument beschreibt, was der Code indexiert, was dabei fehlte (und jetzt im Code geschlossen ist), wie man die Kosten ohne Aufruf schätzt und wie der Lauf in der Preview später abliefe.

## 1. Kurzfassung

- Der Reindex (`scripts/reindex-gemini.ts`) indexierte schon alle Quellen mit Berufsfilter (`training_catalog_id`) und Sichtbarkeit (`all` oder `trainer`). Es fehlten die **Textzeilen** der Dokumente (Szenario-Ausgangssituation, Lösungs- und Fachwissenstext, Themenzeilen der Use Cases). Die sind jetzt dabei.
- Use-Case-Musterlösungen landen nie in einem Index, den Azubis lesen. Das ist an vier Stellen abgesichert und mit Tests belegt (Abschnitt 4).
- Der Trockenlauf zählt jetzt Zeichen, geschätzte Token und Seiten der PDF-Dateien. Ein eigenes Werkzeug schätzt daraus die Einbettungskosten, **offline**, mit Preisen aus einer Konfigurationsdatei (Abschnitt 5).
- Die Kosten sind klein. Beispiel mit angenommenen Zahlen: 2 000 Textchunks und 226 PDF-Dateien mit 1 500 Seiten, zwei Läufe (Preview und Production), ergeben etwa 0,34 bis 0,61 USD, je nach Token-Annahme und Modell.
- **Offene Entscheidung für Niko:** Die KfBM-Musterlösungen liegen im privaten Bucket `content-solutions`. Ein Skript liest sie nicht (der Verweis `private://` ist keine Adresse). Sie stehen deshalb auch nicht im Index für Trainer. Siehe Abschnitt 3, Punkt 5.

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
| Private Verweise, Word-Dateien, andere Dateien | `private://...`, `wordprocessingml`, kein PDF | nicht indexiert | | mit Grund gezählt |

Das PageIndex liest PDF-Dateien zusätzlich erst bei der Anfrage (nur `http`, PDF, im Beruf der Person, für Azubis ohne `TRAINER_SOLUTION` und `TRAINER_ONLY`). Textzeilen liest es nicht.

## 3. Lücken und was damit geschah

1. **Textzeilen wurden nie indexiert.** Der Importer legt Szenario-Ausgangssituation, Lösungs- und Fachwissenstext und die Themenzeile eines Use Case als Dokumentzeile ohne Datei ab (`storage_url` leer, `mime_type` `text/plain`, Text in `description`). Das Reindex-Skript übersprang jede Zeile ohne Adresse. Für KfBM wäre damit der sichtbare Text der Szenarien nicht auffindbar gewesen. **Geschlossen:** Die Entscheidung trifft eine reine Funktion, `planDocumentIndexing` in `src/lib/hai/indexScope.ts`. Eine Textzeile wird aus der Beschreibung gelesen, mit der Sichtbarkeit des Dokuments (Lösung: `trainer`).
2. **Private Verweise, Word-Dateien und andere Nicht-PDF-Zeilen wurden heruntergeladen und scheiterten.** Jetzt übersprungen, mit Grund und Zählung (`documents skipped by reason`). Geladen wird nur eine `http`- oder `https`-Adresse. Ein übersprungenes Dokument verliert in einem echten Lauf seine alten Chunks (ein Dokument, das nachträglich zur Lösung oder zum privaten Verweis wurde, darf nicht mit dem alten Scope lesbar bleiben). Nicht geprüft wird der Host einer gespeicherten Adresse (sie stammt aus einem Import oder von einem Trainer); eine Positivliste wie bei der Lösungsablage wäre ein eigenes Paket.
3. **Der Trockenlauf war zu grob für eine Kostenschätzung.** PDF-Dateien zählten als "1 Chunk", Lernfelder, Rahmenplan und PDFs hießen alle `document`, Zeichen gab es nicht. Jetzt: Zeichen und geschätzte Token je Zeile, Seiten der PDF-Dateien, eigene Bezeichnungen (`document (lernfeld)`, `document (training_component)`, `document (text row)`, `document (PDF files, not chunks)`), Chunks, die nur ihren Beruf oder ihre Sichtbarkeit wechseln, getrennt (kosten nichts). Das Protokoll `logs/reindex-<Zeit>.json` enthält alles.
4. **Es gab kein Kostenmodell.** Jetzt `scripts/hai-embedding-cost.ts` (Abschnitt 5).
5. **Offen, nicht geändert: Musterlösungen im privaten Bucket.** KfBM-Musterlösungen (`private://content-solutions/...`) liest weder das Reindex-Skript noch das PageIndex. Folge: Auch die Trainersicht der HAI hat keine KfBM-Musterlösung. Das ist sicher für den Lösungsschutz. Soll die HAI Trainern daraus antworten, braucht das Skript einen signierten Link mit dem Servicekey (Preview) und eine Entscheidung von Niko. Die Texte der Lösungszeilen (Textzeilen mit `TRAINER_SOLUTION`) sind dagegen jetzt im Index, nur für Trainer.
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
