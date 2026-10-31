# FIAE-Dokumente aus der Word-Lieferung in die Preview

Stand: 30.10.2026. Das Skript `scripts/import/fiae-documents.mjs` (`npm run import:fiae:documents`) wandelt die Word-Dateien der FIAE-Lieferung (`06-01-26 LFA\FIAE\Komponenten`) in PDF um und ersetzt damit die Dokumente der Enabler und Use Cases in der Preview. Production ist nicht vorgesehen, es gibt kein Ziel dafür.

## Was es tut

| Quelle | Ziel in `content_documents` | Bucket |
| --- | --- | --- |
| Hauptdatei eines Enablers | `THEORY` des Enablers, Zeile wird ersetzt | `content` (öffentlich) |
| Datei in `Szenario parts` | `EXERCISE`, je Teil eine Zeile ("Szenario: Part N: …"), vorhandene Zeile wird ersetzt, ein neuer Teil bekommt eine neue Zeile | `content` (öffentlich) |
| Use Case "mit Lösung" | `TRAINER_SOLUTION` des Use Cases, Zeile wird ersetzt | `content-solutions` (privat, Verweis `private://`) |

**Ersetzen heißt:** Die neue PDF liegt unter einem neuen Pfad `preview/fiae/k<Komponente>/…`, die Zeile zeigt darauf, die alte Datei bleibt im Speicher. Nichts wird gelöscht. Der Bericht (`--out`) nennt die alten Werte jeder Zeile.

**Es legt nie Enabler oder Use Cases an.** Ein Ordner ohne passenden Enabler in der Preview wird gemeldet und ausgelassen.

**Nicht hochgeladen werden:**

- die Komponente `22_Sicherstellen der Qualität von Softwareanwendungen (Vertiefung)` (kommt nach, Entscheidung vom 30.10.2026),
- die Dateien im Unterordner "Ohne Musterlösung": Das sind die Aufgabenfassungen der Use Cases ohne Lösungsteil (am Inhalt geprüft am 30.10.2026, 51 Dateien). Die Musterlösung liegt im Hauptordner Use_Cases. Ob die Aufgabenfassung als Aufgabe für Azubis hochgeladen wird, ist noch nicht entschieden,
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
- Nicht enthalten: Global-Quizze, Komponente 22.

```
npm run import:fiae:quizzes -- plan "<Ordner Komponenten>" --target preview
npm run import:fiae:quizzes -- run  "<Ordner Komponenten>" --target preview --apply --confirm-host <Host> --out bericht.json
npm run import:fiae:quizzes -- rollback bericht.json --target preview --apply --confirm-host <Host>
```

Erster Lauf am 31.10.2026: 188 Enabler gelesen, 146 unverändert, 42 geschrieben (64 Quizze ersetzt, 62 angelegt), danach weitere 9 eigene Quizze für die Komponente 09 (geteilt mit 20), 0 ausgelassen. Folgelauf: 188 unverändert.

