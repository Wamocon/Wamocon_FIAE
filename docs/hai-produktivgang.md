# HAI in Production: Ablauf des Produktivgangs

Stand: 02.11.2026. Ziel: Die HAI läuft in Production mit KfBM und dem neuen FIAE-Inhalt, Chat und Einbettung über Sokrates (Beschluss Niko, Qualität gemessen). Die Preview ist der Maßstab: dort ist alles gebaut und gemessen. Dieses Dokument ersetzt nicht das Rollout-Runbook (`docs/kfbm-production-rollout.md`), es ergänzt es um alles, was die HAI betrifft. Nichts davon ist in Production ausgeführt, jeder Schritt mit Wirkung braucht das Go von Niko.

## 1. Ausgangslage in Production (lesend gemessen am 02.11.2026)

| Messung | Wert |
|---|---|
| Index `hai_embeddings` | 16.226 Zeilen, alle `gemini-embedding-001`: Dokumente 7.835, Quizze 8.136, Enabler 231, Kurse 24 |
| Stand des Index | zuletzt aktualisiert am 18.02.2026, also der alte FIAE-Inhalt, **kein KfBM**, keine Lernkarten |
| Spalten | ohne `training_catalog_id`, `visibility`, `organization_id` (kommen mit den Migrationen des Rollouts) |
| Nutzung | 7 Chat-Sitzungen von 4 Personen in 30 Tagen, letzte Antwort am 26.10.2026 |
| Anbieter | Chat und Einbettung stehen in Production auf Gemini (`HAI_CHAT_PROVIDER`, `HAI_EMBEDDING_PROVIDER`), das Google-Guthaben war leer (Fehler 402) |
| Sokrates-Zugang | `OPENAI_COMPATIBLE_BASE_URL`, `_API_KEY`, `_MODEL` sind für Production schon gesetzt |

Folgerung: Die Nutzung ist gering, das Risiko für Nutzer beim Umbau des Index ist klein. Der Index muss aber komplett neu mit dem Modell entstehen, das die Fragen beantwortet (die Vektoren zweier Modelle sind nicht vergleichbar).

## 2. Vorbedingungen

1. Plattform-Rollout durch: 36 Migrationen (darunter die Bereichs-, Sichtbarkeits- und Lernkarten-Migration), App-Release, FIAE-Übertragung, KfBM-Inhaltsabgleich. Ohne den Inhalt in Production gibt es nichts zu indexieren.
2. Sokrates frei für etwa drei Stunden (der Server wird auch von WAMO genutzt) und Tunnel `ssh -N -L 18434:localhost:11434 sokrates1` (Hinweis: unter Windows als losgelöster Prozess mit Git-SSH starten, sonst bricht er ab).
3. Sicherung der Tabelle `hai_embeddings` (Rückweg, siehe Abschnitt 5).
4. Go von Niko für die Neuindexierung von Production (bisher ausdrücklich nicht erteilt).

## 3. Ablauf (in dieser Reihenfolge)

| Nr | Schritt | Befehl oder Ort | Prüfung |
|---|---|---|---|
| H1 | Sicherung `hai_embeddings` | `pg_dump --table=public.hai_embeddings` über den Session-Pooler, Datei verschlüsselt ablegen | Zeilenzahl vor dem Lauf notieren (heute 16.226) |
| H2 | Index für die Suche anlegen (optional, empfohlen) | `scripts/db/hai-halfvec-index.sql` mit `PGOPTIONS="-c search_path=public,extensions"`, CONCURRENTLY, blockiert nichts | Index gültig (`indisvalid`), bei etwa 50.000 Zeilen rund 15 Minuten |
| H3 | Neuindexierung mit Sokrates | `HAI_REINDEX_PROVIDER=ollama OLLAMA_BASE_URL=http://localhost:18434 DB_CONNECTION_STRING=<Production, Session-Pooler> npx tsx scripts/reindex-gemini.ts --target production --confirm-production <Host> --apply` | Trockenlauf zuerst (ohne `--apply`), Dauer etwa drei Stunden, wiederaufnehmbar |
| H4 | Reste der Gemini-Vektoren entfernen | gleicher Aufruf mit `--catalog <FIAE oder KFBM> --purge-stale --apply` je Beruf | `select metadata->>'embeddingModel', count(*)` zeigt nur `qwen3-embedding:8b@3072` |
| H5 | Lernkarten einlesen | `HAI_EMBEDDING_PROVIDER=openai-compatible npx tsx scripts/hai-learning-techniques.ts --apply` mit der Production-Verbindung | zwölf Zeilen `learning_technique`, ohne Beruf, Sichtbarkeit `all` |
| H6 | Kontrolle des Index | Zeilen je Quelle und Beruf gegen die Preview vergleichen, Retrieval-Test (20 Enabler auf Rang 1), Suchzeit je Abfrage | gleiche Größenordnung wie Preview (49.372), Rang-1-Quote wie am 31.10. (20 von 20) |
| H7 | Variablen in Vercel (Ziel Production) | `HAI_EMBEDDING_PROVIDER=openai-compatible`, `HAI_CHAT_PROVIDER=openai-compatible`, `HAI_HALFVEC_SEARCH=on` (nur wenn H2 gelaufen ist). Der Sprachassistent bleibt je Organisation aus | danach ein neues Deployment (Variablen gelten erst dann) |
| H8 | Smoketest der HAI in Production | Testplan `docs/hai-testplan.md`, Abschnitte A bis E mit einem FIAE- und einem KfBM-Konto | alle Pflichtfälle bestanden |
| H9 | Beobachten | Vercel-Logs der Routen `/api/hai/*` am ersten Tag, Fehlerhinweise der HAI, Sokrates-Last | keine Fehlerhäufung |

Reihenfolge-Hinweis: H7 erst nach H3 bis H6. Wer die Variablen vorher umstellt, lässt die App mit Qwen-Fragen gegen Gemini-Vektoren suchen. Solange H3 läuft, bleibt der alte Zustand stehen (die Nutzung ist gering, ein Hinweis an die Nutzer genügt).

## 4. Entscheidungen

Von Niko entschieden am 02.11.2026:

1. **Weg:** Die HAI steigt in Production auf Sokrates um, Chat (`gemma4:31b`) und Einbettung (Qwen3-Embedding). Gemini bleibt nicht als Rückfall.
2. **Abhängigkeit von Sokrates akzeptiert:** Fällt der Server aus, antwortet die HAI nicht (kein Fallback auf Gemini, Entscheidung CF1). Die Oberfläche zeigt dann einen Hinweis. Lernen und Abgaben laufen weiter.
3. **PR 183 (preview nach master):** noch nicht. Master wird nach Preview gemergt (PR 237 am 02.11.2026), nicht umgekehrt.

Noch offen:

1. **Go** für H3 (Neuindexierung Production) und H7 (Umstellung der Anbieter), bisher nicht erteilt.
2. **Zeitfenster** für Sokrates mit dem Projekt WAMO (etwa drei Stunden für H3).

### Wird der Index mit dem Rollout übernommen?

Nein. Der Index ist Datenbankinhalt, kein Code. `hai_embeddings` liegt in Production im Schema `public` und in der Preview im Schema `public_preview`, es sind zwei getrennte Tabellen. Der App-Release, die Migrationen und die FIAE-Übertragung (`fiae-content-promote`) ändern die Tabelle `hai_embeddings` in Production nicht. Deshalb braucht Production einen eigenen Lauf (H3).

Eine Abkürzung gibt es nur teilweise. Das Neuindexierungsskript überspringt jede Quelle, deren Textstücke (Quelle, Nummer, `content_hash`) und Modellmarke schon stimmen. Würde man die Zeilen der Preview vorher nach Production kopieren, liefe H3 danach nur noch für die Unterschiede. Das trägt aber nur, wo die Quell-Ids in beiden Schemas gleich sind. Das gilt für den FIAE-Inhalt (Übertragung per Id). Der KfBM-Inhalt kommt per Inhaltsabgleich mit eigenen Ids, dort würden kopierte Zeilen auf falsche Quellen zeigen. Empfehlung: nicht kopieren, H3 vollständig mit Sokrates laufen lassen (rund drei Stunden, wiederaufnehmbar). Eine Kopie nur für FIAE wäre eine spätere Optimierung mit eigener Prüfung.

Persönliche Lernfortschritts-Dokumente: Das Dokument "Lernfortschritt" eines Azubis entsteht nicht in H3 (das Neuindexierungsskript `reindex-gemini.ts` schreibt keine Daten von Nutzern), sondern beim Abgleich über `/api/hai/sync` (`traineeDataIndexer.ts`). Es nimmt seit dem 04.11.2026 dieselben Zahlen wie die Plattform (`progressFigures.ts`, Quiz-Definition, je Beruf) statt der Zeilen von `enabler_completions`. Das war vorher 0 Prozent. Wird der Abgleich nach der Neuindexierung (H3) gestartet, entsteht das Dokument mit den richtigen Zahlen. Bereits indexierte alte Dokumente bleiben bis zum nächsten Abgleich falsch. In diesem Stand wurde weder neu indexiert noch `/api/hai/sync` aufgerufen.

## 5. Rückweg

- **Vor H3:** nichts zu tun, Production ist unverändert.
- **Nach H3, vor H7:** Tabelle aus H1 zurückspielen, die Variablen bleiben auf Gemini.
- **Nach H7:** Variablen zurück auf `gemini` und die Sicherung einspielen. Das geht nur, wenn das Google-Guthaben da ist. Sonst bleibt die HAI aus und die Plattform läuft ohne sie weiter, denn die HAI ist keine Voraussetzung für Lernen und Abgaben.
- Der Index enthält keine Daten der Nutzer. Fehlt er ganz, liefert die HAI Antworten ohne Wissensbezug und sagt es.

## 6. Messungen als Grundlage (Preview, Sokrates)

| Messung | Ergebnis |
|---|---|
| Einbettung Qwen gegen Gemini (400 Fragen, 8.090 Textstücke) | MRR 0,462 bis 0,472 gegen 0,471 |
| Retrieval-Test (20 Enabler beider Berufe) | 20 von 20 auf Rang 1 |
| Golden Set, 98 Fälle, `gemma4:31b` | Antworten 93,1 %, Fremdberuf 100 %, Lösungen verweigern 100 %, themenfremd 100 %, keine Lecks |
| Suche mit Vektorindex | 0,9 s im Mittel gegen 26 s ohne Index |
| Sprachweg (85 Fälle) | keine Lecks, Antworten 88,5 % (Schwelle 90 %) |
