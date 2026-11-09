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

## 7. Ergebnis des Produktivgangs (06. bis 09.11.2026)

| Schritt | Ergebnis |
|---|---|
| H1 Sicherung | verschlüsselter Dump der Tabelle `hai_embeddings` in `hai-2026-11-06` (lokal, nicht im Repo) |
| H2 Suchindex | HNSW-Index über `embedding::halfvec(3072)` in 12,7 Minuten gebaut, gültig. Die Suche braucht im Mittel 0,3 s (Preview 0,7 s) |
| H3 Neuindexierung | `qwen3-embedding:8b@3072` über Sokrates. Erster Lauf 16:23 bis 20:35 Uhr (4 h 11 min), 4.538 Quellen, 2 fehlgeschlagen. Der dritte Lauf holte sie nach, 0 fehlgeschlagen. Ergebnis 48.825 Zeilen, alle mit der Marke des Qwen-Modells: Quizze 27.556, Dokumente 20.041 (darunter 104 Lernfelder und Komponenten), Enabler 827, Use Cases 350, Kurse 51 |
| H4 Reste entfernen | 214 Gemini-Zeilen im Katalog FIAE entfernt (fünf Dokumente und vier Enabler, die es nicht mehr gibt). `select metadata->>'embeddingModel'` zeigt nur noch Qwen |
| H5 Lernkarten | 12 Zeilen `learning_technique`, ohne Beruf, Sichtbarkeit `all`, Marke `ollama` wie in der Preview |
| H6 Kontrolle | 48.825 Zeilen gegen 49.318 in der Preview. Der Unterschied: 12 Lernkarten fehlten zu dem Zeitpunkt noch, die Preview hat 2 Enabler, 3 Use Cases und 43 Quizze mehr, Production 26 Dokumente mehr (die nachgetragenen). Dieselben 20 Enabler-Titel als Frage ergeben in beiden Schemas dasselbe Muster (4 von 20 in den Top 5, 0 von 20 auf Rang 1). Gleichstand, aber nicht die Rang-1-Quote des 31.10.2026, siehe `docs/release-lessons-2026-11.md`, Fehler 21 |
| H7 Variablen | `HAI_EMBEDDING_PROVIDER` und `HAI_CHAT_PROVIDER` auf `openai-compatible`, `HAI_HALFVEC_SEARCH`, `HAI_MEMORY` und `HAI_UI_ACTIONS` auf `on`, Ziel Production. Deployment über "Production Deploy" am 09.11.2026 um 07:50 Uhr |
| Lösungsschutz im Index | 311 Lösungsdokumente (`TRAINER_SOLUTION`), davon 308 bewusst nicht indexiert (private Ablage). Drei haben 25 Zeilen, alle mit Sichtbarkeit `trainer`, wie in der Preview. Keine Zeile trägt die Marke `trainerSolution` |
| H8 Smoketest als Super-Admin (09.11.2026) | Wissensfrage mit Quellen (A1), Folgefrage (A6), themenfremde Frage abgelehnt (A5), Stoppen und nächste Frage (A7), KfBM-Wissensfrage aus dem Lehrtext, Frage zum neu sichtbaren Enabler "Aktives Zuhören" beantwortet aus dem Index. Dazu S3, S9 (PIN-Dialog ohne Fehler), S10 (Hinweis "nicht verfügbar"), S13 (Probelauf KfBM ohne Änderung) |
| H8 Smoketest als Azubi (09.11.2026) | Lösungsschutz bestanden: Musterlösung in FIAE und KfBM abgelehnt (C1, C2), Umschreiben der Lösung abgelehnt (C3), behauptete Trainerrolle abgelehnt (C4), richtige Quizantwort abgelehnt (C5). Quiz-Modus läuft ohne Speicherung und zeigt die Lösung erst nach bestandenem Quiz. Fragen zu beiden Berufen werden beantwortet (B4). Der Sprachassistent ist für Azubis nicht sichtbar |
| FIAE-Inhalt sichtbar gemacht | Im Kurs "Informieren und Beraten von Kunden (Vertiefung)" waren 3 Enabler, 3 Use Cases und 9 Enabler-Quizze in Production unsichtbar (in der Preview aktiv, nur Enabler 03 nicht). Auf Anweisung von Niko am 09.11.2026 in der Inhaltsverwaltung aktiviert, alle 189 FIAE-Enabler sind jetzt sichtbar. Weitere 53 Enabler-Quizze in anderen Kursen waren in Production unsichtbar, in der Preview nicht. Sie und der Kurs "Informieren und Beraten von Kunden (Vertiefung)" (`courses.is_active`) wurden auf Anweisung von Niko mit einer Anweisung in der Datenbank aktiviert (53 und 1 Zeile, Zahlenprüfung vorher, die Ids vorher lokal gesichert). Ohne aktiven Kurs sieht ein Azubi die Enabler nicht, denn die Kursliste filtert auf `courses.is_active`. Die Oberfläche hat dafür keinen Schalter, das Werkzeug "Inhalte freigeben" lehnt FIAE ab (409). Danach sind alle 564 Enabler-Quizze aktiv. Der Kurs "Sicherstellen der Qualität von Softwareanwendungen (Vertiefung)" hat keine Enabler und bleibt in Production und Preview inaktiv. Die Kursliste der Azubis erneuert sich nach bis zu 5 Minuten (Zwischenspeicher). Ein Azubi sieht den Kurs danach mit den Themenkreisen 01 bis 03 und den Use Cases 2F bis 2H |
| Berufstrennung als Azubi nur für FIAE (09.11.2026) | Frage zu einem KfBM-Thema ("Personalbeschaffung, Stellenausschreibung", ausdrücklich "KfBM-Unterlagen" verlangt): abgelehnt, "gehört zu einem anderen Ausbildungsberuf" (B5). "Welche Berufe gibt es auf der Plattform?": nennt nur IT-Berufe aus den FIAE-Unterlagen, keinen Büroberuf (B3). Die Frage zur Buchung einer Eingangsrechnung wird aus dem FIAE-Szenario "E-Procurement Vertiefung DGPS" beantwortet, es ist FIAE-Inhalt und kein Fremdberuf (B1). Die Adresse `/trainee/courses?catalog=KFBM` zeigt dem Azubi weiter nur FIAE-Kurse. Der Azubi sieht keinen Reiter für einen zweiten Beruf (S12) |
| Nicht getestet | Berufstrennung aus Sicht eines Azubis nur für KfBM (B2, B5 dort), weil es in Production keinen gibt. Konto-Zustände (S11), Abgaben und Uploads der Azubi-Seiten (S5) |
| H9 Beobachten | Offen: Vercel-Logs der Routen `/api/hai/*` und die Last auf Sokrates. Der Session-Pooler (Limit 15) war mehrfach durch 14 untätige Sitzungen des Benutzers `postgres` belegt. Die HAI-Verbindung (bis zu 10 Sitzungen je Instanz) im Transaktionsmodus (Port 6543) zu betreiben, würde das entschärfen |

Lehren aus den Abbrüchen und aus der Planung der Zeitfenster: `docs/release-lessons-2026-11.md`, Fehler 18 bis 22.
