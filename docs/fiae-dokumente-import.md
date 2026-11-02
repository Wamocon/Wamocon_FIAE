# FIAE-Dokumente aus der Word-Lieferung in die Preview

Stand: 02.11.2026 (Beschriftung 2.1 und 2.2, beide Ordnernamen, Inhaltsregel für Vertiefungen; 31.10.2026: Aufgabenfassungen ergänzt). Das Skript `scripts/import/fiae-documents.mjs` (`npm run import:fiae:documents`) wandelt die Word-Dateien der FIAE-Lieferung (`06-01-26 LFA\FIAE\Komponenten`) in PDF um und ersetzt damit die Dokumente der Enabler und Use Cases in der Preview. Production ist nicht vorgesehen, es gibt kein Ziel dafür.

## Beschriftung der Komponenten und Ordnernamen (Stand 02.11.2026)

Entscheidung von Niko vom 02.11.2026: FIAE beschriftet die Komponenten wie KfBM (K24.1, K24.2). Die Grundkomponente heißt immer x.1, die Vertiefung immer x.2, und x ist die Reihenfolgenummer (`order_index`) der Grundkomponente. Eine Komponente ohne Vertiefung behält ihre Nummer ohne Zusatz (1, 7, 12, 19, 23, 24, 25, 26).

**Das ist eine reine Beschriftung.** Die Datenbank-Codes und der `order_index` ändern sich nicht, denn die Phasen und die Freischaltung hängen am `order_index`, und der Importer, die Upload-Zuordnung, die Übertragung und der HAI-Index arbeiten mit den Codes. Die App zeigt die Beschriftung über eine zentrale Funktion (`src/lib/catalog/component-label.ts`, nur für FIAE, KfBM und unbekannte Codes bleiben unverändert). In dieser Datei steht "Komponente 13" immer für die Ordnernummer alt, also den `order_index`.

| Beschriftung | Ordnernummer alt (order_index) | Ordnername neu | Code in der Preview | Art |
| --- | --- | --- | --- | --- |
| **1** | 01 | `1_<Titel>` oder `01_<Titel>` | `1-P1` | einzeln |
| **2.1** | 02 | `2.1_<Titel>` | `2-P1` | Grundkomponente |
| **3.1** | 03 | `3.1_<Titel>` | `3-P1` | Grundkomponente |
| **4.1** | 04 | `4.1_<Titel>` | `4-P1` | Grundkomponente |
| **5.1** | 05 | `5.1_<Titel>` | `5-P1` | Grundkomponente |
| **6.1** | 06 | `6.1_<Titel>` | `6-P1` | Grundkomponente |
| **7** | 07 | `7_<Titel>` oder `07_<Titel>` | `7-P1` | einzeln |
| **8.1** | 08 | `8.1_<Titel>` | `8-P1` | Grundkomponente |
| **9.1** | 09 | `9.1_<Titel>` | `10-P1` | Grundkomponente |
| **10.1** | 10 | `10.1_<Titel>` | `AE1-P1` | Grundkomponente |
| **11.1** | 11 | `11.1_<Titel>` | `AE2-P1` | Grundkomponente |
| **12** | 12 | `12_<Titel>` | `INT5-P1` | einzeln |
| **2.2** | 13 | `2.2_<Titel>` | `2-P2` | Vertiefung |
| **3.2** | 14 | `3.2_<Titel>` | `3-P2` | Vertiefung |
| **4.2** | 15 | `4.2_<Titel>` | `4-P2` | Vertiefung |
| **5.2** | 16 | `5.2_<Titel>` | `5-P2` | Vertiefung |
| **6.2** | 17 | `6.2_<Titel>` | `6-P2` | Vertiefung |
| **8.2** | 18 | `8.2_<Titel>` | `8-P2` | Vertiefung |
| **19** | 19 | `19_<Titel>` | `9-P2` | einzeln |
| **9.2** | 20 | `9.2_<Titel>` | `10-P2` | Vertiefung |
| **10.2** | 21 | `10.2_<Titel>` | `AE1-P2` | Vertiefung |
| **11.2** | 22 | `11.2_<Titel>` | `AE2-P2` | Vertiefung |
| **23** | 23 | `23_<Titel>` | `INT1` | einzeln |
| **24** | 24 | `24_<Titel>` | `INT2` | einzeln |
| **25** | 25 | `25_<Titel>` | `INT3` | einzeln |
| **26** | 26 | `26_<Titel>` | `INT4` | einzeln |

Die Codes der Spalte "Code in der Preview" stehen im Seed-Skript `src/scripts/seed-training-data.ts` und in der Preview. Production hat heute andere Codes und bekommt diese mit der Migrationsreihe des Rollouts (Entscheidung von Niko). Eine Migrationsdatei unter `supabase/migrations`, die FIAE-Komponentencodes schreibt, gibt es im Stand vom 02.11.2026 nicht, die Zuordnung der Codes in Production ist also noch zu prüfen. Die Beschriftung richtet sich deshalb zuerst nach dem Code und, wenn der Code unbekannt ist, nach dem `order_index`, damit sie auch bei abweichenden Codes stimmt.

### Beide Ordnernamen werden gelesen

Der Lieferant kann weiter mit den alten Namen liefern (`02_`, `13_`, `09_`, `20_`), Niko benennt die Ordner nach und nach um (`2.1_`, `2.2_`, `9.1_`, `9.2_`). Die gemeinsame Funktion `scripts/import/fiae-component-folder.mjs` wandelt die Nummer am Anfang eines Ordner- oder Dateinamens in den `order_index` um:

- `02_` und `2.1_` ergeben 2, `13_` und `2.2_` ergeben 13, `09_` und `9.1_` ergeben 9, `20_` und `9.2_` ergeben 20. Einzelne Komponenten bleiben unverändert, mit oder ohne führende Null (`1_` und `01_`).
- Beide Schreibweisen dürfen im selben Ordner stehen (zum Beispiel `02_` neben `13_` oder `2.1_` neben `13_`).
- Ein unbekanntes Muster wird mit einer Meldung abgelehnt und nie erraten, zum Beispiel `2.3_`, `13.1_`, `7.1_` oder `27_`. Zwei Ordner für dieselbe Komponente (`02_` und `2.1_`) werden ebenfalls abgelehnt. Der Lauf bricht dann vor jeder Änderung ab.
- Alle drei Importer (Dokumente, Quizze, Global-Quizze) benutzen diese Funktion, auch die Optionen `--components` und `--files` (beide Schreibweisen sind erlaubt, zum Beispiel `--components 2.1,2.2,05`) und die Tabellen `QUIZ_OF_FILE` und `LEFT_OUT` des Global-Quiz-Skripts, die nach Ordnernummer arbeiten.
- Die Berichte und Meldungen nennen die Komponente in der neuen Beschriftung und in Klammern die Ordnernummer, zum Beispiel `2.2 (Ordner 13)`. Die Pfade im Speicher (`preview/fiae/k13/...`) bleiben wie sie waren, damit ein zweiter Lauf die Zeilen wiederfindet.

### Ordner umbenennen (`npm run import:fiae:folder-renumber`)

Das Skript `scripts/import/fiae-folder-renumber.mjs` benennt nur die Komponentenordner direkt unter dem angegebenen Ordner um. Es berührt keine Datei in den Ordnern, nur den Ordnernamen. Einzelne Komponenten und Ordner, die schon den neuen Namen tragen, bleiben unverändert.

```
npm run import:fiae:folder-renumber -- plan     "<Ordner Komponenten>"                       # Standard, ändert nichts, listet alt und neu
npm run import:fiae:folder-renumber -- apply    "<Ordner Komponenten>" --log protokoll.json  # benennt um, schreibt das Protokoll
npm run import:fiae:folder-renumber -- rollback protokoll.json                               # Rückweg mit dem Protokoll
```

- `apply` bricht vor dem ersten Umbenennen ab, wenn eine Nummer unklar ist, zwei Ordner zu einer Komponente gehören, ein Zielname schon existiert (auch in anderer Groß- und Kleinschreibung) oder die Protokolldatei schon da ist.
- Das Protokoll (JSON mit `from` und `to` je Ordner) wird nach jedem einzelnen Umbenennen geschrieben. Ein Lauf, der mittendrin stoppt, lässt sich deshalb mit `rollback` zurückdrehen. `rollback` prüft vorher, dass jeder Ordner da und der alte Name frei ist.
- Das Protokoll gehört nicht in den Ordner der Lieferung.
- Tests: `tests/scripts/import/fiae-folder-renumber.test.mjs` (Wegwerf-Ordner).

## Inhaltsregel: jede Vertiefung hat einen eigenen Enabler (Stand 02.11.2026)

Regel von Niko: Jede Vertiefung bekommt einen eigenen Enabler, der sich vom Grundkurs unterscheidet, und deshalb auch ein eigenes Szenario. **Eine byte-gleiche Kopie des Grundkurses in einer Vertiefung ist kein gültiger Inhalt.**

Bekannt am 02.11.2026 (Ordnernummer alt, Nummer des Enablers):

| Vertiefung | Kopie des Grundkurses |
| --- | --- |
| Komponente 22 (11.2) | Enabler 01 bis 04 |
| Komponente 18 (8.2) | Enabler 01, 04, 05, 09, 13 |
| Komponente 14 (3.2) | Enabler 02 und 03 |

Das Prüfwerkzeug vergleicht die Hauptdatei jedes Vertiefungs-Enablers (SHA-256) mit den Hauptdateien der Enabler der Grundkomponente desselben Paares. Ein Treffer ist die Warnung "Kopie des Grundkurses". Der Plan der Dokumente (`plan` und Probelauf von `run`) weist die Treffer im Bericht aus (Feld `gaps.copiesOfBase`, dazu Zeilen in der Ausgabe), ändert den Lauf aber nicht: Die Datei wird weiter wie jede gelieferte Datei behandelt. Ein Treffer bedeutet, dass der Lieferant einen eigenen Inhalt nachliefern muss.

```
npm run import:fiae:copy-check -- "<Ordner Komponenten>"   # nur lesen, ohne Datenbank, Ausgabe 1 bei Kopien, 0 ohne
```

Geprüft wird die Hauptdatei des Enablers. Ob ein eigenes Szenario dazugehört, zeigt der Vergleich der Teile in `Szenario parts` nicht an, das bleibt eine Sichtprüfung. Tests: `tests/scripts/import/fiae-copy-check.test.mjs`.

## Was es tut

| Quelle | Ziel in `content_documents` | Bucket |
| --- | --- | --- |
| Hauptdatei eines Enablers | `THEORY` des Enablers, Zeile wird ersetzt | `content` (öffentlich) |
| Datei in `Szenario parts` | `EXERCISE`, je Teil eine Zeile ("Szenario: Part N: …"), vorhandene Zeile wird ersetzt, ein neuer Teil bekommt eine neue Zeile | `content` (öffentlich) |
| Use Case "mit Lösung" | `TRAINER_SOLUTION` des Use Cases, Zeile wird ersetzt | `content-solutions` (privat, Verweis `private://`) |
| Aufgabenfassung im Unterordner "Ohne Musterlösung" | `TRAINEE_QUESTION` des Use Cases, Zeile wird ersetzt oder neu angelegt, `visibility` ALL | `content` (öffentlich) |

**Ersetzen heißt:** Die neue PDF liegt unter einem neuen Pfad `preview/fiae/k<Komponente>/…`, die Zeile zeigt darauf, die alte Datei bleibt im Speicher. Nichts wird gelöscht. Der Bericht (`--out`) nennt die alten Werte jeder Zeile.

**Es legt nie Enabler oder Use Cases an.** Ein Ordner ohne passenden Enabler in der Preview wird gemeldet und ausgelassen.

**Nicht hochgeladen werden:**

- die Komponente `22_Sicherstellen der Qualität von Softwareanwendungen (Vertiefung)` (kommt nach, Entscheidung vom 30.10.2026),
- Quizze (nicht Teil der Lieferung, die vorhandenen bleiben den Enablern zugeordnet),
- Dateien, die zwei Use Cases gleichzeitig treffen würden oder deren Name nicht lesbar ist (werden gemeldet).

## Zuordnung

- **Komponente zu Kurs:** nach dem Titel, bei Eltern und Vertiefung mit demselben Titel entscheidet die Nummer (13 bis 18 und 20 bis 22 sind Vertiefung, also die Beschriftungen x.2). Der Ordnername darf alt (`02_`, `13_`) oder neu (`2.1_`, `2.2_`) geschrieben sein. Ordnet sich ein Ordner nicht eindeutig zu, bricht der Lauf ab.
- **Enabler:** nach der Ähnlichkeit des Titels innerhalb des Kurses. Bleiben höchstens drei Ordner und gleich viele Enabler übrig (verkürzte Ordnernamen), gelten sie in der Reihenfolge der Nummern.
- **Use Case:** nach Nummer und Buchstabe im Dateinamen ("1a_…", "Use Case_4b_…"), sonst nach dem Buchstaben allein, wenn nur ein Use Case des Kurses ihn trägt.

## Aufruf

```
npm run import:fiae:documents -- plan "<Ordner Komponenten>" --target preview
npm run import:fiae:documents -- run  "<Ordner Komponenten>" --target preview            # Probelauf
npm run import:fiae:documents -- run  "<Ordner Komponenten>" --target preview --apply \
    --confirm-host <Host der Datenbank> --confirm-storage-host <Host des Speichers> \
    --created-by <Profil des Superadmins> --out bericht.json
npm run import:fiae:documents -- rollback bericht.json --target preview [--apply] --confirm-host <Host>
```

Weitere Schalter: `--components 05,13` oder `--components 2.1,2.2` (nur diese Komponenten, beide Schreibweisen), `--limit N` (nur die ersten N Dateien), `--soffice <Pfad>` (LibreOffice).

Die Verbindung kommt aus `DB_CONNECTION_STRING` (Rolle `app_preview_migrator`), der Speicher aus `NEXT_PUBLIC_SUPABASE_URL` und `SUPABASE_SECRET_KEY`, alles aus der Umgebung. Das Skript gibt keinen Schlüssel, keine Verbindung und keinen Dateiinhalt aus.

## Ablauf und Schutz

- Ohne `--apply` wird nichts umgewandelt und nichts gespeichert.
- Ein echter Lauf braucht `--confirm-host` und `--confirm-storage-host` und die Datenbankrolle der Preview.
- Je Komponente werden zuerst die PDFs gespeichert (LibreOffice, eigenes Profil, Metadaten wie Autor werden entfernt), danach schreibt eine Transaktion die Zeilen. Ein Fehler in einer Datei lässt diese aus und wird im Bericht genannt, die anderen laufen weiter.
- Ein zweiter Lauf findet die Zeilen mit dem neuen Pfad und schreibt nichts mehr.
- Die Dateien sind höchstens 45 MB groß, größere werden gemeldet.

## Zurückdrehen

`rollback bericht.json --apply` schreibt die alten Werte (Dateiname, Größe, Adresse, Pfad, Seitenzahl) in die ersetzten Zeilen zurück und entfernt die neu angelegten Zeilen. Die neuen Dateien bleiben im Speicher liegen, nichts zeigt mehr darauf.

## Hinweise

- Die HAI-Suche kennt die neuen Texte erst nach einer Neuindexierung der Preview.
- Die Vertiefungs-Enabler sind teilweise byte-gleiche Kopien der Original-Enabler (Betreiben 5 von 13, Beurteilen 2 von 4, Sicherstellen der Qualität 4 von 4). Das ist nach der Inhaltsregel oben kein gültiger Inhalt. Der Importer meldet sie als Warnung "Kopie des Grundkurses", behandelt sie aber wie gelieferte Dateien.
- Tests: `tests/scripts/import/fiae-documents.test.mjs`.

## Quizze (`npm run import:fiae:quizzes`)

Stand 31.10.2026. Das Skript `scripts/import/fiae-quizzes.mjs` liest die Quizze der Lieferung (`Enablers\<Enabler>\Quiz\QUIZ_FR-nnn_light|medium|hard.docx`) und gleicht sie mit den Quizzen der Preview ab (LOW, MEDIUM, HIGH je Enabler). Gleiche Fragen und gleiche richtige Antworten heißen: nichts zu tun. Hat ein Enabler ein geändertes oder fehlendes Quiz, bekommt er alle drei aus der Lieferung.

- Ein vorhandenes Quiz behält Zeile und Verknüpfung, seine Fragen und Optionen werden ersetzt (Testantworten auf den alten Fragen entfallen dabei).
- Ein fehlendes Quiz wird angelegt und verknüpft.
- Ein Quiz, das mehrere Enabler teilen (Vertiefung kopiert den Grundkurs), wird für keinen von ihnen geändert: der Enabler bekommt ein eigenes Quiz, seine Verknüpfung wird umgehängt.
- Eine Frage wird nur gelesen, wenn sie einen Text, mindestens zwei Optionen und genau eine klare richtige Antwort hat ("Richtige Antwort: B" oder Haken an der Option). Sonst wird der ganze Enabler ausgelassen und gemeldet.
- Nicht enthalten: Global-Quizze (eigenes Skript, siehe unten), Komponente 22.

```
npm run import:fiae:quizzes -- plan "<Ordner Komponenten>" --target preview
npm run import:fiae:quizzes -- run  "<Ordner Komponenten>" --target preview --apply --confirm-host <Host> --out bericht.json
npm run import:fiae:quizzes -- rollback bericht.json --target preview --apply --confirm-host <Host>
```

Erster Lauf am 31.10.2026: 188 Enabler gelesen, 146 unverändert, 42 geschrieben (64 Quizze ersetzt, 62 angelegt), danach weitere 9 eigene Quizze für die Komponente 09 (geteilt mit 20), 0 ausgelassen. Folgelauf: 188 unverändert.


Aufgabenfassungen: Eine Datei, die einen Lösungsteil trägt (Absatz mit "Musterlösung" oder "Lösung"), wird nicht hochgeladen und gemeldet. Erster Lauf am 31.10.2026: 46 Dateien (40 ersetzt, 6 neu), 5 nicht zuordenbar (24d, 23a und 26a doppelt für 26_), Komponente 22 kommt nach.

## Global-Quizze (`npm run import:fiae:global-quizzes`)

Stand 31.10.2026. Das Skript `scripts/import/fiae-global-quizzes.mjs` liest die Dateien `<nn>_...\Global_Quiz\Global_Quiz.docx` (Parser `scripts/import/fiae-global-quiz-parse.mjs`) und gleicht sie mit den 22 Global-Quizzen der Preview ab. Die Preview hat ein Quiz je Themengebiet (§ 4 ...), die Lieferung eine Datei je Komponente. Deshalb gibt es 26 Komponenten und 22 Quizze: Informieren (Nr. 2), Beurteilen (Nr. 3), Betreiben (Nr. 8) und Sicherstellen der Qualität (AE2) haben ein gemeinsames Quiz für das erste und zweite Jahr. Die Quizze sind bei FIAE nicht mit einer Komponente verknüpft (anders als bei KfBM).

- Die Dateien haben rund zehn Layouts (Chat-Exporte). Die richtige Antwort steht als Zeile "Lösung: B" oder "Korrekte Antwort: B", als Haken oder als fette Option. Eine Frage wird nur gelesen, wenn sie einen Text, Optionen A, B, C ... in Reihenfolge und genau eine klare richtige Antwort hat. Alles andere wird gemeldet und nicht geraten (keine Antwort, zwei Antworten, Widerspruch zwischen fetter Option und Antwortzeile, kaputte Zeile in einer Option). Eine zurückgezogene Frage ("Note: ... I will replace it") wird übersprungen.
- Je Quiz: **same** (alles gleich, nichts zu tun), **replace** (Datei vollständig gelesen und anders: Fragen und Optionen werden ersetzt) oder **patch** (einzelne Fragen der Datei nicht lesbar: nur die lesbaren werden genutzt, eine vorhandene Frage bekommt Optionen und Antwort der Datei, eine neue wird angehängt, alle anderen Fragen bleiben). Liegen Testantworten auf einer Frage, die sich ändern würde, wird das Quiz nicht angefasst.
- Es wird kein Quiz angelegt oder gelöscht. Nicht übernommen werden die Dateien 14, 18 und 22 (byte-gleiche Kopien von 03, 08 und 11 für das zweite Jahr, Entscheidung offen), 09 (die Fragen stammen aus den Enablern FR-726 bis FR-731, Netzwerk und Speicher, nicht aus Programmieren) und 13 (fehlt in der Lieferung).

```
npm run import:fiae:global-quizzes -- plan "<Ordner Komponenten>" --target preview
npm run import:fiae:global-quizzes -- run  "<Ordner Komponenten>" --target preview --apply --confirm-host <Host> --out bericht.json
npm run import:fiae:global-quizzes -- rollback bericht.json --target preview --apply --confirm-host <Host>
```

Erster Lauf am 31.10.2026: 21 Dateien gelesen, 12 unverändert, 9 Quizze geändert (4 ersetzt, 5 ergänzt), danach zeigt der Plan 21 von 21 unverändert. Der Bericht enthält die alten Fragen für den Rückbau. Dabei ist aufgefallen: Das Preview-Quiz "Erbringen der Leistungen" enthielt die 166 Fragen von "Berufsbildung" und hat jetzt die 50 eigenen Fragen. Im Quiz "Beurteilen" haben 28 Fragen eine andere richtige Antwort, die Belegsätze der Datei stützen die neuen Antworten.

Offen in der Lieferung (nicht lesbar, die Preview behält ihre bisherigen Fragen): Datei 03 mit 19 Fragen ohne markierte Antwort, Datei 20 mit 14 Fragen (keine Antwort oder kaputte Option), Dateien 10 und 21 mit je einer Frage mit widersprüchlicher Antwort, Datei 16 mit einer Frage mit Widerspruch, Datei 01 mit einer Frage ohne Antwort, Datei 08 und 23 mit je 1 und 2 kaputten Optionen. In der Preview bleiben deshalb 8 Fragen mit zwei richtigen Optionen aus dem alten Import stehen (im Quiz "Berufsbildung" 3, in den beiden Programmieren-Quizzen je 2 DTD- und TDD-Frage und 1 Roboter-Frage). Tests: `tests/scripts/import/fiae-global-quizzes.test.mjs`.
