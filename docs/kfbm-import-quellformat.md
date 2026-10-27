# KfBM-Inhaltsimport: Quellformat, Parser und Prüfläufe

Stand: 27.10.2026. Dieses Paket ist Phase 4.0 (Inventur) und 4.3 (Parser) des KfBM-Umbaus, ergänzt um den Parser der Use Cases (Phase 4.6). Es **liest nur**. Es schreibt nichts in eine Datenbank, ruft kein Netzwerk und kein Modell auf und ändert keine Quelldatei. Das Schreiben (Phase 4.4 und 4.6) steht im Runbook `docs/kfbm-import-runbook.md` (Plan, Prüfung, Probelauf, Apply) und baut auf diesen Funktionen auf.

## Quelle

Die Inhalte liegen im OneDrive von Niko, Ordner `06-01-25 WMC-KfBM`, Unterordner `Komponente`. Sie werden nie ins Repository kopiert. Die Tests nutzen nur erfundene Beispiele.

```
Komponente/
  00_Global_Quizze/          Übersicht (.md), Unterordner Word und PDF
  Komponente - während der gesamten Ausbildung/   K20 bis K23
  Komponente Teil 1 (1-15 Monate)/                K1 bis K7, K24.1, K25.1
  Komponente Teil 2 (16-36 Monate)/               K6.2, K8 bis K19, K24.2, K25.2
    <NN> - <Titel> (§ 4 Abs. x Nr. y)/            ein Ordner je Komponente
      Enablers/ (oder Enabler/)
        <Enabler-Ordner>/                         zum Beispiel 1a_..., 20b) ..., 24_1a_...
          <Buchstabe>.docx                        Lehrtext, bis 12 MB wegen Bildern
          Quiz/<Buchstabe>_Quiz_Low|Medium|High.docx
          Szenario/Szenario_<Buchstabe>[_Titel].docx
      K<N>_Use-Cases/ (oder K<N>_Use-Case/)       Use Cases (UC_<Buchstabe>_..., ein Word je Enabler)
        Ohne Musterlösung/                        (nur K5) Fassung eines Use Cases ohne Musterlösung
        Enabler/                                  (nur K21) Lehrtexte, die hier fälschlich liegen
      Global Quiz/                                Global-Quiz der Komponenten 1 bis 5
```

Regeln für die Ableitung (`src/lib/content-import/path-info.ts`):

- **Gruppe**: aus dem obersten Ordner (`global`, `teil1`, `teil2`, `ganze`). K10 bis K19 im Ordner Teil 2 zählen als `wahl`. K18 ist nicht Teil des Imports (`excluded`).
- **Komponente**: aus dem Komponentenordner: Nummer, optional Teilung (`06.1`, `24.2`), Titel, Paragraf. Schlüssel `06.1`, Kurzcode `K6.1`.
- **Enabler**: Buchstabe aus dem Enabler-Ordner (`1a_`, `20b)`, `24_1a_`, `25d)`), Schlüssel aus Nummer, Teilung und Buchstabe (`1a`, `6.2d`, `24.1a`), Code `K6.2-d`. Die Teilung kommt aus dem Komponentenordner, weil Ordner wie `6d_` sie weglassen.
- **Typ**: `enabler`, `quiz` (Stufe low, medium, high), `scenario`, `use-case`, `global-quiz`, `overview`, `pdf` (PDF der Global-Quizze), `archive`, `other`.
- **Archiv**: Ordner oder Dateien mit dem ganzen Wort `Archiv` oder `to_delete` (zum Beispiel `Enabler_Archiv_to_delete`, `6f_Old_To_Delete.docx`), auch im Use-Case-Ordner. Ein Thema wie `Archivierung` ist kein Archiv.
- **Schlüssel**: `enabler:1a`, `quiz:1a:low`, `scenario:1a`, `use-case:1a`, `global-quiz:06.1`, `pdf:global-quiz:06.1`. Haben mehrere Dateien denselben Schlüssel, sind es Dubletten. Ein Versionszusatz `_v2` im Dateinamen wird als `version` gelesen.
- **Auffälligkeiten** (`issues`): Pfad passt nicht zum Schema (`unknown-group`, `unknown-component-folder`, `enabler-folder-unrecognized`, `file-name-unrecognized`, `letter-mismatch`, `component-mismatch`, `unexpected-format`, `unexpected-folder`, `unexpected-depth`). Hinweise ohne Fehler (`flags`): `misplaced` (Szenario neben dem Lehrtext, Lehrtext im Use-Case-Ordner), `name-variant` (Szenario im Ordner `Szenario`, das wie sein Enabler heißt, zum Beispiel `14i.docx`), `version`, `without-solution` (ein Use Case in einem Unterordner `Ohne Musterlösung`).

## Dateiformat der Quizze

Enabler-Quiz (`1b_Quiz_Low.docx`), je Absatz:

| Absatz   | Inhalt                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| 1        | Überschrift `1b) Titel` (Enabler-Code, Klammer, Titel)                                                      |
| 2        | `Quiz, Schwierigkeitsgrad: leicht` (leicht, mittel, anspruchsvoll)                                          |
| je Frage | `1. Frage?` (fett), vier Absätze `A) ...` bis `D) ...`, `Richtige Antwort: B` (fett), `Kurzbegründung: ...` |

Global-Quiz (20 Fragen, 1 bis 5 leicht, 6 bis 15 mittel, 16 bis 20 anspruchsvoll): Überschrift `06.1) Titel (§ 4 Abs. 2 Nr. 6)`, dann der Absatz `Global Quiz`, danach die Fragen im selben Format. Es gibt keine Zeile mit Schwierigkeitsgrad.

Der Parser `parseQuizText` (`src/lib/content-import/source-parsers.ts`) nimmt Klartext (eine Zeile je Absatz, `**...**` markiert fett) oder eine Absatzliste. Er wirft nie einen Fehler auf schlechten Inhalt, sondern liefert den bestmöglichen Wert und eine Liste von Befunden (`ParseResult`: `value`, `issues`, `ok`). `ok` ist wahr, wenn kein Befund die Art `error` hat. Weiche Zeilenumbrüche im Absatz werden zu eigenen Zeilen.

| Code                                                  | Art                                  | Bedeutung                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HEADING_MISSING`, `HEADING_FORMAT`                   | Fehler                               | Überschrift fehlt oder trägt keinen Code                                                                                                                               |
| `HEADING_VARIANT`                                     | Hinweis                              | andere Anrede, zum Beispiel `Quiz 1b: Titel`, `25/1b) Titel` (Schrägstrich statt Punkt in der Teilung) oder bei einem Global-Quiz der Paragraf auf einer eigenen Zeile |
| `DIFFICULTY_MISSING`, `DIFFICULTY_UNKNOWN`            | Fehler                               | Zeile mit Schwierigkeitsgrad fehlt oder ist unbekannt                                                                                                                  |
| `QUESTION_NUMBER_GAP`                                 | Fehler                               | Nummerierung beginnt nicht bei 1, hat eine Lücke oder eine Wiederholung                                                                                                |
| `OPTION_COUNT`, `OPTION_ORDER`, `OPTION_EMPTY`        | Fehler                               | nicht genau vier Optionen A bis D in dieser Reihenfolge, Option ohne Text                                                                                              |
| `ANSWER_MISSING`, `ANSWER_MULTIPLE`, `ANSWER_INVALID` | Fehler                               | keine, mehrere oder eine Antwort außerhalb der Optionen (auch `B + C`, `B und C`)                                                                                      |
| `ANSWER_LOWERCASE`                                    | Hinweis                              | Antwortbuchstabe klein geschrieben                                                                                                                                     |
| `RATIONALE_MISSING`                                   | Fehler                               | Kurzbegründung fehlt                                                                                                                                                   |
| `RATIONALE_MULTIPLE`                                  | Hinweis                              | mehrere Kurzbegründungen zu einer Frage, sie werden zusammengefügt                                                                                                     |
| `QUESTION_COUNT`                                      | Fehler                               | Fragenzahl weicht vom Erwarteten ab (Global-Quiz: 20, sonst über die Option `expectedQuestions`)                                                                       |
| `NO_QUESTIONS`, `EMPTY_INPUT`                         | Fehler                               | keine Fragen, kein Text                                                                                                                                                |
| `UNPARSED_LINE`                                       | Fehler in einer Frage, Hinweis davor | Text, der in keinen Teil des Formats passt                                                                                                                             |

## Dateiformat der Szenarien

`Szenario 1b) Titel`, danach die Abschnitte `Ausgangssituation`, `Lösungsszenario` (auch `Lösung`) und `Wie das Fachwissen zur Lösung beiträgt`, dazu optional `Aufgabe` (auch `Aufgabenstellung`, `Aufgaben`). `parseScenarioText` liefert `{ code, title, situation, task, solution, knowledgeContribution, visibility }`. Befunde: `HEADING_FORMAT`, `HEADING_VARIANT` (zum Beispiel `Szenario 24/1a) Titel`, `Szenario_14j) Titel` oder ohne das Wort Szenario), `SECTION_MISSING`, `SECTION_EMPTY`, `SECTION_ORDER`, `SECTION_DUPLICATE`, `SECTION_UNKNOWN_HEADING` (eine kurze, fett gesetzte Zeile, die kein bekannter Abschnitt ist, zum Beispiel `Hinweise`), `SECTION_HEADING_VARIANT` (eine Zeile sieht aus wie eine Abschnittsüberschrift, ist aber keine, zum Beispiel `Lösungsszenario (nur Trainer)`), `TASK_AS_SOLUTION` (Hinweis, siehe unten), `TASK_SOLUTION_OVERLAP` (Fehler: die Aufgabe wiederholt Text der Lösungsteile), `TASK_SOLUTION_HEADING` (Fehler: eine Zeile der Aufgabe sieht wie die Überschrift einer Lösung aus), `UNPARSED_LINE`.

**Abschnitt `Aufgabe`.** Steht er neben einem Abschnitt `Lösungsszenario`, ist er die Aufgabe und für Azubis sichtbar: `visibility.task` ist `trainee`, `toTraineeScenario` liefert ihn als `task` (leer, wenn die Datei keine Aufgabe hat). Er steht zwischen der Ausgangssituation und den Lösungsteilen. Steht die Überschrift davor, dahinter oder zwischen Lösung und Fachwissen, ist das ein Fehler (`SECTION_ORDER`): Die Zeile wird verworfen, der Text darunter bleibt im Abschnitt davor und wird nie sichtbar. Der Abschnitt ist optional, doppelt oder leer ist er ein Fehler (`SECTION_DUPLICATE`, `SECTION_EMPTY`). Wiederholt die Aufgabe einen Absatz aus Lösung oder Fachwissen (ab 20 Zeichen, Groß- und Kleinschreibung und Leerraum egal), ist das ein Fehler (`TASK_SOLUTION_OVERLAP`), ebenso eine kurze Zeile ohne Satzzeichen am Ende, die eine Lösung benennt (`TASK_SOLUTION_HEADING`, zum Beispiel `Erwartete Lösung`). Der Vergleich ist ein wörtlicher Abgleich und eine Heuristik, er ersetzt nicht die Durchsicht der Aufgabentexte durch den Eigentümer. `toTraineeScenario` verweigert die Ausgabe außerdem bei einer Lösungsmarke in der Aufgabe.

**`Aufgabe` an der Stelle der Lösung.** Fehlt der Abschnitt `Lösungsszenario` in der Datei, ersetzt `Aufgabe` die Lösungsüberschrift. Das ist bei drei Szenarien der Quelle der Fall (10m, 16c, 23c): Unter `Aufgabe` steht der Text der Lösung, die Kopie von 23c im Ordner 23b trägt denselben Text unter `Lösungsszenario`. Ein solcher Abschnitt wird als Lösung gelesen (nur Trainer) und mit dem Hinweis `TASK_AS_SOLUTION` gemeldet, die Datei ist nicht mehr fehlerhaft. Eine echte Aufgabe ohne Lösungsabschnitt landet damit ebenfalls im Trainerbereich, das ist die sichere Seite. Der Eigentümer bestätigt die Lesart für die drei Dateien.

## Dateiformat der Use Cases

Eine Use-Case-Datei (`UC_4a_<Titel>.docx`, Ordner `K4_Use-Cases`, ein Word je Enabler) ist eine Aufgabe mit Musterlösung. Der Aufbau, je Absatz (Tabellen werden Zelle für Zelle gelesen, jede Zelle ist ein Absatz):

| Teil                         | Inhalt                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Überschrift                  | `4a) Titel` (Code des Enablers, Klammer, Titel), die erste Zeile, nicht fett                                         |
| `Behandelte Themen` (fett)   | Lehrtext, der die Themen der Aufgabe wiederholt (sichtbar für Azubis)                                                |
| `Ausgangssituation` (fett)   | die Lage der erfundenen Firma, darin die fette Zeile `Eckdaten` mit Text und Datentabellen (sichtbar für Azubis)     |
| `Zielsetzung` (fett)         | was verlangt wird (sichtbar für Azubis)                                                                              |
| `Weg zum Ziel` (fett)        | die Schritte, in Gruppen mit einer Zwischenüberschrift je Gruppe (sichtbar für Azubis)                               |
| `Musterlösung` (fett)        | wiederholt die Schritte und gibt die Antworten mit Rechnungen und Tabellen (**Lösung, nur Ausbilder**)               |
| `Bewertungskriterien` (fett) | gibt es in den heutigen Quellen nicht. Der Parser kennt den Abschnitt für spätere Fassungen und führt ihn als Lösung |

Eine Abschnittsüberschrift ist eine fette Zeile außerhalb einer Tabelle, deren Text genau der Name des Abschnitts ist (Doppelpunkt am Ende erlaubt). Jede andere Zeile gehört zum Abschnitt darüber. Eine Zeile mit dem Namen eines Abschnitts, die nicht fett ist oder in einer Tabelle steht, bleibt Text (Hinweis `SECTION_HEADING_NOT_BOLD`). Die Reihenfolge ist fest (Themen, Situation, Ziel, Weg, Lösung, Kriterien).

`parseUseCaseText` (`src/lib/content-import/use-cases/parser.ts`) liefert `{ code, title, topics, situation, objective, steps, solution, criteria, hasDataTable, visibility }`. Tabellenzeilen werden zu einer Zeile mit " | " zwischen den Zellen, mehrere Absätze einer Zelle werden mit Leerzeichen verbunden (der Absatzleser `docx-paragraphs.ts` setzt dafür je Absatz in einer Tabelle die laufende Nummer von Zeile und Zelle). Befunde:

| Code                                 | Art     | Bedeutung                                                                                                |
| ------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------- |
| `EMPTY_INPUT`                        | Fehler  | kein Text                                                                                                |
| `HEADING_FORMAT`                     | Fehler  | die Überschrift trägt keinen Use-Case-Code                                                               |
| `HEADING_VARIANT`                    | Hinweis | andere Anrede, zum Beispiel `UC 4a: Titel`, `4a - Titel` oder `25/1b) Titel`                             |
| `SECTION_MISSING`                    | Fehler  | Ausgangssituation, Zielsetzung, Weg zum Ziel oder Musterlösung fehlt (bei Behandelte Themen nur Hinweis) |
| `SECTION_EMPTY`                      | Fehler  | ein Abschnitt ohne Text (bei Behandelte Themen und Bewertungskriterien nur Hinweis)                      |
| `SECTION_DUPLICATE`, `SECTION_ORDER` | Fehler  | ein Abschnitt kommt mehrfach vor, die Reihenfolge stimmt nicht                                           |
| `SECTION_HEADING_NOT_BOLD`           | Hinweis | eine Zeile sieht aus wie eine Abschnittsüberschrift, ist aber nicht fett oder steht in einer Tabelle     |
| `UNPARSED_LINE`                      | Hinweis | Text vor dem ersten Abschnitt wird ignoriert                                                             |
| `DATA_HEADING_MISSING`               | Hinweis | die Situation hat keine fette Zeile `Eckdaten`                                                           |

Der Prüflauf (`kfbm-parse-check.mjs --only use-case`) prüft zusätzlich, ob die Überschrift zum Pfad passt (`CODE_MISMATCH`) und meldet `FOLDER_WITHOUT_SOLUTION` für den Ordner `Ohne Musterlösung`.

## Lösungsschutz

Lösungen sind die richtige Antwort und die Kurzbegründung der Quizfragen sowie das Lösungsszenario und der Abschnitt zum Fachwissen sowie die Musterlösung (und die Bewertungskriterien) der Use Cases. Sie unterliegen dem Lösungsschutz und dürfen nur in Felder, die Azubis nie lesen.

- Kennzeichnung im Ergebnis: `ParsedQuiz.solutionFields` nennt `correctLetter` und `rationale`. `ParsedScenario.visibility` setzt `situation` auf `trainee`, `solution` und `knowledgeContribution` auf `trainer`.
- Die Sicht für Azubis liefern **nur** `toTraineeQuiz(result)`, `toTraineeScenario(result)` und `toTraineeUseCase(result)`. Alle arbeiten mit einer Positivliste von Feldern und **verweigern die Ausgabe** (Rückgabe `null`), wenn die Datei einen Fehler hat oder im sichtbaren Text eine Lösungsmarke steht (`Richtige Antwort`, `Kurzbegründung`, `Lösungsszenario`, `Fachwissen zur Lösung`, bei Use Cases zusätzlich `Musterlösung`). Das Wort `Bewertungskriterien` ist keine Marke, die Aufgaben benutzen es (Angebote nach Kriterien bewerten). Wer die Sicht für Azubis baut, nimmt diese Funktionen und nie das volle Ergebnis.
- Die Berichte der Prüfläufe speichern keine Fragetexte, Antworten oder Begründungen.

## Befehle

Beide Befehle brauchen Node 22.18 oder neuer (die Parser sind TypeScript und werden mit Node-Typentfernung geladen) und arbeiten nur lesend.

```
npm run import:kfbm:inventory -- "<Pfad zu Komponente>" --out <Datei.json>
npm run import:kfbm:parse-check -- "<Pfad zu Komponente>" --out <Datei.json>
```

**Inventur** (`scripts/import/kfbm-inventory.mjs`): läuft über die Quelle, ohne Inhalte zu laden (Namen, Größen, Zeiten, Attribute). Meldet Anzahl je Komponente und Typ gegen die Erwartung (27 Komponenten ohne K18, 226 Enabler, 226 Szenarien, 27 Global-Quizze, 9 Wahlkomponenten, 678 Quizze, 226 Use Cases), fehlende Bausteine (auch ein Enabler ohne Use Case, wenn die Quelle Use Cases hat), die Use-Case-Dateien je Format und die Ordner "Ohne Musterlösung", Dubletten mit Größe, Datum und Empfehlung (neueste Fassung), Dateien ohne Schema, Archivdateien und OneDrive-Platzhalter. Die Geschwisterordner (`Komponenten_PDF`, `Quizze`, `Szenarien`, `Szenarien (1)`, `Use Cases`, `Excels` neben `Komponente`) werden nur nach Namen und Größe aufgelistet und gegen die Quelle auf gleiche Namen geprüft. Mit `--out` entstehen die JSON-Datei und daneben eine Zusammenfassung als Markdown. Weitere Optionen: `--siblings <Ordner>`, `--no-siblings`, `--no-attributes`.

**Prüflauf** (`scripts/import/kfbm-parse-check.mjs`): liest die .docx nacheinander (nie mehrere zugleich) und wendet die Parser an. Meldet je Datei Erfolg oder die Befunde, dazu Zusammenfassung mit Fragen gesamt, Dateien mit Abweichung und den häufigsten Abweichungen mit Beispielpfad. Prüft zusätzlich, ob Schwierigkeitsgrad, Enabler-Code und Komponente der Überschrift zum Pfad passen (`DIFFICULTY_MISMATCH`, `CODE_MISMATCH`, `KIND_MISMATCH`). Die Enabler-Lehrtexte werden nur auf Metadaten geprüft (Überschrift, Zeichenzahl, Bildanzahl, Größe). K18 wird übersprungen (`--include-k18` nimmt ihn mit). Optionen: `--only quiz,scenario,use-case,global-quiz,enabler`, `--limit <n>`, `--expected-questions <n>`, `--no-attributes`.

**OneDrive-Platzhalter**: Eine Datei, die noch nicht heruntergeladen ist, trägt das Attribut `RECALL_ON_DATA_ACCESS` (0x400000). Der Prüflauf überspringt sie und zählt sie, den Lauf später wiederholen. Mit `--hydrate` liest er sie trotzdem, eine nach der anderen, mit einer Frist je Datei (`--timeout <Sekunden>`, Standard 60). Dabei lädt OneDrive die Datei auf das Gerät. Nach drei Fristüberschreitungen in Folge bricht der Lauf ab.

**Grenzen des Parsers**: Er liest nur `word/document.xml`. Text in Textfeldern, gelöschter und verschobener Text sowie die automatische Word-Nummerierung (`w:numPr`) werden nicht gelesen. Die Fett-Markierung wird nur aus der direkten Formatierung gelesen und von den Parsern nicht benutzt. Der Leser lehnt Dateien ab, die entpackt über 64 MB groß sind (Schutz vor Zip-Bomben).

## Tests

- `tests/unit/content-import`: Parser (Quiz, Szenario, Use Case), Pfadableitung und Absatzleser (Jest, erfundene Fixtures im Stil der Quelle).
- `tests/scripts/import`: Inventur und Prüflauf (`npm run test:scripts`).

## Befund der Quellen (Stand 26.10.2026)

Prüflauf über alle 1167 Word-Dateien außer K18 (Quiz, Szenario, Global-Quiz, Enabler), alle Dateien auf dem Gerät. Die Quellen sind weitgehend einheitlich: 7338 Fragen gelesen, 1126 Dateien ohne Abweichung, 41 mit Abweichung (17 mit Fehler, die übrigen nur Hinweise), 4 Enabler-Dateien nicht lesbar (OneDrive konnte sie nicht laden). Die Abweichungen im Einzelnen stehen im Bericht des Pull Requests und im Bericht des Prüflaufs, sie sind ein Prüfauftrag an den Eigentümer der Inhalte, nicht an den Parser.

Die Inventur der Quelle meldet 27 Komponenten (ohne K18), 226 Enabler, 226 Szenarien (eines heißt `14i.docx` statt `Szenario_14i.docx`), 27 Global-Quizze (drei davon doppelt, im Ordner `00_Global_Quizze` und im Komponentenordner), 9 Wahlkomponenten und 678 Quizze. Die Zahlen stimmen mit den erwarteten Werten überein.

## Befund der Use Cases (Stand 27.10.2026)

Inventur und Prüflauf über den Quellordner. Alle Use-Case-Dateien sind Word-Dateien (keine PDF), die Dateien lagen als OneDrive-Platzhalter vor und wurden mit `--hydrate` gelesen.

- 247 Dateien in den Use-Case-Ordnern: 7 Lehrtexte im Ordner `K21_Use-Cases/Enabler` (gehören zum Inhaltsimport) und 240 Use-Case-Dateien, davon 13 in K18 (ausgeschlossen). Bleiben 227 Use Cases in den 27 Komponenten. Das sind 226 verschiedene Schlüssel, genau ein Use Case je Enabler (je Komponente so viele Use Cases wie Enabler, K24.2 hat einen).
- Der einzige Konflikt ist Use Case 5b: Er liegt zweimal vor, im Ordner `K5_Use-Cases` und im Unterordner `Ohne Musterlösung`. Der Import überspringt beide, der Eigentümer nennt die gültige Fassung. Beide Dateien haben statt der Behandelten Themen einen Abschnitt `Fachwissen`.
- Das Format ist einheitlich: 235 von 240 Use-Case-Dateien (mit K18) haben alle sechs Teile (Überschrift mit Code, Behandelte Themen, Ausgangssituation mit Eckdaten, Zielsetzung, Weg zum Ziel, Musterlösung). Es fehlen die Eckdaten in drei Dateien (5d, 10k, 17b), das ist nur ein Hinweis, und die beiden Kopien von 5b weichen ab (siehe oben). In einer Datei (16h) steht ein Abschnittsname als nicht fetter Text (Hinweis).
- Der Prüflauf liest 227 Dateien (ohne K18 und Archiv): 221 ohne Abweichung, 6 mit Abweichung, davon eine mit Fehler (die Kopie ohne Musterlösung). Der Plan über alle Komponenten enthält 225 Use Cases und überspringt nur die beiden Kopien von 5b.
- Der Geschwisterordner `Use Cases` (233 Word-Dateien, je Enabler eine, K7 fehlt, K18 dabei) wurde nur nach Namen und Größe verglichen: 215 Namen stimmen überein, nur 6 Dateien haben dieselbe Größe, keine ist neuer als die Quelle. Er ist keine Quelle des Imports.
- Eine Datei hat bis zu 650 Absätze, weil Tabellenzellen Absätze sind (Median 339).
