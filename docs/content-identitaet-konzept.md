# Feste Identität und Version für Trainingsinhalte (Entwurf)

Stand: 06.11.2026. Status: Entwurf zur Entscheidung, nichts davon ist umgesetzt. Entstanden aus dem Vorfall beim Produktivgang (`docs/release-lessons-2026-11.md`, Fehler 12 und 13) und einer Recherche mit zwei Auswertungen (Bestandsaufnahme im Code, Architekturentwurf).

## 1. Ausgangsfrage

Idee von Niko: Beim Upload bekommt jeder Inhalt eine Version. Wird derselbe Inhalt erneut hochgeladen, wird geprüft, ob es eine Aktualisierung ist. Dann entsteht eine neue Version, und der Abgleich kann Änderungen sicher erkennen.

**Bewertung:** Der zweite Teil stimmt, der erste reicht nicht. Entscheidend ist, dass beim Upload erkannt wird, **welches bestehende Element** eine Datei ersetzt. Das leistet eine feste **Identität** (ein Code, der sich nie ändert). Eine Versionsnummer allein hätte den Vorfall nicht verhindert: Der Abgleich hätte weiterhin nicht gewusst, welche Zeile die Vorgängerin ist. Die Änderung selbst erkennt man zuverlässiger über einen **Inhalts-Hash** als über eine Nummer, die jemand hochzählen muss. Eine Revisionsnummer lohnt sich nur an einer Stelle: bei Quizzen, zu denen es schon Abgaben von Azubis gibt.

## 2. Was der Code heute tut (Bestand)

| Bereich | Heute |
|---|---|
| Stabile Codes | `courses`, `quizzes`, `training_components`, `learning_fields` (je Katalog und Code), `enablers`, `use_cases` (je Kurs und Code). Bei KfBM gefüllt, bei **FIAE leer** |
| Kein Code | `content_documents`, `questions`, `options`. `order_index` bei Optionen und Fragen ist nicht eindeutig und nullbar |
| Dokument-Hash | `content_documents.content_sha256`, nur durch das Skript `content:hash` befüllt (nur wo leer), nie von Upload oder Import. Verglichen wird nie alt gegen neu derselben Zeile |
| Upload-Pipeline | ordnet über abgeleitete Codes zu (Komponente, Kurs, Enabler, Quiz), Fragen und Optionen über die Position. Ein geänderter Inhalt bekommt den Status `differs`, geschrieben wird nur nach ausdrücklicher Freigabe der Datei. Keine Update-Entscheidung im Review |
| Inhaltsabgleich (`content-sync.mjs`) | kopiert keine Id, findet Zeilen über Textspalten (Dokument: Titel, Dateiname, Typ; Option: Text und Richtigkeit). Legt nur neue Zeilen an |
| FIAE-Übertragung (`fiae-content-promote.mjs`) | findet Dokumente über die **Id** (die Preview wurde aus Production kopiert), ersetzt Quizfragen an Ort und Stelle, bei Abgaben Konflikt |
| HAI-Index | erkennt Änderungen über den Hash des Textstücks, nicht über `content_sha256`. Veraltete Textstücke löscht nur der Reindex. Beim Löschen eines Enabler-Dokuments bleibt der Index stehen |
| "Version" | kommt in Inhaltstabellen nicht vor (nur Dateisuffix `_vN` beim Import, `regulation_version` am Katalog) |

## 3. Empfehlung: stabiler Code plus Inhalts-Hash

Verglichene Varianten: (a) Version plus stabiler Schlüssel, (b) stabiler Code plus Hash, (c) zwei Werkzeuge mit Schutzprüfungen. Empfohlen wird **(b)**: eindeutig, wiederholbar und baut auf dem Muster auf, das KfBM schon nutzt.

### 3.1 Identität
- Jedes Element hat einen `code`, der **nie geändert wird**. Für FIAE werden die Codes einmal aus der Struktur abgeleitet und nachgetragen, in Production über die gemeinsame Id.
- Neu: `content_documents.code` als Platz am Elternteil (zum Beispiel `THEORY`, `EXERCISE-P07`, `UC-TASK`, `UC-SOLUTION`), eindeutig je Elternteil.
- Fragen und Optionen bekommen keinen eigenen Code, sondern werden als **Menge unter ihrem Elternteil** behandelt (Position in `order_index`, danach eindeutig und nicht null).

### 3.2 Erkennen einer Änderung
- Dokumente: `content_sha256` wird **beim Upload gesetzt** und ist für verwaltete Zeilen Pflicht.
- Quizze: ein Hash über alle Fragen und Optionen nach Position.
- Was der Abgleich tut: unverändert nichts, geändert Update an Ort und Stelle (die Id im Ziel bleibt), neu Insert, in der Quelle entfernt nur melden (optional `retired_at`, nie löschen).
- Ein Ersetzen legt **nie** eine zweite Zeile mit demselben Code an. Der Abgleich bricht ab, wenn das passieren würde.

### 3.3 Fragen, Optionen und der Fortschritt der Azubis
- Quiz ohne Abgaben: die Fragen werden in einer Transaktion als Menge ersetzt.
- Quiz **mit** Abgaben: neue Quizzeile mit demselben Code und `revision + 1`. Die alte Zeile verweist auf die neue, Verknüpfungen werden umgehängt, alte Abgaben behalten ihre Fragen.
- Vor jedem Löschen von Fragen oder Optionen prüft der Abgleich `quiz_submission_answers` und bricht ab, wenn es Antworten gibt. Optional zusätzlich `ON DELETE RESTRICT` auf diesen Fremdschlüsseln.

### 3.4 HAI-Index
- Ein geändertes Dokument setzt `is_indexed_by_hai = false`, danach werden genau diese Ids neu eingebettet. Bei einer neuen Quizrevision wird die neue Id eingebettet und die alte entfernt.
- `hai_embeddings.source_id` hat keinen Fremdschlüssel. Der Reindex braucht einen Schritt `--purge-orphans` für Einträge ohne Quellzeile.

### 3.5 Ein Werkzeug
`content-sync.mjs` bleibt (Allowlist, Trockenlauf, Konvergenzprüfung, Anbindung an den Release). `fiae-content-promote.mjs` wird stillgelegt, seine Logik zum Vergleich der Quizze (`decideQuiz`) wird übernommen. Bis dahin gilt: FIAE nur mit `fiae-content-promote.mjs`.

### 3.6 Schutzprüfungen im Werkzeug
Abbruch, wenn eine zweite Zeile mit demselben Schlüssel entstünde, wenn `unmatched` größer 0 ist oder eine Zeile im Umfang keinen Code hat. Der Trockenlauf zählt `inserted`, `updated`, `replaced`, `versioned`, `retired` und `conflicts`.

### 3.7 Tests
Umbenanntes PDF ergibt ein Update statt einer neuen Zeile. Eine umformulierte Option ergibt weiter vier Optionen. Quiz mit Abgabe ergibt eine neue Revision, die Antworten bleiben. Der zweite Trockenlauf meldet null Änderungen. Idealerweise läuft das gegen ein Postgres mit zwei Schemas.

## 4. Phasen und Aufwand

| Phase | Inhalt | Aufwand |
|---|---|---|
| 0 | Bereinigung des 06.11. (Dubletten, ohne Abgaben), FIAE-Lauf des Inhaltsabgleichs ohne `--catalog` sperren, FIAE über `fiae-content-promote` | S |
| 1 | Migration: `content_documents.code`, `quizzes.revision`, `superseded_by_id`, `retired_at`, Code nicht änderbar | M |
| 2 | Codes und Hash in beiden Schemas nachtragen, danach Eindeutigkeit und `content_sha256 not null` | M |
| 3 | `content-sync`: Code als Schlüssel, Update, Ersetzen als Menge, Revision, Schutzprüfungen | L |
| 4 | Upload-Pipeline: Zuordnung über Elterncode und Dokumentcode, Status `differs` führt nach Freigabe zum Update | M |
| 5 | HAI: gezielt neu einbetten, verwaiste Einträge entfernen | S |

Risiken: Der Fortschritt hängt an `enabler_quiz_links.quiz_id`, nach dem Umhängen zählen alte Abgaben nur, wenn die App über den Code zusammenfasst. Der Quiz-Hash muss vorher gegen das Zeitlimit von zwei Minuten gemessen werden. Alte Dateien bleiben im Bucket liegen.

## 5. Entscheidungen für den Owner

1. Code-Schema für FIAE. Codes werden nie geändert.
2. Quiz mit Abgaben: neue Revision (empfohlen) oder wie heute ein Konflikt? Zählen alte Revisionen für den Fortschritt, und wandern offene `quiz_assignments` mit?
3. Aus der Quelle entfernte Inhalte: nur melden, `retired_at` setzen oder löschen?
4. Darf der Release Inhalte ändern? Heute läuft er mit `--update never`.
5. Wird Production direkt bearbeitet? Dann braucht es eine Prüfung auf Abweichungen.
6. `ON DELETE RESTRICT` für die Antworten: ja oder nein?
