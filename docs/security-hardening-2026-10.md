# Supabase-Härtung Oktober 2026

Stand 23.10.2026. Grundlage: lesende Messung der Produktion (Projekt FIEA-Production) und Suche im Code. Nichts davon wurde angewendet. Die Dateien sind nur statisch geprüft, ein Probelauf auf einem Klon oder Supabase-Branch steht aus.

## Gefundene Lücken

| Nr | Fund | Datei |
| --- | --- | --- |
| 1 | Sechs Tabellen ohne RLS, die Rolle `anon` hat alle Rechte darauf (`reflections` 4 Zeilen, `ihk_grade_legend`, vier `_backup_*` mit zusammen über 21.000 Zeilen) | `supabase/migrations/20261023100000_security_lock_unused_tables.sql` |
| 2 | `hai_embeddings` für jeden lesbar (inklusive Trainerlösungen), `hai_reindex_jobs` für jeden les- und schreibbar (Policy "Service role full access" gilt für die Rolle `public`) | `supabase/migrations/20261023100100_security_close_hai_policies.sql` |
| 3 | 19 Inhaltstabellen anonym lesbar, darunter `options` mit den richtigen Antworten | `supabase/migrations/20261023100200_security_close_anonymous_content_reads.sql` |
| 4 | Bucket `content`: jeder angemeldete Nutzer darf alle Dateien lesen, ändern und löschen. Bucket `avatar`: eine Policy erlaubt Uploads in jeden Ordner | `supabase/manual/20261023_storage_policies.sql` (von Hand, Storage ist geteilt) |

Nicht gelöst: Der Bucket `content` bleibt öffentlich, wer eine Datei-URL kennt, kann sie öffnen. Dafür braucht es einen privaten Bucket mit Signed URLs und eine Umstellung der gespeicherten Links (eigene Aufgabe, Paket 1.3 im Umbauplan).

## Auswirkung auf die Produktion

Grundlage: Die App verbindet über Drizzle als Rolle `postgres` (hat BYPASSRLS, gemessen an den aktiven Verbindungen). Über supabase-js greift der Code nur auf `profiles`, `notifications` und Storage zu (Suche in `src`).

| Datei | Wirkung auf die App | Wirkung nach außen | Risiko |
| --- | --- | --- | --- |
| 1 Tabellen sperren | keine, der Code nutzt die Tabellen nicht | anonymer und angemeldeter Zugriff über die REST-Schnittstelle endet, Daten bleiben | gering |
| 2 HAI-Policies | keine, Drizzle umgeht RLS | anonymes Lesen der Embeddings und Schreiben der Reindex-Jobs endet | gering |
| 3 Inhaltslesen | keine, der Katalog und alle Listen laufen über Drizzle | Fremdwerkzeuge mit dem anon-Schlüssel verlieren den Zugriff | gering bis mittel, nur falls außerhalb des Repos etwas die REST-Schnittstelle nutzt |
| 4 Storage | Uploads mit der Nutzersitzung in den eigenen Ordner `<auth-uid>/...` laufen weiter, Lesen über öffentliche URLs ist unabhängig von Policies, Löschen macht der Server mit dem Service-Key | Nutzer sehen und ändern nur noch den eigenen Ordner | mittel, siehe Annahmen |

Annahmen, die ein Mensch vor dem Anwenden prüft:
- Es gibt keine weiteren Aufrufer außerhalb dieses Repositories, die die REST-Schnittstelle mit dem anon-Schlüssel auf diese Tabellen nutzen (BI-Werkzeuge, andere Apps, Skripte).
- Alle Uploads in `content` verwenden die Auth-ID als ersten Ordner. Gefunden: `PdfUploader` (Trainer: `profile.id`, Aktivitätsnachweise: `profile.id`) und `Profile.tsx` für `avatar`. Profil-ID und Auth-ID sind identisch.
- Skripte mit dem Service-Key (Import, Backup) sind nicht betroffen, der Service-Key umgeht Policies.

## Reihenfolge und Vorbereitung

1. Sicherung (Supabase-Backup oder Point-in-Time) und Policy-Liste sichern: `select * from pg_policies where schemaname in ('public','storage')`.
2. Probelauf der Dateien 1 bis 3 auf einem Supabase-Branch oder Klon.
3. Anwenden in der Reihenfolge 1, 2, dann Storage-Datei, zuletzt 3.
4. Smoke-Test.
5. Bei Problemen: Die Rückgängig-Anweisungen stehen am Kopf jeder Datei.

Die Migrationen sind so geschrieben, dass sie bei fehlenden Tabellen nichts tun und bei einem zweiten Lauf nichts ändern (`drop policy if exists`, `enable row level security` ist wiederholbar).

## Smoke-Test nach dem Anwenden

Mit zwei Konten (Trainer, Azubi) in der Live-Umgebung:
- Anmelden und Abmelden, Profil laden, Avatar hochladen.
- Trainer: Kursliste, Enabler öffnen, PDF im Inhaltseditor hochladen, Dokument ansehen, Dokument löschen.
- Azubi: Dashboard, Kurs, Enabler-Quiz durchführen, Use-Case-Abgabe, Berichtsheft mit PDF-Upload.
- HAI-Chat: Frage stellen, Quellen werden angezeigt.
- Öffentliche Katalog- und Startseite laden.
- Gegenprobe mit dem öffentlichen Schlüssel (nur lesend, ohne Anmeldung): `/rest/v1/hai_embeddings`, `/rest/v1/options` und `/rest/v1/reflections` liefern keine Zeilen mehr oder einen Fehler.

## Weitere offene Punkte in der Produktion (nicht Teil dieser Dateien)

- Auth: Registrierung ohne E-Mail-Bestätigung (`mailer_autoconfirm`), Site URL steht auf `http://localhost:3000`. Beides im Dashboard prüfen. Die Rechteausweitung über die Nutzer-Metadaten schließt PR 85.
- Vercel: `DB_CONNECTION_STRING` und `HAI_DB_CONNECTION_STRING` sind nur als "encrypted" gespeichert, besser "sensitive".
- Schlüssel: Die Legacy-JWT-Schlüssel (anon, service_role) sind noch aktiv, ein geleakter `service_role`-Schlüssel steht in der Git-Historie. Legacy-Schlüssel lassen sich im Dashboard nur abschalten. Das erst tun, nachdem Vercel und Code auf die neuen Schlüssel umgestellt sind (PR 85 unterstützt beide Namen).

## Admin-PIN-Nachweis und Dokumentpfade (Anwendungscode, keine Migration)

**Admin-PIN als echtes Gate.** `POST /api/hai/verify-pin` prüft die PIN wie bisher (Ratenbegrenzung pro Person und Adresse) und liefert bei Erfolg zusätzlich `proof` und `expiresAt`. Der Nachweis hat die Form `v1.<Ablauf in ms>.<HMAC-SHA256 hex>`, gilt 10 Minuten und ist an die Profil-Id der Sitzung und den Zweck `hai-index-admin` gebunden. Die Routen `POST /api/hai/embed`, `DELETE /api/hai/embed` und `POST /api/hai/sync` verlangen ihn im Header `x-admin-pin-proof`, nach der Rollenprüfung. Fehlt er, ist er abgelaufen oder gehört er einer anderen Person, antworten sie mit 403. Die lesenden Statusabfragen (`GET`) bleiben nur an die Rolle gebunden. Der Browser hält den Nachweis nur im Speicher des Dialogs.

**Schlüssel, keine neue Umgebungsvariable.** Der HMAC-Schlüssel wird aus dem serverseitigen Supabase-Schlüssel (`SUPABASE_SECRET_KEY`, ersatzweise `SUPABASE_SERVICE_ROLE_KEY`) abgeleitet, den jede Umgebung schon hat. Fehlt er oder ist er kürzer als 16 Zeichen, antworten `verify-pin` und die gesicherten Routen fail closed mit 503. Wird der Schlüssel gewechselt, verfallen offene Nachweise (höchstens 10 Minuten), die PIN muss dann erneut eingegeben werden. `HAI_ADMIN_PIN` bleibt unverändert die PIN selbst.

**Speicherpfade der Dokumente.** Die Dokument-Routen für Enabler und Use Cases nehmen als `storageUrl` nur noch die öffentliche URL einer eigenen Datei an: Projekt-URL aus `NEXT_PUBLIC_SUPABASE_URL`, Bucket `content`, Pfad `[preview/]<eigene Profil-Id>/<Zeitstempel>_<Dateiname>`, ohne Punktsegmente, ohne Kodierungen, ohne Query. `storagePath` wird aus der URL abgeleitet. Beim Löschen eines Dokuments wird die Datei nur entfernt, wenn sie im Ordner der Person liegt, die das Dokument hochgeladen hat, und wenn kein anderes Dokument und kein Enabler (`ppt_url`, `scenario_pdf_url`, `video_url`) auf dieselbe Datei zeigt. Dateien des Bulk-Imports (`use-cases/...`) bleiben beim Löschen im Storage liegen.

