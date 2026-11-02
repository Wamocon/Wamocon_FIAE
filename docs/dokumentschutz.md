# Dokumentschutz für Azubis (Jira WMCNL-2872, WMCNL-2873, WMCNL-2891)

Stand: 02.11.2026. Dieser Stand gilt für den Branch `fix/jira0211-dokumente`.

## Ziel und Maßstab

Ein Azubi liest Lerndokumente (Theorie, Szenarien, Aufgaben der Use Cases) in der Plattform. Es soll keinen bequemen Weg geben, die Datei zu speichern: kein Herunterladen, kein "Speichern unter" per Rechtsklick, kein Druckknopf des PDF-Viewers, keine sichtbare Datei-Adresse im Dokument.

Ein vollständiges technisches Verbot gibt es im Browser nicht. Wer ein Dokument sehen kann, kann es auch abfotografieren. Der Schutz sperrt deshalb jeden bequemen Weg und benennt den Rest ehrlich (Abschnitt "Was nicht verhindert werden kann").

## Was gesperrt ist

| Weg                                                      | Maßnahme                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Knopf "Herunterladen", Knopf "In neuem Tab öffnen"       | Für Azubis gibt es beide nicht (`allowDownload={false}` im `FlipbookViewer`). Es gibt auch keinen Link auf die Datei.      |
| Knopf "PPT öffnen" (`enabler.pptUrl`)                    | Für Azubis entfällt der Knopf. Die API liefert dem Azubi das Feld nicht mehr. Der Trainer pflegt es weiter im Editor.      |
| PDF-Viewer des Browsers (Rechtsklick, Speichern, Druck)  | Der Azubi bekommt keinen `iframe` mehr. Die Seiten werden von der App selbst mit pdf.js auf `canvas` gezeichnet.           |
| Rechtsklick                                              | `onContextMenu` mit `preventDefault` auf dem ganzen Viewer, nicht nur auf dem Canvas.                                      |
| Ziehen eines Bildes                                      | `draggable=false` und `onDragStart` mit `preventDefault`.                                                                  |
| Markieren, Kopieren, Ausschneiden                        | `user-select: none`, außerdem werden `copy` und `cut` im Viewer verhindert. Der Canvas enthält ohnehin keinen Text.        |
| Strg+S, Strg+Shift+S, Strg+P (auch Cmd)                  | Der Viewer fängt die Tasten ab, solange er den Fokus hat (er nimmt ihn beim Öffnen). Der Browser lässt das nicht überall zu. |
| Drucken                                                  | `@media print` blendet den Viewer aus (`print:hidden`), ein Ausdruck der Seite zeigt nichts vom Dokument.                  |
| Datei-Adresse im Quelltext und in der API-Antwort        | Die Seiten und die Listen der Azubis enthalten keine Adresse mehr. Der Viewer bekommt nur die Kennung des Dokuments.       |

Beim Trainer ändert sich fast nichts: Er behält Herunterladen und "In neuem Tab öffnen". Die Werkzeugleiste des PDF-Viewers im Browser ist beim Trainer jetzt ebenfalls aus, weil sie einen zweiten Download-Knopf direkt unter dem ersten zeigte (WMCNL-2872 und WMCNL-2873 meldeten "zwei Knöpfe übereinander"). Den einen Download-Knopf im Kopf des Viewers und "In neuem Tab öffnen" behält der Trainer.

## So kommen die Bytes zum Viewer

1. Die Seite des Azubis kennt nur die Kennung: die Id eines Dokuments (`content_documents.id`) oder, für das einzelne Szenario-PDF eines Enablers ohne eigene Zeile, die Id des Enablers.
2. Der Viewer (`SecurePdfViewer`, wird nur bei Bedarf geladen, `next/dynamic` ohne SSR) ruft mit der Anmeldung der App (`authFetch`) eine dieser Routen:
   - `GET /api/trainee/documents/[documentId]/content`
   - `GET /api/trainee/enablers/[enablerId]/scenario/content`
3. Die Route prüft den Zugriff, liest die Datei auf dem Server mit dem Schlüssel des Servers aus dem Speicher (`src/lib/storage/contentRead.ts`) und liefert die Bytes mit `Content-Type: application/pdf`, `Content-Disposition: inline` (ohne Dateinamen), `Cache-Control: private, no-store` und `X-Content-Type-Options: nosniff`. Die Antwort wird als Datenstrom gesendet, damit die Grenze von 4,5 MB für gepufferte Antworten bei Vercel nicht greift.
4. pdf.js (feste Version `5.4.624`, Legacy-Build, der Worker kommt aus dem Paket und wird von der App selbst ausgeliefert) zeichnet nur die Seiten in und nahe dem sichtbaren Bereich. Seiten, die weit weg sind, geben ihren Canvas wieder frei. Es gibt keinen Aufruf an ein CDN oder eine andere Adresse.

### Zugriffsprüfung

Die Route für Dokumente nutzt dieselbe Regel wie die Listen (`src/lib/storage/documentAccess.ts`):

- Beruf (Katalog) des Enablers oder Use Cases liegt im Berufsbereich des Azubis (`requireContentScopeForUser`).
- Organisation: gemeinsamer Lehrplan, Plattform oder eigene Organisation.
- Sichtbarkeit `ALL`, `TRAINEE_ONLY` oder leer. Nie `TRAINER_ONLY`, nie `TRAINER_SOLUTION`, kein Word-Original, kein Dokument auf Kursebene.
- Der Enabler ist aktiv und der Azubi ist Mitglied des Kurses.

Die Route für das Szenario-PDF eines Enablers prüft Berufsbereich, aktiven Enabler und Kursmitgliedschaft wie die Seite des Enablers.

Alles, was kein Zugriff ist, antwortet mit `404` und demselben Text wie ein Dokument, das es nicht gibt. Die Route verrät nicht, welche Dokumente existieren. Ein Trainer bekommt auf diesen Routen `403`, er hat seinen eigenen Weg. Ohne Anmeldung gibt es `401`.

**Reihenfolge der Themenkreise.** Ein gesperrter Enabler (Reihenfolge der Arbeit) bleibt lesbar: Die Seite des Enablers sagt ausdrücklich, dass Titel und Material gelesen werden können und nur Abgaben und Quizze gesperrt sind. Die neuen Routen halten sich daran und sperren das Lesen nicht. Wollte Niko das ändern, wäre es eine Produktentscheidung, die dann auch den Text der Seite betrifft.

### Was die Route nie tut

- Sie nimmt keine Adresse, keinen Pfad und keinen Bucket aus der Anfrage. Ein Pfad, ein `storageUrl` oder `bucket` in der Abfrage ändert nichts. Die Datei wird allein aus der Zeile der eigenen Tabelle bestimmt, die über die Id gefunden wird. Eine Id, die keine UUID ist, führt zu `404` ohne Abfrage.
- Sie liest nur Objekte des Buckets `content` des eigenen Projekts (strenge Pfadprüfung in `contentPath.ts`). Ein Link auf einen anderen Host, ein anderer Bucket und die Musterlösungen im privaten Bucket `content-solutions` werden für einen Azubi nie geholt. Damit gibt es keinen SSRF-Weg über eine Adresse in der Datenbank.
- Sie liefert nur echte PDF-Dateien. Andere Bytes führen zu `404`.

## Was die Listen der Azubis nicht mehr enthalten

- `GET /api/trainee/enablers/[enablerId]/documents` und `GET /api/trainee/use-cases/[useCaseId]/documents`: kein Feld `storageUrl` mehr, auch keine signierte Adresse. Die Seiten brauchten die Adresse nur für den Viewer.
- `GET /api/trainee/enablers/[enablerId]`: statt `scenarioPdfUrl` nur `hasScenarioPdf` (ja oder nein). Das Feld `pptUrl` fehlt. `videoUrl` bleibt (externer Link zum Ansehen oder ein hochgeladenes Video, dann signiert).

Die Trainer-APIs bleiben unverändert und liefern die Adresse weiter.

## Untertitel im Viewer (WMCNL-2932)

Der Viewer zeigte unter jedem Titel "Theorie-Dokument". Der Untertitel kommt jetzt je Dokumentart aus dem Übersetzungssystem (`viewerSubtitle` in `src/lib/documentTypeLabel.ts`): Theorie behält "Theorie-Dokument", ein Szenario heißt "Szenario", eine Aufgabe "Aufgabe", eine Musterlösung "Musterlösung". Eine unbekannte Art heißt neutral "Dokument". Die Trainer-Seite der Prüfungen übergibt noch keinen Untertitel (WMCNL-3005 ist nicht Teil dieses Stands).

## Was nicht verhindert werden kann

Ehrlich gesagt, ohne etwas zu versprechen:

- **Bildschirmfoto und Bildschirmaufzeichnung.** Was auf dem Bildschirm steht, kann aufgenommen werden. Die Taste "Druck" und Werkzeuge des Betriebssystems erreicht keine Webseite.
- **Entwicklerwerkzeuge des Browsers.** Wer die Netzwerkansicht öffnet, sieht die Antwort der Route und kann die Bytes speichern. Das Abfangen von Tastenkürzeln und die Sperre des Rechtsklicks halten das nicht auf. Die Antwort trägt `no-store`, das schützt nur vor dem Zwischenspeicher, nicht vor dem Mitschneiden.
- **Mitschneiden der Antwort** durch Erweiterungen des Browsers, Proxys oder einen eigenen Aufruf mit der eigenen Anmeldung. Ein Azubi, der seine Anmeldung kennt, kann die Route selbst aufrufen.
- **Abfotografieren** des Bildschirms.
- **Tastenkürzel.** Der Browser reserviert manche Kürzel. Der Viewer fängt Strg+S, Strg+Shift+S und Strg+P nur ab, solange er den Fokus hat. Das Menü des Browsers (Datei, Speichern) liegt außerhalb der Seite.
- **Der HAI-Chat.** Eine Quelle in einer Antwort der HAI öffnet das Dokument über `GET /api/documents/[documentId]/file` (signierte Adresse) im neuen Tab, also im PDF-Viewer des Browsers. Dieser Weg ist hier nicht gesperrt, weil er zur HAI gehört und eine eigene Entscheidung braucht (Quellen im Viewer der App öffnen, oder für Azubis ganz ohne Link).
- **Der alte Link.** Der Bucket `content` ist bis zum Produktivgang öffentlich (Entscheidung Niko, Schritt 6 der Go-Checkliste `docs/go-checkliste.md`). Wer die alte Adresse einer Datei kennt (zum Beispiel aus dem Quelltext einer älteren Seite oder von einem Trainer), kann sie weiter öffnen. Die Plattform gibt sie einem Azubi aber nicht mehr aus.
- **Die eigenen Dateien des Azubis** (Datei zur Abgabe, eigene Ausbildungsnachweise) bleiben herunterladbar. Es sind seine Dateien, kein Lernmaterial.

## Was mit dem privaten Bucket zum Produktivgang dazukommt

Sobald der Bucket `content` privat ist (Schritt 6 der Go-Checkliste):

- Die alten öffentlichen Adressen liefern nichts mehr. Dann ist der Weg über die Routen der einzige Weg zum Azubi, und der Schutz vor einer bekannten Adresse ist vollständig.
- Die Routen ändern sich nicht. Sie lesen mit dem Schlüssel des Servers, das geht bei einem öffentlichen und bei einem privaten Bucket gleich (`readContentObject`). Ohne Schlüssel würde der Fallback die öffentliche Adresse lesen, bei einem privaten Bucket gäbe es dann `502`. Der Schlüssel `SUPABASE_SECRET_KEY` muss in Production gesetzt sein.
- Für den Rest (HAI-Chat, Trainer-Weg) bleibt `GET /api/documents/[documentId]/file` die Stelle, die kurzlebige signierte Adressen vergibt. Dort ist die Entscheidung offen, ob ein Azubi diese Adresse noch bekommen soll.

## Dateien

- Viewer: `src/components/ui/SecurePdfViewer.tsx`, Lader: `src/lib/pdf/pdfjs.ts`, Modal: `src/components/ui/FlipbookViewer.tsx`
- Routen: `src/app/api/trainee/documents/[documentId]/content/route.ts`, `src/app/api/trainee/enablers/[enablerId]/scenario/content/route.ts`, Lesen und Antwort: `src/lib/storage/traineeFile.ts`
- Kennungen der Seiten: `src/lib/documentContentPath.ts`
- Tests: `tests/integration/api/trainee/documents.content.get.test.ts`, `tests/integration/api/trainee/enablers.scenario.content.get.test.ts`, `tests/unit/components/ui/SecurePdfViewer.test.tsx`, `tests/unit/components/ui/FlipbookViewer.test.tsx`, `tests/unit/app/trainee-enabler-documents.page.test.tsx`, `tests/unit/app/trainee-use-case-documents.page.test.tsx`
