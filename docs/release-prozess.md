WAMOCON GmbH, Mergenthalerallee 79-81, 65760 Eschborn

# Release-Prozess: Preview und Production mit zwei Schemas

Stand: Oktober 2026. Gilt für das Repository Wamocon_FIAE (Next.js, Drizzle, Supabase, Vercel).

## 1. Kurzfassung

Production und Preview teilen sich eine Supabase-Datenbank, aber nicht das Schema.

- `public` ist Production.
- `public_preview` ist Preview, eine Strukturkopie von `public`.

Preview bekommt nie Produktionsdaten. Die Struktur wird aus `public` geklont, Inhalte entstehen über Seed, Import oder den Inhaltsabgleich. Nach Production gelangt nur durch ein veröffentlichtes Release etwas: erst die Struktur-Migration, dann der Abgleich der Ausbildungsinhalte, dann das Deployment. Ein Merge auf `master` verändert Production nie.

## 2. Ereignisse, Migration und Deployment

| Ereignis                                                                                           | Workflow           | Migration                                                          | Deployment                                             |
| -------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------ |
| Branch angelegt und gepusht (Migrationen oder Preview-Skripte geändert, kein offener Pull Request) | Preview Migration  | `public_preview`                                                   | keines                                                 |
| Pull Request geöffnet, danach jeder Push in den Pull Request                                       | Preview Deploy     | `public_preview`                                                   | Preview                                                |
| Pull Request gemergt (Push auf `master`)                                                           | Preview Deploy     | `public_preview`                                                   | Preview, nie Production. `public` wird nicht migriert. |
| Release veröffentlicht (ohne Prerelease)                                                           | Release Production | `public` (Struktur), danach Inhaltsabgleich der Ausbildungsinhalte | Production                                             |
| Manuell: Production Deploy                                                                         | Production Deploy  | keine, nur lesende Prüfung                                         | letztes Release                                        |
| Manuell: Preview Deploy                                                                            | Preview Deploy     | optional (`run_migration`)                                         | Branch nach Wahl                                       |
| Manuell: Inhaltsabgleich                                                                           | Content Sync       | Trockenlauf (Standard) oder Anwenden                               | keines                                                 |
| Manuell: Preview zurücksetzen                                                                      | Preview Reset      | Plan (Standard) oder Neuaufbau von `public_preview`                | keines                                                 |
| Täglich 04:17 UTC                                                                                  | Database Drift     | nur lesend                                                         | keines                                                 |
| Pull Request mit Änderungen an Datenbank oder Workflows                                            | Database Checks    | keine, kein Secret, keine Datenbank                                | keines                                                 |

Die Reihenfolge im Release ist per `needs` erzwungen: `guard`, dann `migrate`, dann `content-sync`, dann `deploy`. Schlägt ein Job fehl, startet "Re-run failed jobs" an der Stelle des Fehlers. Jeder Schritt ist wiederholbar.

Zwei Begrenzungen beim Push auf einen Branch: Der Lauf startet nur, wenn sich `supabase/migrations/**` oder die Preview-Skripte geändert haben, und er wird übersprungen, sobald für den Branch ein offener Pull Request existiert (dann übernimmt der Lauf des Pull Requests, damit nichts doppelt läuft).

## 3. Aufbau

| Datei                                                          | Zweck                                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `.github/workflows/preview-migration.yml`                      | Branch-Push: Migration von `public_preview`                                                     |
| `.github/workflows/deploy-preview.yml`                         | Pull Request, Push auf `master`, manuell: Migration von `public_preview` und Preview-Deployment |
| `.github/workflows/release-production.yml`                     | Release: `guard`, `migrate`, `content-sync`, `deploy`                                           |
| `.github/workflows/deploy-production.yml`                      | Manuell: letztes Release nach Production                                                        |
| `.github/workflows/content-sync.yml`                           | Manuell: Inhaltsabgleich (Trockenlauf als Standard)                                             |
| `.github/workflows/db-drift.yml`                               | Täglich, nur lesend                                                                             |
| `.github/workflows/preview-reset.yml`                          | Manuell: `public_preview` neu aus der Struktur von `public` aufbauen                            |
| `.github/workflows/db-checks.yml`                              | Pull Request: Skript-Tests und Migrationsprüfung, ohne Secrets                                  |
| `.github/actions/db-setup`, `preview-migrate`, `vercel-deploy` | Wiederverwendbare Bausteine im Repository                                                       |
| `scripts/db/*.mjs`                                             | Prüfung, Umschreiben, Preview-Migration, Drift, Vergleich, Inhaltsabgleich                      |
| `supabase/content-tables.json`                                 | Allowlist des Inhaltsabgleichs                                                                  |
| `supabase/legacy-migrations.txt`, `supabase/known-drift.txt`   | Bekannte Altlasten (mit Begründung)                                                             |
| `supabase/preview-setup/01` bis `04`                           | SQL-Vorlagen für die einmalige Preview-Einrichtung                                              |
| `src/lib/db-schema.ts`                                         | Zentrale Schema-Auswahl der App                                                                 |

Das alte `deploy.yml` (Aufruf des Remote-Workflows `Wamocon/github_workflow`) ist ersetzt.

### Entscheidung: lokale Bausteine statt Remote-Workflow

Der Remote-Workflow hat keinen `ref`-Input, setzt bei leerem `db_schema` den Wert `public` (ein Preview-Deployment würde dann Produktionsdaten lesen) und legt mit einem persönlichen Token Vercel-Projekte und Secrets an. Deshalb liegt die Deploy-Logik als lokale Composite Action im Repository. Das Schema ist dort kein Input, sondern folgt aus dem Ziel (Preview oder Production), der Stand des Codes kommt vom Checkout des aufrufenden Jobs, die Vercel-CLI ist fest gepinnt. Composite Actions laufen im aufrufenden Job, deshalb stehen Environment-Secrets sicher zur Verfügung.

## 4. Schutz vor Schema-Verwechslung

1. Der Preview-Deploy setzt `NEXT_PUBLIC_DB_SCHEMA` und `SUPABASE_DB_SCHEMA` immer fest auf `public_preview`, Production fest auf `public`. Die Werte aus dem Vercel-Projekt werden überschrieben, `scripts/db/deploy-env.mjs` prüft das Ergebnis und bricht bei Abweichung ab.
2. Dasselbe Skript prüft die Datenbank-Rolle in `DB_CONNECTION_STRING`: Preview muss als `app_preview` verbinden, Production darf es nicht.
3. `next.config.ts` bricht den Build ab, wenn ein Vercel-Production-Build nicht `public` oder ein Vercel-Preview-Build nicht `public_preview` nutzt. Ungültige Werte brechen jeden Build ab.
4. Die App prüft beim ersten Datenbankzugriff, ob Rolle und Schema zusammenpassen (`assertRoleMatchesSchema`).
5. Die Rolle `app_preview` hat ihren `search_path` auf Rollenebene (`public_preview, extensions`) und keine Rechte auf `public`. Der rollenbasierte `search_path` ist hinter dem Pooler robuster als ein Startparameter und schlägt sicher fehl.
6. Ohne gesetzte Variablen läuft die App wie bisher auf `public`.

`NEXT_PUBLIC_*` wird beim Build eingebacken. Jedes Deployment bekommt deshalb einen eigenen Build, nichts wird zwischen Preview und Production hochgestuft.

## 5. Secrets und Variablen

Es werden nur Namen genannt, nie Werte.

### GitHub (Repository, Environments `Production` und `Preview`)

| Name                        | Art                             | Wo                                     | Zweck                                                                        |
| --------------------------- | ------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`     | Secret                          | Environment `Production` und `Preview` | Supabase CLI (persönliches Zugriffstoken, am besten ein eigenes nur dafür)   |
| `VERCEL_TOKEN`              | Secret                          | Environment `Production` und `Preview` | Vercel CLI                                                                   |
| `VERCEL_ORG_ID`             | Secret                          | Environment `Production` und `Preview` | Vercel Team oder Konto                                                       |
| `VERCEL_PROJECT_ID`         | Secret                          | Environment `Production` und `Preview` | Vercel Projekt                                                               |
| `SUPABASE_PROJECT_REF_PROD` | Variable (Repository)           | Repository                             | Projekt-Referenz, nicht hartkodiert und kein Secret                          |
| `CONTENT_SYNC_OWNER_EMAIL`  | Variable (Repository), optional | Repository                             | Profil, das als Ersteller synchronisierter Kurse und Quizze eingetragen wird |

Hinweis: Beim ersten Lauf auf dem Branch war bereits ein `SUPABASE_ACCESS_TOKEN` sichtbar (als Organisations- oder Repository-Secret). Bitte prüfen, ob er für dieses Projekt gedacht ist, und ihn auf die Environments begrenzen. Ohne die Variable `SUPABASE_PROJECT_REF_PROD` bricht jeder Lauf vor dem ersten Datenbankzugriff ab.

### Vercel-Projekt (Laufzeit der App, nicht GitHub)

| Name                                          | Preview                                            | Production                              |
| --------------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| `DB_CONNECTION_STRING`                        | Benutzer `app_preview.<Projekt-Referenz>` (Pooler) | wie bisher                              |
| `NEXT_PUBLIC_SUPABASE_URL`                    | wie Production (geteilte Auth)                     | wie bisher                              |
| Neuer Schlüsselname, serverseitig             | `SUPABASE_SECRET_KEY` (Präfix `sb_secret_`)        | `SUPABASE_SECRET_KEY`                   |
| Alter Schlüsselname, serverseitig             | `SUPABASE_SERVICE_ROLE_KEY`                        | `SUPABASE_SERVICE_ROLE_KEY`             |
| Neuer Schlüsselname, öffentlich               | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`             | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`  |
| Alter Schlüsselname, öffentlich               | `NEXT_PUBLIC_SUPABASE_ANON_KEY`                    | `NEXT_PUBLIC_SUPABASE_ANON_KEY`         |
| `NEXT_PUBLIC_DB_SCHEMA`, `SUPABASE_DB_SCHEMA` | nicht setzen, der Deploy setzt sie fest            | nicht setzen, der Deploy setzt sie fest |

Production nutzt jetzt die neuen Schlüsselnamen. Der Code dieses Repositories liest an 17 Stellen noch die alten Namen (`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Das gehört nicht zu diesem Paket. Bis die Umstellung im Code erfolgt ist, müssen beide Paare in Vercel gepflegt werden, sonst fehlen der App die Schlüssel.

## 6. Einmalige menschliche Schritte

Die Workflows führen nichts davon aus. Solange Secrets und Variablen fehlen, scheitern alle Läufe sicher in der ersten Prüfung.

1. **Schema in Supabase freigeben.** Im Supabase-Dashboard unter Project Settings, Data API, "Exposed schemas" das Schema `public_preview` ergänzen. Ohne diesen Schritt kann supabase-js (`db.schema`) das Schema nicht ansprechen.
2. **GitHub Environments anlegen.**
   - `Production`: unter "Required reviewers" mindestens eine Person eintragen, "Deployment branches and tags" auf `master` und Release-Tags beschränken. Ein Release braucht bis zu drei Freigaben, je eine für `migrate`, `content-sync` und `deploy`.
   - `Preview`: ohne Reviewer, alle Branches erlaubt.
   - Secrets laut Abschnitt 5 im jeweiligen Environment eintragen, die Variablen im Repository.
3. **Baseline der Production-Migrationen abgleichen.** Die 56 Drizzle-Dateien unter `src/db/migrations/drizzle` sind Historie und keine abspielbare Kette, sie bleiben unangetastet. Die Datei `202606260001_schema_only_ausbildung_duration.sql` ist von Hand in Production angewendet worden. Damit `supabase db push` sie nicht ein zweites Mal ausführt, gleicht ein Mensch das Ledger einmal ab (nicht ausgeführt durch dieses Paket):
   1. `supabase link --project-ref <Projekt-Referenz>`
   2. `supabase migration list --linked` und den Stand von lokalen Dateien und Ledger vergleichen.
   3. Für die bereits angewendete Datei `supabase migration repair --status applied 202606260001`. Wurde sie über das Supabase-Werkzeug mit einem Zeitstempel als Version eingetragen, diesen Eintrag mit `supabase migration repair --status reverted <Version>` entfernen.
   4. `supabase db push --linked --dry-run` muss "Remote database is up to date." melden. Erst dann das erste Release.

   Solange das nicht erledigt ist, stoppt der Baseline-Guard (`scripts/db/baseline-guard.mjs`) den Release-Lauf.

4. **Preview einrichten.**
   1. `supabase/preview-setup/01-preview-role.sql` im SQL-Editor ausführen (Schema, Rechte, Rolle `app_preview`). Danach das Passwort der Rolle von Hand setzen (siehe Kommentar in der Datei) und nirgends ablegen.
   2. In Vercel für die Umgebung Preview `DB_CONNECTION_STRING` mit dem Benutzer `app_preview.<Projekt-Referenz>` eintragen, dazu die Supabase-Schlüssel (Abschnitt 5).
   3. Workflow "Preview Reset" mit Modus `plan` starten, Ausgabe prüfen, dann mit `execute`. Das klont die Struktur von `public` (nur Struktur, keine Zeilen) und führt `03-preview-side.sql` aus.
   4. `supabase/preview-setup/02-production-side.sql` ausführen. Das ist die einzige Änderung an Production: feste `search_path` der Hilfsfunktionen `get_user_org_id` und `is_platform_owner` sowie die Bedingung am Auth-Trigger, damit Preview-Nutzer (Anmelde-Metadatum `env=preview`) in Production übersprungen werden. Vorher Sicherung, Abschnitt 0 der Datei zuerst lesen.
   5. `supabase/preview-setup/04-verify.sql` ausführen und die erwarteten Ergebnisse vergleichen.
   6. Inhalt in Preview: Seed, Import oder Inhaltsabgleich in Richtung `production-to-preview` (zuerst als Trockenlauf).
5. **Releases von Hand veröffentlichen.** Mit dem `GITHUB_TOKEN` eines Workflows erzeugte Releases lösen keine Workflows aus (GitHub-Regel). Ein Release muss von einer Person oder mit einem persönlichen Token beziehungsweise einer GitHub-App erstellt werden. Releases entstehen nur aus `master`, der Release-Lauf prüft das.

## 7. Einschränkungen

Bitte vor dem Einsatz lesen. Die Preview-Umgebung ist bewusst günstig gebaut und hat Grenzen.

- **Geteiltes Preview-Schema.** Alle Branches und Pull Requests migrieren dasselbe `public_preview`. Die Migration eines noch ungeprüften Branches läuft dort vor dem Review. Zwei Branches mit unvereinbaren Migrationen stören sich gegenseitig. Gegenmaßnahmen: Datenbanksperre pro Migration, Verlauf mit Prüfsumme (eine nachträglich geänderte, schon angewendete Datei bricht den Lauf ab), Warnung bei Migrationen anderer Branches, Concurrency-Gruppen, die nie abbrechen. Wenn nichts mehr hilft: Workflow "Preview Reset". Er löscht alle Preview-Daten.
- **Geteilte Auth.** Preview und Production nutzen dieselben Supabase-Nutzer. Ein Preview-Nutzer ist ein echter Auth-Nutzer, der durch das Metadatum `env=preview` nur in `public_preview` ein Profil bekommt. Dieselbe E-Mail-Adresse kann nicht gleichzeitig ein Konto in Production und eines in Preview haben. Passwörter und Sitzungen gelten für beide Anwendungen.
- **Geteilter Storage.** Die Buckets `avatar` und `content` sind geteilt. Uploads aus Preview landen unter dem Präfix `preview/`, die Richtlinien dafür legt `03-preview-side.sql` an. Dateien, die über den Inhaltsabgleich nach Production gelangen, behalten ihren Pfad unter `preview/`.
- **Clusterweite Objekte.** Rollen, Publikationen (Realtime) und Erweiterungen gibt es nur einmal. Migrationen, die sie ändern, werden für Preview abgelehnt, die Realtime-Mitgliedschaft der Preview-Tabellen setzt `03-preview-side.sql`.
- **Preview läuft Production voraus.** `public_preview` hat Migrationen, die `public` noch nicht hat. Das ist gewollt. Der Drift-Check meldet es nur als Hinweis.
- **Migrationen müssen rückwärtskompatibel sein.** Zwischen Migration und Deployment läuft kurz die alte App gegen das neue Schema. Erst erweitern, später aufräumen.
- **Rolle `app_preview`** umgeht Row Level Security (wie `postgres` für Production), hat aber keine Rechte auf `public`. `04-verify.sql` belegt das.
- **Inhaltsabgleich.** Siehe Abschnitt 8, die Schlüssel sind vorläufig.

## 8. Inhaltsabgleich

`scripts/db/content-sync.mjs` gleicht ausschließlich Ausbildungsinhalt ab, gesteuert von der Allowlist `supabase/content-tables.json`.

Regeln:

- Additiv und nie zerstörend: fehlende Zeilen werden eingefügt, vorhandene je Tabelle aktualisiert (`newer`, `always` oder `never`), gelöscht wird nie etwas.
- Der Abgleich erkennt Zeilen über konfigurierbare Schlüsselspalten (`key`). Fremdschlüssel werden über den Schlüssel der Elterntabelle übersetzt, weil die Ids der Schemas verschieden sind. Eine Zeile, deren Elter nicht übersetzt werden kann, wird übersprungen und gezählt.
- Alles oder nichts: ein Lauf in einer Transaktion unter Sperre. Ein nicht eindeutiger Schlüssel bricht ab.
- Trockenlauf ist Standard (Transaktion mit Rollback, genaue Zahlen). Mit Anwenden folgt ein zweiter Trockenlauf, der null Änderungen melden muss.
- Nie dabei: `profiles`, Abgaben, Fortschritt, Zeugnisse, Organisationen, Benachrichtigungen, `hai_embeddings` und alles, was Nutzerdaten enthält. Der Code lehnt solche Namen selbst dann ab, wenn sie in der Allowlist stünden. `profiles` und `organizations` werden nur gelesen, um Ids zu übersetzen (E-Mail beziehungsweise Slug).
- Ersteller (`created_by_id`) werden beim Einfügen gesetzt (Profil mit der E-Mail aus `CONTENT_SYNC_OWNER_EMAIL`, falls kein Profil mit gleicher E-Mail existiert) und beim Aktualisieren nie überschrieben.

Tabellen der Allowlist. Als vorläufig gelten alle Schlüssel außer `code`; die stabilen `code`-Spalten entstehen in einem anderen Strang, dann nur `key` in der JSON-Datei anpassen.

| Tabelle                                                                 | Schlüssel                                                                 | Status                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `training_catalogs`                                                     | `code`                                                                    | vorläufig, nur in der Migration eines anderen Branches, optional                                      |
| `courses`                                                               | `title`, `year`, `chapter`                                                | vorläufig                                                                                             |
| `enablers`, `use_cases`                                                 | `course_id`, `title`                                                      | vorläufig                                                                                             |
| `content_documents` (nur Metadaten, ohne `is_indexed_by_hai`)           | `title`, `file_name`, `document_type`                                     | vorläufig                                                                                             |
| `quizzes`                                                               | `title`, `quiz_type`                                                      | vorläufig                                                                                             |
| `enabler_quizzes`, `enabler_quiz_links`                                 | `enabler_id` beziehungsweise `enabler_id`, `difficulty`                   | vorläufig                                                                                             |
| `questions`, `options`                                                  | `quiz_id`, `question_text` beziehungsweise `question_id`, `option_text`   | vorläufig                                                                                             |
| `lernfelder`                                                            | `code`                                                                    | vorläufig (in `schema.ts` ist `lernfelder` doppelt definiert, angenommen ist die Variante mit `code`) |
| `lernfeld_mappings`                                                     | `lernfeld_id`, `enabler_id`, `use_case_id`                                | vorläufig                                                                                             |
| `training_components`                                                   | `code`                                                                    | vorläufig (nach der Katalog-Migration `training_catalog_id`, `code`)                                  |
| `training_use_cases`                                                    | `component_id`, `letter`                                                  | vorläufig                                                                                             |
| `training_catalog_learning_fields`, `training_catalog_content_mappings` | `training_catalog_id`, `code` beziehungsweise Lernfeld, Enabler, Use Case | vorläufig, optional                                                                                   |

Nicht aufgenommen, weil nicht in der Vorgabe genannt: `skills`, `course_skills`, `mes_softskill_criteria`, `certificate_text_templates`, `modules`, `lessons`.

## 9. Migrationen schreiben

- Datei `supabase/migrations/<14 Ziffern>_<name>.sql`, Name in Kleinbuchstaben. Zwei Altdateien mit 12 Ziffern stehen in `supabase/legacy-migrations.txt`.
- Neue Migrationen müssen neuer sein als jede Migration auf `master`. Bereits vorhandene Dateien werden nie geändert, umbenannt oder gelöscht.
- Zerstörende Anweisungen (`drop table`, `drop column`, `drop schema`, `truncate`, `delete` ohne `where`) brauchen die Zeile `-- migration:destructive-ok`.
- Jede Migration wird für `public_preview` umgeschrieben (`public.` wird zu `public_preview.`, `begin` und `commit` werden entfernt). Was sich nicht sicher umschreiben lässt (Rollen, Publikationen, Änderungen an `auth`), lehnt die Prüfung ab. Einen Abschnitt, der für Preview nicht laufen soll, rahmen die Zeilen `-- preview:skip` und `-- preview:end`.
- Katalogabfragen brauchen ein Schema, Erweiterungen `if not exists` und `with schema extensions`.

Prüfen vor dem Push:

- `npm run test:scripts` (Unit-Tests der Skripte, ohne Datenbank)
- `npm run db:migrations:check` und `npm run db:preview:check`
- `node scripts/db/content-sync.mjs --linked` (Trockenlauf, braucht Zugang und läuft normalerweise nur in der CI)

## 10. Rollback-Hinweise

- **App.** Production Deploy deployt immer das letzte Release. Für einen Rückschritt das fehlerhafte Release auf GitHub zurückziehen oder die Markierung "Latest" auf das vorherige Release setzen und "Production Deploy" starten. Alternativ im Vercel-Dashboard auf das vorherige Deployment zurückgehen. Das ändert nur die App, nicht die Datenbank.
- **Datenbank.** Es gibt kein automatisches Zurück. Ein Fehler in einer Migration wird mit einer neuen Migration vorwärts korrigiert. Deshalb gilt: erweitern, dann umstellen, dann aufräumen. Vor riskanten Releases eine Datenbanksicherung anlegen.
- **Inhalte.** Der Abgleich löscht nichts. Ein falsch übernommener Inhalt wird in Production von Hand korrigiert, der Abgleich überschreibt ihn nur, wenn die Quelle neuer ist (`newer`).
- **Teilweise fehlgeschlagenes Release.** Ist die Migration durch und das Deployment gescheitert, "Re-run failed jobs" starten oder "Production Deploy" verwenden. Dessen lesende Prüfung stellt sicher, dass die Migrationen schon angewendet sind.
- **Preview.** Bei kaputtem Zustand "Preview Reset" (erst `plan`, dann `execute`). Das löscht alle Preview-Daten, Production bleibt unberührt.

## 11. Was geprüft ist und was nicht

Geprüft: Unit-Tests der reinen Funktionen (Umschreiben, Prüfregeln, Plan-Berechnung, Allowlist, SQL-Erzeugung, Deploy-Umgebung), Syntax aller Workflows und Skripte, TypeScript, Lint der geänderten App-Dateien, Jest der App-Schema-Auswahl.

Nur statisch geprüft, weil kein Zugriff auf Datenbank, Supabase oder Vercel bestand: das Verhalten gegen die echte Datenbank (Klonen der Struktur per Dump, Umschreiben eines echten Dumps, erzeugtes SQL des Inhaltsabgleichs, SQL-Vorlagen in `supabase/preview-setup`), die Supabase-CLI-Ausgaben (`db push --dry-run`, `db dump`, `db query`), die Environment-Secrets in Composite Actions, die Vercel-Builds. Der erste Lauf jedes Teils sollte ein Plan oder Trockenlauf sein.
