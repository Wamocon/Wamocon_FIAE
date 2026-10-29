# Datei zur Use-Case-Abgabe (Jira WMCNL-2810, Schritt 3.7)

Stand: 29.10.2026. Dieser Stand gilt für die Preview. In Production ist die Funktion aus (siehe Abschnitt "Schalter").

## Was der Azubi kann

Zu einer Use-Case-Abgabe kann ein Azubi eine Datei anhängen (optional, eine Datei je Abgabe). Das Feld steht auf der Seite des Use Cases unter den Links. Der Azubi kann die Datei öffnen, ersetzen und entfernen, solange die Abgabe noch nicht eingereicht ist oder vom Trainer zurückgewiesen wurde. Eingereichte und bewertete Abgaben sind gesperrt.

Der zuständige Trainer (und jeder Administrator der Organisation, die Trainerrechte haben) sieht bei der Prüfung der Abgabe den Knopf "Anhang öffnen". Der Knopf holt einen Link, der zwei Minuten gilt und den Download erzwingt.

## Regeln

| Punkt              | Regel                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Dateitypen         | pdf, docx, xlsx, png, jpg (jpeg zählt als jpg). Kein zip, keine Dokumente mit Makros.           |
| Größe              | höchstens 10 MB, mindestens 1 Byte                                                              |
| Anzahl             | eine Datei je Abgabe, eine neue ersetzt die alte                                                |
| Name               | wird auf dem Server bereinigt (ASCII, Umlaute ausgeschrieben, keine Punkte im Namen außer der Endung) |
| Pfad               | wird auf dem Server aus Organisation, Azubi und Use Case gebaut, nie vom Browser übernommen     |
| Prüfung vor Upload | Endung, Größe und MIME-Typ, außerdem Berufskontext und Reihenfolge der Arbeit wie bei der Abgabe |
| Prüfung nach Upload | die Bytes: Signatur von pdf, png, jpg; docx und xlsx müssen den Hauptteil ihres Formats enthalten, Makros, eingebettete Objekte und ActiveX werden abgelehnt |
| Lesen              | der Azubi selbst, der zuständige Trainer, Administratoren der Organisation (Berufskontext zählt) |

## Ablauf

1. `POST /api/trainee/use-cases/[useCaseId]/submission-file/upload-url` prüft Name, Größe und Typ und antwortet mit einem signierten Upload-Link für einen Pfad im Ordner `incoming/`.
2. Der Browser lädt die Datei direkt in den privaten Speicher. Die Datei läuft nicht durch die Funktion der App, deshalb greift die Grenze von 4,5 MB für Anfragen auf Vercel nicht.
3. `POST .../submission-file/complete` liest das Objekt mit dem Schlüssel des Servers, prüft Größe und Bytes und verschiebt es erst dann in den Ordner `file/`. Besteht die Datei die Prüfung nicht, wird das Objekt sofort gelöscht. Die vorige Datei wird entfernt.
4. `GET .../submission-file` (Azubi) und `GET /api/trainer/reviews/use-cases/[submissionId]/file` (Trainer) lesen aus `file/`. Nur `file/` wird je gelesen, eine ungeprüfte Datei ist für niemanden erreichbar.

Ein Upload ohne Abschluss wird beim nächsten Upload des Azubis für denselben Use Case entfernt. Pfadform: `[preview/]<Organisation>/<Azubi>/<Use Case>/incoming/<uuid>.<endung>` und `.../file/<Zeitstempel>_<name>`. Jeder Zugriff prüft die exakte Form noch einmal, ein anderer Pfad löst einen Fehler aus.

## Schalter und Bucket (Entscheidung des Eigentümers)

Die Funktion folgt der Regel des Inhaltsuploads: an in einer Vercel-Preview auf dem Schema `public_preview` und bei lokalem Lauf, aus in Production und in jeder unbekannten Umgebung. Die Routen antworten dort mit 404, die Seite blendet das Feld aus (`GET /api/me/submission-file`).

Es braucht keinen neuen Eintrag in der Datenbank und keine Migration. Der Eigentümer legt von Hand einen privaten Bucket an, wie bei `content-solutions` und `content-upload`:

- Name `submission-files`, nicht öffentlich
- Dateigrößenlimit 10 MB
- erlaubte MIME-Typen: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `image/png`, `image/jpeg`
- keine Policy für `anon` und `authenticated` (nur der Server greift mit dem geheimen Schlüssel zu)

Die Werte stehen auch in `SUBMISSION_BUCKET_SETTINGS` in `src/lib/submission-file/rules.ts`. Der Bucket ist zwischen Preview und Production geteilt, die Preview schreibt unter dem Präfix `preview/`.

## Grenzen dieses Stands und offene Entscheidungen

- Die Datei hängt über ihren Ordner am Paar Azubi und Use Case, nicht über eine Datenbankspalte. Eine spätere Spalte (Dateiname, Größe, Pfad an `use_case_submissions`) wäre eine Migration und gehört in die Entscheidung des Eigentümers.
- Aufbewahrung: Die Dateien bleiben bis zum Ende der Ausbildung des Azubis, danach räumt der Aufräumlauf sie ab (Abschnitt "Aufbewahrung und Aufräumlauf"). Entschieden von Niko am 29.10.2026.
- Virenprüfung: Es gibt keine und es wird keine gebaut (Abschnitt "Keine Virenprüfung"). Der Download erzwingt das Speichern der Datei, die Prüfung der Bytes verhindert nur falsch benannte Dateien.
- Der MIME-Typ eines Objekts stammt vom Browser. Der Bucket begrenzt die erlaubten Typen, die Bytes prüft der Server.

## Aufbewahrung und Aufräumlauf

Entscheidung von Niko am 29.10.2026: Die Datei einer Abgabe bleibt gespeichert, bis die Ausbildung des Azubis zu Ende ist. Es gibt keine feste Frist darüber hinaus. Danach wird sie entfernt, weil Abgaben personenbezogene Daten enthalten können.

### Was "Ausbildung beendet" bedeutet

Gemeint ist die Ausbildung des Azubis in diesem Beruf, nicht der Abschluss eines Kurses. Das Datenmodell kennt kein Ende. Der Lauf leitet es deshalb aus zwei Tatsachen ab:

1. Der Azubi ist deaktiviert (`profiles.is_active = false`). Ein leerer Wert zählt nicht als Deaktivierung.
2. Der Azubi ist nicht mehr in den Beruf eingeschrieben, zu dem der Use Case gehört (keine Zeile in `trainee_enrollments` für diesen Katalog). Ein Azubi ganz ohne Einschreibung gilt wie in der App als eingeschrieben in FIAE.

Mit dem Schalter `--keep-deactivated` zählt nur die zweite Tatsache.

### Die Lücke im Datenmodell

- `trainee_enrollments` hat nur Beginn (`start_date`, kann leer sein), Dauer (`duration_years`, 2 oder 3) und die Zeitstempel der Zeile. Es gibt weder ein Enddatum noch einen Status (laufend, beendet, gekündigt).
- Eine Einschreibung zu beenden heißt heute, die Zeile zu löschen (`removeTraineeEnrollment`). Das geht nur, wenn der Azubi mindestens zwei Einschreibungen hat, die letzte lässt sich nicht entfernen. Es bleibt keine Spur, wann und warum.
- Wer nur in einem Beruf ausgebildet wird, hat deshalb nur die Deaktivierung als Zeichen für das Ende. `is_active` hat aber zwei Bedeutungen (neues Konto, noch nicht freigeschaltet, und später deaktiviert) und unterscheidet nicht zwischen Pause und Ende.
- Das planmäßige Ende (Beginn plus Dauer) lässt sich rechnen, ist aber nicht verbindlich (Verlängerung, Wiederholung der Prüfung) und wird vom Lauf nicht benutzt.
- `use_case_submissions` hat keine Spalte für die Datei. Die Datei hängt über ihren Pfad (Organisation, Azubi, Use Case) an der Abgabe.

Folge: Wer ein Konto nur vorübergehend deaktiviert, verliert die Dateien beim nächsten Lauf mit `--apply`. Der Trockenlauf zeigt die Zahl vorher. Wer das nicht will, startet den Lauf mit `--keep-deactivated`.

Vorschlag für eine spätere Entscheidung (nicht gebaut, keine Migration in diesem Stand): eine Spalte `ended_at` (Datum) und optional `end_reason` an `trainee_enrollments`, die der Administrator setzt, wenn die Ausbildung endet oder gekündigt wird. Der Lauf würde dann `ended_at` auswerten und die beiden Ableitungen oben ersetzen. Eine Frist nach dem Ende (zum Beispiel 30 Tage zur Übergabe) ließe sich dort ebenfalls festlegen.

### Wann eine Datei entfernt wird

| Grund                    | Bedeutung                                                                                       | Wann            |
| ------------------------ | ----------------------------------------------------------------------------------------------- | --------------- |
| `orphan` (verwaist)      | Ein Upload im Ordner `incoming/`, der nie abgeschlossen wurde                                  | älter als 24 Stunden |
| `deleted` (gelöscht)     | Der Azubi oder der Use Case existiert nicht mehr, die Abgabezeilen sind mit ihm gegangen       | sofort beim nächsten Lauf |
| `ended` (beendet)        | Die Ausbildung des Azubis ist beendet (siehe oben)                                             | sofort beim nächsten Lauf |

Was bleibt: Dateien von Azubis in laufender Ausbildung, auch Entwürfe. Eine Datei in `file/` ohne Abgabezeile ist ein Entwurf (der Azubi hat sie angehängt und noch nicht eingereicht, das erlaubt die App), sie wird deshalb nicht allein wegen der fehlenden Zeile entfernt. Ein Upload, der jünger als 24 Stunden ist, kann noch laufen und bleibt. Ist das Alter eines Uploads unbekannt, bleibt er ebenfalls.

### Direkte Löschung

Wird ein Azubi (Administrator, `DELETE /api/admin/users/[userId]`), ein Use Case oder ein Kurs (`DELETE /api/trainer/use-cases/[useCaseId]`, `DELETE /api/trainer/courses/[courseId]`) gelöscht, gehen die Dateien sofort mit.

- Die Route sucht die Dateien vor dem Löschen und entfernt sie danach. Scheitert das Löschen (zum Beispiel weil ein Konto noch gebraucht wird), bleiben die Dateien.
- Beim Azubi gehen alle Use-Case-Ordner mit, auch Entwürfe ohne Abgabezeile. Beim Use Case und beim Kurs gehen die Dateien der vorhandenen Abgaben mit, ein Entwurf ohne Abgabezeile bleibt für den Aufräumlauf (Grund `deleted`).
- Antwortet der Speicher nicht, scheitert die Anfrage nicht. Der Aufräumlauf holt den Rest nach. Im Protokoll steht nur ein fester Text, nie eine Kennung.
- In Production (Funktion aus) wird nichts gelesen und nichts entfernt.

### Der Lauf

`scripts/storage/cleanup-submission-files.mjs`, von Hand gestartet. Später kann ein Zeitplan (Cron, zum Beispiel wöchentlich) den Lauf starten. Das ist nicht gebaut und braucht eine Entscheidung, weil der Lauf das Geheimnis des Speichers und den Zugang zur Datenbank braucht.

```
node scripts/storage/cleanup-submission-files.mjs --target local|preview
node scripts/storage/cleanup-submission-files.mjs --target preview --apply --confirm-storage-host <Host der Speicheradresse> --confirm-host <Host der Datenbank>
```

Ablauf und Schutz:

1. Standard ist der Trockenlauf. Er liest den Bucket und die Datenbank, zählt die Gründe und entfernt nichts. Erst `--apply` entfernt.
2. `--target local|preview` ist Pflicht und wird mit den Tatsachen der Verbindung verglichen (Host, Schema, Rolle). Production ist in jeder Form abgelehnt, es gibt keinen Schalter.
3. Ein echter Lauf verlangt `--confirm-storage-host` mit dem Host aus `NEXT_PUBLIC_SUPABASE_URL` (der geheime Schlüssel geht an diese Adresse, der Bucket gehört Preview und Production gemeinsam). Gegen die Preview kommt `--confirm-host` mit dem Host der Datenbankverbindung dazu.
4. Der Bucket steht fest im Code (`submission-files`) und ist kein Argument. Der Lauf der Preview sieht nur Pfade unter `preview/`, der lokale Lauf nur Pfade ohne dieses Präfix. Entfernt wird nur ein Pfad, der genau die Form des Buckets hat (`<Organisation>/<Azubi>/<Use Case>/incoming|file/...`).
5. Die Datenbank wird nur gelesen (die Sitzung ist schreibgeschützt gesetzt). Der Lauf entfernt Objekte und sonst nichts.
6. Der Lauf ist wiederholbar: Ein zweiter Lauf findet nichts mehr. Scheitert ein Teil der Entfernung, endet der Lauf mit Exitcode 1 und nennt die Zahl, die übrig ist.
7. Das Protokoll zeigt nur Zahlen, keinen Pfad, keine Kennung, keinen Namen, keine Verbindungszeichenfolge und keinen Schlüssel.

Umgebung (es wird keine `.env`-Datei gelesen): `DB_CONNECTION_STRING`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`.

Empfehlung: erst den Trockenlauf, die Zahlen lesen (vor allem `ended`), dann `--apply`.

## Keine Virenprüfung

Eine Virenprüfung der hochgeladenen Dateien gibt es nicht und sie wird nicht gebaut, weil die Plattform keinen eigenen Server hat, auf dem ein Scanner laufen könnte. Entscheidung von Niko am 29.10.2026. Es ist keine Funktion der Abgabe und darf nicht so beschrieben werden.

Der Schutz besteht allein aus Beschränkungen:

- fünf Dateitypen (pdf, docx, xlsx, png, jpg), geprüft an Endung, MIME-Typ und den Bytes
- keine Dokumente mit Makros, eingebetteten Objekten oder ActiveX, kein ZIP
- höchstens 10 MB, eine Datei je Abgabe
- ein privater Bucket ohne Policy für die Rollen der Programmierschnittstelle, nur der Server greift zu
- erzwungener Download (der Link setzt den Namen zum Speichern, die Datei öffnet sich nicht im Browser)
- kurzlebige Links (zwei Minuten)

Das verhindert falsch benannte Dateien und die häufigsten Wege, Code in einem Dokument zu starten. Es erkennt keine Schadsoftware in einer Datei, die die Prüfung besteht (zum Beispiel ein PDF mit einem Fehler, den ein Betrachter ausnutzt). Wer eine Abgabedatei öffnet, tut das auf eigenes Risiko mit einem aktuellen Betrachter.

## Demo-Daten und Tests je Beruf (Schritt 3.8)

Die SQL-Vorlage `supabase/preview-setup/08-demo-occupations.sql` richtet in der Preview je Beruf (FIAE und KfBM) einen Demo-Azubi und einen Demo-Ausbilder ein. Alle vier Adressen enden auf `example.invalid`. Sie ist wie 05 eine Vorlage für den Eigentümer, von Hand im SQL-Editor, und beginnt als Probelauf (`v_dry_run = true`), der nichts ändert.

Voraussetzungen: Schritt 05 ist gelaufen, und die vier Konten sind als Auth-Konten angelegt und haben sich einmal in der Preview angemeldet. Das Skript gibt beide Berufe für den Demo-Betrieb frei, setzt Rollen und Namen, ordnet jeden Azubi dem Ausbilder desselben Berufs zu und schreibt ihn in den Katalog seines Berufs ein. Es aktiviert den Katalog KfBM nicht und weist keine Kurse zu (siehe `docs/kfbm-freigabe-zuweisung.md`).

Die Tests zum Berufskontext:

- `tests/integration/api/catalog/occupation-trainee-matrix.test.ts`: Azubi von FIAE und von KfBM, beide Richtungen, mit dem echten Katalogfilter. Inhalt des anderen Berufs antwortet 404 (Use Case, Dokumente, Abgabe, Datei zur Abgabe, Kurs, Enabler, Quiz), nichts wird geschrieben.
- `tests/unit/hai/occupationAccess.test.ts`: HAI-Kontext je Beruf mit dem echten Katalogfilter: Filter der Indexsuche, Fortschritt der Kurse und Use Cases enthalten nur den eigenen Beruf.
- `tests/unit/preview-setup/demo-occupations.test.ts`: statische Prüfung der Vorlage.
