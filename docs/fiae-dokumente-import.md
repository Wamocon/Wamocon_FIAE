# FIAE-Dokumente aus der Word-Lieferung in die Preview

Stand: 31.10.2026 (Aufgabenfassungen ergänzt). Das Skript `scripts/import/fiae-documents.mjs` (`npm run import:fiae:documents`) wandelt die Word-Dateien der FIAE-Lieferung (`06-01-26 LFA\FIAE\Komponenten`) in PDF um und ersetzt damit die Dokumente der Enabler und Use Cases in der Preview. Production ist nicht vorgesehen, es gibt kein Ziel dafür.

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

- **Komponente zu Kurs:** nach dem Titel, bei Eltern und Vertiefung mit demselben Titel entscheidet die Nummer (13 bis 18 und 20 bis 22 sind Vertiefung). Ordnet sich ein Ordner nicht eindeutig zu, bricht der Lauf ab.
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

Weitere Schalter: `--components 05,13` (nur diese Komponenten), `--limit N` (nur die ersten N Dateien), `--soffice <Pfad>` (LibreOffice).

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
- Die Vertiefungs-Enabler sind teilweise byte-gleiche Kopien der Original-Enabler (Betreiben 5 von 13, Beurteilen 2 von 4). Sie werden wie gelieferte Dateien behandelt.
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
