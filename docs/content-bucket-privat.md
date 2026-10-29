# Bucket `content` privat: Inventur, Umbau und Umschalten

Stand: 29.10.2026. Der Bucket `content` (heute öffentlich, 10 MB, von Preview und Production gemeinsam genutzt) soll bei der Produktivschaltung privat werden. Der Bucket `avatar` bleibt öffentlich. Dieses Dokument beschreibt, wo die App Dateiadressen aus dem Bucket nutzt, was der Umbau geändert hat und wie umgeschaltet wird. Die Umstellung selbst ist **nicht** Teil dieses Pakets, es gibt keine Migration und keine Änderung an Supabase-Einstellungen.

## 1. Kern des Umbaus

Die App funktioniert mit öffentlichem **und** privatem Bucket gleichermaßen. Das Umschalten ändert für die Nutzer nichts.

- **Gespeicherte Adresse bleibt, wie sie ist.** Zeilen in `content_documents.storage_url`, `enablers.scenario_pdf_url`, `ppt_url` und `video_url` enthalten die öffentliche URL des eigenen Projekts, die Referenz `private://content/<Pfad>` oder einen nackten Pfad. Alle drei Formen werden verstanden (`src/lib/storage/contentPath.ts`). Die Schreibwege (Upload der Trainer, Importer, Content-Upload) bleiben unverändert und schreiben weiter die öffentliche Form.
- **Alles, was zum Browser geht, wird signiert.** `src/lib/storage/contentUrl.ts` ersetzt die Adresse einer Datei im Bucket `content` durch eine kurzlebige signierte Adresse (`createSignedUrls`, Schlüssel nur auf dem Server, 60 Minuten in Listen, 15 Minuten auf Abruf). Eine signierte Adresse funktioniert bei öffentlichem und bei privatem Bucket.
- **Zugriffsprüfung vor jeder neuen Signatur.** `GET /api/documents/[documentId]/file` (`src/lib/storage/documentAccess.ts`) liefert nur dann eine Adresse, wenn die Person das Dokument sehen darf: Rolle, Beruf (Katalog), Organisation, Sichtbarkeit (ALL und TRAINEE_ONLY für Azubis, TRAINER_ONLY und Musterlösungen nur für Trainer), Kursmitgliedschaft und aktiver Enabler für Azubis. Alles andere antwortet 404 wie ein fehlendes Dokument. Der Pfad kommt immer aus der Datenbankzeile, nie aus der Anfrage.
- **Bewusst JSON und keine Weiterleitung.** Die Sitzung der App ist ein Bearer-Token, den nur `authFetch` mitschickt. Ein Link oder ein iframe kann ihn nicht senden, eine Weiterleitung wäre für den Browser nicht erreichbar. Die Route antwortet deshalb mit `{ url, expiresIn }`.
- **Server-Leser lesen mit dem Server-Schlüssel direkt aus dem Speicher** (`src/lib/storage/contentRead.ts`): HAI-Extraktor, Zeugnis-Logo und Reindex-Skript. Ohne Schlüssel bleibt der bisherige Weg (geprüfte öffentliche Adresse).
- **Rückfall bei öffentlichem Bucket:** Schlägt das Signieren fehl (kein Schlüssel, Speicher gestört), bekommt der Browser die gespeicherte http(s)-Adresse. Eine Referenz `private://` verlässt den Server nie, sie wird zu einem leeren Wert.

## 2. Inventur

Wirkung bei privatem Bucket: **bricht** heißt, ohne Umbau wäre die Stelle kaputt. **bleibt** heißt, nicht betroffen.

### 2.1 Adressen, die zum Browser gehen (jetzt signiert)

| Datei und Zeile | Nutzung | Wirkung ohne Umbau | Stand |
| --- | --- | --- | --- |
| `src/app/api/trainee/enablers/[enablerId]/documents/route.ts:122, 162` | Lehrtexte und Szenario-PDFs eines Enablers für Azubis | bricht (iframe im Reader) | signiert, `private://content/` zugelassen |
| `src/app/api/trainee/use-cases/[useCaseId]/documents/route.ts:103, 127` | Aufgaben-PDFs eines Use Cases für Azubis | bricht (iframe) | signiert |
| `src/app/api/trainee/enablers/[enablerId]/route.ts:66` | `scenarioPdfUrl`, `pptUrl`, `videoUrl` im Enabler-Detail | bricht (Szenario-PDF, Folien) | signiert, Fremdlinks (Video) bleiben |
| `src/app/api/trainer/enablers/[enablerId]/documents/route.ts:67, 195` | Dokumentliste und neues Dokument (Trainer) | bricht (Vorschau, Link) | signiert (Liste und Antwort auf POST) |
| `src/app/api/trainer/use-cases/[useCaseId]/documents/route.ts:73, 238` | wie oben für Use Cases, mit Musterlösungen | bricht | signiert, Musterlösungen weiter über `solution-storage.ts` |
| `src/app/api/trainer/enablers/[enablerId]/route.ts:42` | Editor des Enablers: `signedLinks` zum Öffnen, `enabler` behält die gespeicherte Adresse | bricht (Vorschau des Szenario-PDFs) | signiert, Formular schreibt weiter die gespeicherte Adresse |
| `src/app/api/documents/[documentId]/file/route.ts` | neu: frische Adresse auf Abruf | neu | Zugriffsprüfung wie die Listen |

### 2.2 Anzeige im Browser

| Datei und Zeile | Nutzung | Stand |
| --- | --- | --- |
| `src/components/ui/FlipbookViewer.tsx` (iframe, Links Öffnen und Download) | zeigt die übergebene Adresse | unverändert, bekommt signierte Adresse |
| `src/app/trainee/enablers/[enablerId]/page.tsx:619, 712, 734, 639` | Reader, Szenario-PDF, Folien | unverändert, signierte Adresse aus der API |
| `src/app/trainee/use-cases/[useCaseId]/page.tsx:80, 171, 187` | PDF im Rahmen | Auswahl jetzt nach Dokument-Id, die Adresse des Klicks bleibt im Rahmen (eine neu geladene Liste hat neue Signaturen) |
| `src/app/trainer/use-cases/[useCaseId]/page.tsx:477` | Link auf das Dokument | unverändert, signierte Adresse |
| `src/app/trainer/reviews/page.tsx:162` | Musterlösung für die Bewertung | unverändert (bereits signiert über `solution-storage.ts`) |
| `src/app/trainer/content-management/[moduleId]/edit/page.tsx:76, 2182` und die Vorschauen der Dokumente | Vorschau im Editor | Szenario-PDF nutzt `signedLinks`, Dokumente die signierte Liste |
| `src/components/hai/HaiMessage.tsx:229`, `src/lib/documentFileLink.ts` | Quellen im HAI-Chat | Klick holt eine frische Adresse über die Route, Rückfall auf die gespeicherte http(s)-Adresse |
| `src/lib/hai/citationUrl.ts:32` | Adresse einer Quelle | `private://content/` wird zum Pfad `/api/documents/<id>/file` |

### 2.3 Leser auf dem Server (lesen jetzt mit Schlüssel)

| Datei und Zeile | Nutzung | Wirkung ohne Umbau | Stand |
| --- | --- | --- | --- |
| `src/lib/hai/pdfExtractor.ts:90` | Text aus PDF für PageIndex und Ingest | bricht (400 auf öffentliche Adresse) | `readContentObject`, Rückfall wie bisher |
| `src/lib/hai/pageIndexService.ts:169, 492` | PageIndex ruft den Extraktor | bricht | über den Extraktor gelöst |
| `src/lib/hai/ingestUseCase.ts:221` | Ingest von Use-Case-Dokumenten | bricht | über den Extraktor gelöst, Musterlösungen bleiben abgelehnt |
| `src/lib/hai/indexScope.ts:220` | Plan der Indexierung | `private://content/` wurde übersprungen | zugelassen, sicherer Pfad Pflicht |
| `scripts/reindex-gemini.ts:1467` | Reindex liest PDFs | bricht | `readPdfBytes`, REST mit Schlüssel aus der Umgebung |
| `src/app/api/verify/[code]/download/route.ts:333` | Logo `WMC_Logo.png` im Zeugnis-PDF | Logo fehlt | `readContentObject`, Rückfall auf öffentliche Adresse |

### 2.4 Schreibwege (schreiben Adressen, unverändert)

| Datei und Zeile | Nutzung | Wirkung |
| --- | --- | --- |
| `src/components/trainer/PdfUploader.tsx:87` | Upload im Browser mit Nutzerrechten, `getPublicUrl` | bleibt, Upload in den eigenen Ordner braucht nur die Richtlinien der Vorlage v2 (`supabase/manual/20261029_storage_policies_v2.sql`), nicht die Öffentlichkeit |
| `src/app/api/trainer/enablers/[enablerId]/documents/route.ts:187`, `src/app/api/trainer/use-cases/[useCaseId]/documents/route.ts:208` | speichern `documentPublicUrl(...)` | bleibt, Auflösung beim Lesen |
| `src/lib/content-upload/transfer/originals.ts:364` | Originale aus dem Content-Upload | bleibt |
| `src/lib/content-import/documents/engine.ts:325` | Importer: öffentliche URL für `content`, `private://content-solutions/` für Musterlösungen | bleibt |
| `src/lib/content-import/apply/engine.ts:236` | Apply kopiert die Adresse | bleibt |
| `scripts/bulk-import-use-case-pdfs.ts:839`, `scripts/upload-szenarien.mjs:442` | Skripte mit öffentlicher URL | bleibt |
| `src/app/api/trainer/enablers/[enablerId]/route.ts:113`, `src/app/api/trainer/courses/[courseId]/enablers/route.ts:95` | Trainer schreibt Adressfelder | neu: eine versehentlich kopierte signierte Adresse wird als öffentliche Form gespeichert |
| `src/lib/document-file-cleanup.ts:88`, `src/lib/content-upload/transfer/content-bucket.ts:65` | Löschen und Schreiben mit Server-Schlüssel | bleibt, Schlüssel umgeht die Privatheit |

### 2.5 Nicht betroffen oder ohne Schreibweg

- **Avatar:** `src/components/profile/Profile.tsx:220`, Bucket `avatar`, bleibt öffentlich.
- **Bucket `content-solutions`** (privat): Musterlösungen, `src/lib/solution-storage.ts`, bleibt.
- **Bucket `content-upload`** (privat): Zwischenablage des Content-Uploads, `src/lib/content-upload/staging/storage.ts`, bleibt.
- **`scenario_image_url`:** Die Spalte gehört zu den alten Inline-Feldern der FIAE-Enabler (siehe Abschnitt 4.8 des Rollout-Runbooks). Die App liest sie nicht, sie steht nicht im Schema. Bilder aus dem Bucket zeigt die App sonst nirgends an.
- **Dashboards:** `src/app/api/trainee/dashboard/route.ts:168` und `src/app/api/trainer/dashboard/route.ts:93` prüfen nur, ob ein Szenario-PDF eingetragen ist. `src/lib/catalog/content-stats.ts:139` zählt nur. Keine Adresse geht zum Browser.
- **Zeugnis und Berichte:** `pdfUrl` an `work_certificates` und `activity_reports` (`src/app/api/activity-reports/route.ts:153`, `src/components/school/ActivityReportsList.tsx:386`) hat im Code keinen Schreibweg und ist leer. Die Zeugnis-PDFs werden im Browser erzeugt (Logo aus `public/`) oder auf Abruf auf dem Server (siehe 2.3).
- **E-Mails:** `src/lib/email.ts` enthält keine Adressen aus dem Bucket.
- **Organisationslogo:** `organizations.logo_url` wird nur über die Admin-API gepflegt, die UI zeigt es nicht an.

## 3. Ungelöste Stellen

1. **Pfade mit Sonderzeichen.** Die Prüfung erlaubt je Pfadteil nur `A-Z a-z 0-9 . _ -`, ohne Dekodierung. Eine Zeile mit Leerzeichen, Umlaut, `%20` oder `+` im Pfad wird nicht signiert. Sie behält ihre gespeicherte Adresse und ist nach dem Umschalten tot. Importer und Uploader erzeugen nur den erlaubten Zeichensatz, in den 185 Zeilen von `pdf_mapping_enriched.json` gibt es keinen Ausreißer. Der Vorcheck in Abschnitt 5 zeigt es für die echten Daten.
2. **Fremder Host in alten Zeilen.** Nur Adressen des eigenen Projekts (`NEXT_PUBLIC_SUPABASE_URL`) gelten als Datei im Bucket. Eine Zeile mit dem Host eines früheren Projekts bleibt unsigniert. Der Vorcheck zeigt sie.
3. **Reindex-Skript ohne Größenkappe** beim Lesen über REST. Der Server-Pfad (`contentRead.ts`) prüft die Größe nach dem Laden. Nur Speicherdruck, die Schreiber sind vertrauenswürdig.
4. **Zeugnis-Route** `src/app/api/verify/[code]/download/route.ts` hat keinen eigenen Test (große Datenbankabhängigkeit). Das Lesen ist in `tests/unit/lib/storage/contentRead.test.ts` geprüft.
5. **Gespeicherte Links im Chat-Verlauf** zeigen weiter die alte öffentliche Adresse. Der Klick holt über die Route eine frische. Ohne Rechte oder ohne Dokument-Id gibt es den Rückfall auf die alte Adresse, die bei privatem Bucket nicht mehr öffnet.

## 4. Reihenfolge, Rückweg, gemeinsamer Bucket

**Reihenfolge (erst App, dann Bucket):**

1. App-Release mit diesem Paket nach Production (Merge, Release-Lauf wie in `docs/release-prozess.md`). Der Bucket ist noch öffentlich, alles verhält sich wie bisher, die Listen liefern signierte Adressen. Voraussetzung: der Server-Schlüssel (`SUPABASE_SECRET_KEY` oder `SUPABASE_SERVICE_ROLE_KEY`) ist in Production gesetzt. Ohne Schlüssel greift der Rückfall auf die öffentliche Adresse und das Umschalten wäre nicht sicher.
2. Vorcheck (Abschnitt 5) ausführen, Ergebnis leer.
3. Bucket `content` in Supabase auf privat stellen (Storage, Bucket bearbeiten, Public aus). Das macht der Eigentümer, nicht die App. Die Richtlinien der Vorlage v2 bleiben (Upload in den eigenen Ordner).
4. Smoketest sofort danach (Abschnitt 6).

**Rückweg:** Bucket `content` wieder auf öffentlich stellen. Sonst ist nichts zu tun. Signierte und öffentliche Adressen funktionieren dann wieder nebeneinander, die gespeicherten Zeilen sind unverändert.

**Preview und Production gleichzeitig:** Beide nutzen denselben Bucket (`content`). Das Umschalten wirkt in dem Moment auf beide. Deshalb muss die Preview-App denselben Stand dieses Pakets haben wie Production, sonst bricht dort die Anzeige (alte Preview-Stände liefern die öffentliche Adresse). Preview-Zeilen zeigen teils auf Production-Pfade (kopierte Zeilen ohne Präfix `preview/`), beide Umgebungen lesen dieselben Objekte, die Prüfung erzwingt kein Präfix. Vor dem Umschalten alle Preview-Deployments auf den neuen Stand bringen (Merge von `master` nach `preview` auf Zuruf von Niko). Der Smoketest läuft in beiden Umgebungen.

## 5. Vorcheck vor dem Umschalten (lesend, Niko führt aus)

Findet Zeilen, die die App nicht signieren kann. Erwartung: null Zeilen. Der Platzhalter `<PROJEKT-URL>` ist der Wert von `NEXT_PUBLIC_SUPABASE_URL` ohne Schrägstrich am Ende.

```sql
-- Zeilen mit Adresse im Bucket content, die nicht in der erlaubten Form stehen
with refs as (
  select 'content_documents.storage_url' as spalte, id::text as zeile, storage_url as wert from content_documents
  union all select 'enablers.scenario_pdf_url', id::text, scenario_pdf_url from enablers
  union all select 'enablers.ppt_url', id::text, ppt_url from enablers
  union all select 'enablers.video_url', id::text, video_url from enablers
)
select spalte, zeile, wert
from refs
where wert is not null and btrim(wert) <> ''
  and wert not like 'private://content-solutions/%'
  and wert !~ '^https?://(www\.youtube\.com|youtu\.be)/'
  and (
    -- Adresse des Buckets content auf einem anderen Host
    (wert ~ '/storage/v1/object/(public|sign)/content/' and wert not like '<PROJEKT-URL>/storage/v1/object/public/content/%')
    -- Pfad mit Zeichen außerhalb von A-Z a-z 0-9, Punkt, Unterstrich, Bindestrich und Schrägstrich
    or regexp_replace(
         regexp_replace(wert, '^<PROJEKT-URL>/storage/v1/object/public/content/', ''),
         '^private://content/', ''
       ) ~ '[^A-Za-z0-9._/-]'
  );
```

Zeilen aus diesem Check einzeln prüfen: ein Video auf einem fremden Host ist in Ordnung, eine Datei im Bucket nicht.

## 6. Smoketest nach dem Umschalten

Je Umgebung (Production und Preview), mit einem Azubi der KfBM und einem der FIAE, danach ein Trainer.

1. **Lehrtext als Azubi öffnen:** Enabler öffnen, Lehrtext im Reader anzeigen, Öffnen im neuen Tab und Download.
2. **Szenario-PDF:** Enabler mit Szenario-PDF (Detailseite) öffnen.
3. **Aufgaben-PDF eines Use Cases** im Rahmen anzeigen.
4. **Bild und Logo:** Zeugnis-PDF über die Prüfseite herunterladen (`/verify/<Code>`), Logo muss sichtbar sein.
5. **HAI:** Frage stellen, auf eine Quelle klicken, die PDF öffnet.
6. **Trainer:** Dokumentliste eines Enablers, Vorschau, neues PDF hochladen und sofort ansehen, Musterlösung öffnen.
7. **Gegenprobe:** Die alte öffentliche Adresse einer Datei im Browser aufrufen, sie muss mit 400 oder 404 antworten (Bucket ist privat). Ein Azubi darf über `/api/documents/<Id der Musterlösung>/file` nichts bekommen (404).
8. **HAI-Reindex** (nur nach gesondertem Go): Trockenlauf des Skripts muss PDFs lesen können (Server-Schlüssel gesetzt).

Bei jedem Fehler: Rückweg aus Abschnitt 4 (Bucket wieder öffentlich), dann Ursache klären.
