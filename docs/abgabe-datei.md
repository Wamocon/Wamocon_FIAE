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
- Aufbewahrung: Löscht man eine Abgabe, einen Azubi oder einen Use Case, bleibt die Datei im Bucket liegen, bis ein Aufräumlauf sie entfernt. Ein solcher Lauf ist noch nicht gebaut. Die Dauer der Aufbewahrung (zum Beispiel bis zum Ende der Ausbildung oder eine feste Frist nach der Freigabe) ist offen, weil Abgaben personenbezogene Daten enthalten können.
- Virenprüfung: Es gibt keine. Der Download erzwingt das Speichern der Datei, die Prüfung der Bytes verhindert nur falsch benannte Dateien.
- Der MIME-Typ eines Objekts stammt vom Browser. Der Bucket begrenzt die erlaubten Typen, die Bytes prüft der Server.

## Demo-Daten und Tests je Beruf (Schritt 3.8)

Die SQL-Vorlage `supabase/preview-setup/08-demo-occupations.sql` richtet in der Preview je Beruf (FIAE und KfBM) einen Demo-Azubi und einen Demo-Ausbilder ein. Alle vier Adressen enden auf `example.invalid`. Sie ist wie 05 eine Vorlage für den Eigentümer, von Hand im SQL-Editor, und beginnt als Probelauf (`v_dry_run = true`), der nichts ändert.

Voraussetzungen: Schritt 05 ist gelaufen, und die vier Konten sind als Auth-Konten angelegt und haben sich einmal in der Preview angemeldet. Das Skript gibt beide Berufe für den Demo-Betrieb frei, setzt Rollen und Namen, ordnet jeden Azubi dem Ausbilder desselben Berufs zu und schreibt ihn in den Katalog seines Berufs ein. Es aktiviert den Katalog KfBM nicht und weist keine Kurse zu (siehe `docs/kfbm-freigabe-zuweisung.md`).

Die Tests zum Berufskontext:

- `tests/integration/api/catalog/occupation-trainee-matrix.test.ts`: Azubi von FIAE und von KfBM, beide Richtungen, mit dem echten Katalogfilter. Inhalt des anderen Berufs antwortet 404 (Use Case, Dokumente, Abgabe, Datei zur Abgabe, Kurs, Enabler, Quiz), nichts wird geschrieben.
- `tests/unit/hai/occupationAccess.test.ts`: HAI-Kontext je Beruf mit dem echten Katalogfilter: Filter der Indexsuche, Fortschritt der Kurse und Use Cases enthalten nur den eigenen Beruf.
- `tests/unit/preview-setup/demo-occupations.test.ts`: statische Prüfung der Vorlage.
