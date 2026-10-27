# KfBM-Inhalts-Upload: Runbook für die Preview

Stand: 27.10.2026. Dieses Runbook gehört zum Paket U8 des KI-gestützten Inhalts-Uploads (Konzept: `docs/ki-upload-konzept.md`). Es beschreibt den Weg von der Auswahl der Dateien bis zur Übernahme und zum Rückbau. Die Sokrates-Stufe (U5, Abschnitt 11) ist gebaut, aber bis zum Go von Niko ausgeschaltet: ohne die Variable `CONTENT_UPLOAD_KI_ENABLED` und ohne Opt-in im Lauf arbeitet jeder Lauf nur mit Regeln und ohne Modellaufruf. Der Importweg über die Skripte steht in `docs/kfbm-import-runbook.md` und bleibt gültig.

**Production ist gesperrt.** Die Seiten und Routen antworten dort mit 404, die Tabellen fehlen dort bis zum Rollout. Abschnitt 7 nennt die Sperren.

## 1. Was der Upload tut

Eine berechtigte Person wählt einen Ordner oder Word- und PDF-Dateien. Der Browser berechnet die Prüfsummen und lädt die Dateien über signierte Adressen in den privaten Bucket `content-upload`. Der Server liest jede Datei, ordnet sie nach Regeln (Pfad und Inhalt) einem Dokumenttyp, einer Komponente, einem Enabler und einer Stufe zu und schreibt Vorschläge. Die Person prüft und entscheidet. Erst ein Probelauf und eine Übernahme mit Tippbestätigung schreiben in die Inhaltstabellen. Alles, was geschrieben wird, ist **inaktiv**, Lösungsteile von Szenarien und Use Cases werden nie geschrieben, nichts wird gelöscht, nichts wird indexiert.

## 2. Voraussetzungen (Preview)

| Voraussetzung                                                                                                                                                       | Prüfung                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Preview-Datenbank hat die Migration `20261030000100_content_upload_tables.sql` (sieben Tabellen `content_upload_*`)                                                 | `npm run db:preview:check` lokal, in der Preview-Datenbank `select count(*) from public_preview.content_upload_runs`        |
| Bucket `content-upload` ist angelegt: privat, 25 MB je Datei, nur PDF und docx, keine Richtlinie für API-Rollen                                                     | Supabase Storage, Bucket ansehen. Der Bucket ist zwischen Preview und Production geteilt, der Preview-Präfix ist `preview/` |
| Vercel-Variablen der Preview: `DB_CONNECTION_STRING` (Rolle `app_preview`, Schema `public_preview`), `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` (nur Server) | Vercel, Projekt, Environment Preview. Werte nie ausgeben                                                                    |
| Der Build ist ein Preview-Build auf dem Preview-Schema (`NEXT_PUBLIC_DB_SCHEMA=public_preview`)                                                                     | sonst antworten alle Routen mit 404 (`PREVIEW_SCHEMA_MISSING`)                                                              |
| Der Katalog `KFBM` existiert und ist aktiv                                                                                                                          | `select code, is_active from public_preview.training_catalogs`                                                              |
| Die Person hat das Lehrplan-Schreibrecht: `SUPER_ADMIN` oder `ADMIN` der Plattform-Organisation                                                                     | Menüeintrag "Inhalts-Upload" ist sichtbar                                                                                   |
| Quelle auf dem Rechner: der Ordner `Komponente` aus dem OneDrive, Dateien heruntergeladen (keine Platzhalter)                                                       | Explorer: grüner Haken an den Dateien                                                                                       |

**Struktur zuerst, sonst gibt es keine "sicheren" Vorschläge.** In einem Katalog ohne Komponenten sind alle Codes neu (sie kommen nur aus dem Ordnerbaum). Das Band ist dann bei allen Dateien "Mittel", und die Schaltfläche "Alle sicheren übernehmen" bleibt leer (gemessen: 1228 von 1256 Dateien Mittel, 0 Sicher). Eine Entscheidung je Datei ist in der Oberfläche der einzige Weg. Besser: erst die Struktur mit den Skripten aus `docs/kfbm-import-runbook.md` anlegen (Komponenten, Kurse, Enabler), dann den Upload für Ergänzungen und Korrekturen nutzen. Mit Struktur ist die Mehrheit der Dateien "Sicher".

## 3. Ablauf Schritt für Schritt

1. **Neuer Lauf.** Menü "Inhalts-Upload", "Neuer Lauf". Bezeichnung eintragen, die Erklärung ankreuzen ("eigenes Lehrmaterial, keine Kundendokumente"). Den Schalter "an Sokrates senden" nur ankreuzen, wenn die Stufe freigegeben ist (Abschnitt 11), er ist standardmäßig aus. "Lauf anlegen". Höchstens drei offene Läufe je Person.
2. **Dateien wählen.** "Ordner wählen" und den Ordner `Komponente` angeben (der Name des Ordners ist gleichgültig, das Ordnerverhalten stützt sich auf die Gruppenordner darunter) oder "Dateien wählen" für lose Dateien. Grenzen: 25 MB je Datei, 1500 Dateien und 1 GB je Lauf, 2 GB im Bucket insgesamt. Größere Dateien und Dateien anderer Endung werden nicht hochgeladen und genannt.
3. **Hochladen und verarbeiten.** Die Seite zeigt Prüfsummen, Upload, Bestätigung und Verarbeitung. Die Seite offen lassen: die Verarbeitung läuft im Browser getaktet, ohne Cron. Wird die Seite geschlossen, im Lauf "Weiterverarbeiten" wählen. Dateien, die der Browser nicht lesen kann, stehen unter "Probleme" mit dem Code `UNREADABLE` (Abschnitt 6), der Rest läuft weiter.
4. **Prüfliste.** Nach der Verarbeitung öffnet sich die Prüfliste. Bänder: Sicher (Pfad und Inhalt nennen dasselbe), Mittel (etwas ist nicht sauber, zum Beispiel ein neuer Code oder ein Formatfehler der Quelle), Unklar (nichts erkannt), Widerspruch (Pfad und Inhalt widersprechen sich). Die Details einer Zeile nennen den Grund. Dubletten (mehrere Fassungen) zeigt die Dublettenansicht mit einem Vorschlag der neuesten Fassung. Bei gleicher Version und weniger als 24 Stunden Abstand gibt es keinen Vorschlag, die Person entscheidet.
5. **Entscheiden.** "Alle sicheren übernehmen" nimmt nur Band Sicher ohne Dublettengruppe. Alles andere einzeln: Übernehmen, Ablehnen, Zurückgestellt. Eine Datei im Band Unklar oder Widerspruch (und Dateien mit Lösungsmarke im Lehrtext) wird nie per Klick übernommen, die Person nennt die ganze Zuordnung aus der Positivliste. Jede Änderung erhöht die Version der Entscheidungen und macht einen früheren Probelauf ungültig.
6. **Probelauf, Übernahme, Rückbau-SQL.** Dafür gibt es noch **keine Oberfläche** (die Routen aus U7 sind gebaut, die Schaltflächen fehlen). Bis dahin in der Browserkonsole der Preview-Seite, angemeldet als berechnete Person:

```js
const RUN = '<Lauf-ID aus der Adresszeile>';
const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
const token = JSON.parse(localStorage.getItem(key)).access_token;
const call = (method, route, body) =>
  fetch(`/api/trainer/content-upload/runs/${RUN}/${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async r => ({ status: r.status, ...(await r.json()) }));

// Probelauf: schreibt nichts, meldet Zahlen, Konflikte, ausgelassene Dateien
await call('POST', 'dry-run', {});
// Übernahme: nur nach einem Probelauf mit demselben Stand, Tippbestätigung KFBM
await call('POST', 'apply', { confirm: 'KFBM' });
// Rückbau-SQL aus dem Protokoll (nur lesend, 2 bis 3 MB Text bei 1200 Dateien)
const rb = await call('GET', 'rollback-sql');
copy(rb.sql); // in die Zwischenablage, dann als Datei speichern
```

Der Probelauf nennt je Tabelle `insert`, `update`, `unchanged`, die Konflikte (`conflicts`), die Unterschiede zu bestehenden Zeilen (`differences`) und `skipped` mit Grund (zum Beispiel `ENABLER_MISSING`). `updateExisting: true` im Body schreibt auch bestehende Zeilen um, nur auf ausdrücklichen Wunsch. `publishOriginals: [<Datei-IDs>]` (höchstens 25) kopiert die Originale von Enabler-Lehrtexten in den Dokument-Bucket, nur auf ausdrückliche Nennung und nur nach der Entscheidung zu Abschnitt 8. 7. **Nach der Übernahme.** Der Lauf steht auf "Übernommen", die Dateien im Bucket bleiben 30 Tage (Rückbaufenster), dann räumt der Aufräumjob sie weg. Die Inhalte sind inaktiv. Aktivieren, Indexieren und der Release nach Production sind eigene Entscheidungen (Abschnitt 8).

## 4. Prüfliste vor der Übernahme

- [ ] Der Probelauf ist gelaufen **nach** der letzten Entscheidung (sonst lehnt die Übernahme ab, `DRY_RUN_REQUIRED`).
- [ ] `conflicts` ist leer. Jeder Konflikt wurde verstanden.
- [ ] Die Zahlen passen zur Erwartung: Komponenten, Kurse, Enabler, Quizze, Fragen, Optionen, Verknüpfungen, Dokumente, Use Cases. Bei einem Nachlauf stehen vorwiegend `unchanged`.
- [ ] `skipped` ist gelesen: `ENABLER_MISSING` heißt, ein Quiz oder Szenario wartet auf seinen Lehrtext (im selben Lauf mit hochladen), `SOLUTION_MARKER` und `PARSE_ERROR` sind Quellfehler.
- [ ] Offene Quellfragen aus dem Memory sind bekannt (Szenario 23c im Ordner 23b, Quizfehler 10b, 16e, 11c, 1a High, Enabler 6d bis 6g nicht lesbar, Dubletten Global-Quiz 03 und 04, Use Case 5b).
- [ ] Das Ziel stimmt: lokale Datenbank oder Preview, nie ein anderes Ziel (die Übernahme prüft das selbst und lehnt ab, `TARGET_REFUSED`).
- [ ] Es läuft kein anderer Import (Skript) zur selben Zeit.
- [ ] Der Rückbau ist vorbereitet: wer führt ihn aus, wo liegt die SQL-Datei.

## 5. Rückbau

Der Rückbau ist SQL, das **die Person selbst ausführt**. Die App löscht nie.

1. `rollback-sql` abrufen (Abschnitt 3, Schritt 6). Die Antwort nennt `blockers`, wenn etwas im Weg steht (ein späterer Lauf hat dieselben Zeilen berührt, Inhalte sind aktiv, Daten von Lernenden hängen daran). Dann gibt es keinen Text, erst die Ursache klären.
2. Den Text `sql` als Datei speichern und mit `psql -f` ausführen, **erst als Probe**: der Text endet mit `rollback; -- probe ...`. Das Ergebnis zeigt die Zahl gelöschter Zeilen je Block. Jeder Block bricht bei einer Abweichung der Zeilenzahl ab.
3. Zum echten Rückbau die letzte Zeile `rollback; -- probe ...` durch `commit;` ersetzen und noch einmal ausführen.
4. Prüfen: Die Inhaltstabellen haben wieder den Stand vor der Übernahme. Nicht erledigt vom Text und von Hand zu prüfen: `hai_embeddings` zu gelöschten Quellen (nur wenn indexiert wurde) und Dateien im Bucket `content` (nur wenn Originale veröffentlicht wurden).
5. Nicht während eines Imports ausführen. Die Lauf-Zeilen und das Protokoll bleiben erhalten (der Lauf ist als zurückgebaut markiert, derselbe Lauf lässt sich nicht zweimal zurückbauen).

Ein Rückbau eines früheren Laufs ist erst möglich, wenn spätere Läufe zurückgebaut sind. Läuft nur der Upload schief (vor der Übernahme), genügt "Lauf verwerfen": die Objekte werden sofort gelöscht, die Zeilen nach 7 Tagen.

## 6. Fehlerbilder

| Bild                                                                     | Ursache                                                                                                                                    | Abhilfe                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 404 "The content upload is not available in this environment."           | Production, falsches Schema, unbekanntes `VERCEL_ENV`                                                                                      | richtige Umgebung, Abschnitt 7. Kein Fehler in Production                                                                                                                                                                               |
| 401 oder 403                                                             | nicht angemeldet oder ohne Lehrplan-Schreibrecht                                                                                           | als `SUPER_ADMIN` oder Plattform-`ADMIN` anmelden                                                                                                                                                                                       |
| 429 beim Upload                                                          | mehr als 60 Anforderungen für Upload-Adressen je Minute, oder drei offene Läufe                                                            | warten (Retry-After), Lauf verwerfen                                                                                                                                                                                                    |
| `UNREADABLE` in der Problemliste                                         | der Browser kann die Datei nicht lesen. Unter Windows lesen Chrome und Edge keine Pfade über 259 Zeichen                                   | die betroffenen Ordner in einen Ordner mit kurzem Pfad kopieren (nur die Kopie, die Quelle bleibt) und in einem zweiten Lauf hochladen. Gemessen: von 1447 Dateien der Quelle sind 183 bis 257 betroffen, je nach Länge des Wurzelpfads |
| "größer als erlaubt"                                                     | Datei über 25 MB (gemessen: 2 Enabler-Lehrtexte, größte 36 MB)                                                                             | Bilder verkleinern oder die Datei später über den Skriptweg einspielen                                                                                                                                                                  |
| `HASH_MISMATCH`, `NOT_A_DOCX`, `NOT_A_PDF`, `MACRO_ENABLED`, `ENCRYPTED` | die Datei ist nicht, was sie vorgibt, hat Makros oder ist verschlüsselt                                                                    | Datei prüfen, neu speichern, neuen Lauf                                                                                                                                                                                                 |
| `ENGINE_UNAVAILABLE` bei PDF                                             | der PDF-Leser findet seine Bibliothek nicht (Build ohne die Dateien aus `next.config.ts`)                                                  | neuen Preview-Build, `outputFileTracingIncludes` prüfen (Abschnitt 9)                                                                                                                                                                   |
| 409 `VERSION_CONFLICT`                                                   | jemand hat die Entscheidungen geändert, die Seite war veraltet                                                                             | Seite neu laden                                                                                                                                                                                                                         |
| 409 `RUN_STATE`                                                          | der Lauf ist nicht in der Prüfung                                                                                                          | Status des Laufs ansehen, bei "Übernommen" auf "Erneut prüfen"                                                                                                                                                                          |
| 409 `DRY_RUN_REQUIRED` oder `STALE_DECISIONS` bei der Übernahme          | der Probelauf gehört nicht zum jetzigen Stand der Entscheidungen oder des Plans                                                            | Probelauf wiederholen, dann übernehmen                                                                                                                                                                                                  |
| 400 `CONFIRM_REQUIRED`                                                   | die Tippbestätigung fehlt oder ist falsch (genau `KFBM`)                                                                                   | `confirm: 'KFBM'` senden. Nichts wurde geschrieben                                                                                                                                                                                      |
| 409 `NOTHING_TO_TRANSFER`                                                | keine akzeptierte Datei wurde zu einem Element des Plans                                                                                   | Entscheidungen und `skipped` des Probelaufs ansehen                                                                                                                                                                                     |
| 409 `TARGET_REFUSED`                                                     | die Datenbank passt nicht zum Ziel (zum Beispiel Preview-Rolle in einer lokalen Datenbank, oder Schema `public` auf einem gehosteten Host) | richtige Verbindung. Die Sperre ist gewollt, nicht umgehen                                                                                                                                                                              |
| 409 `NO_ENABLERS`                                                        | die Pläne enthalten keinen Enabler und der Katalog hat keinen                                                                              | zuerst die Enabler-Lehrtexte in den Lauf aufnehmen oder die Struktur mit dem Skript anlegen                                                                                                                                             |
| 422 `PLAN_TOO_LARGE`                                                     | die Dateien konnten nicht im Zeitbudget (40 s) gelesen werden                                                                              | Lauf kleiner schneiden (komponentenweise)                                                                                                                                                                                               |
| 503 "beschäftigt"                                                        | Sperre eines anderen Imports, Serialisierungsfehler, kein freier Platz im Pool                                                             | nach einer Minute wiederholen                                                                                                                                                                                                           |
| `COMMIT_UNCERTAIN`                                                       | die Verbindung riss beim Festschreiben ab, der Ausgang ist unklar                                                                          | **nicht** wiederholen. Zuerst in der Datenbank nachsehen (`content_upload_applies`, Zeilenzahlen), die Kopien im Bucket bleiben dafür liegen                                                                                            |
| Funktion antwortet langsam, Zeitlimit                                    | `maxDuration` der Funktion ist 60 s                                                                                                        | Messung in Abschnitt 8, Lauf kleiner schneiden                                                                                                                                                                                          |

## 7. Was in Production gesperrt ist und welche Sperren gelten

| Sperre                        | Wirkung                                                                                                                                                                                                                                                                                  | Fundort                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| G1 Abschaltung                | Alle Routen und Seiten antworten außerhalb von Preview (Preview-Schema) und lokal mit 404. Unbekannte Werte von `VERCEL_ENV` und ein Produktions-Build ohne `VERCEL_ENV` (Docker, `next start`) sind aus (fail closed). Die Sitzungsprüfung läuft davor, 401 und 403 gelten also überall | `src/lib/content-upload/staging/config.ts` (`evaluateAvailability`) |
| Rollout-Gate                  | Die Migration `20261030000100` liegt über `GATED_FROM` und wird in Production nicht angewendet, solange `KFBM_ROLLOUT_APPROVED` fehlt. Ohne Tabellen kann keine Route in Production etwas tun                                                                                            | `scripts/db/rollout-gate.mjs`                                       |
| Zielprüfung                   | Die Übernahme schreibt nur in eine lokale Datenbank oder in die Preview (Host, Schema, Rolle werden mit den Fakten der eigenen Verbindung geprüft). Schema `public` auf einem gehosteten Host wird abgelehnt                                                                             | `src/lib/content-import/apply/target.ts`                            |
| Berechtigung                  | Nur `requireCurriculumEditor` (Lehrplan-Schreibrecht), Läufe sieht der Ersteller, ein `SUPER_ADMIN` alle                                                                                                                                                                                 | `src/lib/auth/session.ts`                                           |
| Inaktiv                       | `activate` und beide Lösungsschalter sind im Code fest `false` (Test liest die Quelltexte). Es entsteht nie ein aktiver Inhalt                                                                                                                                                           | `transfer/run.ts` (`FIXED_ENGINE_OPTIONS`)                          |
| Tippbestätigung und Probelauf | Übernahme nur mit `confirm: "KFBM"` und nur, wenn der Hash des letzten Probelaufs zum Plan passt                                                                                                                                                                                         | `transfer/store.ts` (das Tor)                                       |
| Kein Modell                   | Es gibt keinen Aufruf an Sokrates oder einen anderen Anbieter, keine Neuindexierung                                                                                                                                                                                                      | Konzept O5, O6                                                      |

## 8. Freigabebedingungen vor Production

Der Upload wird in Production **nicht** eingeschaltet, bevor Folgendes erledigt oder von Niko entschieden ist.

1. **PDF-Leser ohne Sandbox.** Das Lesen von PDF läuft in einem Worker-Thread mit pdf.js 1.10.100 aus 2018. Ein Thread ist keine Sandbox. Empfehlung: Kindprozess mit dem Berechtigungsmodell von Node (`--permission`, nur Lesen des Leser-Ordners) und hartem Speicherlimit, mit einer gepflegten Bibliothek. Das ist eine neue Abhängigkeit und ein eigener Schnitt.
2. **Obergrenze gleichzeitiger Claims je Lauf.** Umgesetzt in U8: höchstens 6 Dateien eines Laufs sind gleichzeitig gehalten, über alle Aufrufe (`MAX_HELD_PER_RUN`, `claimFiles` mit `maxHeld`). Vor Production zusätzlich die Zahl der Instanzen und den Speicher je Funktion messen.
3. **Unbenutzte signierte Upload-URL nach Objektlöschung.** Eine nicht benutzte Upload-Adresse bleibt gültig, auch wenn das Objekt entfernt wurde. Ein Objekt kann nach Ablehnung oder Verwerfen erneut entstehen und wird dann zur Waise (Aufräumen nach Präfix löscht sie nach 7 Tagen). Nur Administratoren, Kosten statt Datenschutz. Vor Production: kürzere Gültigkeit oder Löschen der Waisen im Aufräumjob verbindlich.
4. **Docx-Metadaten der Originale.** Veröffentlichte Originale tragen Autor, Kopf- und Fußzeilen und Dokumenteigenschaften. Vor der Veröffentlichung entfernen oder Entscheidung, dass sie bleiben.
5. **Sichtbarkeit der Originale vor der Aktivierung (Entscheidung von Niko offen).** Eine Zeile `THEORY`/`ALL` am Enabler ist sofort lesbar, auch wenn der Enabler inaktiv ist (wo die Richtlinie `cd_select` noch gilt). Empfehlung: Originale **erst nach der Aktivierung** veröffentlichen, also `publishOriginals` im Lauf leer lassen und die Originale in einem eigenen späteren Lauf mit der Aktivierung übernehmen.
6. **Oberfläche für Probelauf, Übernahme und Rückbau** (Abschnitt 3, Schritt 6) fehlt. Die Konsole genügt für Niko in der Preview, nicht für den Betrieb.
7. Messung der Laufzeit an der echten Preview (Abschnitt 10) und die Entscheidung, ob `maxDuration` erhöht oder die Übernahme als Schritt der Warteschlange gebaut wird.

## 9. Lokale Abnahme wiederholen

Alles läuft gegen Wegwerf-Container, nie gegen die gehostete Preview oder Production.

- **Golden Set (Regelstufe, ohne Modell):** `node scripts/import/kfbm-golden-set.mjs "<Pfad zu Komponente>" --hydrate`. Gibt nur Zahlen aus (Bänder, Anteile, Zeiten, bekannte Dubletten). Beendet sich mit 1, wenn der Anteil ohne KI unter 92 Prozent liegt oder eine Datei mit Band Sicher falsch ist, mit 2 bei falschem Aufruf oder zu vielen nicht lesbaren Dateien. `--mode path` oder `--mode names` wählt einen der beiden Fälle (Ordnerstruktur oder nur Dateiname), `--show-keys` nennt die Inhaltsschlüssel der Sonderfälle.
- **PDF-Leser im Build:** `npm run build` mit Dummy-Variablen, danach in `.next/server/app/api/trainer/content-upload/runs/[runId]/pump/route.js.nft.json` (und `dry-run`, `apply`) nach `pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js`, `pdf.worker.js` und `node-ensure` suchen. Fehlen sie, würde eine Vercel-Funktion jede PDF mit `ENGINE_UNAVAILABLE` beantworten. Die Dateien nennt `outputFileTracingIncludes` in `next.config.ts`. Kein Standalone-Build mit einer verknüpften `node_modules`: Next legt dort eine Verknüpfung an, und der nächste Build leert darüber das Original.
- **Ende zu Ende:** Wegwerf-Postgres (Supabase-Image 17, Struktur aus dem Snapshot, Migrationen bis `20261030000100`, für die Preview-Form zusätzlich der Preview-Rebuild), Dev-Server, eine Attrappe für Auth und Storage, `playwright-core` mit Chrome. Die Abnahmeläufe stehen im Konzept, Notiz "Stand U8".

## 10. Messung der Laufzeit an der echten Preview (offen)

Lokal laufen Probelauf und Übernahme in 15 bis 25 Sekunden (Abschnitt "Stand U8" im Konzept). An der Preview kommen Supavisor, der gehostete Speicher und das reale Zeitlimit der Funktion dazu. Das ist **nicht gemessen**. Anleitung:

1. Einen Lauf mit einer Komponente anlegen (zum Beispiel K1, etwa 40 Dateien), dann einen zweiten mit allen Dateien, die der Browser lesen kann.
2. Je Lauf notieren: Dauer von "Hochladen und verarbeiten" bis zur Prüfliste (Stoppuhr), Dauer des Probelaufs und der Übernahme (`performance.now()` um den Aufruf in der Konsole, oder `ms` in der Antwort der Konsole), Antwortcodes.
3. Im Vercel-Projekt unter Logs der Funktionen `pump`, `dry-run`, `apply` die Dauer und den Speicher je Aufruf ablesen. Grenze: `maxDuration` 60 s, Planbau-Budget 40 s (ab etwa 120 ms je Datei bei 1300 Dateien `PLAN_TOO_LARGE`).
4. Ergebnis ins Konzept eintragen. Liegt der Probelauf über 45 Sekunden, den Lauf komponentenweise schneiden oder die Übernahme als Schritt der Warteschlange bauen (Spike, Stufe 2).
5. Nach den Messläufen den Lauf rückbauen oder verwerfen (Abschnitte 5 und 3), damit die Preview sauber bleibt.

## 11. KI-Stufe (Sokrates)

Stand: 28.10.2026, Paket U5. **Es wurde noch kein echter Aufruf gemacht.** Alles ist gegen eine Attrappe auf localhost getestet. Der erste echte Livetest braucht das ausdrückliche Go von Niko (Abschnitt 11.4).

### 11.1 Was die Stufe tut und was nicht

- Sie nimmt **nur Dateien, die die Regeln `unklar` lassen** (Band Unklar, Dokument mit erkennbarer Lehrstruktur). Sichere, wahrscheinliche und widersprüchliche Dateien gehen nie an Sokrates. Dateien ohne erkennbare Struktur, PDF, Dateien mit Anweisungstext, Dateien mit Lösungsmarke, Kundendokument-Mustern oder mehr als 3 personenbezogenen Mustern gehen auch nicht.
- Gesendet wird ein Auszug von höchstens 2500 Zeichen ohne Lösungsteile, ohne Dateiname und ohne Pfad, dazu die Codes und Titel der Komponenten des Katalogs (Titel nur aus der Datenbank). Der Auszug wird vor dem Senden gegen die Lösungstexte **aller** Dateien des Laufs und der Datenbank geprüft. Deshalb startet die Stufe erst, wenn alle Dateien des Laufs gelesen sind.
- Die Antwort ist nur ein Vorschlag mit der Quelle KI (höchstens Band Wahrscheinlich, Sicherheit höchstens 80 Prozent). Er wird **nie mit einem Klick** übernommen, eine Person nennt die Zuordnung. Widerspricht er den Regeln, bleibt es ein Widerspruch mit den Werten der Regeln.
- Es gibt keinen Fallback auf Gemini, Claude oder OpenRouter, und keinen Aufruf einer anderen Adresse als der von Sokrates.

### 11.2 Voraussetzungen und Schalter

| Voraussetzung | Wert und Prüfung |
| --- | --- |
| Schutzschalter des Betreibers | Vercel-Variable `CONTENT_UPLOAD_KI_ENABLED` genau `true`. Ohne sie oder mit jedem anderen Wert **sendet nichts**. Standard: aus |
| Schlüssel | `OPENAI_COMPATIBLE_API_KEY` (dieselbe Variable wie der Chat). Nur aus der Umgebung, nie im Protokoll |
| Adresse | `OPENAI_COMPATIBLE_BASE_URL`, Standard `https://sokrates.test-qualitaetsmanagement.com/api`. Nur https, Standardport, keine Zugangsdaten, nur ein Host der Positivliste. Eine falsch gesetzte Variable schaltet die Stufe ab, sie sendet nichts an einen anderen Host |
| Positivliste der Hosts | Standard nur `sokrates.test-qualitaetsmanagement.com`. `CONTENT_UPLOAD_KI_ALLOWED_HOSTS` ersetzt die Liste (genaue Namen, mit Punkt, höchstens 5). Die Liste prüft den Namen, nicht die aufgelöste Adresse: ein Name, der auf eine interne Adresse zeigt, wäre erlaubt. Nur der Betreiber setzt sie |
| Modell | `OPENAI_COMPATIBLE_MODEL`, dasselbe Modell wie der Chat (Entscheidung O5). Der Modellname steht im Protokoll |
| Obergrenzen (optional) | `CONTENT_UPLOAD_KI_MAX_CALLS_PER_RUN` (Standard 1500), `CONTENT_UPLOAD_KI_MAX_CALLS_PER_DAY` (Standard 3000, alle Läufe, gleitende 24 Stunden), `CONTENT_UPLOAD_KI_TIMEOUT_MS` (Standard 15000, höchstens 20000). Je Datei höchstens 3 Aufrufe |
| Opt-in je Lauf | Beim Anlegen des Laufs die Option "Auszüge zur Einordnung an Sokrates senden" ankreuzen. **Standard aus**, später nicht änderbar |
| Umgebung | nur Preview oder lokal. In Production ist der ganze Upload aus, also auch diese Stufe |
| Open WebUI (Entscheidung O13) | Vor dem ersten Lauf klären, ob Open WebUI Anfragen über die Schnittstelle speichert oder protokolliert und wie lange. Sonst liegen die Auszüge dort |

### 11.3 Was in der Prüfliste zu sehen ist

| Anzeige | Bedeutung |
| --- | --- |
| Quelle "KI-Vorschlag" mit Hinweis | Der Vorschlag stammt von Sokrates. Er ist keine Entscheidung. Bitte prüfen. Der Knopf "Übernehmen" öffnet den Editor, die Person nennt die Zuordnung |
| "KI widerspricht den Regeln" (Band Widerspruch) | Die Regeln und Sokrates nennen Verschiedenes. Die Werte der Regeln bleiben, die Person entscheidet |
| "Nicht an die KI gesendet" | Die Datei war nicht für die KI geeignet oder die Prüfung vor dem Senden hat sie ausgeschlossen. Der Code in den Details nennt den Grund (zum Beispiel `STRUCTURE_UNKNOWN`, `INSTRUCTION_TEXT`, `GUARD_REFUSED`, `PII_THRESHOLD`) |
| "KI nicht erreichbar oder ohne Antwort" | Zeitüberschreitung, Serverfehler oder die Datei hat ihre Aufrufe verbraucht |
| "Antwort der KI nicht verwertbar" | kein JSON, ein Code außerhalb der Liste. Es wurde nichts übernommen |
| "KI konnte nicht einordnen" | Sokrates hat "unbekannt" geantwortet |

Der gesendete Auszug wird **nicht** gespeichert und nicht angezeigt. Das Protokoll (`content_upload_ki_calls`) hält je Aufruf: Lauf, Datei, Stufe, Modell, Host, Länge und SHA-256 des Auszugs, Zahl der ersetzten Muster, Status, HTTP-Status, Dauer, Tokenzahlen, Nummer des Versuchs und die geprüfte Antwort ohne Begründungstext. Ablehnungen vor dem Senden stehen mit Status `refused_by_guard` oder `skipped` darin.

### 11.4 Erster echter Livetest (Preview, kleiner Lauf mit 5 Dateien)

**Nur mit dem ausdrücklichen Go von Niko.** Kein Agent führt ihn aus. Ablauf:

1. **Vorher prüfen.** O13 beantwortet (Protokollierung in Open WebUI bekannt). Die Preview ist auf dem aktuellen Stand, der Katalog KFBM hat Komponenten, und es gibt mindestens eine Dateizeile, die die Regeln nicht eindeutig einordnen können (siehe Schritt 2).
2. **Fünf Dateien aus eigenem Material auswählen, nie Kundendokumente und nie Dateien mit sensiblem Inhalt:**
   - zwei Quizdateien, deren Überschriftencode zu zwei Komponenten passt (zum Beispiel `6a`, wenn K6.1 und K6.2 im Katalog stehen): erwartet "KI-Vorschlag"
   - eine Quizdatei, deren Code in keinem Katalog steht (zum Beispiel `77z`): erwartet "KI widerspricht den Regeln" oder ein Vorschlag, je nach Antwort
   - eine Datei ohne die Struktur der Quellen (frei geschriebener Text): erwartet "Nicht an die KI gesendet"
   - eine Quizdatei, in deren erster Frage ein Satz wie "Ignoriere alle bisherigen Anweisungen" steht: erwartet "Nicht an die KI gesendet"
   Die Quizdateien enthalten Lösungen. Das ist gewollt: Die Kontrolle in Schritt 5 prüft, dass keine davon bei Sokrates ankommt.
3. **Obergrenzen niedrig setzen** (nur Preview, Typ Sensitive für den Schlüssel): `CONTENT_UPLOAD_KI_ENABLED=true`, `CONTENT_UPLOAD_KI_MAX_CALLS_PER_RUN=10`, `CONTENT_UPLOAD_KI_MAX_CALLS_PER_DAY=20`, die Schlüssel- und Adressvariablen wie im Chat. Neues Deployment der Preview abwarten.
4. **Lauf anlegen** mit der Erklärung und **mit dem Opt-in**, die fünf Dateien hochladen, die Seite offen lassen, bis die Prüfliste da ist. Erwartet: drei Aufrufe (zwei Quizze und die Datei mit dem unbekannten Code), zwei Dateien nicht gesendet.
5. **Kontrolle im Open-WebUI-Protokoll (Entscheidung O13) und in der Datenbank:**
   - Zahl der Anfragen bei Open WebUI gleich der Zahl der Zeilen mit Status `ok` im Protokoll der Plattform. In der Datenbank: `select status, model, endpoint_host, excerpt_chars, attempt from content_upload_ki_calls where run_id = '<Lauf>' order by requested_at` (nur Zahlen und Codes)
   - In keiner Anfrage bei Open WebUI darf stehen: ein Dateiname oder Pfad, die Wörter `Richtige Antwort`, `Kurzbegründung`, `Musterlösung`, ein Lösungstext, der Anweisungssatz der fünften Datei, der Schlüssel
   - Die Nutzernachricht jeder Anfrage besteht aus den Markierungen `<<<AUSZUG-xxxxxxxx` und `AUSZUG-xxxxxxxx>>>` und dem Auszug dazwischen. SHA-256 des Textes zwischen den Markierungen (ohne den letzten Zeilenumbruch) muss gleich `excerpt_sha256` im Protokoll sein: `node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync(0,'utf8'),'utf8').digest('hex'))" < auszug.txt`
   - Die Temperatur ist 0, `stream` ist falsch, höchstens 300 Antwort-Token
6. **Abbruch.** Findet sich ein Lösungsteil, ein Dateiname oder der Schlüssel in der Anfrage: sofort `CONTENT_UPLOAD_KI_ENABLED` entfernen (Schutzschalter) und den Befund melden. Nicht weiter testen.
7. **Aufräumen.** Lauf verwerfen. Einträge in Open WebUI löschen oder Aufbewahrung klären. `CONTENT_UPLOAD_KI_ENABLED` entfernen, wenn kein weiterer Lauf folgt.

### 11.5 Bremsen

| Bremse | Wirkung |
| --- | --- |
| Schutzschalter `CONTENT_UPLOAD_KI_ENABLED` | aus: kein Aufruf, die Dateien bleiben `unklar` ohne Vermerk und werden bei eingeschalteter Stufe später genommen |
| Opt-in des Laufs | ohne Opt-in kein Aufruf für diesen Lauf |
| Aufrufe je Lauf, je Tag, je Datei | bei Erreichen werden keine weiteren Dateien genommen. Der Lauf kommt trotzdem in die Prüfung |
| Schutzschalter bei Fehlern | 5 Fehler in Folge (Zeitüberschreitung, Serverfehler, kein JSON) halten die Stufe des Laufs 10 Minuten an, danach geht ein Versuch hinaus. Ein abgelehnter Schlüssel (401, 403, 404) zählt dazu und markiert keine Datei |
| Zeit und Größe | 15 Sekunden je Aufruf (auch beim Lesen der Antwort), Antwort höchstens 32 KB, keine Weiterleitung |
| Wiederholung | bei Zeitüberschreitung, 429, 5xx oder kaputtem JSON ein zweiter Versuch nach 10 Sekunden, danach ist die Datei fertig mit der Stufe |

### 11.6 Bekannte Grenzen

- Eine Datei ohne erkennbare Struktur geht nie an die KI. Der Opt-in je Datei ("Auszug an Sokrates senden") ist nicht gebaut.
- Das Band Wahrscheinlich geht nicht an die KI (die Regeln haben dort schon entschieden, Entscheidung U4).
- Eine Datei, die die Stufe nicht einordnen konnte, wird nicht erneut genommen. Eine Schaltfläche "KI erneut versuchen" gibt es nicht. Ein neuer Lauf nimmt sie wieder.
- Der Aufbau der Liste der Lösungstexte liest jede Word-Datei des Laufs einmal aus dem Speicher und hält sie bis zu 10 Minuten im Arbeitsspeicher der Instanz. Bei einem Lauf mit allen 1445 Dateien kostet das mehrere Sekunden je Aufruf der Pumpe, bis die Liste fertig ist (nicht an der echten Preview gemessen).
- Die Zähler der Obergrenzen werden vor dem Aufruf geprüft: bei gleichzeitigen Aufrufen sind wenige Aufrufe mehr möglich.
