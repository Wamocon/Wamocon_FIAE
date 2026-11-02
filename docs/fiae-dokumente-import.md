# FIAE-Dokumente aus der Word-Lieferung in die Preview

Stand: 02.11.2026 (finale Beschriftung mit 17 Nummern, zwei Schemata der Ordnernummern, Inhaltsregel für Vertiefungen; 31.10.2026: Aufgabenfassungen ergänzt). Das Skript `scripts/import/fiae-documents.mjs` (`npm run import:fiae:documents`) wandelt die Word-Dateien der FIAE-Lieferung (`06-01-26 LFA\FIAE\Komponenten`) in PDF um und ersetzt damit die Dokumente der Enabler und Use Cases in der Preview. Production ist nicht vorgesehen, es gibt kein Ziel dafür.

## Beschriftung der Komponenten und Ordnernamen (finaler Stand 02.11.2026)

Entscheidung von Niko vom 02.11.2026, final: FIAE beschriftet die Komponenten wie KfBM (K24.1, K24.2). Die Grundkomponente eines Paares heißt immer x.1, die Vertiefung immer x.2, und x ist die Reihenfolgenummer (`order_index`) der Grundkomponente. Die Einzelkomponenten werden fortlaufend weiternummeriert, damit es 17 Komponenten gibt: 1, 7, 12 und dann 13 bis 17 (die Komponenten mit dem `order_index` 19, 23, 24, 25 und 26). Paare sind 2, 3, 4, 5, 6, 8, 9, 10 und 11.

**Das ist eine reine Beschriftung.** Die Datenbank-Codes und der `order_index` ändern sich nicht, denn die Phasen und die Freischaltung hängen am `order_index`, und der Importer, die Upload-Zuordnung, die Übertragung und der HAI-Index arbeiten mit den Codes. Die App zeigt die Beschriftung über eine zentrale Funktion (`src/lib/catalog/component-label.ts`, nur für FIAE, KfBM und unbekannte Codes bleiben unverändert). In dieser Datei steht "Komponente 13" ohne weiteren Zusatz immer für den `order_index` 13 (die Vertiefung 2.2), nie für die Beschriftung 13 (Speicherlösungen, `order_index` 19). Dasselbe gilt für die Dateinummern und Ordnernummern der älteren Abschnitte unten (zum Beispiel "Dateien 14, 18 und 22" oder "26_"), sie stammen aus der Zeit des alten Schemas.

| order_index (Nummer alt) | Beschriftung neu | Ordnername im finalen Stand | Thema | Code in der Preview | Art |
| --- | --- | --- | --- | --- | --- |
| 01 | **1** | `01_<Titel>` | Planen, Vorbereiten und Durchführen von Arbeitsaufgaben | `1-P1` | einzeln |
| 02 | **2.1** | `02.1_<Titel>` | Informieren und Beraten von Kunden | `2-P1` | Grundkomponente |
| 03 | **3.1** | `03.1_<Titel>` | Beurteilen marktgängiger IT-Systeme | `3-P1` | Grundkomponente |
| 04 | **4.1** | `04.1_<Titel>` | Entwickeln, Erstellen und Betreuen | `4-P1` | Grundkomponente |
| 05 | **5.1** | `05.1_<Titel>` | Durchführen und Dokumentieren von Maßnahmen | `5-P1` | Grundkomponente |
| 06 | **6.1** | `06.1_<Titel>` | Umsetzen, Integrieren und Prüfen von Maßnahmen | `6-P1` | Grundkomponente |
| 07 | **7** | `07_<Titel>` | Erbringen der Leistungen und Auftragsabschluss | `7-P1` | einzeln |
| 08 | **8.1** | `08.1_<Titel>` | Betreiben von IT-Systemen | `8-P1` | Grundkomponente |
| 09 | **9.1** | `09.1_<Titel>` | Programmieren von Softwarelösungen | `10-P1` | Grundkomponente |
| 10 | **10.1** | `10.1_<Titel>` | Konzipieren und Umsetzen von Softwareanwendungen | `AE1-P1` | Grundkomponente |
| 11 | **11.1** | `11.1_<Titel>` | Sicherstellen der Qualität von Softwareanwendungen | `AE2-P1` | Grundkomponente |
| 12 | **12** | `12_<Titel>` | Vernetztes Zusammenarbeiten unter Nutzung digitaler Medien | `INT5-P1` | einzeln |
| 13 | **2.2** | `02.2_<Titel>` | Informieren und Beraten von Kunden (Vertiefung) | `2-P2` | Vertiefung |
| 14 | **3.2** | `03.2_<Titel>` | Beurteilen marktgängiger IT-Systeme (Vertiefung) | `3-P2` | Vertiefung |
| 15 | **4.2** | `04.2_<Titel>` | Entwickeln, Erstellen und Betreuen (Vertiefung) | `4-P2` | Vertiefung |
| 16 | **5.2** | `05.2_<Titel>` | Durchführen und Dokumentieren von Maßnahmen (Vertiefung) | `5-P2` | Vertiefung |
| 17 | **6.2** | `06.2_<Titel>` | Umsetzen, Integrieren und Prüfen von Maßnahmen (Vertiefung) | `6-P2` | Vertiefung |
| 18 | **8.2** | `08.2_<Titel>` | Betreiben von IT-Systemen (Vertiefung) | `8-P2` | Vertiefung |
| 19 | **13** | `13_<Titel>` | Inbetriebnehmen von Speicherlösungen | `9-P2` | einzeln |
| 20 | **9.2** | `09.2_<Titel>` | Programmieren von Softwarelösungen (Vertiefung) | `10-P2` | Vertiefung |
| 21 | **10.2** | `10.2_<Titel>` | Konzipieren und Umsetzen von Softwareanwendungen (Vertiefung) | `AE1-P2` | Vertiefung |
| 22 | **11.2** | `11.2_<Titel>` | Sicherstellen der Qualität von Softwareanwendungen (Vertiefung) | `AE2-P2` | Vertiefung |
| 23 | **14** | `14_<Titel>` | Berufsausbildung, Arbeits- und Tarifrecht | `INT1` | einzeln |
| 24 | **15** | `15_<Titel>` | Aufbau und Organisation des Ausbildungsbetriebes | `INT2` | einzeln |
| 25 | **16** | `16_<Titel>` | Sicherheit und Gesundheitsschutz bei der Arbeit | `INT3` | einzeln |
| 26 | **17** | `17_<Titel>` | Umweltschutz | `INT4` | einzeln |

Die Ordner der Lieferung vom 02.11.2026 heißen schon so: zweistellig mit führender Null, die Punktschreibweise für die Paare (`02.1_`, `02.2_`, `09.1_`, `09.2_`).

Die Codes der Spalte "Code in der Preview" stehen im Seed-Skript `src/scripts/seed-training-data.ts` und in der Preview. Production hat heute andere Codes und bekommt diese mit der Migrationsreihe des Rollouts (Entscheidung von Niko). Eine Migrationsdatei unter `supabase/migrations`, die FIAE-Komponentencodes schreibt, gibt es im Stand vom 02.11.2026 nicht, die Zuordnung der Codes in Production ist also noch zu prüfen. Die Beschriftung richtet sich deshalb zuerst nach dem Code und, wenn der Code unbekannt ist, nach dem `order_index`, damit sie auch bei abweichenden Codes stimmt.

### Zwei Schemata der Ordnernummern, Erkennung je Lieferordner

Es gibt zwei Schreibweisen der Ordnernummer, die sich bei einfachen Nummern widersprechen. Der Lieferant kann weiter im alten Schema liefern.

- **ALT:** 26 Ordner `01_` bis `26_`, die Nummer ist der `order_index`. `13_` ist die Vertiefung von 2, `19_` sind die Speicherlösungen.
- **NEU (final):** die Punktschreibweise für die Paare (`02.1_` Grundkomponente, `02.2_` Vertiefung, mit oder ohne führende Null) und die einzelnen Komponenten mit den Nummern 1, 7, 12, 13, 14, 15, 16, 17. `13_` sind hier die Speicherlösungen (`order_index` 19).

Die Funktion `scripts/import/fiae-component-folder.mjs` erkennt das Schema für den ganzen Lieferordner: Enthält mindestens ein Komponentenordner die Punktschreibweise (x.1 oder x.2), gilt NEU, sonst ALT. Danach wandelt sie die Nummer am Anfang jedes Ordnernamens in den `order_index` um:

- ALT: `02_` ist 2, `13_` ist 13, `19_` ist 19 (1 bis 26, mit oder ohne führende Null).
- NEU: `02.1_` ist 2, `02.2_` ist 13, `09.2_` ist 20, `13_` ist 19, `14_` ist 23, `17_` ist 26, `01_`, `07_`, `12_` bleiben.
- Im NEU-Schema sind als einfache Nummern nur 1, 7, 12, 13, 14, 15, 16, 17 erlaubt. Eine einfache 2 oder 9, eine Nummer von 18 bis 26 (eine Mischung beider Schemata) und Muster wie `2.3_`, `13.1_` oder `7.1_` werden mit einer Meldung abgelehnt, nie erraten. Eine Mischung, die sich nur an einer Nummer zeigt, die in beiden Schemata erlaubt ist (zum Beispiel ein `13_` der alten Vertiefung neben `02.1_`), lässt sich nicht erkennen: Solche Ordner gehören nicht in einen Lieferordner des neuen Schemas.
- Zwei Ordner für dieselbe Komponente werden ebenfalls abgelehnt. Der Lauf bricht dann vor jeder Änderung ab.
- Alle drei Importer (Dokumente, Quizze, Global-Quizze) benutzen diese Funktion. Die Optionen `--components` und `--files` nehmen die Nummern wie geschrieben und lösen sie im Schema des Lieferordners auf (Punktschreibweise geht immer, zum Beispiel `--components 2.1,2.2,17`, eine einfache Zahl gilt im neuen Schema als Beschriftung, im alten als `order_index`). Die Tabellen `QUIZ_OF_FILE` und `LEFT_OUT` des Global-Quiz-Skripts arbeiten nach dem `order_index`, die Umrechnung läuft über die Ordnerfunktion.
- Die Berichte und Meldungen nennen die Komponente in der neuen Beschriftung und in Klammern die Ordnernummer des Lieferordners, zum Beispiel `2.2 (Ordner 02.2)` im neuen und `2.2 (Ordner 13)` im alten Schema, `13 (Ordner 13)` beziehungsweise `13 (Ordner 19)` für die Speicherlösungen. Die Pfade im Speicher (`preview/fiae/k13/...`) bleiben wie sie waren (Schlüssel ist der `order_index`), damit ein zweiter Lauf die Zeilen wiederfindet.

### Ordner umbenennen (`npm run import:fiae:folder-renumber`)

Das Skript `scripts/import/fiae-folder-renumber.mjs` bringt einen Lieferordner im alten Schema auf den finalen Stand (zweistellig mit führender Null, Punktschreibweise für die Paare, Einzelne 19 zu 13, 23 zu 14, 24 zu 15, 25 zu 16, 26 zu 17). Es dient für spätere Lieferungen im alten Schema, der Ordner vom 02.11.2026 ist schon umgestellt. Ein Lieferordner im neuen Schema bleibt unverändert. Das Skript benennt nur die Komponentenordner direkt unter dem angegebenen Ordner um und berührt keine Datei in den Ordnern.

```
npm run import:fiae:folder-renumber -- plan     "<Ordner Komponenten>"                       # Standard, ändert nichts, listet alt und neu
npm run import:fiae:folder-renumber -- apply    "<Ordner Komponenten>" --log protokoll.json  # benennt um, schreibt das Protokoll
npm run import:fiae:folder-renumber -- rollback protokoll.json                               # Rückweg mit dem Protokoll
```

- `apply` bricht vor dem ersten Umbenennen ab, wenn eine Nummer unklar ist, die Schemata gemischt sind, zwei Ordner zu einer Komponente gehören, ein Zielname schon existiert (auch in anderer Groß- und Kleinschreibung) oder die Protokolldatei schon da ist.
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

- **Komponente zu Kurs:** nach dem Titel, bei Eltern und Vertiefung mit demselben Titel entscheidet die Nummer (13 bis 18 und 20 bis 22 sind Vertiefung, also die Beschriftungen x.2). Der Lieferordner darf im alten (`02_`, `13_`) oder im neuen Schema (`02.1_`, `02.2_`) benannt sein. Ordnet sich ein Ordner nicht eindeutig zu, bricht der Lauf ab.
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

Weitere Schalter: `--components 05,13` (alt) oder `--components 2.1,2.2,17` (nur diese Komponenten, Nummern im Schema des Lieferordners), `--limit N` (nur die ersten N Dateien), `--soffice <Pfad>` (LibreOffice).

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
